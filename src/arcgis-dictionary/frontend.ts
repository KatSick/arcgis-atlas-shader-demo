import Map from "@arcgis/core/Map";
import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import DictionaryRenderer from "@arcgis/core/renderers/DictionaryRenderer";
import { getMetadata, MAP_CONFIG, type DatasetItem } from "@/dataset";
import "@arcgis/core/assets/esri/themes/dark/main.css";

const map = new Map({
  basemap: "osm",
});

new MapView({
  container: "root",
  map: map,
  center: [MAP_CONFIG.center.longitude, MAP_CONFIG.center.latitude],
  zoom: MAP_CONFIG.zoom,
});

const dictionaryRendererConfig = {};

const dictionaryRendererFieldMap = {
  sidc: "sidc",
};

const dictRenderer = new DictionaryRenderer({
  url: "https://www.arcgis.com/sharing/rest/content/items/a63067c8791d4f88b308075af9587861",
  fieldMap: dictionaryRendererFieldMap,
  config: dictionaryRendererConfig,
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
