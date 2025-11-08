import { createFeatureCollection, getMetadata, MAP_CONFIG } from "@/dataset";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import ms from "milsymbol";

const OSM = L.tileLayer("http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {});

const map = L.map("root", {
  center: L.latLng(MAP_CONFIG.center.latitude, MAP_CONFIG.center.longitude),
  zoom: MAP_CONFIG.zoom,
  layers: [OSM],
});

console.time("points generation");
const { points } = await getMetadata();
const { featureCollection } = createFeatureCollection(points);
console.timeEnd("points generation");

L.geoJson(featureCollection, {
  pointToLayer: (feature, latlng) => {
    const symbol = new ms.Symbol(feature.properties.id, {
      size: 20,
    });

    const myicon = L.icon({
      iconUrl: symbol.toDataURL(),
      iconAnchor: [symbol.getAnchor().x, symbol.getAnchor().y],
    });

    return L.marker(latlng, { icon: myicon, draggable: true });
  },
}).addTo(map);
