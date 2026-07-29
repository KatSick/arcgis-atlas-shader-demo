/**
 * TypeScript port of the Arcade "dictionary script" stored in the APP6-D
 * stylx (`meta.dictionary_script`). The script is pure string logic: it maps
 * feature attributes (or a packed 20-digit SIDC) to a semicolon-delimited
 * list of style-item keys plus primitive overrides of the form
 * `po:<primitiveName>|<Property>|<value>`.
 *
 * Porting it (rather than embedding an Arcade interpreter) is what makes the
 * dictionary usable outside ArcGIS: the output keys resolve against the very
 * same stylx items on any engine.
 */

export interface DictionaryAttributes {
  /** 8/10/20-digit APP6-D SIDC; when present it overrides the split fields */
  sidc?: string;
  context?: string;
  identity?: string;
  symbolset?: string;
  symbolentity?: string;
  modifier1?: string;
  modifier2?: string;
  echelon?: string;
  mobility?: string;
  array?: string;
  status?: string;
  operationalcondition?: string;
  indicator?: string;
  specialentitysubtype?: string;
  /** direction of movement in degrees; empty/undefined = no arrow */
  direction?: string | number;
  civilian?: string;
}

export interface DictionaryConfiguration {
  frame: "ON" | "OFF";
  icon: "ON" | "OFF";
  fill: "ON" | "OFF";
  modifiers: "ON" | "OFF";
  amplifiers: "ON" | "OFF";
  text: "ON" | "OFF";
  condition: "PRIMARY" | "ALTERNATE";
  sea_mine: "MEDAL" | "ALTERNATE";
  colors: "LIGHT" | "MEDIUM" | "DARK";
}

export const DEFAULT_CONFIGURATION: DictionaryConfiguration = {
  frame: "ON",
  icon: "ON",
  fill: "ON",
  modifiers: "ON",
  amplifiers: "ON",
  text: "ON",
  condition: "PRIMARY",
  sea_mine: "MEDAL",
  colors: "LIGHT",
};

export interface PrimitiveOverride {
  primitiveName: string;
  property: string;
  value: string;
}

export interface ResolvedSymbolKeys {
  /** ordered item keys; each entry lists fallback alternatives ("a|b") */
  itemKeys: string[][];
  overrides: PrimitiveOverride[];
  /** the raw semicolon-delimited string, as the Arcade script returns it */
  raw: string;
}

const isEmpty = (v: string | number | undefined | null): boolean =>
  v === undefined || v === null || v === "";

/** Arcade decode(value, in1, out1, in2, out2, ..., default) */
function decode(value: string, ...pairs: string[]): string {
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (value === pairs[i]) return pairs[i + 1]!;
  }
  return pairs.length % 2 === 1 ? pairs[pairs.length - 1]! : "";
}

/**
 * Faithful port of the stylx Arcade script. Returns the same
 * semicolon-delimited key string the Arcade version produces.
 */
