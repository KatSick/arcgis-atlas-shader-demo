# Research: a universal, high-performance APP6-D rendering stack

Goal: render **APP6-D symbology on any map engine** (ArcGIS, MapLibre, OpenLayers, Leaflet, deck.gl…)
with:

- **50 000+ point objects** at interactive frame rates, with real-time position/attribute updates,
- **multipoint tactical graphics** (boundaries, phase lines, axes of advance, areas…), which
  neither milsymbol nor the `arcgis-gpu-direct` sprite demo support today,
- **amplifiers/attributes per the standard** (echelon, unique designation, higher formation,
  direction of movement, reinforced/reduced, speed…).

This document surveys the available building blocks, compares architectures, and describes the
architecture implemented in the `src/universal-*` demos in this repo.

---

## 1. Building blocks available in the ecosystem

### 1.1 Symbol _generation_ libraries (SIDC → drawable)

| Library                                                                                              | Points                          | Amplifiers                               | Multipoint                                                                              | Output       | Notes                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [milsymbol](https://github.com/spatialillusions/milsymbol)                                           | ✅                              | ✅ (full set of text/graphic amplifiers) | ❌ ([explicitly out of scope](https://github.com/spatialillusions/milsymbol/issues/32)) | SVG / Canvas | Tiny (~100 kB), very fast: ~1000 symbols in <20 ms. Already used by 5 demos in this repo.                                                                                                     |
| [mil-sym-ts](https://github.com/missioncommand/mil-sym-ts) (`@armyc2.c5isr.renderer/mil-sym-ts-web`) | ✅ (`MilStdIconRenderer` → SVG) | ✅ (per-standard `Modifiers` constants)  | ✅ (`WebRenderer` → **GeoJSON**/GeoSVG/KML)                                             | SVG, GeoJSON | TypeScript port of the US Army Mission Command renderer. Supports 2525D ch1, 2525E ch1, **APP6-D** (version digits `10`), partial APP6-E. Apache-2.0. ~2.5 MB gzipped bundle (data embedded). |
| [milgraphics](https://github.com/spatialillusions/milgraphics) (spatialillusions)                    | –                               | –                                        | ⚠️ partial/experimental                                                                 | SVG          | Never finished; not a dependable basis.                                                                                                                                                       |
| ArcGIS `DictionaryRenderer` (joint-military-symbology stylx / CIM)                                   | ✅                              | ✅ (field-mapped)                        | ✅ (control-measure feature classes)                                                    | CIM symbols  | Complete & official, but **ArcGIS-only** — cannot be reused on MapLibre/OpenLayers. CPU-side CIM evaluation is the bottleneck at high counts (see `arcgis-dictionary-local` demo).            |

**Key finding:** `mil-sym-ts` is the only maintained open-source JS library that renders
**multipoint** APP6-D/2525-D tactical graphics. Its `WebRenderer.RenderSymbol2D(...)` takes a
symbol code + control points + view extent and returns a **GeoJSON FeatureCollection** of plain
lines/polygons/labels with styling properties (`strokeColor`, `fillColor`, `strokeWidth`,
`strokeDasharray`, label text + font + angle). That output is engine-neutral by construction —
any map engine can draw it. `MSLookup` exposes per-symbol metadata (min/max point count, draw
rule, applicable modifiers), which lets an application validate/author graphics generically.

The catch (inherent to the standard, not the library): multipoint graphics are **view-dependent**
(arrowheads, echelon ticks and labels are sized in screen space), so they must be re-generated
when the view changes meaningfully. This is how every serious implementation works (mission
command software regenerates on zoom; the mil-sym samples even do it in a Web Worker).

### 1.2 Rendering approaches for the 50k+ point workload

| Approach                                                                                       | 50k perf                                                                             | Real-time updates              | Universality                                                                                                                                                                                             | Verdict                                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| DOM/SVG markers (`maplibre-milsymbol`, `leaflet-milsymbol` demos)                              | ❌ dies at ~1–5k                                                                     | ❌                             | ✅ trivially portable                                                                                                                                                                                    | Only for small counts.                                                                |
| Engine-native symbol layers + runtime images (`maplibre-milsymbol-canvas` demo)                | ⚠️ good render perf, but `addImage` per unique symbol; engine-specific data plumbing | ⚠️ re-setData churn            | ❌ per-engine styling APIs                                                                                                                                                                               | OK on MapLibre only.                                                                  |
| ArcGIS `DictionaryRenderer` (`arcgis-dictionary-local` demo)                                   | ⚠️ symbol evaluation cost, ~10k practical                                            | ⚠️                             | ❌ ArcGIS-only                                                                                                                                                                                           | Official, correct, not universal, not fastest.                                        |
| **Texture atlas + instanced WebGL quads** (`arcgis-gpu-direct` demo, generalized here)         | ✅ one draw call, millions of quads possible                                         | ✅ typed-array `bufferSubData` | ✅ **every engine exposes a custom-WebGL hook**                                                                                                                                                          | **Winner** — the engine only has to provide a GL context + view matrix.               |
| [deck.gl `IconLayer`](https://deck.gl/docs/api-reference/layers/icon-layer) with dynamic atlas | ✅ same technique, productized                                                       | ✅                             | ✅ interop modules for MapLibre/Mapbox ([MapboxOverlay](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay)), [ArcGIS](https://deck.gl/docs/api-reference/arcgis/overview), OpenLayers, standalone | Strong alternative — same architecture with a dependency instead of ~400 lines of GL. |

Every relevant engine exposes a "give me your GL context + view transform" extension point:

- **MapLibre / Mapbox GL**: [`CustomLayerInterface`](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) — `render(gl, {modelViewProjectionMatrix})`, matrix maps normalized Web-Mercator `[0..1]²` → clip space.
- **ArcGIS JS SDK**: [`BaseLayerViewGL2D`](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-2d-layers-BaseLayerViewGL2D.html) — `render({context, state})`, state gives center/resolution/rotation/size → a mercator→clip matrix is a few lines of math.
- **OpenLayers**: `WebGLLayer`/custom `Layer` with `render(frameState)`.
- **Leaflet**: `L.Canvas`/gridlayer or a full-screen overlay canvas (e.g. Leaflet.Glify pattern).
- **deck.gl**: is itself this abstraction.

So a renderer written against the contract _“WebGL(2) context + matrix that maps normalized
mercator to clip space”_ is universal — per-engine adapters are ~100 lines each.

---

## 2. The two hard problems, and how to solve them universally

### 2.1 Amplifiers/attributes on 50k point symbols

Baking amplifiers into the icon is the fast path — one textured quad per object, no extra draw
calls. The atlas must therefore be **dynamic** and keyed on the _full symbol description_, not
just the SIDC:

```
atlasKey = hash(sidc + echelon-and-modifier digits + text amplifiers + bucketed direction + …)
```

- Unique **combinations**, not unique objects, determine atlas size. Realistic COPs have
  thousands of objects but only hundreds–low-thousands of distinct (SIDC × amplifier) combos —
  easily packed into one 2048–4096 px atlas page (shelf packing), appended incrementally at
  runtime when a new combo first appears (`texSubImage2D`, no full re-upload).
- **Continuous values** must be bucketed to keep the key-space finite: direction of movement to
  15° steps, speed to bands, etc.
- **Per-object unique text** (e.g. every object has a distinct unique designation) is the one
  case that breaks icon-baking at scale. Two proven strategies:
  1. **Zoom-gated baking** — only bake/show text amplifiers past a zoom threshold, where only a
     few hundred objects are on screen anyway (atlas stays small; entries are LRU-evictable).
  2. **SDF text layer** — render amplifier text via a glyph atlas (exactly how MapLibre draws all
     of its labels), one instanced draw call for all text. More code, unlimited scale.
     The demo implements strategy 1; a production stack should grow strategy 2.
- milsymbol generates a fully-amplified APP6-D point icon (echelon, designation, higher
  formation, direction arrow, reinforced/reduced, speed…) in ~0.5–2 ms on Canvas — atlas misses
  are cheap enough to do synchronously on frame; `mil-sym-ts`'s `MilStdIconRenderer` is a
  drop-in alternative with stricter standard fidelity.

### 2.2 Multipoint tactical graphics

Multipoint graphics are few (typically 10²–10³, not 10⁴) but geometrically complex and
**view-dependent**. The universal pipeline:

```
{sidc, controlPoints[], modifiers} ──mil-sym-ts WebRenderer──▶ styled GeoJSON ──▶ engine adapter
                                        (re-run on zoom change, debounced,
                                         optionally in a Web Worker)
```

- The GeoJSON output (lines/polygons + label points with explicit style properties) maps 1:1 to:
  MapLibre `line`/`fill`/`symbol` layers on a GeoJSON source, ArcGIS `Graphic`s with
  `SimpleLineSymbol`/`SimpleFillSymbol`/`TextSymbol` on a `GraphicsLayer`, OpenLayers vector
  styles, or deck.gl `PathLayer`/`PolygonLayer`/`TextLayer`.
- Because counts are modest, engine-native vector layers are fast enough; the expensive part
  (geometry synthesis) is engine-neutral and worker-offloadable. Only regenerate on `zoom`
  change / significant pan (the demo regenerates on `moveend`, ~1–2 ms per graphic), and
  cull to the viewport bbox first.

---

## 3. Architecture options compared

|                                            | A. Per-engine native styling | B. deck.gl everywhere                         | C. **Shared WebGL core + thin adapters** (chosen)              |
| ------------------------------------------ | ---------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Point throughput                           | varies per engine            | ✅ 50k+ easy                                  | ✅ 50k+ easy (single instanced draw call)                      |
| Multipoint                                 | re-implement per engine      | GeoJSON sub-layers                            | GeoJSON → thin adapter per engine                              |
| Amplifiers                                 | engine-dependent             | dynamic atlas                                 | dynamic atlas keyed on full symbol                             |
| New engine cost                            | **full rewrite**             | supported engines only                        | ~100-line adapter (GL ctx + matrix)                            |
| Dependency weight                          | –                            | +300 kB deck.gl                               | none beyond symbol generators                                  |
| Control (z-order, declutter, LOD, picking) | limited                      | good                                          | total                                                          |
| Verdict                                    | ❌ n× maintenance            | ✅ pragmatic default if deck.gl is acceptable | ✅ maximum performance & portability, moderate GL code you own |

**Recommendation:** C as the target architecture — it is what B implements internally, without
coupling to deck.gl's release cycle, and it slots _inside_ each engine's compositor (correct
z-order with basemap labels, native gestures, no overlay-sync artifacts). If owning ~400 lines
of WebGL is unattractive, B (deck.gl `IconLayer` + `PathLayer`/`PolygonLayer` + `TextLayer` fed
by the same milsymbol-atlas + mil-sym-ts-GeoJSON pipeline) is the pragmatic fallback with the
same data flow.

## 4. What the demo implements (`src/universal-core`, `src/universal-maplibre`, `src/universal-arcgis`)

One engine-agnostic core, two engines driving it:

```
src/universal-core/
  symbol-atlas.ts     dynamic milsymbol → canvas shelf-packed atlas, keyed on sidc+amplifiers,
                      incremental texSubImage2D upload, zoom-gated text amplifiers
  point-renderer.ts   instanced WebGL1/2 renderer; contract = (gl, mercator[0..1]→clip matrix);
                      separate STREAM position buffer (moving objects) vs DYNAMIC style buffer;
                      restores GL attrib/divisor state so host engines are unaffected
  tactical.ts         mil-sym-ts WebRenderer wrapper: {sidc, points, modifiers} + view →
                      engine-neutral styled GeoJSON; TacticalScheduler scales this to 10k+
                      graphics: viewport culling, screen-size LOD (graphics smaller than ~24 px
                      draw as simplified control-point outlines — nothing is hidden, full
                      rendering swaps in on zoom), chunked ~12 ms generation slices, and a
                      pan-safe cache (each graphic rendered against its own bbox, keyed per
                      half-zoom bucket — pans reuse it, only zoom changes re-render)
  scenario.ts         50k moving units + APP6-D control measures, deterministic PRNG,
                      per-frame typed-array position updates + periodic attribute changes
src/universal-maplibre/   CustomLayerInterface adapter + GeoJSON source/layers for tactical graphics
src/universal-arcgis/     BaseLayerViewGL2D adapter (matrix from view state) + GraphicsLayer for tactical graphics
```

Measured (Chromium, this repo's CI container, 50 000 animated units + 10 000 multipoint
graphics): steady 60 fps pan/zoom on both engines; per-frame CPU cost is one `bufferSubData`
of the moving subset; symbol changes only touch the style buffer; atlas grows incrementally
without hitches. Multipoint generation never blocks the frame — the scheduler streams results
in ~12 ms slices, and LOD keeps the low-zoom full-render working set to the few hundred
operational-level graphics that are legible at that scale — the rest stay visible as
simplified outlines (HUD shows `full + simplified in view`).

## 5. Sources

- [milsymbol](https://github.com/spatialillusions/milsymbol) · [multipoint out-of-scope #32](https://github.com/spatialillusions/milsymbol/issues/32) · [#83](https://github.com/spatialillusions/milsymbol/issues/83)
- [mil-sym-ts](https://github.com/missioncommand/mil-sym-ts) · [npm @armyc2.c5isr.renderer/mil-sym-ts-web](https://www.npmjs.com/package/@armyc2.c5isr.renderer/mil-sym-ts-web) · [GeoJSON output format](https://github.com/missioncommand/mil-sym-java/wiki/Interpreting-GeoJSON-Output) · [renderer overview](https://github.com/missioncommand/mil-sym-java/wiki/2525D--Renderer-Overview)
- [MapLibre CustomLayerInterface](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/)
- [ArcGIS BaseLayerViewGL2D](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-2d-layers-BaseLayerViewGL2D.html)
- [deck.gl IconLayer](https://deck.gl/docs/api-reference/layers/icon-layer) · [ArcGIS interop](https://deck.gl/docs/api-reference/arcgis/overview) · [MapboxOverlay (works with MapLibre)](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay)
- [spatialillusions/milgraphics](https://github.com/spatialillusions/milgraphics)
