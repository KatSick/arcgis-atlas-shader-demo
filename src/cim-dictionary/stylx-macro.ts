import db from "../arcgis-dictionary-local/app6d.stylx" with { type: "sqlite" };

/**
 * Bundle-time (Bun macro) extraction of the CIM items from the APP6-D stylx.
 * The stylx is a SQLite database; ITEMS.CONTENT holds one CIM JSON document
 * per style item, keyed by the strings the dictionary script produces.
 *
 * Control-measure and METOC items are excluded here: they are multipoint
 * line/area symbols whose CIM (geometric effects, marker placements along
 * lines) is outside the point-sprite subset these demos rasterize. This keeps
 * the inlined payload at roughly half of the full 9.3 MB stylx content.
 *
 * The macro returns one compact JSON string (parsed once at runtime) rather
 * than an object literal — the string form bundles ~5× smaller.
 */
export async function loadDictionaryItemsJson(): Promise<string> {
  const rows = (await db.query("select KEY, CATEGORY, CONTENT from ITEMS").all()) as {
    KEY: string;
    CATEGORY: string;
    CONTENT: string;
  }[];

  const items: Record<string, unknown> = {};
  for (const row of rows) {
    if (/^(Control Measure|Meteorological)/i.test(row.CATEGORY ?? "")) continue;
    // some CONTENT blobs carry a stray NUL from the database
    items[row.KEY] = JSON.parse(row.CONTENT.replaceAll("\x00", ""));
  }
  return JSON.stringify(items);
}
