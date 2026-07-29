// type-only import: pulling tactical.ts values would drag the entire
// mil-sym-ts bundle (embedded standard data, ~10 MB) into demos that only
// render point symbols — callers that want multipoint graphics pass the
// control-measure list in (see listMultipointControlMeasures in tactical.ts)
import type { PointSymbolStyle } from "./symbol-atlas";
import type { ControlMeasureInfo, TacticalGraphic } from "./tactical";

export const SCENARIO_REGION = {
  west: -122,
  east: -75,
  south: 27,
  north: 48,
};

export function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
}

/** deterministic PRNG so both engine demos show the same scenario */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Land-unit entity codes present in the APP6-D icon tables (subset).
const ENTITIES = ["121100", "121000", "120500", "121102", "130300", "110600", "111000", "120100"];
const IDENTITIES = ["3", "3", "3", "6", "6", "4"]; // friend-heavy mix, some hostile/neutral
const ECHELONS = ["00", "15", "16", "17", "18", "21"];
const DESIGNATIONS = [
  "ALPHA",
  "BRAVO",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
];
const HIGHER_FORMATIONS = ["1 BDE", "2 BDE", "3 BDE", "X CORPS"];
const DIRECTION_BUCKET_DEG = 45;

function buildSidc(identity: string, echelon: string, entity: string): string {
  return `100${identity}1000${echelon}${entity}0000`;
}

export interface Scenario {
  count: number;
  /** fixed origin in mercator [0..1] — positions are stored relative to it */
  origin: [number, number];
  /** 2 floats per unit: mercator [0..1] minus origin */
  positions: Float32Array;
  /** logical symbol description per unit; index-aligned with positions */
  styles: PointSymbolStyle[];
  tacticalGraphics: TacticalGraphic[];
  /** advance movers; returns true when positions changed */
  step(dtSeconds: number): boolean;
  /** flip attributes (affiliation/echelon) on a random subset; returns changed indices */
  mutateSymbols(): number[];
}

