// @ts-nocheck

import { mat3, vec2, vec3 } from "gl-matrix";
import Map from "@arcgis/core/Map";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import BaseLayerViewGL2D from "@arcgis/core/views/2d/layers/BaseLayerViewGL2D";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import atlasImgUrl from "./public/app6d.png" with { type: "file" };
import spriteMetaUrl from "./public/app6d.json" with { type: "file" };

// @ts-expect-error `createSubclass` is not in type definitions while it official documentation
const CustomLayerView2D = BaseLayerViewGL2D.createSubclass({
  aPosition: 0,
  aOffset: 1,
  aUV: 2,
  aSize: 3,

  constructor: function () {
    this.transform = mat3.create();
    this.translationToCenter = vec2.create();
    this.screenTranslation = vec2.create();
    this.display = mat3.fromValues(NaN, 0, 0, 0, NaN, 0, -1, 1, 1);
    this.screenScaling = vec3.fromValues(NaN, NaN, 1);
    this.needsUpdate = false;

    // --- ANIMATION STATE ---
    this.animationFrame = null;
    this.lastPositionUpdateTime = 0;
    this.lastSidcUpdateTime = 0;
  },

  attach: function () {
    const gl = this.context;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.layer.atlasImg);

    const vertexSource = `
                    precision highp float;
                    uniform mat3 u_transform;
                    uniform mat3 u_display;
                    attribute vec2 a_position;
                    attribute vec2 a_offset;
                    attribute vec2 a_uv;
                    attribute vec2 a_size;
                    varying vec2 v_uv;
                    void main(void) {
                        gl_Position.xy = (u_display * (u_transform * vec3(a_position, 1.0) + vec3(a_offset * a_size, 0.0))).xy;
                        gl_Position.zw = vec2(0.0, 1.0);
                        v_uv = a_uv;
                    }`;

    const fragmentSource = `
                    precision highp float;
                    uniform sampler2D u_tex;
                    varying vec2 v_uv;
                    void main(void) {
                        gl_FragColor = texture2D(u_tex, v_uv);
                        if (gl_FragColor.a < 0.05) discard;
                    }`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);

    gl.bindAttribLocation(this.program, this.aPosition, "a_position");
    gl.bindAttribLocation(this.program, this.aOffset, "a_offset");
    gl.bindAttribLocation(this.program, this.aUV, "a_uv");
    gl.bindAttribLocation(this.program, this.aSize, "a_size");

    gl.linkProgram(this.program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    this.uTransform = gl.getUniformLocation(this.program, "u_transform");
    this.uDisplay = gl.getUniformLocation(this.program, "u_display");
    this.uTex = gl.getUniformLocation(this.program, "u_tex");

    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.indexBufferSize = 0;

    this.centerAtLastUpdate = vec2.fromValues(this.view.state.center[0], this.view.state.center[1]);

    const requestUpdate = () => {
      this.needsUpdate = true;
      this.requestRender();
    };

    // This watcher is still useful for external changes to the graphics collection
    this.watcher = reactiveUtils.on(() => this.layer.graphics, "change", requestUpdate);

    // --- START ANIMATION LOOP ---
    this.animate();
  },

  detach: function () {
    // --- STOP ANIMATION LOOP ---
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.watcher.remove();
    const gl = this.context;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
  },

  // --- NEW ANIMATION METHOD ---
  animate: function () {
    const now = Date.now();
    let needsRender = false;

    // Update positions every 1000ms (1 second)
    if (now - this.lastPositionUpdateTime > 1000) {
      this.lastPositionUpdateTime = now;
      needsRender = true;

      this.layer.graphics.forEach((graphic) => {
        const newPoint = graphic.geometry.clone();
        // Adjust multiplier for more/less movement
        const moveFactor = 5000;
        newPoint.x += (Math.random() - 0.5) * moveFactor;
        newPoint.y += (Math.random() - 0.5) * moveFactor;
        graphic.geometry = newPoint;
      });
    }

    // Update SIDC every 10000ms (10 seconds)
    if (now - this.lastSidcUpdateTime > 10000) {
      this.lastSidcUpdateTime = now;
      needsRender = true;

      const keys = this.layer.sidcKeys; // Use a pre-calculated list from the layer
      this.layer.graphics.forEach((graphic) => {
        const randomSidc = keys[Math.floor(Math.random() * keys.length)];
        // Cloning attributes is a robust way to ensure change detection
        graphic.attributes = { ...graphic.attributes, sidc: randomSidc };
      });
    }

    if (needsRender) {
      this.needsUpdate = true;
      this.requestRender();
    }

    // Continue the loop
    this.animationFrame = requestAnimationFrame(this.animate.bind(this));
  },

  render: function (renderParameters) {
    /* ... unchanged ... */
    const gl = renderParameters.context;
    const state = renderParameters.state;

    this.updatePositions(renderParameters);

    if (this.indexBufferSize === 0) return;

    mat3.identity(this.transform);
    this.screenTranslation[0] = (state.pixelRatio * state.size[0]) / 2;
    this.screenTranslation[1] = (state.pixelRatio * state.size[1]) / 2;
    mat3.translate(this.transform, this.transform, this.screenTranslation);
    mat3.rotate(this.transform, this.transform, (Math.PI * state.rotation) / 180);
    this.screenScaling[0] = state.pixelRatio / state.resolution;
    this.screenScaling[1] = -state.pixelRatio / state.resolution;
    mat3.scale(this.transform, this.transform, this.screenScaling);
    mat3.translate(this.transform, this.transform, this.translationToCenter);

    this.display[0] = 2 / (state.pixelRatio * state.size[0]);
    this.display[4] = -2 / (state.pixelRatio * state.size[1]);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uTransform, false, this.transform);
    gl.uniformMatrix3fv(this.uDisplay, false, this.display);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const stride = 8 * 4;
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aOffset);
    gl.vertexAttribPointer(this.aOffset, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(this.aSize);
    gl.vertexAttribPointer(this.aSize, 2, gl.FLOAT, false, stride, 24);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawElements(gl.TRIANGLES, this.indexBufferSize, gl.UNSIGNED_SHORT, 0);
  },

  updatePositions: function (renderParameters) {
    /* ... unchanged ... */
    const gl = renderParameters.context;
    const stationary = renderParameters.stationary;
    const state = renderParameters.state;
    const graphics = this.layer.graphics;
    const uvAtlasMeta = this.layer.uvAtlasMeta;
    const spriteMeta = this.layer.spriteMeta;

    if (!stationary) {
      vec2.sub(this.translationToCenter, this.centerAtLastUpdate, state.center);
      this.requestRender();
      return;
    }
    if (!this.needsUpdate && this.translationToCenter[0] === 0 && this.translationToCenter[1] === 0)
      return;

    this.centerAtLastUpdate.set(state.center);
    this.translationToCenter[0] = 0;
    this.translationToCenter[1] = 0;
    this.needsUpdate = false;

    const vertexData = new Float32Array(graphics.length * 4 * 8);
    const indexData = new Uint16Array(graphics.length * 6);
    let vIdx = 0;
    let iIdx = 0;

    graphics.forEach((graphic, i) => {
      const point = graphic.geometry;
      const sidc = graphic.attributes.sidc;
      const uv = uvAtlasMeta[sidc];
      const sprite = spriteMeta[sidc];
      if (!uv || !sprite || !point) return;

      const x = point.x - this.centerAtLastUpdate[0];
      const y = point.y - this.centerAtLastUpdate[1];
      const width = sprite.width || 32;
      const height = sprite.height || 32;

      vertexData[vIdx++] = x;
      vertexData[vIdx++] = y;
      vertexData[vIdx++] = -0.5;
      vertexData[vIdx++] = 0.5;
      vertexData[vIdx++] = uv.u0;
      vertexData[vIdx++] = uv.v0;
      vertexData[vIdx++] = width;
      vertexData[vIdx++] = height;
      vertexData[vIdx++] = x;
      vertexData[vIdx++] = y;
      vertexData[vIdx++] = -0.5;
      vertexData[vIdx++] = -0.5;
      vertexData[vIdx++] = uv.u0;
      vertexData[vIdx++] = uv.v1;
      vertexData[vIdx++] = width;
      vertexData[vIdx++] = height;
      vertexData[vIdx++] = x;
      vertexData[vIdx++] = y;
      vertexData[vIdx++] = 0.5;
      vertexData[vIdx++] = 0.5;
      vertexData[vIdx++] = uv.u1;
      vertexData[vIdx++] = uv.v0;
      vertexData[vIdx++] = width;
      vertexData[vIdx++] = height;
      vertexData[vIdx++] = x;
      vertexData[vIdx++] = y;
      vertexData[vIdx++] = 0.5;
      vertexData[vIdx++] = -0.5;
      vertexData[vIdx++] = uv.u1;
      vertexData[vIdx++] = uv.v1;
      vertexData[vIdx++] = width;
      vertexData[vIdx++] = height;

      const baseIndex = i * 4;
      indexData[iIdx++] = baseIndex + 0;
      indexData[iIdx++] = baseIndex + 1;
      indexData[iIdx++] = baseIndex + 2;
      indexData[iIdx++] = baseIndex + 2;
      indexData[iIdx++] = baseIndex + 1;
      indexData[iIdx++] = baseIndex + 3;
    });

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

    this.indexBufferSize = indexData.length;
  },
});

