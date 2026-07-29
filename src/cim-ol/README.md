# CIM dictionary renderer on OpenLayers

The same CIM dictionary pipeline as `cim-maplibre`, driven through an
OpenLayers adapter: a custom `Layer` subclass that owns a WebGL canvas and
derives the mercator-[0..1]→clip matrix from the OL view state (center,
resolution, rotation) each frame — the ~100-line adapter contract described
in RESEARCH.md §1.2, now proven on a third engine.

50 000 animated units by default (`?count=` to change).

## Run

```bash
bun dev:cim-ol
```
