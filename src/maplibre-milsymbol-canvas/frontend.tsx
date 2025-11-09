import maplibregl from "maplibre-gl";
import { createFeatureCollection, getMetadata, MAP_CONFIG } from "../dataset";
import ms from "milsymbol";
import "maplibre-gl/dist/maplibre-gl.css";

const map = new maplibregl.Map({
  container: "root",
  style: "https://demotiles.maplibre.org/style.json",
  center: [MAP_CONFIG.center.longitude, MAP_CONFIG.center.latitude],
  zoom: MAP_CONFIG.zoom,
});

console.time("points generation");
const { points } = await getMetadata();
const { featureCollection } = createFeatureCollection(points);
console.timeEnd("points generation");

map.on("load", () => {
  const ratio = window.devicePixelRatio || 1;
  const size = 20;

  // Generate and register canvas images for each unique symbol
  featureCollection.features.forEach((feature) => {
    const sym = new ms.Symbol(feature.properties.id, {
      size: size * ratio,
    });

    const canvas = sym.asCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Convert canvas to ImageData for MapLibre
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Register the canvas image with MapLibre
    map.addImage(feature.properties.id, imageData, {
      pixelRatio: ratio,
    });
  });

  // Add GeoJSON source
  map.addSource("points", {
    type: "geojson",
    data: featureCollection,
  });

  // Add symbol layer
  map.addLayer({
    id: "symbols",
    type: "symbol",
    source: "points",
    layout: {
      "icon-image": ["get", "id"],
      "icon-size": 1.0,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
});
