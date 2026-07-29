import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildSymbolKeys, parseSymbolKeys } from "./dictionary-script";

/**
 * The ported dictionary script is only useful if the keys it emits actually
 * resolve against the stylx items — that is the whole contract with the CIM
 * rasterizer. These tests sweep the attribute space the demos exercise (plus
 * indicators/status/mobility variants) and assert every emitted key exists.
 */

const db = new Database(
  new URL("../arcgis-dictionary-local/app6d.stylx", import.meta.url).pathname,
);
const keyExists = db.query("select 1 from ITEMS where KEY = ?");
const exists = (key: string) => keyExists.get(key) !== null;

function expectResolvable(sidc: string, direction?: number) {
  const raw = buildSymbolKeys({ sidc, direction });
  const { itemKeys, overrides } = parseSymbolKeys(raw);
  expect(itemKeys.length).toBeGreaterThan(0);
  for (const alternatives of itemKeys) {
    const hit = alternatives.some(exists);
    if (!hit) {
      throw new Error(`sidc ${sidc}: unresolvable key "${alternatives.join("|")}" in "${raw}"`);
    }
  }
  for (const o of overrides) {
    expect(o.primitiveName).not.toBe("");
    expect(o.property).toMatch(/^(Color|OffsetX|OffsetY|Rotation|BeginCut|MiddleCut|EndCut)$/);
  }
}

// the entity/identity/echelon space used by universal-core/scenario.ts
const ENTITIES = ["121100", "121000", "120500", "121102", "130300", "110600", "111000", "120100"];
const IDENTITIES = ["1", "2", "3", "4", "5", "6"];
const ECHELONS = ["00", "11", "13", "15", "16", "17", "18", "21", "25"];

describe("dictionary script key resolution", () => {
  test("scenario space: identities × echelons × entities resolve", () => {
    for (const identity of IDENTITIES) {
      for (const echelon of ECHELONS) {
        for (const entity of ENTITIES) {
          expectResolvable(`100${identity}1000${echelon}${entity}0000`);
        }
      }
    }
  });

  test("direction of movement adds DOM_Land + rotation override", () => {
    const raw = buildSymbolKeys({ sidc: "10031000151211000000", direction: 45 });
    expect(raw).toContain("DOM_Land");
    expect(raw).toContain("po:DOM_arrow|Rotation|45");
    expectResolvable("10031000151211000000", 45);
  });

  test("HQ/TF/FD indicators resolve", () => {
    for (const indicator of ["1", "2", "3", "4", "5", "6", "7"]) {
      expectResolvable(`1003100${indicator}161211000000`);
    }
  });

  test("planned status uses dashed frame variant", () => {
    const raw = buildSymbolKeys({ sidc: "10031010161211000000" });
    expect(parseSymbolKeys(raw).itemKeys[0]![0]).toBe("0_310_1");
    expectResolvable("10031010161211000000");
  });

  test("mobility and leadership amplifiers resolve", () => {
    expectResolvable("10031000311211000000"); // mobility 31
    expectResolvable("10032700711101010000"); // dismounted individual leadership
  });

  test("air / sea / equipment symbol sets resolve", () => {
    expectResolvable("10030100001101040000"); // air fighter
    expectResolvable("10033000001202000000"); // sea surface combatant
    expectResolvable("10031500001202000000"); // land equipment
  });

  test("golden composition for a friendly land unit", () => {
    const raw = buildSymbolKeys({ sidc: "10031000151211020000" });
    const { itemKeys, overrides } = parseSymbolKeys(raw);
    expect(itemKeys[0]).toEqual(["0_310_0"]); // frame: reality, friend, land unit
    expect(itemKeys[1]).toEqual(["10121102", "10121102_1"]); // icon + touching fallback
    expect(itemKeys[2]).toEqual(["ECH_15_P"]); // echelon
    expect(itemKeys[3]).toEqual(["10_labels"]);
    expect(overrides).toContainEqual({
      primitiveName: "frame_fill",
      property: "Color",
      value: "#80E0FF",
    });
    expect(overrides).toContainEqual({
      primitiveName: "echelon",
      property: "OffsetY",
      value: "12.5",
    });
  });

  test("modifier digits emit modifier keys", () => {
    const raw = buildSymbolKeys({ sidc: "10031000161211000301" });
    expect(raw).toContain(";10031");
    expect(raw).toContain(";10012");
    expectResolvable("10031000161211000301");
  });

  test("individual attributes path matches packed-SIDC path", () => {
    const packed = buildSymbolKeys({ sidc: "10031000151211020000" });
    const split = buildSymbolKeys({
      context: "0",
      identity: "3",
      symbolset: "10",
      status: "0",
      indicator: "0",
      echelon: "15",
      symbolentity: "121102",
      modifier1: "00",
      modifier2: "00",
    });
    expect(split).toBe(packed);
  });
});
