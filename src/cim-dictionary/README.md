# Engine-neutral CIM dictionary renderer core

An ArcGIS-free reimplementation of the `DictionaryRenderer` for APP6-D point
symbols, built directly on the open [CIM spec](https://github.com/Esri/cim-spec)
and the very same `.stylx` content ArcGIS uses
(`src/arcgis-dictionary-local/app6d.stylx`). Nothing here imports `@arcgis/core`.

## How it works

```
attributes {sidc, direction, text amplifiers}
        │ dictionary-script.ts (TS port of the stylx Arcade script)
        ▼
"0_310_0;po:frame_fill|Color|#80E0FF;10121102|10121102_1;ECH_16_P;…;10_labels"
        │ rasterizer.ts (CIM → Canvas 2D)
        ▼
sprite canvas + anchor ──▶ cim-atlas.ts (shelf-packed texture atlas,
                            same IconAtlas contract as the milsymbol atlas)
        ▼
universal-core PointSymbolRenderer (one instanced draw call on any engine)
```

- **`stylx-macro.ts`** — a Bun bundle-time macro that reads the stylx SQLite
  and inlines the CIM items as JSON (control-measure/METOC multipoint items
  excluded — they are outside the point-sprite subset).
- **`dictionary-script.ts`** — faithful TypeScript port of the ~420-line
  Arcade `dictionary_script` stored in the stylx `meta` table. It maps a
  packed 20-digit SIDC (or split attributes) to ordered style-item keys plus
  `po:<primitive>|<Property>|<value>` overrides. `dictionary-script.test.ts`
  sweeps ~2000 attribute combinations and asserts every emitted key resolves
  against the stylx.
- **`rasterizer.ts`** — Canvas 2D interpreter for the CIM subset the
  dictionary actually uses for point symbols: `CIMPointSymbol` →
  `CIMVectorMarker` (frames, relative anchors, offsets, rotation, nested
  point symbols) → `CIMSolidFill` / `CIMSolidStroke` (+ dash effects) /
  `CIMTextSymbol` (halo, alignment, `[field]` substitution). A survey of the
  stylx shows that is the complete requirement — no curves, picture markers
  or hatch fills appear on the point path.
- **`cim-atlas.ts`** — the atlas: keyed on SIDC + amplifiers, rasterizes on
  first request, uploads incrementally via the shared `pendingUploads` queue.

## Try it

```bash
bun dev:cim-gallery     # rasterizer output, large, no map engine
bun dev:cim-maplibre    # 50k units through MapLibre CustomLayerInterface
bun dev:cim-ol          # 50k units through an OpenLayers custom WebGL layer
bun test                # dictionary-script key resolution sweep
```

## Scope and limits

- Point symbols only. Control measures (symbol set 25) resolve through the
  same script, but their CIM is line/area symbology with geometric effects
  (dashes, offset, arrows, cuts) and on-line marker placements — implementing
  that subset is the natural next step if mil-sym-ts is not acceptable for
  multipoint graphics (see RESEARCH.md §5).
- Text amplifier fields beyond the demo set (speed, staff comments, …) work
  automatically — they are plain `[field]` substitutions.
- The `Allcaps`/halo/kerning fidelity is Canvas-level, not ArcGIS-pixel-exact.
