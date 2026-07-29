import type {
  CimColor,
  CimDictionaryItems,
  CimMarkerGraphic,
  CimPointSymbol,
  CimTextSymbol,
} from "./cim-types";
import type { PrimitiveOverride, ResolvedSymbolKeys } from "./dictionary-script";

/**
 * Canvas-2D rasterizer for the CIM point-symbol subset used by the
 * joint-military-symbology dictionary. Input is the ordered item list the
 * dictionary script resolves to (frame, icon, modifiers, amplifiers, labels)
 * plus primitive overrides; output is a composed sprite with an anchor,
 * ready for a texture atlas or an engine image registry.
 *
 * Geometry model (verified against the stylx contents):
 *  - every item is a CIMPointSymbol whose layers are CIMVectorMarkers,
 *  - a marker's `frame` maps to `size` units of height in its parent space
 *    (points at the top level); geometry, stroke widths, text heights and
 *    dash templates are in frame units and scale by size/frameHeight
 *    (scaleSymbolsProportionally is always true in this stylx),
 *  - the marker is positioned so its anchor point (Relative units, (0,0) =
 *    frame center) lands on the insertion point, then offsetX/offsetY (parent
 *    units) apply; `rotation` spins the marker around the anchor
 *    (clockwise when rotateClockwise is set),
 *  - marker graphics may nest: a CIMMarkerGraphic's symbol can itself be a
 *    CIMPointSymbol (e.g. DOM_Land's rotatable arrow), so placement recurses
 *    with composed transforms,
 *  - CIMPointSymbol.symbolLayers[0] is the TOP layer (draw in reverse), and
 *    later dictionary keys draw on top of earlier ones.
 */

export interface RasterizedSymbol {
  canvas: HTMLCanvasElement;
  /** sprite size in CSS px */
  width: number;
  height: number;
  /** symbol origin in CSS px from the sprite's top-left */
  anchorX: number;
  anchorY: number;
}

/** affine transform local units → points (y-up); k = uniform scale factor */
interface XForm {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  k: number;
}

const IDENTITY: XForm = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, k: 1 };

const apply = (t: XForm, x: number, y: number): [number, number] => [
  t.a * x + t.c * y + t.tx,
  t.b * x + t.d * y + t.ty,
];

/** compose parent ∘ child (apply child first, then parent) */
const compose = (p: XForm, c: XForm): XForm => ({
  a: p.a * c.a + p.c * c.b,
  b: p.b * c.a + p.d * c.b,
  c: p.a * c.c + p.c * c.d,
  d: p.b * c.c + p.d * c.d,
  tx: p.a * c.tx + p.c * c.ty + p.tx,
  ty: p.b * c.tx + p.d * c.ty + p.ty,
  k: p.k * c.k,
});

interface PlacedGraphic {
  graphic: CimMarkerGraphic;
  xf: XForm;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const FIELD_RE = /\[([a-z0-9_]+)\]/gi;

function parseOverrideColor(value: string): CimColor | null {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        255,
      ];
    }
    return null;
  }
  const m = /^RGBA?\(([^)]*)\)$/i.exec(value);
  if (m) {
    const parts = m[1]!.split(",").map((p) => Number(p.trim()));
    if (parts.length >= 3) {
      return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 255];
    }
  }
  return null;
}

