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
}

/** Current map view — multipoint graphics are view-dependent per the standard. */
export interface TacticalView {
  /** [west, south, east, north] in degrees */
  bbox: [number, number, number, number];
  widthPx: number;
  heightPx: number;
}

export interface TacticalStyleProps {
  kind: "stroke" | "fill" | "label";
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  fill?: string;
  label?: string;
  labelAngle?: number;
  labelSize?: number;
  labelColor?: string;
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

/**
 * Render tactical graphics for the given view into one engine-neutral
 * GeoJSON FeatureCollection. Feature properties are normalized under `_style`
 * plus flattened keys adapters can consume with data-driven styling.
 */
export function renderTacticalGeoJSON(
  graphics: TacticalGraphic[],
  view: TacticalView,
): FeatureCollection<Geometry, Record<string, unknown>> {
  const [west, south, east, north] = view.bbox;
  const bbox = `${west},${south},${east},${north}`;
  const features: Feature<Geometry, Record<string, unknown>>[] = [];

  for (const graphic of graphics) {
    // cheap pre-cull on control-point bbox (padded ~2°) before invoking the renderer
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
    const pad = 2;
    if (maxX < west - pad || minX > east + pad || maxY < south - pad || minY > north + pad) {
      continue;
    }

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
        view.widthPx,
        view.heightPx,
        bbox,
        modifiers,
        attributes,
        WebRenderer.OUTPUT_FORMAT_GEOJSON,
      );
    } catch (error) {
      console.warn(`tactical render failed for ${graphic.sidc} (${graphic.name})`, error);
      continue;
    }

    let collection: FeatureCollection<Geometry, Record<string, any>>;
    try {
      collection = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!collection?.features) continue;

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
          labelColor: normalizeColor(props.fontColor) ?? "#ffffff",
        };
      } else {
        const stroke = normalizeColor(props.strokeColor ?? props.lineColor);
        const fill = normalizeColor(props.fillColor);
        feature.properties = {
          graphicId: graphic.id,
          kind: fill && (geomType === "Polygon" || geomType === "MultiPolygon") ? "fill" : "stroke",
          stroke: stroke ?? "#00ffff",
          strokeWidth: Number(props.strokeWidth ?? props.lineWidth ?? 2),
          dash: parseDash(props.strokeDasharray),
          fill: fill ?? null,
        };
      }
      features.push(feature as Feature<Geometry, Record<string, unknown>>);
    }
  }

  return { type: "FeatureCollection", features };
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
