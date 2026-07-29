import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  MSLookup,
  SymbolID,
  WebRenderer,
  initialize,
  isReady,
} from "@armyc2.c5isr.renderer/mil-sym-ts-web";

/**
 * Engine-agnostic multipoint tactical graphic: what the application stores.
 * Rendering it for a given view produces plain styled GeoJSON any engine
 * can draw (mil-sym-ts WebRenderer output).
 */
export interface TacticalGraphic {
  id: string;
  name: string;
  sidc: string;
  /** control points as [lng, lat] */
  points: [number, number][];
  modifiers?: Record<string, string>;
  /** drives the simplified sub-threshold representation (default: line) */
  geometryType?: "line" | "area";
}

/** Current map view — multipoint graphics are view-dependent per the standard. */
export interface TacticalView {
  /** [west, south, east, north] in degrees */
  bbox: [number, number, number, number];
  widthPx: number;
  heightPx: number;
  /** web-mercator zoom level (fractional ok) — drives LOD and the render cache */
  zoom: number;
}

let readyPromise: Promise<void> | null = null;

/** Initialize mil-sym-ts (data is embedded in the web bundle, so this is fast). */
export function initTactical(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        await initialize();
      } catch {
        // deprecated initializer may throw when data is already embedded
      }
      for (let i = 0; i < 100 && !isReady(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!isReady()) throw new Error("mil-sym-ts failed to initialize");
    })();
  }
  return readyPromise;
}

export interface ControlMeasureInfo {
  /** 6-digit entity code within symbol set 25 */
  entity: string;
  name: string;
  geometry: string;
  minPoints: number;
  maxPoints: number;
}

/**
 * Enumerate APP6-D control measures that take 2+ control points (lines/areas),
 * straight from the standard's data via MSLookup — no hand-maintained lists.
 */
export function listMultipointControlMeasures(): ControlMeasureInfo[] {
  const lookup = MSLookup.getInstance();
  const version = SymbolID.Version_APP6D;
  const result: ControlMeasureInfo[] = [];
  for (const basicID of lookup.getIDList(version)) {
    if (!basicID.startsWith("25")) continue;
    const info = lookup.getMSLInfo(basicID, version);
    if (!info) continue;
    const geometry = (info.getGeometry() ?? "").toLowerCase();
    const minPoints = info.getMinPointCount();
    const maxPoints = info.getMaxPointCount();
    if (minPoints < 2) continue;
    if (geometry !== "line" && geometry !== "area") continue;
    result.push({
      entity: basicID.slice(2),
      name: info.getName() ?? basicID,
      geometry,
      minPoints,
      maxPoints,
    });
  }
  return result;
}

/** Build a full 20-digit APP6-D control-measure SIDC (friendly, present). */
export function controlMeasureSidc(entity: string): string {
  return `1003250000${entity}0000`;
}

interface GraphicBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function graphicBounds(graphic: TacticalGraphic): GraphicBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of graphic.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Render one graphic against its OWN padded bbox (not the viewport), with a
 * pixel size derived from the current map resolution. The output therefore
 * depends only on (graphic, resolution) — pans never invalidate it, which is
 * what makes the scheduler's cache work at 10k+ graphics.
 */
