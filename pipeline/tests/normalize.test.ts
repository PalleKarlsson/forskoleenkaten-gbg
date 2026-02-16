/**
 * Unit tests for normalization logic (getScale / normalize / computeCleanName / extractAddress).
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { getScale, normalize, computeCleanName, extractAddress } from "../src/normalize.js";

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

describe("getScale with category", () => {
  it("returns 1-10 for FÖRÄLDRAR years <= 2009", () => {
    deepStrictEqual(getScale(2008, 'foralder'), { min: 1, max: 10, label: "1-10" });
    deepStrictEqual(getScale(2007, 'foralder'), { min: 1, max: 10, label: "1-10" });
    deepStrictEqual(getScale(2009, 'foralder'), { min: 1, max: 10, label: "1-10" });
  });

  it("returns 1-3 for BARN years <= 2009 (default)", () => {
    deepStrictEqual(getScale(2008), { min: 1, max: 3, label: "1-3" });
    deepStrictEqual(getScale(2008, 'barn'), { min: 1, max: 3, label: "1-3" });
  });

  it("category ignored for years > 2009", () => {
    deepStrictEqual(getScale(2012, 'foralder'), { min: 1, max: 10, label: "1-10" });
    deepStrictEqual(getScale(2020, 'foralder'), { min: 1, max: 5, label: "1-5" });
  });
});

describe("normalize with FÖRÄLDRAR scale", () => {
  it("normalizes 1-10 scale for FÖRÄLDRAR 2008: 7.80 → 75.56", () => {
    strictEqual(normalize(7.8, 2008, undefined, 'foralder'), 75.56);
  });

  it("NKI passthrough works with category", () => {
    strictEqual(normalize(72, 2008, "NKI TRIVSEL", 'foralder'), 72);
  });

  it("FÖRÄLDRAR boundary values", () => {
    strictEqual(normalize(1, 2009, undefined, 'foralder'), 0);
    strictEqual(normalize(10, 2009, undefined, 'foralder'), 100);
  });
});

describe("computeCleanName", () => {
  it("strips .pdf suffix", () => {
    strictEqual(computeCleanName("DoReMi.pdf"), "DoReMi");
    strictEqual(computeCleanName("Kärralundsgatan 11 förskola.pdf"), "Kärralundsgatan 11 förskola");
  });

  it("strips leading numeric area prefix", () => {
    strictEqual(computeCleanName("03_Kortedala"), "Kortedala");
  });

  it("expands fam.försk. abbreviation", () => {
    strictEqual(computeCleanName("Kärrdalen fam.försk."), "Kärrdalen familjeförskola");
  });

  it("expands fam.dagh. abbreviation", () => {
    strictEqual(computeCleanName("Kärrdalen fam.dagh."), "Kärrdalen familjedaghem");
  });

  it("expands försk. abbreviation including inside compound words", () => {
    strictEqual(computeCleanName("vidkärrs montessoriförsk."), "Vidkärrs montessoriförskola");
  });

  it("expands standalone fsk abbreviation", () => {
    strictEqual(computeCleanName("Askims Montessori fsk"), "Askims Montessoriförskola");
  });

  it("converts ALL CAPS to title case", () => {
    strictEqual(computeCleanName("ÅKEREDS SKOLVÄG 20"), "Åkereds Skolväg 20");
  });

  it("lowercases known words in ALL CAPS names", () => {
    strictEqual(computeCleanName("BORGAREGATAN 5 FÖRSKOLA"), "Borgaregatan 5 förskola");
  });

  it("capitalizes first letter of lowercase names", () => {
    strictEqual(computeCleanName("vidkärrs montessoriförsk."), "Vidkärrs montessoriförskola");
  });

  it("preserves names that are already properly cased", () => {
    strictEqual(computeCleanName("Förskolan Fyren"), "Förskolan Fyren");
  });

  it("keeps förskola in the name (not stripped)", () => {
    strictEqual(computeCleanName("Borgaregatan 5 förskola"), "Borgaregatan 5 förskola");
    strictEqual(computeCleanName("Askims Montessoriförskola"), "Askims Montessoriförskola");
  });

  it("joins Montessori + förskola into compound word", () => {
    strictEqual(computeCleanName("Askims Montessori förskola"), "Askims Montessoriförskola");
    strictEqual(computeCleanName("Askims Montessori förskolan"), "Askims Montessoriförskolan");
  });

  it("normalizes cooperativ → kooperativ", () => {
    strictEqual(computeCleanName("Föräldracooperativet Con Brio"), "Föräldrakooperativet Con Brio");
  });

  it("strips PO prefix (pedagogisk omsorg unit naming)", () => {
    strictEqual(computeCleanName("PO Rimsmedsgatan 1H"), "Rimsmedsgatan 1H");
  });

  it("fixes FörskolaNAME concatenation (missing space)", () => {
    strictEqual(computeCleanName("FörskolaMELONGATAN 3"), "Förskola Melongatan 3");
  });

  it("trims and collapses whitespace", () => {
    strictEqual(computeCleanName("  Borgaregatan  5  "), "Borgaregatan 5");
  });

  it("handles Bondegärdet 18 B", () => {
    strictEqual(computeCleanName("Bondegärdet 18 B"), "Bondegärdet 18 B");
  });
});

describe("extractAddress", () => {
  it("extracts address from name with förskola suffix", () => {
    strictEqual(extractAddress("Kärralundsgatan 11 förskola"), "Kärralundsgatan 11");
  });

  it("extracts full name when it is an address", () => {
    strictEqual(extractAddress("Åkereds Skolväg 20"), "Åkereds Skolväg 20");
  });

  it("extracts address with letter suffix", () => {
    strictEqual(extractAddress("Bondegärdet 18 B"), "Bondegärdet 18 B");
  });

  it("returns null for names without a house number", () => {
    strictEqual(extractAddress("DoReMi"), null);
    strictEqual(extractAddress("Kärrdalen familjeförskola"), null);
    strictEqual(extractAddress("Vidkärrs montessoriförskola"), null);
    strictEqual(extractAddress("Kortedala"), null);
  });

  it("returns null for names where number is not a house number", () => {
    strictEqual(extractAddress("Förskolan Fyren"), null);
  });

  it("extracts address when non-förskola words follow house number", () => {
    strictEqual(extractAddress("Sommarvädersgatan 8 Dygnet runt förskola"), "Sommarvädersgatan 8");
    strictEqual(extractAddress("Gånglåten 31 Nattomsorg"), "Gånglåten 31");
  });

  it("normalizes concatenated house number ranges (even-length)", () => {
    strictEqual(extractAddress("Standargatan 1012"), "Standargatan 10-12");
    strictEqual(extractAddress("Höstvädersgatan 5157"), "Höstvädersgatan 51-57");
    strictEqual(extractAddress("Kalendervägen 1517"), "Kalendervägen 15-17");
    strictEqual(extractAddress("Kummingatan 128130"), "Kummingatan 128-130");
    strictEqual(extractAddress("Gamla Tumlehedsvägen 100104"), "Gamla Tumlehedsvägen 100-104");
  });

  it("normalizes concatenated house number ranges (odd-length)", () => {
    strictEqual(extractAddress("Siriusgatan 410"), "Siriusgatan 4-10");
  });

  it("does not split valid single house numbers", () => {
    strictEqual(extractAddress("Åkereds Skolväg 20"), "Åkereds Skolväg 20");
    strictEqual(extractAddress("Kärralundsgatan 11"), "Kärralundsgatan 11");
  });
});
