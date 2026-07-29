import maplibregl, { type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createScenario } from "../universal-core/scenario";
import { UnitLayerController } from "../universal-core/unit-layer";
import { initTactical, TacticalScheduler } from "../universal-core/tactical";
import { createHud } from "../universal-core/hud";
import type { PointSymbolRenderer } from "../universal-core/point-renderer";

const params = new URLSearchParams(window.location.search);
const UNIT_COUNT = Number(params.get("count")) || 50_000;
const TACTICAL_COUNT = Number(params.get("tactical")) || 10_000;

const hud = createHud("MapLibre");

const REMOTE_STYLE = "https://demotiles.maplibre.org/style.json";

/** fall back to a self-contained style when the tile CDN is unreachable */
async function resolveStyle(): Promise<{
  style: string | maplibregl.StyleSpecification;
  online: boolean;
}> {
  try {
    const response = await fetch(REMOTE_STYLE, { signal: AbortSignal.timeout(4000) });
    if (response.ok) return { style: REMOTE_STYLE, online: true };
  } catch {
    // offline / blocked network
  }
  return {
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#10141a" } }],
    },
    online: false,
  };
}

async function main() {
  const { style, online } = await resolveStyle();
  const map = new maplibregl.Map({
    container: "root",
    style,
    center: [-98, 38],
    zoom: 4,
  });
  (window as unknown as { __map: unknown }).__map = map;

  await initTactical();

  console.time("scenario generation");
  const scenario = createScenario(UNIT_COUNT, TACTICAL_COUNT);
  console.timeEnd("scenario generation");

  const controller = new UnitLayerController(scenario);
  let renderer: PointSymbolRenderer | null = null;

  // ---- 50k point symbols: shared instanced WebGL core via a custom layer ----
  const unitLayer: maplibregl.CustomLayerInterface = {
    id: "app6d-units",
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

  // ---- multipoint tactical graphics: mil-sym-ts GeoJSON on native layers ----
  // 10k graphics need the incremental scheduler: viewport cull + screen-size
  // LOD + zoom-bucketed cache + chunked generation streaming into setData
  const scheduler = new TacticalScheduler(scenario.tacticalGraphics);
  let tacticalShown = 0;
  const refreshTactical = () => {
    const bounds = map.getBounds();
    const canvas = map.getCanvas();
    scheduler.request(
      {
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        widthPx: canvas.clientWidth,
        heightPx: canvas.clientHeight,
        zoom: map.getZoom(),
      },
      (update) => {
        const source = map.getSource("tactical") as maplibregl.GeoJSONSource | undefined;
        source?.setData(update.collection);
        tacticalShown = update.visible;
        pushHud();
      },
    );
  };

  map.on("load", () => {
    map.addSource("tactical", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "tactical-fill",
      type: "fill",
      source: "tactical",
      filter: ["==", ["get", "kind"], "fill"],
      paint: {
        "fill-color": ["coalesce", ["get", "fill"], "rgba(0,0,0,0)"],
        "fill-outline-color": ["get", "stroke"],
      },
    });
    map.addLayer({
      id: "tactical-line",
      type: "line",
      source: "tactical",
      filter: ["!=", ["get", "kind"], "label"],
      paint: {
        "line-color": ["get", "stroke"],
        "line-width": ["get", "strokeWidth"],
      },
    });
    map.addLayer({
      id: "tactical-line-dash",
      type: "line",
      source: "tactical",
      filter: ["all", ["!=", ["get", "kind"], "label"], ["to-boolean", ["get", "dash"]]],
      paint: {
        "line-color": ["get", "stroke"],
        "line-width": ["get", "strokeWidth"],
        "line-dasharray": [2, 2],
      },
    });
    if (online)
      map.addLayer({
        id: "tactical-labels",
        type: "symbol",
        source: "tactical",
        filter: ["==", ["get", "kind"], "label"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["get", "labelSize"],
          "text-rotate": ["get", "labelAngle"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["get", "labelColor"],
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1,
        },
      });

    map.addLayer(unitLayer);

    refreshTactical();
    pushHud();
    setInterval(pushHud, 2000);
  });

  function pushHud() {
    hud.set({
      units: scenario.count,
      tacticalShown,
      tacticalTotal: scenario.tacticalGraphics.length,
      atlasEntries: controller.atlas.entryCount,
    });
  }

  // multipoint graphics are view-dependent (arrowheads, ticks, labels are
  // screen-space): regenerate when the camera settles
  map.on("moveend", refreshTactical);
}

main();