function renderOneGraphic(
  graphic: TacticalGraphic,
  bounds: GraphicBounds,
  degPerPxX: number,
  degPerPxY: number,
): Feature<Geometry, Record<string, unknown>>[] {
  const padX = Math.max((bounds.maxX - bounds.minX) * 0.5, degPerPxX * 64);
  const padY = Math.max((bounds.maxY - bounds.minY) * 0.5, degPerPxY * 64);
  const west = bounds.minX - padX;
  const east = bounds.maxX + padX;
  const south = bounds.minY - padY;
  const north = bounds.maxY + padY;
  const widthPx = Math.max(32, Math.ceil((east - west) / degPerPxX));
  const heightPx = Math.max(32, Math.ceil((north - south) / degPerPxY));

  const controlPoints = graphic.points.map(([lng, lat]) => `${lng},${lat}`).join(" ");
  const modifiers = new Map<string, string>(Object.entries(graphic.modifiers ?? {}));
  const attributes = new Map<string, string>();

  let raw: string;
  try {
    raw = WebRenderer.RenderSymbol2D(
      graphic.id,
      graphic.name,
      "",
      graphic.sidc,
      controlPoints,
      widthPx,
      heightPx,
      `${west},${south},${east},${north}`,
      modifiers,
      attributes,
      WebRenderer.OUTPUT_FORMAT_GEOJSON,
    );
  } catch (error) {
    console.warn(`tactical render failed for ${graphic.sidc} (${graphic.name})`, error);
    return [];
  }

  let collection: FeatureCollection<Geometry, Record<string, any>>;
  try {
    collection = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!collection?.features) return [];

  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const feature of collection.features) {
    const props = feature.properties ?? {};
    const geomType = feature.geometry?.type;
    if (!geomType) continue;

    if (geomType === "Point") {
      if (!props.label) continue;
      feature.properties = {
        graphicId: graphic.id,
        kind: "label",
        label: String(props.label),
        labelAngle: Number(props.angle ?? props.rotation ?? 0),
        labelSize: parseFontSize(props.fontSize) ?? 10,
        labelColor: friendlyDefault(normalizeColor(props.fontColor)) ?? "#ffffff",
      };
    } else {
      const stroke = friendlyDefault(normalizeColor(props.strokeColor ?? props.lineColor));
      const fill = friendlyDefault(normalizeColor(props.fillColor));
      feature.properties = {
        graphicId: graphic.id,
        kind: fill && (geomType === "Polygon" || geomType === "MultiPolygon") ? "fill" : "stroke",
        stroke: stroke ?? FRIENDLY_BLUE,
        strokeWidth: Number(props.strokeWidth ?? props.lineWidth ?? 2),
        dash: parseDash(props.strokeDasharray),
        fill: fill ?? null,
      };
    }
    features.push(feature as Feature<Geometry, Record<string, unknown>>);
  }
  return features;
}

/**
 * Legacy one-shot render of a graphic list for a view. Fine for hundreds of
 * graphics; use TacticalScheduler for thousands.
 */
export function renderTacticalGeoJSON(
  graphics: TacticalGraphic[],
  view: Omit<TacticalView, "zoom">,
): FeatureCollection<Geometry, Record<string, unknown>> {
  const [west, south, east, north] = view.bbox;
  const degPerPxX = (east - west) / view.widthPx;
  const degPerPxY = (north - south) / view.heightPx;
  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const graphic of graphics) {
    const bounds = graphicBounds(graphic);
    const pad = 2;
    if (
      bounds.maxX < west - pad ||
      bounds.minX > east + pad ||
      bounds.maxY < south - pad ||
      bounds.minY > north + pad
    ) {
      continue;
    }
    features.push(...renderOneGraphic(graphic, bounds, degPerPxX, degPerPxY));
  }
  return { type: "FeatureCollection", features };
}

export interface TacticalUpdate {
  collection: FeatureCollection<Geometry, Record<string, unknown>>;
  /** graphics fully rendered so far in this pass */
  rendered: number;
  /** graphics selected for full rendering in this view */
  visible: number;
  /** graphics drawn as simplified outlines (too small on screen for detail) */
  simplified: number;
  total: number;
  done: boolean;
}

/**
 * Incremental renderer for LARGE multipoint sets (10k+ graphics).
 *
 * Techniques (all engine-agnostic):
 *  - viewport culling against a padded bbox,
 *  - screen-size LOD: a graphic smaller than `minPixelExtent` on screen is
 *    unreadable in full detail, so it is drawn as a simplified outline built
 *    straight from its control points (no mil-sym call — effectively free);
 *    nothing is ever hidden, and full rendering swaps in as you zoom,
 *  - chunked generation in ~12 ms time slices so the map never freezes;
 *    results stream in via repeated onUpdate callbacks,
 *  - a render cache keyed per zoom bucket: outputs are rendered against each
 *    graphic's own bbox (not the viewport), so panning reuses the cache and
 *    only zoom changes re-render.
 */
export class TacticalScheduler {
  private graphics: TacticalGraphic[];
  private bounds: GraphicBounds[];
  private cache = new Map<string, Feature<Geometry, Record<string, unknown>>[]>();
  private cacheBucket = NaN;
  private runId = 0;
  private readonly minPixelExtent: number;
  private readonly labelMinZoom: number;
  private readonly sliceMs: number;

  constructor(
    graphics: TacticalGraphic[],
    opts?: { minPixelExtent?: number; labelMinZoom?: number; sliceMs?: number },
  ) {
    this.graphics = graphics;
    this.bounds = graphics.map(graphicBounds);
    this.minPixelExtent = opts?.minPixelExtent ?? 24;
    this.labelMinZoom = opts?.labelMinZoom ?? 7;
    this.sliceMs = opts?.sliceMs ?? 12;
  }

