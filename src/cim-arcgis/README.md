# Replacing DictionaryRenderer inside ArcGIS

The headline demo for the universal dictionary renderer: the ArcGIS JS SDK
map, but the built-in `DictionaryRenderer` (per-feature CPU CIM evaluation,
~10k practical — see `arcgis-dictionary-local`) is replaced by
`UniversalDictionaryRenderer` — same APP6-D stylx content, same dictionary
script semantics, but symbols rasterize once per unique SIDC+amplifier combo
into a texture atlas and draw as instanced quads via `BaseLayerViewGL2D`.

The _same renderer class_ (and data flow) drives `cim-maplibre` and `cim-ol`:
one dictionary renderer, any engine.

50 000 animated units + 10 000 multipoint tactical graphics (mil-sym-ts pipeline) by default (`?count=` / `?tactical=` to change).

## Run

```bash
bun dev:cim-arcgis
```
