import db from "./app6d.stylx" with { type: "sqlite" };
import info from "./dictionaryInfo.json" with { type: "json" };

import { Schema } from "effect";

class RawItem extends Schema.Class<RawItem>("RawItem")({
  ID: Schema.Number,
  CLASS: Schema.Number,
  CATEGORY: Schema.String,
  NAME: Schema.String,
  TAGS: Schema.String,
  CONTENT: Schema.NonEmptyString,
  KEY: Schema.NonEmptyString,
}) {}

class RawMeta extends Schema.Class<RawMeta>("RawMeta")({
  key: Schema.String,
  value: Schema.String,
}) {}

export async function generateJsonFile() {
  const rawData = await db.query("select * from items").all();
  const data = await Schema.decodeUnknownPromise(Schema.NonEmptyArray(RawItem))(rawData);

  const itemsMap = data.reduce(
    (prev, current) => {
      prev[current.KEY] = JSON.parse(current.CONTENT.replace("\x00", "")); // replace junk from DB
      return prev;
    },
    {} as Record<RawItem["KEY"], RawItem["CONTENT"] | {}>,
  );

  const rawMeta = await db.query("select * from meta").all();
  const meta = await Schema.decodeUnknownPromise(Schema.NonEmptyArray(RawMeta))(rawMeta);

  itemsMap["dictionary-info"] = info;

  return itemsMap;
}
