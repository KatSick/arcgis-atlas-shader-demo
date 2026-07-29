import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Layer from "@arcgis/core/layers/Layer";
import BaseLayerViewGL2D from "@arcgis/core/views/2d/layers/BaseLayerViewGL2D";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import "@arcgis/core/assets/esri/themes/dark/main.css";

import { createScenario } from "../universal-core/scenario";
import { UnitLayerController } from "../universal-core/unit-layer";
import {
  initTactical,
  listMultipointControlMeasures,
  TacticalScheduler,
} from "../universal-core/tactical";
import { createHud } from "../universal-core/hud";

const params = new URLSearchParams(window.location.search);
const UNIT_COUNT = Number(params.get("count")) || 50_000;
const TACTICAL_COUNT = Number(params.get("tactical")) || 10_000;

const hud = createHud("ArcGIS");

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
  await initTactical();

  console.time("scenario generation");
  const scenario = createScenario(UNIT_COUNT, TACTICAL_COUNT, listMultipointControlMeasures());
  console.timeEnd("scenario generation");

  const controller = new UnitLayerController(scenario);

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

  // ---- multipoint tactical graphics: mil-sym-ts GeoJSON → GraphicsLayer ----
  const tacticalLayer = new GraphicsLayer();

  const cssToEsriColor = (css: string | null | undefined): number[] | string => {
    if (!css) return [0, 255, 255, 1];
    const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
    return css; // hex string — esri Color autocasts CSS color strings
  };

  const featuresToGraphics = (features: GeoJSON.Feature[]): Graphic[] => {
    const graphics: Graphic[] = [];
    for (const feature of features) {
      const props = feature.properties as Record<string, any>;
      const geometry = feature.geometry;
      if (geometry.type === "Point" && props.kind === "label") {
        graphics.push(
          new Graphic({
            geometry: {
              // @ts-expect-error autocast
              type: "point",
              longitude: geometry.coordinates[0],
              latitude: geometry.coordinates[1],
            },
            symbol: {
              // @ts-expect-error autocast
              type: "text",
              text: props.label,
              color: cssToEsriColor(props.labelColor),
              angle: props.labelAngle ?? 0,
              haloColor: [0, 0, 0, 0.8],
              haloSize: 1,
              font: { size: props.labelSize ?? 10 },
            },
          }),
        );
      } else if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
        const rings =
          geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
        graphics.push(
          new Graphic({
            // @ts-expect-error autocast
            geometry: { type: "polygon", rings },
            symbol: {
              // @ts-expect-error autocast
              type: "simple-fill",
              color: props.kind === "fill" ? cssToEsriColor(props.fill) : [0, 0, 0, 0],
              outline: {
                color: cssToEsriColor(props.stroke),
                width: props.strokeWidth ?? 2,
                style: props.dash ? "dash" : "solid",
              },
            },
          }),
        );
      } else if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
        const paths =
          geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
        graphics.push(
          new Graphic({
            // @ts-expect-error autocast
            geometry: { type: "polyline", paths },
            symbol: {
              // @ts-expect-error autocast
              type: "simple-line",
              color: cssToEsriColor(props.stroke),
              width: props.strokeWidth ?? 2,
              style: props.dash ? "dash" : "solid",
            },
          }),
        );
      }
    }
    return graphics;
  };

  // 10k graphics need the incremental scheduler: viewport cull + screen-size
  // LOD + zoom-bucketed cache + chunked generation. Each update appends only
  // the new features so the GraphicsLayer isn't rebuilt per chunk.
  const scheduler = new TacticalScheduler(scenario.tacticalGraphics);
  let tacticalFull = 0;
  let tacticalSimplified = 0;
  let appliedFeatureCount = 0;
  const refreshTactical = (view: InstanceType<typeof MapView>) => {
    const extent = view.extent;
    if (!extent) return;
    // extent is in web-mercator meters — convert to degrees for the renderer
    const toLng = (x: number) => (x / WORLD) * 360;
    const toLat = (y: number) =>
      ((2 * Math.atan(Math.exp((y / WORLD) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI;

    appliedFeatureCount = 0;
    tacticalLayer.removeAll();
    scheduler.request(
      {
        bbox: [toLng(extent.xmin), toLat(extent.ymin), toLng(extent.xmax), toLat(extent.ymax)],
        widthPx: view.width,
        heightPx: view.height,
        zoom: Math.log2(591657527.591555 / view.scale),
      },
      (update) => {
        const fresh = update.collection.features.slice(appliedFeatureCount);
        appliedFeatureCount = update.collection.features.length;
        if (fresh.length > 0) tacticalLayer.addMany(featuresToGraphics(fresh as GeoJSON.Feature[]));
        tacticalFull = update.visible;
        tacticalSimplified = update.simplified;
        pushHud();
      },
    );
  };

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

  const unitsLayer = new UnitsLayer();
  const map = new Map({
    basemap: online ? "dark-gray-vector" : undefined,
    layers: [tacticalLayer, unitsLayer],
  });

  const view = new MapView({
    container: "root",
    map,
    center: [-98, 38],
    // zoom needs a basemap tiling scheme; scale works on a blank view too
    ...(online ? { zoom: 4 } : { scale: 36978595.24 }),
    spatialReference: { wkid: 102100 },
  });
  view.container.style.background = "#10141a";

  (window as unknown as { __view: unknown }).__view = view;

  await view.when();
  refreshTactical(view);
  // regenerate view-dependent multipoint graphics when the camera settles
  reactiveUtils.watch(
    () => view.stationary,
    (stationary) => {
      if (stationary) refreshTactical(view);
    },
  );

  pushHud();
  setInterval(pushHud, 2000);

  function pushHud() {
    hud.set({
      units: scenario.count,
      tacticalFull,
      tacticalSimplified,
      tacticalTotal: scenario.tacticalGraphics.length,
      atlasEntries: controller.atlas.entryCount,
    });
  }
}

main();
