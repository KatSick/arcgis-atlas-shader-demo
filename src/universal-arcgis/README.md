# Universal APP6-D stack — ArcGIS adapter

ArcGIS `BaseLayerViewGL2D` adapter for the shared [universal-core](../universal-core)
renderer. The only engine-specific rendering code is ~30 lines deriving the
mercator→clip matrix from the ArcGIS view state; point symbols are drawn by the exact
same instanced WebGL core as the MapLibre demo. Multipoint tactical graphics
(mil-sym-ts GeoJSON) go through a `GraphicsLayer` and are regenerated when the view
becomes stationary.

URL params: `?count=50000` (units) `&tactical=10000` (multipoint graphics)

## Run

```bash
bun dev:universal-arcgis
```
