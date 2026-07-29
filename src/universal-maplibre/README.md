# Universal APP6-D stack — MapLibre adapter

MapLibre `CustomLayerInterface` adapter for the shared [universal-core](../universal-core)
renderer: 50k+ point symbols with baked amplifiers in one instanced draw call, plus
multipoint tactical graphics (mil-sym-ts GeoJSON) on native `fill`/`line`/`symbol` layers,
regenerated on `moveend` (multipoint graphics are view-dependent per the standard).

URL params: `?count=50000` (units) `&tactical=60` (multipoint graphics)

## Run

```bash
bun dev:universal-maplibre
```
