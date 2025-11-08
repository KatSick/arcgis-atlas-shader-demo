import { createFeatureCollection, getMetadata, MAP_CONFIG } from "../dataset";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Style, Icon } from "ol/style";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import { Map, View } from "ol";
import { transform } from "ol/proj";
import "ol/ol.css";
import ms from "milsymbol";

console.time("points generation");
const { points } = await getMetadata();
const { featureCollection } = createFeatureCollection(points);
console.timeEnd("points generation");

const vectorSource = new VectorSource({
  features: new GeoJSON().readFeatures(featureCollection, {
    featureProjection: "EPSG:3857",
  }),
});

const ratio = window.devicePixelRatio || 1;

vectorSource.forEachFeature((feature) => {
  const mysymbol = new ms.Symbol(feature.getProperties().id, {
    uniqueDesignation: feature.getProperties().name,
    size: 20 * ratio,
  });

  const mycanvas = mysymbol.asCanvas();

  feature.setStyle(
    new Style({
      image: new Icon({
        scale: 1 / ratio,
        anchor: [mysymbol.getAnchor().x, mysymbol.getAnchor().y],
        anchorXUnits: "pixels",
        anchorYUnits: "pixels",
        img: mycanvas,
      }),
    }),
  );
});

const vectorLayer = new VectorLayer({
  source: vectorSource,
});

const rasterLayer = new TileLayer({
  preload: 4,
  source: new OSM(),
});

const mapElement = document.getElementById("root");

if (!mapElement) {
  throw new Error("Map element not found");
}

new Map({
  layers: [rasterLayer, vectorLayer],
  target: mapElement,
  view: new View({
    center: transform(
      [MAP_CONFIG.center.longitude, MAP_CONFIG.center.latitude],
      "EPSG:4326",
      "EPSG:3857",
    ),
    zoom: MAP_CONFIG.zoom,
  }),
});
