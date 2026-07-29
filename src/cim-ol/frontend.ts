import { Map, View } from "ol";
import Layer from "ol/layer/Layer";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import { fromLonLat } from "ol/proj";
import type { FrameState } from "ol/Map";
import "ol/ol.css";

import { createScenario } from "../universal-core/scenario";
import { UnitLayerController } from "../universal-core/unit-layer";
import type { CimDictionaryItems } from "../cim-dictionary/cim-types";
import { UniversalDictionaryRenderer } from "../cim-dictionary/renderer";
import { createCimHud } from "../cim-dictionary/hud";
import { loadDictionaryItemsJson } from "../cim-dictionary/stylx-macro" with { type: "macro" };

/**
 * OpenLayers adapter for the shared instanced-WebGL point core — the ~100
 * lines RESEARCH.md §1.2 promises: a custom Layer that owns a WebGL canvas
 * and, each frame, hands the renderer a matrix mapping normalized Web
 * Mercator [0..1]² to clip space, derived from the OL view state.
 *
 * Symbology comes from the ArcGIS dictionary content (stylx CIM items +
 * ported dictionary script), rasterized to the shared atlas — no ArcGIS
 * runtime anywhere.
 */

const params = new URLSearchParams(window.location.search);
const UNIT_COUNT = Number(params.get("count")) || 50_000;

/** Web-Mercator world width in meters (EPSG:3857) */
const WORLD = 40075016.68557849;

const hud = createCimHud("OpenLayers");

class CimUnitLayer extends Layer {
  private readonly controller: UnitLayerController;
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private matrix = new Float64Array(16);

  constructor(controller: UnitLayerController) {
    super({});
    this.controller = controller;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.left = "0";
    this.canvas.style.top = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
  }

  override render(frameState: FrameState): HTMLElement {
    const gl =
      this.gl ??
      ((this.canvas.getContext("webgl2", { alpha: true, antialias: true }) ??
        this.canvas.getContext("webgl", { alpha: true, antialias: true })) as
        | WebGLRenderingContext
        | WebGL2RenderingContext);
    if (!this.gl) {
      this.gl = gl;
      this.controller.attach(gl);
    }

    const [widthCss = 0, heightCss = 0] = frameState.size;
    const dpr = frameState.pixelRatio;
    const width = Math.round(widthCss * dpr);
    const height = Math.round(heightCss * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const now = performance.now();
    const view = frameState.viewState;
    this.controller.setZoom(view.zoom);
    this.controller.update(now);

    // mercator [0..1]² → clip space, matching OL's coordinateToPixel chain:
    // translate(-center) → rotate(-rotation) → scale(1/res, -1/res) → screen
    const [cx = 0, cy = 0] = view.center;
    const res = view.resolution;
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    // mercator → 3857 offsets: x = E·mx + tx0, y = -E·my + ty0
    const tx0 = -(0.5 * WORLD + cx);
    const ty0 = 0.5 * WORLD - cy;
    const kx = 2 / (widthCss * res);
    const ky = 2 / (heightCss * res);
    const m = this.matrix;
    m.fill(0);
    m[0] = kx * cos * WORLD; // mx → clipX
    m[1] = -ky * sin * WORLD; // mx → clipY
    m[4] = -kx * sin * WORLD; // my → clipX
    m[5] = -ky * cos * WORLD; // my → clipY
    m[10] = 1;
    m[12] = kx * (cos * tx0 + sin * ty0);
    m[13] = ky * (-sin * tx0 + cos * ty0);
    m[15] = 1;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.controller.renderer?.render(m, width, height, dpr);

    hud.frame(now);
    return this.canvas;
  }
}

async function main() {
  const items = JSON.parse(await loadDictionaryItemsJson()) as CimDictionaryItems;

  console.time("scenario generation");
  const scenario = createScenario(UNIT_COUNT, 0);
  console.timeEnd("scenario generation");

  const dictionaryRenderer = new UniversalDictionaryRenderer({ items });
  const controller = new UnitLayerController(scenario, { atlas: dictionaryRenderer.atlas });

  const map = new Map({
    target: "root",
    layers: [new TileLayer({ preload: 4, source: new OSM() }), new CimUnitLayer(controller)],
    view: new View({
      center: fromLonLat([-98, 38]),
      zoom: 5,
    }),
  });
  (window as unknown as { __map: unknown }).__map = map;

  // continuous repaint for the real-time simulation
  const tick = () => {
    map.render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  hud.set({ units: scenario.count, atlasEntries: controller.atlas.entryCount });
  setInterval(
    () => hud.set({ units: scenario.count, atlasEntries: controller.atlas.entryCount }),
    2000,
  );
}

main();
