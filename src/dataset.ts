import type { FeatureCollection, Point } from "geojson";

import spriteMeta from "./app6d.json" with { type: "json" };
import { config } from "./config";

export interface DatasetItem {
  type: "point";
  x: number;
  y: number;
  sidc: string;
}

export const MAP_CONFIG = {
  center: {
    longitude: -98,
    latitude: 39,
  },
  zoom: 4,
};

export const getMetadata = async () => {
  const keys = [
    ...Object.keys(spriteMeta).filter((x) => x.charAt(4) == "3"),
    ...Object.keys(spriteMeta).filter((x) => x.charAt(4) == "2"),
    ...Object.keys(spriteMeta).filter((x) => x.charAt(4) == "1"),
  ];
  const points: DatasetItem[] = [];

  for (let i = 0; i < config.count; i++) {
    const sidc = keys[i % keys.length];
    if (!sidc) continue;

    points.push({
      type: "point",
      x: -125 + Math.random() * 55,
      y: 25 + Math.random() * 25,
      sidc,
    });
  }

  return { points, spriteMeta };
};

export function createFeatureCollection(items: DatasetItem[]) {
  const featureCollection: FeatureCollection<Point, { id: string }> = {
    type: "FeatureCollection",
    features: [],
  };

  items.forEach((item, i) => {
    featureCollection.features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [item.x, item.y],
      },
      properties: { id: item.sidc },
    });
  });

  return { featureCollection };
}
