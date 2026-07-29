import type {
  AtlasEntry,
  IconAtlas,
  PendingUpload,
  PointSymbolStyle,
} from "../universal-core/symbol-atlas";
import type { CimDictionaryItems } from "./cim-types";
import {
  buildSymbolKeys,
  parseSymbolKeys,
  type DictionaryConfiguration,
} from "./dictionary-script";
import { CimPointRasterizer } from "./rasterizer";

/**
 * Drop-in replacement for the milsymbol SymbolAtlas: same shelf-packing and
 * incremental-upload contract, but sprites come from the CIM dictionary
 * pipeline (stylx items + ported dictionary script + Canvas rasterizer).
 * This is what makes the ArcGIS dictionary content render through the shared
 * instanced-WebGL core on MapLibre, OpenLayers, or any other host engine.
 */
export class CimSymbolAtlas implements IconAtlas {
  readonly size: number;
  readonly ratio: number;
  readonly pendingUploads: PendingUpload[] = [];

  private readonly rasterizer: CimPointRasterizer;
  private readonly configuration: Partial<DictionaryConfiguration>;
  private entries = new Map<string, AtlasEntry>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfHeight = 0;
  private readonly padding = 2;
  private fallback: AtlasEntry | null = null;
  private full = false;

  constructor(
    items: CimDictionaryItems,
    opts?: {
      size?: number;
      ratio?: number;
      /** points → CSS px; the dictionary frame is ~28 pt tall */
      ptToPx?: number;
      configuration?: Partial<DictionaryConfiguration>;
    },
  ) {
    this.size = opts?.size ?? 4096;
    this.ratio = opts?.ratio ?? Math.min(window.devicePixelRatio || 1, 1.5);
    this.configuration = opts?.configuration ?? {};
    this.rasterizer = new CimPointRasterizer(items, {
      ptToPx: opts?.ptToPx ?? 0.75,
      ratio: this.ratio,
    });
  }

  get(style: PointSymbolStyle, withText: boolean): AtlasEntry {
    const key = withText
      ? `${style.sidc}|${style.uniqueDesignation ?? ""}|${style.higherFormation ?? ""}|${style.speed ?? ""}|${style.reinforcedReduced ?? ""}|${style.direction ?? ""}`
      : `${style.sidc}||||${style.reinforcedReduced ?? ""}|${style.direction ?? ""}`;

    let entry = this.entries.get(key);
    if (entry) return entry;

    const raw = buildSymbolKeys(
      { sidc: style.sidc, direction: style.direction },
      this.configuration,
    );
    const textAttributes: Record<string, string> = {};
    if (withText) {
      if (style.uniqueDesignation) textAttributes.uniquedesignation = style.uniqueDesignation;
      if (style.higherFormation) textAttributes.higherformation = style.higherFormation;
      if (style.speed) textAttributes.speed = style.speed;
    }
    if (style.reinforcedReduced) textAttributes.reinforced = style.reinforcedReduced;

    const sprite = this.rasterizer.rasterize(parseSymbolKeys(raw), textAttributes);
    if (!sprite) return this.getFallback();

    const w = sprite.canvas.width;
    const h = sprite.canvas.height;
    const slot = this.allocate(w, h);
    if (!slot) {
      // Atlas page exhausted — fall back to the first entry so rendering
      // degrades visibly instead of crashing (see RESEARCH.md §2.1 for the
      // SDF-text / LRU-eviction production answer).
      if (!this.full) {
        this.full = true;
        console.warn("CimSymbolAtlas: atlas page full, new symbols reuse a fallback entry");
      }
      return this.getFallback();
    }

    entry = {
      u0: slot.x / this.size,
      v0: slot.y / this.size,
      u1: (slot.x + w) / this.size,
      v1: (slot.y + h) / this.size,
      width: sprite.width,
      height: sprite.height,
      anchorX: sprite.anchorX,
      anchorY: sprite.anchorY,
    };
    this.entries.set(key, entry);
    if (!this.fallback) this.fallback = entry;

    this.pendingUploads.push({ canvas: sprite.canvas, x: slot.x, y: slot.y });
    return entry;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  private getFallback(): AtlasEntry {
    if (!this.fallback) throw new Error("CimSymbolAtlas: no entries allocated");
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
