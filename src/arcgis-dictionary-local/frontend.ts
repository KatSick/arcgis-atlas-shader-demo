import Map from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { getMetadata, MAP_CONFIG, type DatasetItem } from "@/dataset";
import "@arcgis/core/assets/esri/themes/dark/main.css";
import { generateJsonFile } from "./dictionaryGenerator.ts" with { type: "macro" };
import DictionaryRenderer from "@arcgis/core/renderers/DictionaryRenderer";

import { installArcGisDictionaryInterceptor } from "./local-renderer.ts";

const map = new Map({
  basemap: "osm",
});

new MapView({
  container: "root",
  map: map,
  center: [MAP_CONFIG.center.longitude, MAP_CONFIG.center.latitude],
  zoom: MAP_CONFIG.zoom,
});

const dictionaryRendererFieldMap = {
  sidc: "sidc",
};

const mockUrl = "/dictionary-url";
const bundle = await generateJsonFile();

installArcGisDictionaryInterceptor(mockUrl, bundle);

const dictRenderer = new DictionaryRenderer({
  url: mockUrl,
  fieldMap: dictionaryRendererFieldMap,
  scaleExpression: "0.75",
});

var template = {
  content: "SIDC: {sidc}",
};

const createGraphic = (point: DatasetItem) =>
  new Graphic({
    geometry: {
      type: "point",
      x: point.x,
      y: point.y,
    },
    attributes: {
      sidc: point.sidc,
    },
  });

const { points } = await getMetadata();

const featureLayer = new FeatureLayer({
  source: points.map(createGraphic),
  renderer: dictRenderer,
  fields: [
    {
      name: "sidc",
      type: "string",
    },
    {
      type: "oid",
      name: "id",
    },
  ],
  geometryType: "point",
  popupTemplate: template,
});

map.add(featureLayer);
