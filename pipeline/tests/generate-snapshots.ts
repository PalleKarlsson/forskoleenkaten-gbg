/**
 * Generate test snapshots by running parser functions against test PDFs/XLS.
 *
 * Usage: npm run test:snapshot
 *
 * This creates JSON snapshot files in tests/snapshots/ that capture the
 * current parser output. These snapshots are used by parse.test.ts to
 * verify that parser behavior remains consistent across refactors or
 * language migrations.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

async function generatePdfSnapshot(year: number): Promise<void> {
  const pdfPath = join(TEST_DATA_DIR, `test-${year}.pdf`);
  if (!existsSync(pdfPath)) {
    console.warn(`  SKIP: ${pdfPath} not found`);
    return;
  }

  console.log(`  Parsing test-${year}.pdf...`);

  // 1. Extract layout text
  const layoutText = await extractLayoutText(pdfPath);

  // Save layout text for debugging (not compared in tests)
  await writeFile(join(SNAPSHOT_DIR, `${year}-layout.txt`), layoutText);

  // 2. Parse tables
  const tables = await parseTablesFromPdf(pdfPath);

  // 3. Build meansMap for response distribution assignment
  const meansMap = new Map<string, number>();
  for (const row of tables.means) {
    if (row.meanSchool !== null) {
      meansMap.set(row.questionText, row.meanSchool);
    }
  }

  // 4. Parse response distributions
  const responseDistributions = parseResponseDistributions(layoutText, meansMap);

  // 5. Extract text items for demographics
  const { items } = await extractTextItems(pdfPath);

  // 6. Parse gender splits from layout
  const genderSplits = parseGenderSplitsFromLayout(layoutText);

  // 7. Parse demographics
  const demographics = parseDemographics(items, layoutText);

  // 8. Parse important questions
  const importantQuestions = parseImportantQuestions(layoutText);

  // 9. Parse unit means
  const unitMeans = parseUnitMeans(layoutText);

  // Save snapshot
  const snapshot = {
    year,
    file: `test-${year}.pdf`,
    tables: {
      metadata: tables.metadata,
      means: tables.means,
      historicalYears: tables.historicalYears,
    },
    responseDistributions,
    genderSplits,
    demographics,
    importantQuestions,
    unitMeans,
  };

  const snapshotPath = join(SNAPSHOT_DIR, `${year}.json`);
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`  Saved ${snapshotPath}`);
}

async function generateXlsSnapshot(): Promise<void> {
  const xlsPath = join(TEST_DATA_DIR, "test-2009.xls");
  if (!existsSync(xlsPath)) {
    console.warn(`  SKIP: ${xlsPath} not found`);
    return;
  }

  console.log(`  Parsing test-2009.xls...`);

  const units = parseXlsFile(xlsPath);

  const snapshotPath = join(SNAPSHOT_DIR, "2009-xls.json");
  await writeFile(snapshotPath, JSON.stringify(units, null, 2));
  console.log(`  Saved ${snapshotPath}`);
}

async function main() {
  console.log("Generating test snapshots...\n");

  await mkdir(SNAPSHOT_DIR, { recursive: true });

  // Generate PDF snapshots
  for (const year of PDF_YEARS) {
    await generatePdfSnapshot(year);
  }

  // Generate XLS snapshot
  await generateXlsSnapshot();

  console.log("\nDone. Snapshots saved to pipeline/tests/snapshots/");
}

main().catch((err) => {
  console.error("Snapshot generation failed:", err);
  process.exit(1);
});