function cssColor(color: CimColor | undefined): string | null {
  if (!color) return null;
  const [r, g, b, a] = color;
  if (a === 0) return null;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** apply `po:` overrides to a deep-cloned symbol tree */
function applyOverrides(symbol: CimPointSymbol, overrides: PrimitiveOverride[]): CimPointSymbol {
  const json = JSON.stringify(symbol);
  const relevant = overrides.filter((o) => json.includes(`"${o.primitiveName}"`));
  if (relevant.length === 0) return symbol;
  const clone = JSON.parse(json) as CimPointSymbol;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.primitiveName === "string") {
      for (const o of relevant) {
        if (obj.primitiveName !== o.primitiveName) continue;
        switch (o.property) {
          case "Color": {
            const color = parseOverrideColor(o.value);
            if (color) obj.color = color;
            break;
          }
          case "OffsetX":
            obj.offsetX = Number(o.value);
            break;
          case "OffsetY":
            obj.offsetY = Number(o.value);
            break;
          case "Rotation":
            obj.rotation = Number(o.value);
            break;
          // Begin/Middle/EndCut target control-measure line effects — not
          // applicable to point sprites
        }
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(clone);
  return clone;
}

export class CimPointRasterizer {
  private readonly items: CimDictionaryItems;
  /** points → CSS px */
  readonly ptToPx: number;
  /** device pixel ratio baked into the backing store */
  readonly ratio: number;
  private readonly missingWarned = new Set<string>();
  private measureCtx: CanvasRenderingContext2D;

  constructor(items: CimDictionaryItems, opts?: { ptToPx?: number; ratio?: number }) {
    this.items = items;
    this.ptToPx = opts?.ptToPx ?? 0.75;
    this.ratio = opts?.ratio ?? Math.min(window.devicePixelRatio || 1, 1.5);
    this.measureCtx = document.createElement("canvas").getContext("2d")!;
  }

  /**
   * @param resolved output of parseSymbolKeys()
   * @param textAttributes attribute values substituted into `[field]`
   *   placeholders of label text graphics (lowercase keys)
   */
  rasterize(
    resolved: ResolvedSymbolKeys,
    textAttributes: Record<string, string> = {},
  ): RasterizedSymbol | null {
    // 1. resolve keys against the item map (first existing alternative wins)
    const symbols: CimPointSymbol[] = [];
    for (const alternatives of resolved.itemKeys) {
      let found: CimPointSymbol | undefined;
      for (const key of alternatives) {
        found = this.items[key];
        if (found) break;
      }
      if (found) {
        symbols.push(applyOverrides(found, resolved.overrides));
      } else if (!this.missingWarned.has(alternatives[0]!)) {
        this.missingWarned.add(alternatives[0]!);
        console.warn(`CimPointRasterizer: no item for key "${alternatives.join("|")}"`);
      }
    }
    if (symbols.length === 0) return null;

    // 2. flatten into placed graphics, in paint order (bottom → top)
    const placed: PlacedGraphic[] = [];
    for (const symbol of symbols) this.collect(symbol, IDENTITY, placed);
    if (placed.length === 0) return null;

    // 3. measure bounds in pt (y-up)
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    this.walk(placed, textAttributes, null, bounds);
    if (bounds.minX > bounds.maxX) return null;

    // 4. draw
    const pad = 1;
    const k = this.ptToPx;
    const width = Math.ceil((bounds.maxX - bounds.minX) * k) + pad * 2;
    const height = Math.ceil((bounds.maxY - bounds.minY) * k) + pad * 2;
    const anchorX = -bounds.minX * k + pad;
    const anchorY = bounds.maxY * k + pad; // y-up → canvas top

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * this.ratio));
    canvas.height = Math.max(1, Math.round(height * this.ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.scale(this.ratio, this.ratio);
    ctx.translate(anchorX, anchorY);
    ctx.scale(k, -k); // pt space, y-up

    this.walk(placed, textAttributes, ctx, null);

    return { canvas, width, height, anchorX, anchorY };
  }

  /** recursively place a point symbol's marker layers under `parent` */
  private collect(symbol: CimPointSymbol, parent: XForm, out: PlacedGraphic[]): void {
    const layers = symbol.symbolLayers ?? [];
    // symbolLayers[0] is the top layer within one symbol
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      if (layer.type !== "CIMVectorMarker" || layer.enable === false) continue;
      const frame = layer.frame;
      if (!frame || !layer.markerGraphics) continue;
      const frameW = frame.xmax - frame.xmin;
      const frameH = frame.ymax - frame.ymin;
      if (frameW <= 0 || frameH <= 0) continue;

      const s = (layer.size ?? frameH) / frameH;
      const cx = (frame.xmin + frame.xmax) / 2;
      const cy = (frame.ymin + frame.ymax) / 2;
      // Relative anchor: fractions of frame size from the frame center
      const ax = cx + (layer.anchorPoint?.x ?? 0) * frameW;
      const ay = cy + (layer.anchorPoint?.y ?? 0) * frameH;
      const deg = layer.rotation ?? 0;
      const rad = ((layer.rotateClockwise ? -deg : deg) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // local frame units → parent units: R(θ)·((p − anchor)·s) + offset
      const local: XForm = {
        a: cos * s,
        b: sin * s,
        c: -sin * s,
        d: cos * s,
        tx: (layer.offsetX ?? 0) - (ax * cos - ay * sin) * s,
        ty: (layer.offsetY ?? 0) - (ax * sin + ay * cos) * s,
        k: s,
      };
      const xf = compose(parent, local);

      for (const graphic of layer.markerGraphics) {
        const nested = graphic.symbol as unknown as CimPointSymbol;
        if (nested.type === "CIMPointSymbol") {
          // nested point symbol: recurse, inserting at the graphic's point
          const gx = graphic.geometry.x ?? 0;
          const gy = graphic.geometry.y ?? 0;
          this.collect(nested, compose(xf, { ...IDENTITY, tx: gx, ty: gy }), out);
        } else {
          out.push({ graphic, xf });
        }
      }
    }
  }

  /**
   * Shared measure/draw pass. With `ctx` null it accumulates bounds (pt,
   * y-up); with a context (already transformed to pt space, y-up) it paints.
   */
  private walk(
    placed: PlacedGraphic[],
    textAttributes: Record<string, string>,
    ctx: CanvasRenderingContext2D | null,
    bounds: Bounds | null,
  ): void {
    const extend = (x: number, y: number, margin: number) => {
      if (!bounds) return;
      if (x - margin < bounds.minX) bounds.minX = x - margin;
      if (y - margin < bounds.minY) bounds.minY = y - margin;
      if (x + margin > bounds.maxX) bounds.maxX = x + margin;
      if (y + margin > bounds.maxY) bounds.maxY = y + margin;
    };

    for (const p of placed) {
      const { graphic, xf } = p;

      if (graphic.symbol.type === "CIMTextSymbol") {
        this.handleText(graphic, graphic.symbol, xf, textAttributes, ctx, extend);
        continue;
      }

      const geometry = graphic.geometry;
      const rings = geometry.rings ?? geometry.paths;
      if (!rings) continue;
      const isPolygon = !!geometry.rings;
      const layers = (graphic.symbol.symbolLayers ?? []).filter((l) => l.enable !== false);

      if (bounds) {
        const margin =
          layers.reduce(
            (m, l) => (l.type === "CIMSolidStroke" ? Math.max(m, (l.width ?? 0) / 2) : m),
            0,
          ) * xf.k;
        for (const ring of rings) {
          for (const pt of ring) {
            const [x, y] = apply(xf, pt[0]!, pt[1]!);
            extend(x, y, margin);
          }
        }
        continue;
      }

      ctx!.beginPath();
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = apply(xf, ring[i]![0]!, ring[i]![1]!);
          if (i === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        if (isPolygon) ctx!.closePath();
      }

      // CIM symbol layers list top-first: paint fills/strokes bottom-up
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]!;
        if (layer.type === "CIMSolidFill") {
          const fill = cssColor(layer.color);
          if (fill) {
            ctx!.fillStyle = fill;
            ctx!.fill();
          }
        } else if (layer.type === "CIMSolidStroke") {
          const stroke = cssColor(layer.color);
          const width = (layer.width ?? 1) * xf.k;
          if (stroke && width > 0) {
            ctx!.strokeStyle = stroke;
            ctx!.lineWidth = width;
            ctx!.lineCap = (layer.capStyle?.toLowerCase() ?? "round") as CanvasLineCap;
            ctx!.lineJoin = (layer.joinStyle?.toLowerCase() ?? "round") as CanvasLineJoin;
            ctx!.miterLimit = layer.miterLimit ?? 10;
            const dashes = layer.effects?.find((e) => e.type === "CIMGeometricEffectDashes");
            ctx!.setLineDash(dashes?.dashTemplate?.map((d) => d * xf.k) ?? []);
            ctx!.stroke();
            ctx!.setLineDash([]);
          }
        }
      }
    }
  }

  private handleText(
    graphic: CimMarkerGraphic,
    text: CimTextSymbol,
    xf: XForm,
    textAttributes: Record<string, string>,
    ctx: CanvasRenderingContext2D | null,
    extend: (x: number, y: number, margin: number) => void,
  ): void {
    if (!graphic.textString) return;

    // substitute [field] placeholders; skip the graphic when every referenced
    // field is empty (matches DictionaryRenderer behaviour)
    let anyField = false;
    let anyValue = false;
    let value = graphic.textString.replace(FIELD_RE, (_, field: string) => {
      anyField = true;
      const v = textAttributes[field.toLowerCase()] ?? "";
      if (v !== "") anyValue = true;
      return v;
    });
    if (anyField && !anyValue) return;
    value = value.trim();
    if (value === "") return;
    if (text.textCase === "Allcaps") value = value.toUpperCase();
    else if (text.textCase === "Lowercase") value = value.toLowerCase();

    const sizePt = (text.height ?? 10) * xf.k;
    const [gx, gy] = apply(xf, graphic.geometry.x ?? 0, graphic.geometry.y ?? 0);
    const x = gx + (text.offsetX ?? 0) * xf.k;
    const y = gy + (text.offsetY ?? 0) * xf.k;

    const weight = /bold/i.test(text.fontStyleName ?? "") ? "bold " : "";
    const italic = /italic/i.test(text.fontStyleName ?? "") ? "italic " : "";
    const font = `${italic}${weight}${sizePt}px ${text.fontFamilyName ?? "Arial"}, sans-serif`;

    if (!ctx) {
      this.measureCtx.font = font;
      const w = this.measureCtx.measureText(value).width;
      const halo = text.haloSize ?? 0;
      const align = text.horizontalAlignment ?? "Center";
      const left = align === "Left" ? x : align === "Right" ? x - w : x - w / 2;
      const vAlign = text.verticalAlignment ?? "Center";
      const bottom =
        vAlign === "Top" ? y - sizePt * 1.15 : vAlign === "Center" ? y - sizePt * 0.6 : y;
      extend(left - halo, bottom - halo, 0);
      extend(left + w + halo, bottom + sizePt * 1.15 + halo, 0);
      return;
    }

    ctx.save();
    ctx.scale(1, -1); // canvas text needs y-down
    const cy = -y;
    ctx.font = font;
    ctx.textAlign = (text.horizontalAlignment ?? "Center").toLowerCase() as CanvasTextAlign;
    const vAlign = text.verticalAlignment ?? "Center";
    ctx.textBaseline =
      vAlign === "Top"
        ? "top"
        : vAlign === "Center"
          ? "middle"
          : vAlign === "Bottom"
            ? "bottom"
            : "alphabetic";

    const haloColor = cssColor(
      text.haloSymbol?.symbolLayers?.find((l) => l.type === "CIMSolidFill")?.color,
    );
    if (haloColor && (text.haloSize ?? 0) > 0) {
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = (text.haloSize ?? 0) * 2 * xf.k;
      ctx.lineJoin = "round";
      ctx.strokeText(value, x, cy);
    }
    const fillColor =
      cssColor(text.symbol?.symbolLayers?.find((l) => l.type === "CIMSolidFill")?.color) ?? "#000";
    ctx.fillStyle = fillColor;
    ctx.fillText(value, x, cy);
    ctx.restore();
  }
}
