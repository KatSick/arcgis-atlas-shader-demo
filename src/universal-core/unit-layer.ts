import { PointSymbolRenderer } from "./point-renderer";
import { SymbolAtlas } from "./symbol-atlas";
import type { Scenario } from "./scenario";

/** zoom level at which text amplifiers get baked into the icons */
export const TEXT_AMPLIFIER_ZOOM = 8;

/**
 * Engine-agnostic glue between the scenario (data + simulation), the symbol
 * atlas and the instanced renderer. Each map adapter owns exactly one of
 * these; all it must provide is a GL context, the current zoom and per-frame
 * timestamps.
 */
export class UnitLayerController {
  readonly scenario: Scenario;
  readonly atlas: SymbolAtlas;
  renderer: PointSymbolRenderer | null = null;

  private styleData: Float32Array;
  private withText = false;
  private lastFrameTime = 0;
  private lastMutationTime = 0;
  private readonly mutationIntervalMs: number;

  constructor(scenario: Scenario, opts?: { mutationIntervalMs?: number }) {
    this.scenario = scenario;
    this.atlas = new SymbolAtlas();
    this.styleData = new Float32Array(scenario.count * PointSymbolRenderer.STYLE_FLOATS);
    this.mutationIntervalMs = opts?.mutationIntervalMs ?? 10_000;
  }

  attach(gl: WebGLRenderingContext | WebGL2RenderingContext): PointSymbolRenderer {
    this.renderer = new PointSymbolRenderer(gl, this.atlas, this.scenario.origin);
    this.rebuildStyles();
    this.renderer.setPositions(this.scenario.positions, this.scenario.count);
    this.renderer.setStyles(this.styleData);
    return this.renderer;
  }

  detach(): void {
    this.renderer?.destroy();
    this.renderer = null;
  }

  /** Call when zoom changes; rebuilds all styles when the text gate flips. */
  setZoom(zoom: number): void {
    const withText = zoom >= TEXT_AMPLIFIER_ZOOM;
    if (withText === this.withText) return;
    this.withText = withText;
    this.rebuildStyles();
    this.renderer?.markStylesDirty();
  }

  /**
   * Advance the real-time simulation. Returns true while animating so the
   * adapter keeps scheduling repaints.
   */
  update(nowMs: number): boolean {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = nowMs;
      this.lastMutationTime = nowMs;
      return true;
    }
    const dt = Math.min((nowMs - this.lastFrameTime) / 1000, 0.25);
    this.lastFrameTime = nowMs;

    if (this.scenario.step(dt)) {
      this.renderer?.markPositionsDirty();
    }

    if (nowMs - this.lastMutationTime > this.mutationIntervalMs) {
      this.lastMutationTime = nowMs;
      const changed = this.scenario.mutateSymbols();
      for (const i of changed) this.writeStyle(i);
      if (changed.length > 0) this.renderer?.markStylesDirty();
    }
    return true;
  }

  private rebuildStyles(): void {
    for (let i = 0; i < this.scenario.count; i++) this.writeStyle(i);
  }

  private writeStyle(i: number): void {
    const entry = this.atlas.get(this.scenario.styles[i]!, this.withText);
    const base = i * PointSymbolRenderer.STYLE_FLOATS;
    const data = this.styleData;
    data[base] = entry.u0;
    data[base + 1] = entry.v0;
    data[base + 2] = entry.u1;
    data[base + 3] = entry.v1;
    data[base + 4] = entry.width;
    data[base + 5] = entry.height;
    data[base + 6] = entry.anchorX;
    data[base + 7] = entry.anchorY;
  }
}
