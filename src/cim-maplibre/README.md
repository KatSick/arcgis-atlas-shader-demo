# CIM dictionary renderer on MapLibre

ArcGIS `DictionaryRenderer` semantics on MapLibre, without ArcGIS: the
APP6-D stylx CIM items (inlined at build time), the TypeScript port of the
dictionary script and the Canvas CIM rasterizer feed the shared
instanced-WebGL point core through MapLibre's `CustomLayerInterface`.

50 000 animated units by default (`?count=` to change), symbols keyed on
SIDC + amplifiers, text amplifiers appear past zoom 8.

## Run

```bash
bun dev:cim-maplibre
```
