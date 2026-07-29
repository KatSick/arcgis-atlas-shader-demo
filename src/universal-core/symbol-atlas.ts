import ms from "milsymbol";

/**
 * Engine-agnostic description of a point symbol: the SIDC plus the APP6-D
 * amplifiers that get baked into the icon. Continuous values (direction)
 * must be bucketed by the caller to keep the atlas key-space finite.
 */
export interface PointSymbolStyle {
  sidc: string;
  uniqueDesignation?: string;
  higherFormation?: string;
  /** direction of movement in degrees, bucketed (e.g. to 30° steps) */
  direction?: number;
  speed?: string;
  reinforcedReduced?: string;
}

export interface AtlasEntry {
  /** normalized uv rect in the atlas texture */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** quad size in CSS px */
  width: number;
  height: number;
  /** symbol anchor (octagon center) in CSS px, relative to quad top-left */
  anchorX: number;
  anchorY: number;
}

export interface PendingUpload {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

/**
 * Contract between the instanced point renderer and any icon source. The
 * renderer only needs a texture page size, lazily-allocated uv entries and an
 * upload queue — which icon generator fills the pixels (milsymbol, the CIM
 * dictionary rasterizer, ...) is interchangeable.
 */
export interface IconAtlas {
  readonly size: number;
  readonly pendingUploads: PendingUpload[];
  readonly entryCount: number;
  get(style: PointSymbolStyle, withText: boolean): AtlasEntry;
}

/**
 * Dynamic shelf-packed texture atlas of milsymbol-rendered APP6-D icons,
 * keyed on the full symbol description (SIDC + amplifiers). Entries are
 * rendered lazily on first request and uploaded incrementally by the
 * renderer via the `pendingUploads` queue — the atlas itself has no GL
 * dependency, which is what keeps it engine-agnostic.
 */
export class SymbolAtlas implements IconAtlas {
  readonly size: number;
  readonly ratio: number;
  readonly iconSize: number;
  readonly pendingUploads: PendingUpload[] = [];

  private entries = new Map<string, AtlasEntry>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfHeight = 0;
  private readonly padding = 2;
  private fallback: AtlasEntry | null = null;
  private full = false;

  constructor(opts?: { size?: number; ratio?: number; iconSize?: number }) {
    this.size = opts?.size ?? 4096;
    this.ratio = opts?.ratio ?? Math.min(window.devicePixelRatio || 1, 1.5);
    this.iconSize = opts?.iconSize ?? 20;
  }

  get(style: PointSymbolStyle, withText: boolean): AtlasEntry {
    const key = withText
      ? `${style.sidc}|${style.uniqueDesignation ?? ""}|${style.higherFormation ?? ""}|${style.speed ?? ""}|${style.reinforcedReduced ?? ""}|${style.direction ?? ""}`
      : `${style.sidc}||||${style.reinforcedReduced ?? ""}|${style.direction ?? ""}`;

    let entry = this.entries.get(key);
    if (entry) return entry;

    // milsymbol treats a present-but-undefined amplifier key as "draw it"
    // and crashes — only set keys that carry a value
    const options: Record<string, unknown> = { size: this.iconSize };
    if (style.reinforcedReduced != null) options.reinforcedReduced = style.reinforcedReduced;
    if (style.direction != null) options.direction = style.direction;
    if (withText) {
      if (style.uniqueDesignation != null) options.uniqueDesignation = style.uniqueDesignation;
      if (style.higherFormation != null) options.higherFormation = style.higherFormation;
      if (style.speed != null) options.speed = style.speed;
    }

    const symbol = new ms.Symbol(style.sidc, options);
    const { width, height } = symbol.getSize();
    const anchor = symbol.getAnchor();

    const w = Math.ceil(width * this.ratio);
    const h = Math.ceil(height * this.ratio);

    const slot = this.allocate(w, h);
    if (!slot) {
      // Atlas page exhausted — fall back to the first entry so rendering
      // degrades visibly instead of crashing. RESEARCH.md documents SDF
      // text / LRU eviction as the production answer.
      if (!this.full) {
        this.full = true;
        console.warn("SymbolAtlas: atlas page full, new symbols reuse a fallback entry");
      }
      return this.fallback ?? this.getFallback();
    }

    entry = {
      u0: slot.x / this.size,
      v0: slot.y / this.size,
      u1: (slot.x + w) / this.size,
      v1: (slot.y + h) / this.size,
      width,
      height,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
    this.entries.set(key, entry);
    if (!this.fallback) this.fallback = entry;

    this.pendingUploads.push({ canvas: symbol.asCanvas(this.ratio), x: slot.x, y: slot.y });
    return entry;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  private getFallback(): AtlasEntry {
    if (!this.fallback) throw new Error("SymbolAtlas: no entries allocated");
    return this.fallback;
  }

  private allocate(w: number, h: number): { x: number; y: number } | null {
    if (w > this.size) return null;
    if (this.shelfX + w > this.size) {
      this.shelfX = 0;
      this.shelfY += this.shelfHeight + this.padding;
      this.shelfHeight = 0;
    }
    if (this.shelfY + h > this.size) return null;
    const slot = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w + this.padding;
    this.shelfHeight = Math.max(this.shelfHeight, h);
    return slot;
  }
}
