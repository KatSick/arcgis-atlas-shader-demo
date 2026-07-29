import type { SymbolAtlas } from "./symbol-atlas";

/**
 * Engine-agnostic instanced point-symbol renderer.
 *
 * Contract with the host map engine (the whole universality trick):
 *   - a WebGL1/WebGL2 context, shared with the engine,
 *   - per frame: a 4x4 matrix mapping normalized Web-Mercator [0..1]² to clip
 *     space, the drawing-buffer size in device px and the device pixel ratio.
 *
 * Everything else (MapLibre custom layer, ArcGIS BaseLayerViewGL2D, OpenLayers
 * custom layer, deck.gl...) is a thin adapter that supplies those inputs.
 *
 * Instance data lives in two buffers so real-time updates touch as little
 * memory as possible:
 *   - positions (2 f32 / instance, mercator [0..1] relative to `origin`),
 *     re-uploaded every frame a simulation step ran — 50k instances = 400 kB,
 *   - styles (8 f32 / instance: uv rect, quad size, anchor), re-uploaded only
 *     when symbology changes.
 *
 * Positions are stored relative to a fixed origin and the origin translation
 * is folded into the matrix in float64 on the CPU, so float32 vertex precision
 * does not cause jitter at high zoom.
 */
export class PointSymbolRenderer {
  static readonly STYLE_FLOATS = 8;

  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private atlas: SymbolAtlas;
  private origin: [number, number];

  private program: WebGLProgram;
  private texture: WebGLTexture;
  private cornerBuffer: WebGLBuffer;
  private positionBuffer: WebGLBuffer;
  private styleBuffer: WebGLBuffer;

  private aCorner: number;
  private aPos: number;
  private aUV: number;
  private aBox: number;
  private uMatrix: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uDpr: WebGLUniformLocation;
  private uTex: WebGLUniformLocation;

  private instanceCount = 0;
  private positionsDirty = false;
  private stylesDirty = false;
  private positions: Float32Array = new Float32Array(0);
  private styles: Float32Array = new Float32Array(0);

  private vertexAttribDivisor: (index: number, divisor: number) => void;
  private drawArraysInstanced: (
    mode: number,
    first: number,
    count: number,
    primcount: number,
  ) => void;

  private matrix64 = new Float64Array(16);
  private matrix32 = new Float32Array(16);

  constructor(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    atlas: SymbolAtlas,
    origin: [number, number],
  ) {
    this.gl = gl;
    this.atlas = atlas;
    this.origin = origin;

    if ("drawArraysInstanced" in gl) {
      const gl2 = gl as WebGL2RenderingContext;
      this.vertexAttribDivisor = (i, d) => gl2.vertexAttribDivisor(i, d);
      this.drawArraysInstanced = (m, f, c, p) => gl2.drawArraysInstanced(m, f, c, p);
    } else {
      const ext = gl.getExtension("ANGLE_instanced_arrays");
      if (!ext) throw new Error("PointSymbolRenderer: instancing not supported");
      this.vertexAttribDivisor = (i, d) => ext.vertexAttribDivisorANGLE(i, d);
      this.drawArraysInstanced = (m, f, c, p) => ext.drawArraysInstancedANGLE(m, f, c, p);
    }

    const vertexSource = `
      precision highp float;
      attribute vec2 a_corner;
      attribute vec2 a_pos;
      attribute vec4 a_uv;
      attribute vec4 a_box;
      uniform mat4 u_matrix;
      uniform vec2 u_viewport;
      uniform float u_dpr;
      varying vec2 v_uv;
      void main() {
        vec4 p = u_matrix * vec4(a_pos, 0.0, 1.0);
        vec2 px = (a_corner * a_box.xy - a_box.zw) * u_dpr;
        p.xy += vec2(px.x * 2.0 / u_viewport.x, -px.y * 2.0 / u_viewport.y) * p.w;
        gl_Position = p;
        v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
      }`;

    const fragmentSource = `
      precision mediump float;
      uniform sampler2D u_tex;
      varying vec2 v_uv;
      void main() {
        vec4 color = texture2D(u_tex, v_uv);
        if (color.a < 0.01) discard;
        gl_FragColor = color;
      }`;

    this.program = this.createProgram(vertexSource, fragmentSource);
    this.aCorner = gl.getAttribLocation(this.program, "a_corner");
    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.aUV = gl.getAttribLocation(this.program, "a_uv");
    this.aBox = gl.getAttribLocation(this.program, "a_box");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix")!;
    this.uViewport = gl.getUniformLocation(this.program, "u_viewport")!;
    this.uDpr = gl.getUniformLocation(this.program, "u_dpr")!;
    this.uTex = gl.getUniformLocation(this.program, "u_tex")!;

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      atlas.size,
      atlas.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    this.cornerBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.positionBuffer = gl.createBuffer()!;
    this.styleBuffer = gl.createBuffer()!;
  }

