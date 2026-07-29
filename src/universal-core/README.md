# Universal APP6-D rendering core

Engine-agnostic APP6-D symbology stack — see [RESEARCH.md](../../RESEARCH.md) for the full
option analysis. The contract with a map engine is minimal: a shared WebGL context plus a
matrix mapping normalized Web-Mercator `[0..1]²` to clip space. Everything else lives here:

| file                | responsibility                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbol-atlas.ts`   | dynamic shelf-packed texture atlas of milsymbol icons, keyed on SIDC **+ amplifiers** (echelon, designation, higher formation, direction…), incremental GPU upload                                                                    |
| `point-renderer.ts` | instanced WebGL1/2 quad renderer: one draw call for 50k+ symbols, split position/style buffers for cheap real-time updates, float64 origin folding against zoom jitter, restores host GL state                                        |
| `tactical.ts`       | multipoint tactical graphics via [mil-sym-ts](https://github.com/missioncommand/mil-sym-ts): `{sidc, control points, modifiers}` + view → engine-neutral styled GeoJSON; control measures enumerated from the standard via `MSLookup` |
| `scenario.ts`       | deterministic 50k-unit scenario with movers (bucketed direction-of-movement amplifier), attribute mutation, and generated multipoint control measures                                                                                 |
| `unit-layer.ts`     | glue: zoom-gated text amplifiers, per-frame simulation stepping, style rebuilds                                                                                                                                                       |

Adapters: [`../universal-maplibre`](../universal-maplibre) (CustomLayerInterface) and
[`../universal-arcgis`](../universal-arcgis) (BaseLayerViewGL2D) — each ~100 lines of
engine-specific code around the same core.
