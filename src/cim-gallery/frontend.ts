import type { CimDictionaryItems } from "../cim-dictionary/cim-types";
import { buildSymbolKeys, parseSymbolKeys } from "../cim-dictionary/dictionary-script";
import { CimPointRasterizer } from "../cim-dictionary/rasterizer";
import { loadDictionaryItemsJson } from "../cim-dictionary/stylx-macro" with { type: "macro" };

/**
 * Visual regression surface for the CIM pipeline: a spread of SIDCs rendered
 * large, straight through dictionary-script + rasterizer — no map engine.
 * Compare against ArcGIS's own DictionaryRenderer output (the
 * arcgis-dictionary-local demo) to judge fidelity.
 */

interface Sample {
  label: string;
  sidc: string;
  direction?: number;
  text?: Record<string, string>;
}

const SAMPLES: Sample[] = [
  { label: "Friendly infantry battalion", sidc: "10031000161211020000" },
  { label: "Hostile armor company", sidc: "10061000151205000000" },
  { label: "Neutral mech infantry, planned", sidc: "10041010161211022100" },
  { label: "Unknown land unit", sidc: "10011000001211000000" },
  {
    label: "Friendly brigade + designation/higher formation",
    sidc: "10031000181211000000",
    text: { uniquedesignation: "ALPHA", higherformation: "X CORPS" },
  },
  { label: "Hostile w/ direction of movement 45°", sidc: "10061000151211000000", direction: 45 },
  { label: "Friendly w/ direction of movement 270°", sidc: "10031000151211000000", direction: 270 },
  { label: "HQ + task force (indicator 6)", sidc: "10031006161211000000" },
  { label: "Feint/dummy (indicator 1)", sidc: "10031001161211000000" },
  { label: "Mobility: tracked (31)", sidc: "10031000311205000000" },
  { label: "Air: hostile fighter", sidc: "10060100001101040000" },
  { label: "Sea: friendly surface combatant", sidc: "10033000001201000000" },
  { label: "Land equipment: howitzer", sidc: "10031500001103000000" },
  { label: "Damaged (OC 3)", sidc: "10031030161211000000" },
  { label: "Modifiers 1+2 (mtn 03 / airborne 01)", sidc: "10031000161211020301" },
  { label: "Air fixed-wing (frame off icon fill)", sidc: "10030100001101000000" },
];

async function main() {
  const items = JSON.parse(await loadDictionaryItemsJson()) as CimDictionaryItems;
  const rasterizer = new CimPointRasterizer(items, { ptToPx: 3, ratio: 1 });
  const grid = document.getElementById("grid")!;

  for (const sample of SAMPLES) {
    const raw = buildSymbolKeys({ sidc: sample.sidc, direction: sample.direction });
    const sprite = rasterizer.rasterize(parseSymbolKeys(raw), sample.text ?? {});

    const cell = document.createElement("div");
    cell.className = "cell";
    if (sprite) cell.appendChild(sprite.canvas);
    const caption = document.createElement("small");
    caption.textContent = `${sample.label}\n${sample.sidc}`;
    caption.style.whiteSpace = "pre-line";
    cell.appendChild(caption);
    grid.appendChild(cell);
  }
}

main();
