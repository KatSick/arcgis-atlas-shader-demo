/**
 * Minimal typings for the CIM (Cartographic Information Model) subset that the
 * joint-military-symbology dictionary actually uses for *point* symbols.
 * Reference: https://github.com/Esri/cim-spec
 *
 * A survey of the APP6-D stylx shows point items are built exclusively from:
 * CIMPointSymbol → CIMVectorMarker → CIMMarkerGraphic whose graphic symbol is
 * a CIMPolygonSymbol / CIMLineSymbol (CIMSolidFill / CIMSolidStroke layers,
 * optionally with a CIMGeometricEffectDashes) or a CIMTextSymbol. There are no
 * curves, picture markers or hatch fills on the point-symbol path.
 */

/** [r, g, b, a] with all channels 0–255 as stored in the stylx JSON */
export type CimColor = [number, number, number, number];

export interface CimEnvelope {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface CimGeometry {
  /** polygon rings, in frame units */
  rings?: number[][][];
  /** polyline paths, in frame units */
  paths?: number[][][];
  /** point (used by text graphics) */
  x?: number;
  y?: number;
}

export interface CimGeometricEffect {
  type: string;
  /** CIMGeometricEffectDashes */
  dashTemplate?: number[];
}

export interface CimSymbolLayerBase {
  type: string;
  enable?: boolean;
  primitiveName?: string;
  effects?: CimGeometricEffect[];
}

export interface CimSolidFill extends CimSymbolLayerBase {
  type: "CIMSolidFill";
  color?: CimColor;
}

export interface CimSolidStroke extends CimSymbolLayerBase {
  type: "CIMSolidStroke";
  color?: CimColor;
  width?: number;
  capStyle?: "Butt" | "Round" | "Square";
  joinStyle?: "Bevel" | "Round" | "Miter";
  miterLimit?: number;
}

export type CimFillOrStroke = CimSolidFill | CimSolidStroke;

export interface CimPolygonSymbol {
  type: "CIMPolygonSymbol";
  symbolLayers?: CimFillOrStroke[];
}

export interface CimLineSymbol {
  type: "CIMLineSymbol";
  symbolLayers?: CimFillOrStroke[];
}

export interface CimTextSymbol {
  type: "CIMTextSymbol";
  fontFamilyName?: string;
  fontStyleName?: string;
  /** text size in points (already in marker-frame units when nested) */
  height?: number;
  horizontalAlignment?: "Left" | "Center" | "Right";
  verticalAlignment?: "Top" | "Center" | "Baseline" | "Bottom";
  offsetX?: number;
  offsetY?: number;
  haloSize?: number;
  haloSymbol?: CimPolygonSymbol;
  symbol?: CimPolygonSymbol;
  textCase?: "Normal" | "Allcaps" | "Lowercase";
}

export type CimGraphicSymbol = CimPolygonSymbol | CimLineSymbol | CimTextSymbol;

export interface CimMarkerGraphic {
  type: "CIMMarkerGraphic";
  geometry: CimGeometry;
  symbol: CimGraphicSymbol;
  textString?: string;
  primitiveName?: string;
}

export interface CimVectorMarker extends CimSymbolLayerBase {
  type: "CIMVectorMarker";
  /** marker height in points; frame geometry is scaled by size/frameHeight */
  size?: number;
  frame?: CimEnvelope;
  markerGraphics?: CimMarkerGraphic[];
  /** Relative units: fractions of the frame size, (0,0) = frame center */
  anchorPoint?: { x: number; y: number; z?: number };
  anchorPointUnits?: "Relative" | "Absolute";
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  rotateClockwise?: boolean;
  scaleSymbolsProportionally?: boolean;
  respectFrame?: boolean;
}

export interface CimPointSymbol {
  type: "CIMPointSymbol";
  symbolLayers?: CimVectorMarker[];
}

/** KEY → parsed item CONTENT for the stylx items we ship */
export type CimDictionaryItems = Record<string, CimPointSymbol>;