  /** positions: 2 floats per instance, mercator [0..1] minus origin */
  setPositions(positions: Float32Array, count: number): void {
    this.positions = positions;
    this.instanceCount = count;
    this.positionsDirty = true;
  }

  /** styles: 8 floats per instance: u0,v0,u1,v1, width,height, anchorX,anchorY */
  setStyles(styles: Float32Array): void {
    this.styles = styles;
    this.stylesDirty = true;
  }

  markPositionsDirty(): void {
    this.positionsDirty = true;
  }

  markStylesDirty(): void {
    this.stylesDirty = true;
  }

  /**
   * @param matrix 16 numbers (f64 ok), maps mercator [0..1]² to clip space
   * @param viewportWidth drawing buffer width in device px
   * @param viewportHeight drawing buffer height in device px
   * @param dpr device px per CSS px
   */
  render(
    matrix: ArrayLike<number>,
    viewportWidth: number,
    viewportHeight: number,
    dpr: number,
  ): void {
    const gl = this.gl;
    if (this.instanceCount === 0) return;

    this.uploadPendingSprites();

    if (this.positionsDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STREAM_DRAW);
      this.positionsDirty = false;
    }
    if (this.stylesDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.styleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.styles, gl.DYNAMIC_DRAW);
      this.stylesDirty = false;
    }

    // Fold the origin translation into the matrix in float64 so the f32
    // per-vertex positions stay small and precise.
    const m = this.matrix64;
    for (let i = 0; i < 16; i++) m[i] = matrix[i]!;
    const [ox, oy] = this.origin;
    m[12] = m[0]! * ox + m[4]! * oy + m[12]!;
    m[13] = m[1]! * ox + m[5]! * oy + m[13]!;
    m[14] = m[2]! * ox + m[6]! * oy + m[14]!;
    m[15] = m[3]! * ox + m[7]! * oy + m[15]!;
    this.matrix32.set(m);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMatrix, false, this.matrix32);
    gl.uniform2f(this.uViewport, viewportWidth, viewportHeight);
    gl.uniform1f(this.uDpr, dpr);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(this.aCorner);
    gl.vertexAttribPointer(this.aCorner, 2, gl.FLOAT, false, 0, 0);
    this.vertexAttribDivisor(this.aCorner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 8, 0);
    this.vertexAttribDivisor(this.aPos, 1);

    const styleStride = PointSymbolRenderer.STYLE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.styleBuffer);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 4, gl.FLOAT, false, styleStride, 0);
    this.vertexAttribDivisor(this.aUV, 1);
    gl.enableVertexAttribArray(this.aBox);
    gl.vertexAttribPointer(this.aBox, 4, gl.FLOAT, false, styleStride, 16);
    this.vertexAttribDivisor(this.aBox, 1);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // atlas uploads are premultiplied
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);

    // Restore attribute state so the host engine's own draws are unaffected —
    // a leaked divisor on a shared attrib index corrupts basemap rendering.
    this.vertexAttribDivisor(this.aPos, 0);
    this.vertexAttribDivisor(this.aUV, 0);
    this.vertexAttribDivisor(this.aBox, 0);
    gl.disableVertexAttribArray(this.aCorner);
    gl.disableVertexAttribArray(this.aPos);
    gl.disableVertexAttribArray(this.aUV);
    gl.disableVertexAttribArray(this.aBox);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.styleBuffer);
  }

  private uploadPendingSprites(): void {
    const gl = this.gl;
    const pending = this.atlas.pendingUploads;
    if (pending.length === 0) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const upload of pending) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        upload.x,
        upload.y,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        upload.canvas,
      );
    }
    pending.length = 0;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }
}
