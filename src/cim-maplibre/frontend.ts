import maplibregl, { type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createScenario } from "../universal-core/scenario";
import { UnitLayerController } from "../universal-core/unit-layer";
import type { PointSymbolRenderer } from "../universal-core/point-renderer";
import type { CimDictionaryItems } from "../cim-dictionary/cim-types";
import { UniversalDictionaryRenderer } from "../cim-dictionary/renderer";
import { createCimHud } from "../cim-dictionary/hud";
import { loadDictionaryItemsJson } from "../cim-dictionary/stylx-macro" with { type: "macro" };

/**
 * ArcGIS DictionaryRenderer semantics without ArcGIS: the stylx CIM items are
 * inlined at build time, the ported dictionary script + Canvas rasterizer
 * turn SIDCs into sprites, and the shared instanced-WebGL core draws them
 * through MapLibre's CustomLayerInterface.
 */

const params = new URLSearchParams(window.location.search);
const UNIT_COUNT = Number(params.get("count")) || 50_000;

const hud = createCimHud("MapLibre");

const REMOTE_STYLE = "https://demotiles.maplibre.org/style.json";

/** fall back to a self-contained style when the tile CDN is unreachable */
async function resolveStyle(): Promise<string | maplibregl.StyleSpecification> {
  try {
    const response = await fetch(REMOTE_STYLE, { signal: AbortSignal.timeout(4000) });
    if (response.ok) return REMOTE_STYLE;
  } catch {
    // offline / blocked network
  }
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#10141a" } }],
  };
}

async function main() {
  const items = JSON.parse(await loadDictionaryItemsJson()) as CimDictionaryItems;

  const map = new maplibregl.Map({
    container: "root",
    style: await resolveStyle(),
    center: [-98, 38],
    zoom: 4,
  });
  (window as unknown as { __map: unknown }).__map = map;

  console.time("scenario generation");
  const scenario = createScenario(UNIT_COUNT, 0);
  console.timeEnd("scenario generation");

  const dictionaryRenderer = new UniversalDictionaryRenderer({ items });
  const controller = new UnitLayerController(scenario, { atlas: dictionaryRenderer.atlas });
  let renderer: PointSymbolRenderer | null = null;

  const unitLayer: maplibregl.CustomLayerInterface = {
    id: "cim-dictionary-units",
    type: "custom",
    renderingMode: "2d",
    onAdd(_map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      renderer = controller.attach(gl);
    },
    onRemove() {
      controller.detach();
      renderer = null;
    },
    render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
      if (!renderer) return;
      const now = performance.now();
      controller.setZoom(map.getZoom());
      const animating = controller.update(now);
      // MapLibre v5 passes an input object; older majors pass the matrix itself
      const raw: ArrayLike<number> = (args as CustomRenderMethodInput)?.modelViewProjectionMatrix
        ? ((args as CustomRenderMethodInput)
            .modelViewProjectionMatrix as unknown as ArrayLike<number>)
        : (args as unknown as ArrayLike<number>);
      // v5's matrix maps mercator scaled by worldSize (world pixels); the shared
      // core works in mercator [0..1], so fold the scale into the matrix (f64)
      const worldSize: number =
        (map as unknown as { transform?: { worldSize?: number } }).transform?.worldSize ??
        512 * Math.pow(2, map.getZoom());
      const matrix = new Float64Array(raw as ArrayLike<number>);
      for (let i = 0; i < 8; i++) matrix[i]! *= worldSize;
      renderer.render(
        matrix,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        window.devicePixelRatio || 1,
      );
      hud.frame(now);
      if (animating) map.triggerRepaint();
    },
  };

  map.on("load", () => {
    map.addLayer(unitLayer);
    pushHud();
    setInterval(pushHud, 2000);
  });

  function pushHud() {
    hud.set({ units: scenario.count, atlasEntries: controller.atlas.entryCount });
  }
}

main();
