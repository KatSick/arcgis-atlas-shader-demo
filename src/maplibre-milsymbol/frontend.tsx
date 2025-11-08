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
  featureCollection.features.forEach((feature, i) => {
    const sym = new ms.Symbol(feature.properties.id, {
      size: 20,
    });

    const el = document.createElement("div");

    el.innerHTML = sym.asSVG();
    el.className = "marker";
    el.style.width = `20px`;
    el.style.height = `20px`;

    new maplibregl.Marker({ element: el, draggable: false })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .addTo(map);
  });
});
