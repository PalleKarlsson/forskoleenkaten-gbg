/**
 * Unit tests for normalization logic (getScale / normalize).
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { getScale, normalize, cleanSchoolName } from "../src/normalize.js";

describe("getScale", () => {
  it("returns 1-3 for years <= 2009", () => {
    deepStrictEqual(getScale(2007), { min: 1, max: 3, label: "1-3" });
    deepStrictEqual(getScale(2009), { min: 1, max: 3, label: "1-3" });
  });

  it("returns 1-10 for years 2010-2014", () => {
    deepStrictEqual(getScale(2010), { min: 1, max: 10, label: "1-10" });
    deepStrictEqual(getScale(2012), { min: 1, max: 10, label: "1-10" });
    deepStrictEqual(getScale(2014), { min: 1, max: 10, label: "1-10" });
  });

  it("returns 1-7 for years 2015-2018", () => {
    deepStrictEqual(getScale(2015), { min: 1, max: 7, label: "1-7" });
    deepStrictEqual(getScale(2016), { min: 1, max: 7, label: "1-7" });
    deepStrictEqual(getScale(2018), { min: 1, max: 7, label: "1-7" });
  });

  it("returns 1-5 for years >= 2019", () => {
    deepStrictEqual(getScale(2020), { min: 1, max: 5, label: "1-5" });
    deepStrictEqual(getScale(2025), { min: 1, max: 5, label: "1-5" });
  });
});

describe("normalize", () => {
  it("normalizes 5-point scale (2020+): 4.52 → 88.00", () => {
    strictEqual(normalize(4.52, 2024), 88.0);
  });

  it("normalizes 7-point scale (2016-2018): 5.60 → 76.67", () => {
    strictEqual(normalize(5.6, 2017), 76.67);
  });

  it("normalizes 1-10 scale (2010-2014): 7.80 → 75.56", () => {
    strictEqual(normalize(7.8, 2013), 75.56);
  });

  it("passes through NKI values unchanged: 72 → 72", () => {
    strictEqual(normalize(72, 2013, "NKI Helhetsbedömning"), 72);
  });

  it("normalizes 1-3 scale (≤2009): 2.40 → 70.00", () => {
    strictEqual(normalize(2.4, 2009), 70.0);
  });

  it("returns null for null input", () => {
    strictEqual(normalize(null, 2024), null);
    strictEqual(normalize(null, 2013, "NKI Helhetsbedömning"), null);
  });

  it("handles boundary values", () => {
    // Min value → 0
    strictEqual(normalize(1, 2024), 0);
    // Max value → 100
    strictEqual(normalize(5, 2024), 100);
  });
});

describe("cleanSchoolName", () => {
  it("strips .pdf suffix", () => {
    strictEqual(cleanSchoolName("Borgaregatan 5 förskola.pdf"), "Borgaregatan 5");
    strictEqual(cleanSchoolName("Askims Montessori fsk.pdf"), "Askims Montessori");
  });

  it("strips trailing förskola/förskolan/fsk", () => {
    strictEqual(cleanSchoolName("Borgaregatan 5 förskola"), "Borgaregatan 5");
    strictEqual(cleanSchoolName("Apelsingatan 15 förskolan"), "Apelsingatan 15");
    strictEqual(cleanSchoolName("Askims Montessori fsk"), "Askims Montessori");
  });

  it("preserves names without suffixes", () => {
    strictEqual(cleanSchoolName("Förskolan Fyren"), "Förskolan Fyren");
    strictEqual(cleanSchoolName("Lilla Viljaskolan"), "Lilla Viljaskolan");
  });

  it("preserves compound words containing förskola", () => {
    strictEqual(cleanSchoolName("Askims Montessoriförskola"), "Askims Montessoriförskola");
  });

  it("trims whitespace", () => {
    strictEqual(cleanSchoolName("  Borgaregatan 5  "), "Borgaregatan 5");
  });
});
