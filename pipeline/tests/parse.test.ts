/**
 * Snapshot-based integration tests for all parser functions.
 *
 * Compares current parser output against saved JSON snapshots.
 * If a test fails, either the parser changed unintentionally (fix it)
 * or intentionally (run `npm run test:snapshot` to update snapshots).
 */
import { describe, it } from "node:test";
import { deepStrictEqual } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { extractLayoutText, parseTablesFromPdf } from "../src/parser/tables.js";
import {
  parseResponseDistributions,
  parseGenderSplitsFromLayout,
  parseDemographics,
  parseImportantQuestions,
  parseUnitMeans,
} from "../src/parser/charts.js";
import { extractTextItems } from "../src/parser/pdf-text.js";
import { parseXlsFile } from "../src/parser/xls.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, "../../data/test-pdfs");
const SNAPSHOT_DIR = join(__dirname, "snapshots");

const PDF_YEARS = [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2020, 2021, 2022, 2023, 2024, 2025];

function loadSnapshot(name: string): unknown {
  const path = join(SNAPSHOT_DIR, name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Round-trip through JSON to normalize types (e.g., undefined → absent keys) */
function jsonRoundTrip(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj));
}

describe("PDF parser snapshots", () => {
  for (const year of PDF_YEARS) {
    const pdfPath = join(TEST_DATA_DIR, `test-${year}.pdf`);
    const snapshotFile = `${year}.json`;

    if (!existsSync(pdfPath) || !existsSync(join(SNAPSHOT_DIR, snapshotFile))) {
      it(`Year ${year} - skipped (missing test file or snapshot)`, () => {});
      continue;
    }

    const snapshot = loadSnapshot(snapshotFile) as Record<string, unknown>;

    describe(`Year ${year}`, () => {
      let layoutText: string;
      let meansMap: Map<string, number>;

      it("parseTablesFromPdf matches snapshot", async () => {
        const tables = await parseTablesFromPdf(pdfPath);
        const expected = snapshot.tables;
        deepStrictEqual(jsonRoundTrip(tables), expected);

        // Store for use in subsequent tests
        layoutText = await extractLayoutText(pdfPath);
        meansMap = new Map<string, number>();
        for (const row of tables.means) {
          if (row.meanSchool !== null) {
            meansMap.set(row.questionText, row.meanSchool);
          }
        }
      });

      it("parseResponseDistributions matches snapshot", async () => {
        if (!layoutText) layoutText = await extractLayoutText(pdfPath);
        if (!meansMap) {
          const tables = await parseTablesFromPdf(pdfPath);
          meansMap = new Map<string, number>();
          for (const row of tables.means) {
            if (row.meanSchool !== null) {
              meansMap.set(row.questionText, row.meanSchool);
            }
          }
        }
        const result = parseResponseDistributions(layoutText, meansMap);
        deepStrictEqual(jsonRoundTrip(result), snapshot.responseDistributions);
      });

      it("parseGenderSplitsFromLayout matches snapshot", async () => {
        if (!layoutText) layoutText = await extractLayoutText(pdfPath);
        const result = parseGenderSplitsFromLayout(layoutText);
        deepStrictEqual(jsonRoundTrip(result), snapshot.genderSplits);
      });

      it("parseDemographics matches snapshot", async () => {
        if (!layoutText) layoutText = await extractLayoutText(pdfPath);
        const { items } = await extractTextItems(pdfPath);
        const result = parseDemographics(items, layoutText);
        deepStrictEqual(jsonRoundTrip(result), snapshot.demographics);
      });

      it("parseImportantQuestions matches snapshot", async () => {
        if (!layoutText) layoutText = await extractLayoutText(pdfPath);
        const result = parseImportantQuestions(layoutText);
        deepStrictEqual(jsonRoundTrip(result), snapshot.importantQuestions);
      });

      it("parseUnitMeans matches snapshot", async () => {
        if (!layoutText) layoutText = await extractLayoutText(pdfPath);
        const result = parseUnitMeans(layoutText);
        deepStrictEqual(jsonRoundTrip(result), snapshot.unitMeans);
      });
    });
  }
});

describe("XLS parser snapshot", () => {
  const xlsPath = join(TEST_DATA_DIR, "test-2009.xls");
  const snapshotFile = "2009-xls.json";

  if (!existsSync(xlsPath) || !existsSync(join(SNAPSHOT_DIR, snapshotFile))) {
    it("XLS 2009 - skipped (missing test file or snapshot)", () => {});
  } else {
    it("parseXlsFile matches snapshot", async () => {
      const snapshot = loadSnapshot(snapshotFile);
      const result = await parseXlsFile(xlsPath);
      deepStrictEqual(jsonRoundTrip(result), snapshot);
    });
  }
});
