import type { IconAtlas, PointSymbolStyle } from "../universal-core/symbol-atlas";
import { CimSymbolAtlas } from "./cim-atlas";
import type { CimDictionaryItems } from "./cim-types";
import {
  buildSymbolKeys,
  parseSymbolKeys,
  type DictionaryAttributes,
  type DictionaryConfiguration,
} from "./dictionary-script";
import { CimPointRasterizer, type RasterizedSymbol } from "./rasterizer";

/**
 * Universal drop-in for `@arcgis/core` `DictionaryRenderer`: same inputs
 * (dictionary content, a field map, symbology configuration, per-feature
 * attributes), but the output is engine-neutral — either a rasterized sprite
 * for engine-native image APIs, or a texture atlas + instanced-WebGL core for
 * the 50k+ path. The same instance can drive ArcGIS (BaseLayerViewGL2D),
 * MapLibre (CustomLayerInterface), OpenLayers (custom Layer), or anything
 * else that exposes a GL context and a view matrix — including *replacing*
 * the built-in DictionaryRenderer inside ArcGIS itself, which evaluates CIM
 * on the CPU per feature and struggles past ~10k features.
 */

/** dictionary text-amplifier fields understood by the label items */
export const DICTIONARY_TEXT_FIELDS = [
  "uniquedesignation",
  "higherformation",
  "speed",
  "reinforced",
  "staffcomment",
  "additionalinformation",
  "commonidentifier",
  "type",
  "quantity",
  "platformtype",
  "equipmentteardowntime",
  "specialdesignator",
  "datetimevalid",
  "datetimeexpired",
  "reliability",
  "credibility",
  "combateffectiveness",
  "idmode",
  "z",
  "x",
  "y",
] as const;

export type DictionaryTextField = (typeof DICTIONARY_TEXT_FIELDS)[number];

export interface UniversalDictionaryRendererOptions {
  /** stylx items (e.g. from the loadDictionaryItemsJson build-time macro) */
  items: CimDictionaryItems;
  /**
   * dictionary field → feature attribute name, mirroring the ArcGIS
   * DictionaryRenderer `fieldMap`. Unmapped fields read the attribute with
   * the same (lowercase) name.
   */
  fieldMap?: Partial<Record<string, string>>;
  configuration?: Partial<DictionaryConfiguration>;
  /** points → CSS px for rasterized sprites (frame is ~28 pt tall) */
  ptToPx?: number;
  /** backing-store pixel ratio for sprites */
  ratio?: number;
  /** texture page size for the atlas path */
  atlasSize?: number;
}

export class UniversalDictionaryRenderer {
  /**
   * Shelf-packed sprite atlas for the instanced-WebGL path — hand it to
   * `UnitLayerController`/`PointSymbolRenderer` and adapt any engine with
   * a GL context + mercator→clip matrix.
   */
  readonly atlas: IconAtlas;

  private readonly rasterizer: CimPointRasterizer;
  private readonly fieldMap: Partial<Record<string, string>>;
  private readonly configuration: Partial<DictionaryConfiguration>;

  constructor(options: UniversalDictionaryRendererOptions) {
    this.fieldMap = options.fieldMap ?? {};
    this.configuration = options.configuration ?? {};
    this.rasterizer = new CimPointRasterizer(options.items, {
      ptToPx: options.ptToPx,
      ratio: options.ratio,
    });
    this.atlas = new CimSymbolAtlas(options.items, {
      size: options.atlasSize,
      ratio: options.ratio,
      ptToPx: options.ptToPx,
      configuration: this.configuration,
    });
  }

  /** resolve a dictionary field through the field map */
  private read(
    attributes: Record<string, string | number | undefined>,
    field: string,
  ): string | undefined {
    const source = this.fieldMap[field] ?? field;
    const value = attributes[source];
    return value === undefined || value === null || value === "" ? undefined : String(value);
  }

  /**
   * Per-feature symbol as a standalone sprite — the engine-native path
   * (MapLibre `addImage`, OpenLayers `Icon`, Leaflet markers, …). For 10k+
   * features prefer the `atlas` + instanced-core path instead.
   */
  rasterize(attributes: Record<string, string | number | undefined>): RasterizedSymbol | null {
    const dictionaryAttributes: DictionaryAttributes = {
      sidc: this.read(attributes, "sidc"),
      context: this.read(attributes, "context"),
      identity: this.read(attributes, "identity"),
      symbolset: this.read(attributes, "symbolset"),
      symbolentity: this.read(attributes, "symbolentity"),
      modifier1: this.read(attributes, "modifier1"),
      modifier2: this.read(attributes, "modifier2"),
      echelon: this.read(attributes, "echelon"),
      mobility: this.read(attributes, "mobility"),
      array: this.read(attributes, "array"),
      status: this.read(attributes, "status"),
      operationalcondition: this.read(attributes, "operationalcondition"),
      indicator: this.read(attributes, "indicator"),
      specialentitysubtype: this.read(attributes, "specialentitysubtype"),
      direction: this.read(attributes, "direction"),
      civilian: this.read(attributes, "civilian"),
    };
    const textAttributes: Record<string, string> = {};
    for (const field of DICTIONARY_TEXT_FIELDS) {
      const value = this.read(attributes, field);
      if (value !== undefined) textAttributes[field] = value;
    }
    const raw = buildSymbolKeys(dictionaryAttributes, this.configuration);
    return this.rasterizer.rasterize(parseSymbolKeys(raw), textAttributes);
  }

  /** atlas-path convenience mirroring the engine demos' style objects */
  getAtlasEntry(style: PointSymbolStyle, withText: boolean) {
    return this.atlas.get(style, withText);
  }
}