const CustomLayer = GraphicsLayer.createSubclass({
  properties: {
    atlasImg: null,
    uvAtlasMeta: null,
    spriteMeta: null,
    sidcKeys: null, // Property to hold the list of keys
  },
  createLayerView: function (view) {
    if (view.type === "2d") {
      return new CustomLayerView2D({ view: view, layer: this });
    }
  },
});

(async function () {
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  const atlasImg = await loadImage(atlasImgUrl);
  const spriteMeta = await fetch(spriteMetaUrl).then((r) => r.json());

  const { width: imgWidth, height: imgHeight } = atlasImg;
  const uvAtlasMeta = {};
  for (const sidc in spriteMeta) {
    const { x, y, width, height } = spriteMeta[sidc];
    uvAtlasMeta[sidc] = {
      u0: x / imgWidth,
      v0: y / imgHeight,
      u1: (x + width) / imgWidth,
      v1: (y + height) / imgHeight,
    };
  }

  const keys = Object.keys(uvAtlasMeta).filter((x) => x.charAt(4) == "3");
  const graphics = [];
  for (let i = 0; i < 50_000; i++) {
    const sidc = keys[i % keys.length];
    const geographicPoint = {
      type: "point",
      x: -125 + Math.random() * 55,
      y: 25 + Math.random() * 25,
    };
    const mercatorPoint = webMercatorUtils.geographicToWebMercator(geographicPoint);
    graphics.push(
      new Graphic({
        geometry: mercatorPoint,
        attributes: { sidc: sidc, id: i },
      }),
    );
  }

  const layer = new CustomLayer({
    graphics: graphics,
    atlasImg: atlasImg,
    uvAtlasMeta: uvAtlasMeta,
    spriteMeta: spriteMeta,
    sidcKeys: keys, // Pass the keys to the layer for easy access
  });

  const map = new Map({
    basemap: "dark-gray-vector",
    layers: [layer],
  });

  const view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-98, 39],
    zoom: 4,
  });
})();