export function createScenario(
  count: number,
  tacticalCount: number,
  controlMeasures: ControlMeasureInfo[] = [],
): Scenario {
  const rand = mulberry32(0xa9965d);
  const { west, east, south, north } = SCENARIO_REGION;

  const origin: [number, number] = [mercatorX((west + east) / 2), mercatorY((south + north) / 2)];

  const positions = new Float32Array(count * 2);
  const styles: PointSymbolStyle[] = new Array(count);
  const headings = new Float32Array(count);
  const moverFlags = new Uint8Array(count);

  // clustered placement: units form ~120 groups so zooming in looks plausible
  const clusterCount = 120;
  const clusters: { x: number; y: number; formation: string }[] = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      x: west + rand() * (east - west),
      y: south + rand() * (north - south),
      formation: HIGHER_FORMATIONS[i % HIGHER_FORMATIONS.length]!,
    });
  }

  for (let i = 0; i < count; i++) {
    const cluster = clusters[i % clusterCount]!;
    const lng = cluster.x + (rand() - 0.5) * 1.6;
    const lat = cluster.y + (rand() - 0.5) * 1.2;
    positions[i * 2] = mercatorX(lng) - origin[0];
    positions[i * 2 + 1] = mercatorY(lat) - origin[1];

    const entityIdx = Math.floor(rand() * ENTITIES.length);
    const echelonIdx = Math.floor(rand() * ECHELONS.length);
    const identity = IDENTITIES[Math.floor(rand() * IDENTITIES.length)]!;
    const isMover = rand() < 0.2;
    moverFlags[i] = isMover ? 1 : 0;
    headings[i] = rand() * 360;

    const style: PointSymbolStyle = {
      sidc: buildSidc(identity, ECHELONS[echelonIdx]!, ENTITIES[entityIdx]!),
    };
    if (isMover) {
      // moving units carry a bucketed direction-of-movement amplifier
      style.direction =
        (Math.round(headings[i]! / DIRECTION_BUCKET_DEG) * DIRECTION_BUCKET_DEG) % 360;
    } else {
      // text amplifiers are a deterministic function of the other dimensions so
      // the atlas key-space stays bounded (see RESEARCH.md §2.1)
      style.uniqueDesignation =
        DESIGNATIONS[(entityIdx * ECHELONS.length + echelonIdx) % DESIGNATIONS.length];
      style.higherFormation = cluster.formation;
    }
    styles[i] = style;
  }

  // multipoint control measures: enumerated from the standard via MSLookup
  // by the caller (universal demos); point-only demos pass none
  const measures = controlMeasures;
  const lines = measures.filter((m) => m.geometry === "line");
  const areas = measures.filter((m) => m.geometry === "area");
  const tacticalGraphics: TacticalGraphic[] = [];
  for (let i = 0; i < tacticalCount; i++) {
    const pool = i % 2 === 0 ? areas : lines;
    if (pool.length === 0) continue;
    const measure = pool[Math.floor(rand() * pool.length)]!;
    // spread independently of unit clusters; ~5% are operational-level (large,
    // visible at low zoom), the rest tactical-level (small — the screen-size
    // LOD reveals them as you zoom in), so a 10k+ set stays legible
    const sizeScale = rand() < 0.05 ? 5 + rand() * 5 : 1;
    const cx = west + rand() * (east - west);
    const cy = south + rand() * (north - south);

    const pointCount = Math.max(
      measure.minPoints,
      Math.min(3 + Math.floor(rand() * 2), measure.maxPoints || 4),
    );
    const points: [number, number][] = [];
    if (measure.geometry === "area") {
      // ring of points around the center
      const radius = (0.08 + rand() * 0.18) * sizeScale;
      const phase = rand() * Math.PI * 2;
      for (let p = 0; p < pointCount; p++) {
        const angle = phase + (p / pointCount) * Math.PI * 2;
        points.push([
          cx + Math.cos(angle) * radius * (0.7 + rand() * 0.6),
          cy + Math.sin(angle) * radius * 0.7 * (0.7 + rand() * 0.6),
        ]);
      }
    } else {
      // meandering polyline through the center
      const span = (0.3 + rand() * 0.5) * sizeScale;
      let x = cx - span / 2;
      let y = cy + (rand() - 0.5) * 0.3;
      for (let p = 0; p < pointCount; p++) {
        points.push([x, y]);
        x += (span / Math.max(1, pointCount - 1)) * (0.7 + rand() * 0.6);
        y += (rand() - 0.5) * 0.2;
      }
    }

    tacticalGraphics.push({
      id: `tg-${i}`,
      name: measure.name,
      // full 20-digit friendly/present control-measure SIDC
      sidc: `1003250000${measure.entity}0000`,
      points,
      modifiers: { T: measure.name.slice(0, 12).toUpperCase() },
      geometryType: measure.geometry as "line" | "area",
    });
  }

  const speed = 0.000004; // mercator units / second ≈ realistic vehicle speed at this latitude
  const mutateRand = mulberry32(0x517e21);

  return {
    count,
    origin,
    positions,
    styles,
    tacticalGraphics,
    step(dtSeconds: number): boolean {
      let moved = false;
      for (let i = 0; i < count; i++) {
        if (!moverFlags[i]) continue;
        moved = true;
        const heading = (headings[i]! * Math.PI) / 180;
        positions[i * 2] += Math.sin(heading) * speed * dtSeconds;
        positions[i * 2 + 1] -= Math.cos(heading) * speed * dtSeconds;
      }
      return moved;
    },
    mutateSymbols(): number[] {
      const changed: number[] = [];
      const n = Math.min(500, Math.floor(count / 20));
      for (let k = 0; k < n; k++) {
        const i = Math.floor(mutateRand() * count);
        const style = styles[i]!;
        const identity = IDENTITIES[Math.floor(mutateRand() * IDENTITIES.length)]!;
        const echelon = ECHELONS[Math.floor(mutateRand() * ECHELONS.length)]!;
        const entity = style.sidc.slice(10, 16);
        style.sidc = buildSidc(identity, echelon, entity);
        changed.push(i);
      }
      return changed;
    },
  };
}