  /** Cancel any in-flight pass (also called implicitly by request()). */
  cancel(): void {
    this.runId++;
  }

  request(view: TacticalView, onUpdate: (update: TacticalUpdate) => void): void {
    const runId = ++this.runId;

    // zoom bucket of half-levels: within a bucket, screen-space details are
    // close enough to reuse; crossing a bucket clears the cache
    const bucket = Math.round(view.zoom * 2) / 2;
    if (bucket !== this.cacheBucket) {
      this.cache.clear();
      this.cacheBucket = bucket;
    }

    const [west, south, east, north] = view.bbox;
    const degPerPxX = (east - west) / view.widthPx;
    const degPerPxY = (north - south) / view.heightPx;
    const padX = (east - west) * 0.25;
    const padY = (north - south) * 0.25;
    const withLabels = view.zoom >= this.labelMinZoom;

    const visible: number[] = [];
    const features: Feature<Geometry, Record<string, unknown>>[] = [];
    let simplifiedCount = 0;
    for (let i = 0; i < this.graphics.length; i++) {
      const b = this.bounds[i]!;
      if (
        b.maxX < west - padX ||
        b.minX > east + padX ||
        b.maxY < south - padY ||
        b.minY > north + padY
      ) {
        continue;
      }
      const pxExtent = Math.max((b.maxX - b.minX) / degPerPxX, (b.maxY - b.minY) / degPerPxY);
      if (pxExtent < this.minPixelExtent) {
        // too small for standard detail — draw a simplified outline instead
        // of hiding it; built from raw control points, so it costs nothing
        const graphic = this.graphics[i]!;
        const coordinates =
          graphic.geometryType === "area"
            ? [...graphic.points, graphic.points[0]!]
            : graphic.points;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            graphicId: graphic.id,
            kind: "stroke",
            stroke: FRIENDLY_BLUE,
            strokeWidth: 1,
            dash: null,
            fill: null,
            simplified: true,
          },
        });
        simplifiedCount++;
        continue;
      }
      visible.push(i);
    }

    let cursor = 0;

    const step = () => {
      if (runId !== this.runId) return;
      const start = performance.now();
      while (cursor < visible.length && performance.now() - start < this.sliceMs) {
        const index = visible[cursor++]!;
        const graphic = this.graphics[index]!;
        let feats = this.cache.get(graphic.id);
        if (!feats) {
          feats = renderOneGraphic(graphic, this.bounds[index]!, degPerPxX, degPerPxY);
          this.cache.set(graphic.id, feats);
        }
        for (const f of feats) {
          if (!withLabels && (f.properties as { kind?: string }).kind === "label") continue;
          features.push(f);
        }
      }
      const done = cursor >= visible.length;
      onUpdate({
        // copy: MapLibre serializes setData asynchronously, and the next
        // chunk mutates the accumulator
        collection: { type: "FeatureCollection", features: features.slice() },
        rendered: cursor,
        visible: visible.length,
        simplified: simplifiedCount,
        total: this.graphics.length,
        done,
      });
      if (!done) setTimeout(step, 0);
    };
    step();
  }
}

/**
 * APP6-D "friend" medium blue. mil-sym draws most friendly control measures
 * in default black; the demos recolor exactly that default to friendly blue,
 * leaving the standard's meaningful colors (green obstacles, hostile red,
 * yellow NBC…) untouched.
 */
export const FRIENDLY_BLUE = "#00A8DC";

function friendlyDefault(color: string | null): string | null {
  if (!color) return null;
  if (color === "#000000") return FRIENDLY_BLUE;
  const match = /^rgba\(0,0,0,([\d.]+)\)$/.exec(color);
  if (match) return `rgba(0,168,220,${match[1]})`;
  return color;
}

/** mil-sym outputs #RRGGBB or #AARRGGBB — normalize to CSS rgba(). */
export function normalizeColor(color: unknown): string | null {
  if (typeof color !== "string" || !color.startsWith("#")) return null;
  const hex = color.slice(1);
  if (hex.length === 8) {
    const a = parseInt(hex.slice(0, 2), 16) / 255;
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  if (hex.length === 6) return color;
  return null;
}

function parseDash(value: unknown): number[] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parts = value
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parts.length >= 2 ? parts : null;
}

function parseFontSize(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
