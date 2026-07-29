import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import Layer from "@arcgis/core/layers/Layer";
import BaseLayerViewGL2D from "@arcgis/core/views/2d/layers/BaseLayerViewGL2D";
import "@arcgis/core/assets/esri/themes/dark/main.css";

import { createScenario } from "../universal-core/scenario";
import { UnitLayerController } from "../universal-core/unit-layer";
import type { CimDictionaryItems } from "../cim-dictionary/cim-types";
import { UniversalDictionaryRenderer } from "../cim-dictionary/renderer";
import { createCimHud } from "../cim-dictionary/hud";
import { loadDictionaryItemsJson } from "../cim-dictionary/stylx-macro" with { type: "macro" };

/**
 * The point of this demo: *replace* `@arcgis/core` `DictionaryRenderer`
 * inside ArcGIS itself. Same dictionary content (the APP6-D stylx), same
 * key/override semantics — but instead of ArcGIS's per-feature CPU CIM
 * evaluation (~10k practical, see arcgis-dictionary-local), symbols are
 * rasterized once per unique SIDC+amplifier combo into a shared texture
 * atlas and drawn as instanced quads through BaseLayerViewGL2D. The very
 * same UniversalDictionaryRenderer instance drives the MapLibre and
 * OpenLayers demos — one renderer, any engine.
 */

const params = new URLSearchParams(window.location.search);
const UNIT_COUNT = Number(params.get("count")) || 50_000;

const hud = createCimHud("ArcGIS");

/** Web-Mercator world circumference in meters */
const WORLD = 40075016.68557849;

/**
 * Build the merc[0..1] → clip matrix from the ArcGIS render state — this is
 * the entire per-engine cost of reusing the shared WebGL core.
 */
function arcgisMatrix(
  state: {
    center: number[];
    resolution: number;
    rotation: number;
    size: number[];
    pixelRatio: number;
  },
  out: Float64Array,
): Float64Array {
  const [cx, cy] = state.center as [number, number];
  const theta = (Math.PI * state.rotation) / 180;
  const s = state.pixelRatio / state.resolution;
  const devW = state.size[0]! * state.pixelRatio;
  const devH = state.size[1]! * state.pixelRatio;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // meters relative to view center: dx = W*u - (W/2 + cx); dy = -W*v + (W/2 - cy)
  // screen px: [s*(cos*dx + sin*dy), s*(sin*dx - cos*dy)] + [devW/2, devH/2]
  // clip: x' = 2*sx/devW - 1 ; y' = 1 - 2*sy/devH
  const kx = 2 / devW;
  const ky = 2 / devH;
  const tx = -(WORLD / 2 + cx);
  const ty = WORLD / 2 - cy;

  out.fill(0);
  out[0] = kx * s * cos * WORLD;
  out[4] = kx * s * sin * -WORLD;
  out[12] = kx * s * (cos * tx + sin * ty);
  out[1] = -ky * s * sin * WORLD;
  out[5] = -ky * s * cos * WORLD;
  out[13] = -ky * s * (sin * tx - cos * ty);
  out[10] = 1;
  out[15] = 1;
  return out;
}

async function main() {
  const items = JSON.parse(await loadDictionaryItemsJson()) as CimDictionaryItems;

  console.time("scenario generation");
  const scenario = createScenario(UNIT_COUNT, 0);
  console.timeEnd("scenario generation");

  const dictionaryRenderer = new UniversalDictionaryRenderer({ items });
  const controller = new UnitLayerController(scenario, { atlas: dictionaryRenderer.atlas });

  // @ts-expect-error createSubclass is not in the type definitions
  const UnitsLayerView2D = BaseLayerViewGL2D.createSubclass({
    attach: function () {
      this.matrix = new Float64Array(16);
      this.renderer = controller.attach(this.context);
    },
    detach: function () {
      controller.detach();
      this.renderer = null;
    },
    render: function (renderParameters: { context: WebGLRenderingContext; state: any }) {
      if (!this.renderer) return;
      const now = performance.now();
      const state = renderParameters.state;
      // derive zoom from resolution — view.zoom is -1 when there is no basemap
      controller.setZoom(Math.log2(156543.03392804097 / state.resolution));
      const animating = controller.update(now);
      const gl = renderParameters.context;
      this.renderer.render(
        arcgisMatrix(state, this.matrix),
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        state.pixelRatio,
      );
      hud.frame(now);
      if (animating) this.requestRender();
    },
  });

  // @ts-expect-error createSubclass is not in the type definitions
  const UnitsLayer = Layer.createSubclass({
    createLayerView: function (view: { type: string }) {
      if (view.type === "2d") {
        return new UnitsLayerView2D({ view, layer: this });
      }
    },
  });

  // fall back to a blank web-mercator view when the basemap CDN is unreachable
  let online = true;
  try {
    const probe = await fetch("https://basemaps-api.arcgis.com/arcgis/rest/info?f=json", {
      signal: AbortSignal.timeout(4000),
    });
    online = probe.ok;
  } catch {
    online = false;
  }

  const map = new Map({
    basemap: online ? "dark-gray-vector" : undefined,
    layers: [new UnitsLayer()],
  });

  const view = new MapView({
    container: "root",
    map,
    center: [-98, 38],
    // zoom needs a basemap tiling scheme; scale works on a blank view too
    ...(online ? { zoom: 4 } : { scale: 36978595.24 }),
    spatialReference: { wkid: 102100 },
  });
  view.container!.style.background = "#10141a";

  (window as unknown as { __view: unknown }).__view = view;

  await view.when();
  pushHud();
  setInterval(pushHud, 2000);

  function pushHud() {
    hud.set({ units: scenario.count, atlasEntries: controller.atlas.entryCount });
  }
}

main();