export function buildSymbolKeys(
  attributes: DictionaryAttributes,
  configuration: Partial<DictionaryConfiguration> = {},
): string {
  const cfg = { ...DEFAULT_CONFIGURATION, ...configuration };

  let context = attributes.context ?? "";
  let identity = attributes.identity ?? "";
  let symbolset = attributes.symbolset ?? "";
  let symbolentity = attributes.symbolentity ?? "";
  let modifier1 = attributes.modifier1 ?? "";
  let modifier2 = attributes.modifier2 ?? "";
  let echelon = attributes.echelon ?? "";
  let status = attributes.status ?? "";
  let indicator = attributes.indicator ?? "";
  let specialentitysubtype = attributes.specialentitysubtype ?? "";
  const direction = attributes.direction;
  const civilian = attributes.civilian ?? "";

  const sidc = attributes.sidc ?? "";
  const sidcLen = sidc.length;

  if (sidcLen === 8 || sidcLen === 10 || sidcLen === 20) {
    // extract attribute values from the packed SIDC
    context = sidc.slice(2, 3);
    identity = sidc.slice(3, 4);
    symbolset = sidc.slice(4, 6);
    status = sidc.slice(6, 7);
    indicator = sidc.slice(7, 8);
    echelon = sidcLen > 8 ? sidc.slice(8, 10) : "00";
    if (sidcLen > 10) {
      symbolentity = sidc.slice(10, 16);
      modifier1 = sidc.slice(16, 18);
      modifier2 = sidc.slice(18, 20);
      if (symbolset === "10") {
        const entitySubtype = sidc.slice(14, 16);
        if (["95", "96", "97", "98"].includes(entitySubtype)) {
          specialentitysubtype = entitySubtype;
          symbolentity = symbolentity.slice(0, 4) + "00";
        } else {
          specialentitysubtype = "";
        }
      }
    } else {
      symbolentity = "000000";
      modifier1 = "00";
      modifier2 = "00";
    }
  } else {
    // use individual attributes
    if (isEmpty(symbolset)) symbolset = "10";
    else if (symbolset.length === 1) symbolset = "0" + symbolset;

    if (isEmpty(status)) status = attributes.operationalcondition ?? "";

    if (isEmpty(echelon)) {
      echelon = isEmpty(attributes.mobility)
        ? (attributes.array ?? "")
        : (attributes.mobility ?? "");
    }

    if (symbolentity.length < 6) symbolentity = symbolentity.padEnd(6, "0");
    else if (symbolentity.length > 6) symbolentity = symbolentity.slice(0, 6);

    if (symbolset === "10") {
      if (isEmpty(specialentitysubtype)) specialentitysubtype = symbolentity.slice(4, 6);
      if (["95", "96", "97", "98"].includes(specialentitysubtype)) {
        symbolentity = symbolentity.slice(0, 4) + "00";
      } else {
        specialentitysubtype = "";
      }
    }

    if (modifier1.length === 1) modifier1 = "0" + modifier1;
    if (modifier2.length === 1) modifier2 = "0" + modifier2;
  }

  // configuration
  const showFrame = cfg.frame !== "OFF" && !(symbolset === "30" && symbolentity === "150000");
  const showIcon = cfg.icon !== "OFF";
  const showFill = cfg.fill !== "OFF" && !(symbolset === "36" && cfg.sea_mine === "ALTERNATE");
  const showModifiers = cfg.modifiers !== "OFF";
  const showAmplifiers = cfg.amplifiers !== "OFF";
  const showText = cfg.text !== "OFF";
  const useConditionAlt = cfg.condition !== "PRIMARY";
  const useSeaMineMedal = cfg.sea_mine !== "ALTERNATE";

  const ctx = decode(context, "1", "1", "2", "2", "0");
  const affiliation = decode(identity, "2", "3", "3", "3", "4", "4", "5", "6", "6", "6", "1");
  const statusDigit = ["1", "2", "3", "4", "5", "6"].includes(status) ? status : "0";

  // validity of critical attributes
  const invalidSymbolset = ![
    "00",
    "01",
    "02",
    "05",
    "06",
    "10",
    "11",
    "15",
    "20",
    "25",
    "27",
    "30",
    "35",
    "36",
    "40",
    "45",
    "46",
    "47",
    "50",
    "51",
    "52",
    "53",
    "54",
    "60",
  ].includes(symbolset);
  let invalidIdentity = !["0", "1", "2", "3", "4", "5", "6"].includes(identity);
  const validEchelon = [
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
  ].includes(echelon);
  const validMobility = ["31", "32", "33", "34", "35", "36", "37", "41", "42", "51", "52"].includes(
    echelon,
  );
  const validArray = ["61", "62"].includes(echelon);
  const validLeadership = symbolset === "27" && ["71", "72"].includes(echelon);
  const validSymbolEntity = symbolentity !== "000000";
  const INVALID_KEY = "invalid";

  // fix for feature templates
  if (invalidIdentity) {
    identity = "1";
    invalidIdentity = false;
  }

  // map symbolset for frame icons (used by frameWidth and several branches)
  const symbolsetFrame = decode(
    symbolset,
    "01",
    "01",
    "02",
    "01",
    "05",
    "05",
    "06",
    "05",
    "10",
    "10",
    "11",
    "10",
    "15",
    "30",
    "20",
    "20",
    "27",
    ctx === "0" && affiliation === "3" && statusDigit === "0" ? "27" : "30",
    "30",
    "30",
    "35",
    "35",
    "36",
    "35",
    "40",
    "40",
    "50",
    "05",
    "51",
    "01",
    "52",
    "30",
    "53",
    "30",
    "54",
    "35",
    "60",
    "30",
    "00",
  );

  // frame width based on the spec dimensions (1.2L, 1.44L, ...) as a percentage
  let frameWidthCache: string | undefined;
  const frameWidth = (): string => {
    if (frameWidthCache === undefined) {
      if (!showFrame) frameWidthCache = "100";
      else if (affiliation === "1")
        frameWidthCache = ["01", "05", "35"].includes(symbolsetFrame) ? "150" : "144";
      else if (affiliation === "3" || (affiliation === "6" && context === "1"))
        frameWidthCache = decode(
          symbolsetFrame,
          "00",
          "120",
          "10",
          "150",
          "15",
          "120",
          "20",
          "150",
          "30",
          "120",
          "40",
          "150",
          "110",
        );
      else if (affiliation === "6")
        frameWidthCache = ["01", "05", "35"].includes(symbolsetFrame) ? "110" : "144";
      else frameWidthCache = "110"; // neutral
    }
    return frameWidthCache;
  };

  let keys: string;

  // invalid symbol set
  if (invalidSymbolset) {
    keys = INVALID_KEY;
  }

  // metoc symbol
  else if (["45", "46", "47"].includes(symbolset)) {
    keys = symbolset + symbolentity;
    if (showText) keys += ";" + symbolset + symbolentity + "_labels";
  }

  // from now on, we need a valid identity
  else if (invalidIdentity) {
    keys = INVALID_KEY;
  }

  // control measure symbol
  else if (symbolset === "25") {
    keys = "25" + symbolentity + (statusDigit === "1" ? "_" : "");
    if (showAmplifiers) {
      if (validEchelon) {
        if (["110100", "290600"].includes(symbolentity)) {
          keys += ";ECH_" + echelon + "_L";
          const middleGap = decode(echelon, "22", "24", "23", "32", "24", "36", "25", "40", "20");
          keys += ";po:echelon_cut|MiddleCut|" + middleGap;
        } else if (["151200", "151201", "151202", "151203"].includes(symbolentity)) {
          keys += ";ECH_" + echelon + "_A";
          const gap = decode(echelon, "22", "12", "23", "16", "24", "18", "25", "20", "10");
          keys += ";po:echelon_cut|BeginCut|" + gap;
          keys += ";po:echelon_cut|EndCut|" + gap;
        }
      }
      if (!isEmpty(direction)) {
        if (
          ["281300", "281301", "281400", "281401", "281500", "281600", "281700", "281701"].includes(
            symbolentity,
          )
        ) {
          keys += ";DOM_Land";
          keys += ";po:DOM_arrow|Rotation|" + direction;
          if (showText) keys += ";po:DOM_bar|OffsetY|-10";
        }
      }
    }
    keys += ";po:cm_color|Color|";
    keys += decode(affiliation, "3", "#000000", "4", "#00FF00", "6", "#FF0000", "#FFFF00");
    if (showText) keys += ";25" + symbolentity + "_labels";
  }

  // frame symbol
  else {
    keys = "";

    // frame fill color
    const fillColor =
      civilian === "1" && affiliation !== "6"
        ? decode(cfg.colors, "DARK", "#500050", "MEDIUM", "#800080", "#FFA1FF")
        : decode(
            affiliation,
            "3",
            decode(cfg.colors, "DARK", "#006B8C", "MEDIUM", "#00A8DC", "#80E0FF"),
            "4",
            decode(cfg.colors, "DARK", "#00A000", "MEDIUM", "#00E200", "#AAFFAA"),
            "6",
            decode(cfg.colors, "DARK", "#C80000", "MEDIUM", "#FF3031", "#FF8080"),
            decode(cfg.colors, "DARK", "#E1DC00", "MEDIUM", "#FFFF00", "#FFFF80"),
          );

    // frame
    if (showFrame) {
      keys =
        ctx +
        "_" +
        identity +
        symbolsetFrame +
        (statusDigit === "1" && ["1", "3", "4", "6"].includes(identity) ? "_1" : "_0");
      keys += ";po:frame_fill|Color|";
      keys += showFill ? fillColor : "RGBA(0,0,0,0)";
      if (!showFill) {
        keys += ";po:frame_outline|Color|";
        if (civilian === "1" && affiliation !== "6") keys += "#FF00FF";
        else keys += decode(affiliation, "3", "#00FFFF", "4", "#00FF00", "6", "#FF0000", "#FFFF00");
      }
    }

    // identity suffix for icons with touching frames
    const affiliationIcon =
      context === "1"
        ? decode(identity, "2", "_1", "3", "_1", "4", "_2", "5", "_1", "6", "_1", "_0")
        : decode(identity, "2", "_1", "3", "_1", "4", "_2", "5", "_3", "6", "_3", "_0");

    // icon
    if (showIcon) {
      if (validSymbolEntity) {
        const altSeaMineSuffix = symbolset === "36" && !useSeaMineMedal ? "_alt" : "";
        keys += ";";
        // non-touching first, touching variant as fallback — we can't know
        // which exists without querying, so both are provided
        keys +=
          symbolset +
          symbolentity +
          altSeaMineSuffix +
          "|" +
          symbolset +
          symbolentity +
          affiliationIcon;
        if (!showFrame && symbolset !== "36") {
          keys += ";po:icon_element|Color|" + fillColor;
        }
      } else {
        keys += ";35140000"; // question mark icon for invalid symbol entity
      }
    } else if (!showFrame) {
      keys += ";icon_off"; // default circle
      if (showFill) keys += ";po:icon_element|Color|" + fillColor;
    }

    // modifiers
    if (showModifiers) {
      if (modifier1 !== "00" && modifier1.length === 2) {
        keys += ";" + symbolset + modifier1 + "1";
      }
      if (modifier2 !== "00" && modifier2.length === 2) {
        keys += ";" + symbolset + modifier2 + "2";
      }
      // land unit special entity subtype
      if (
        symbolset === "10" &&
        validSymbolEntity &&
        ["95", "96", "97", "98"].includes(specialentitysubtype)
      ) {
        keys += ";10XXXX" + specialentitysubtype + affiliationIcon;
      }
    }

    // amplifiers
    if (showAmplifiers) {
      // offsets to place elements on top of / below the frame or icon
      let offsetTop: number;
      if (showFrame) {
        if (affiliation === "3" || (affiliation === "6" && context === "1"))
          offsetTop = Number(
            decode(
              symbolsetFrame,
              "01",
              "15",
              "05",
              "15",
              "10",
              "10",
              "20",
              "10",
              "35",
              "10",
              "40",
              "10",
              "12",
            ),
          );
        else if (affiliation === "1" || affiliation === "6")
          offsetTop = Number(decode(symbolsetFrame, "01", "16", "05", "16", "35", "10", "14.5"));
        else offsetTop = Number(decode(symbolsetFrame, "01", "13", "05", "13", "11"));
      } else if (showIcon) {
        offsetTop = 10; // octagon
      } else {
        offsetTop = 5; // circle
      }
      let offsetBottom: number;
      if (showFrame) {
        if (affiliation === "3" || (affiliation === "6" && context === "1"))
          offsetBottom = Number(
            decode(
              symbolsetFrame,
              "01",
              "10",
              "05",
              "10",
              "10",
              "10",
              "20",
              "10",
              "35",
              "16",
              "40",
              "10",
              "12",
            ),
          );
        else if (affiliation === "1" || affiliation === "6")
          offsetBottom = Number(decode(symbolsetFrame, "01", "10", "05", "10", "35", "16", "14.5"));
        else
          offsetBottom = Number(decode(symbolsetFrame, "01", "10", "05", "10", "35", "14", "11"));
      } else if (showIcon) {
        offsetBottom = 10; // octagon
      } else {
        offsetBottom = 5; // circle
      }

      // echelon, mobility, array, leadership
      if (validEchelon) {
        keys += ";ECH_" + echelon + "_P";
        keys += ";po:echelon|OffsetY|" + (offsetTop + 2.5);
      } else if (validArray || validMobility) {
        keys += ";MOB_" + echelon;
        keys += ";po:mobility|OffsetY|" + (-offsetBottom - 3);
        offsetBottom += 6; // in case we also show an operational condition
      } else if (validLeadership) {
        keys += ";" + affiliation + echelon;
      }

      // HQ
      if (["2", "3", "6", "7"].includes(indicator)) {
        if (!showFrame) {
          keys += showIcon ? ";HQ_ICON" : ";HQ_DOT";
        } else {
          const symbolsetHQ = decode(
            symbolsetFrame,
            "00",
            "30",
            "01",
            "01",
            "05",
            "01",
            "27",
            "27",
            "30",
            "30",
            "35",
            "35",
            "10",
          );
          const affiliationHQ = affiliation === "6" && context === "1" ? "3" : affiliation;
          keys += ";HQ_" + affiliationHQ + "_" + symbolsetHQ;
        }
      }
      // TF
      if (["4", "5", "6", "7"].includes(indicator)) {
        keys += ";TF_";
        if (["22", "23", "24", "25"].includes(echelon)) keys += echelon;
        keys += ";po:TF|OffsetY|" + offsetTop; // TF symbols are anchored at base
      }
      // FD
      if (["1", "3", "5", "7"].includes(indicator)) {
        keys += ";FD_" + frameWidth();
        keys += ";po:FD|OffsetY|" + offsetTop; // FD symbols are anchored at base
      }
      // operational condition
      if (useConditionAlt) {
        if (["2", "3", "4", "5"].includes(statusDigit)) {
          keys += ";OC_alt_" + statusDigit + "_" + frameWidth();
          keys += ";po:op_cond|OffsetY|" + (-offsetBottom - 3); // OC symbols are centred
          offsetBottom += 6; // in case we also show direction of movement
        }
      } else {
        if (["3", "4"].includes(statusDigit)) {
          keys += ";OC_" + statusDigit;
        }
      }
      // direction of movement
      if (!isEmpty(direction)) {
        if (["10", "11", "15", "27"].includes(symbolset)) {
          keys += ";DOM_Land";
          keys += ";po:DOM_bar|OffsetY|" + -offsetBottom;
        } else if (symbolset !== "20") {
          keys += ";DOM";
        }
        if (symbolset !== "20") {
          keys += ";po:DOM_arrow|Rotation|" + direction;
        }
      }
    }

    // labels
    if (showText) {
      const symbolsetLabels = decode(
        symbolset,
        "01",
        "01",
        "02",
        "01",
        "05",
        "05",
        "06",
        "05",
        "10",
        "10",
        "11",
        "10",
        "15",
        "15",
        "20",
        "20",
        "27",
        "27",
        "30",
        "30",
        "35",
        "35",
        "36",
        "35",
        "40",
        "40",
        "50",
        "05",
        "51",
        "01",
        "52",
        "10",
        "53",
        "30",
        "54",
        "35",
        "60",
        "30",
        "00",
      );
      keys += ";" + symbolsetLabels + "_labels";
    }
  }

  return keys;
}

/** Split the raw semicolon-delimited key string into item keys + overrides. */
export function parseSymbolKeys(raw: string): ResolvedSymbolKeys {
  const itemKeys: string[][] = [];
  const overrides: PrimitiveOverride[] = [];
  for (const part of raw.split(";")) {
    if (part === "") continue;
    if (part.startsWith("po:")) {
      const [primitiveName, property, ...rest] = part.slice(3).split("|");
      if (primitiveName && property) {
        overrides.push({ primitiveName, property, value: rest.join("|") });
      }
    } else {
      itemKeys.push(part.split("|"));
    }
  }
  return { itemKeys, overrides, raw };
}
