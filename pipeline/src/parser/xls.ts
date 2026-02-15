/**
 * XLS parser for 2007-2009 preschool survey files.
 *
 * Each XLS contains one sheet per unit/school-group/district, all with the same
 * 10-question layout on a 1-3 Likert scale (children aged 3-5).
 *
 * Sheet naming: T{id} = data table, TD{id} = chart data (ignored).
 * Hierarchy from Innehåll sheet:
 *   - ID ending in 0000: district total
 *   - ID ending in X00 (not 0000): school group
 *   - ID ending in XNN (NN != 00): individual unit
 *
 * Original .xls (BIFF) files are pre-converted to .xlsx for ExcelJS compatibility.
 */
import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import { cleanQuestionText } from "./utils.js";

export interface XlsUnitData {
  sheetId: string;
  unitName: string;
  districtName: string;
  respondents: number | null;
  /** "district" | "school_group" | "unit" */
  level: "district" | "school_group" | "unit";
  means: Array<{
    questionText: string;
    meanValue: number | null;
    meanAllSchools: number | null;
    indexValue: number | null;
    indexAllSchools: number | null;
  }>;
  responseDistribution: Array<{
    questionText: string;
    pctLow: number | null;
    pctMedium: number | null;
    pctHigh: number | null;
    pctNoAnswer: number | null;
  }>;
}

function classifySheet(sheetId: string): "district" | "school_group" | "unit" {
  // Strip leading "T" to get the numeric ID
  const numId = sheetId.replace(/^T/, "");
  if (numId.endsWith("0000")) return "district";
  if (numId.endsWith("00")) return "school_group";
  return "unit";
}

function parseNum(val: unknown): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(",", "."));
  return isNaN(n) ? null : n;
}

/** Read worksheet rows into a 0-indexed 2D array (matching old xlsx layout). */
function sheetToArray(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    // ExcelJS rows are 1-indexed; pad with empty arrays for any skipped rows
    while (rows.length < rowNumber - 1) rows.push([]);
    const cells: unknown[] = [];
    // row.values is 1-indexed (index 0 is undefined)
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      cells.push(values[i] ?? "");
    }
    rows.push(cells);
  });
  return rows;
}

function parseSheet(ws: ExcelJS.Worksheet, sheetId: string): XlsUnitData | null {
  const data = sheetToArray(ws);
  if (data.length < 10) return null;

  // Row 0, col 6: unit name
  const unitName = String(data[0]?.[6] ?? "").trim();
  if (!unitName) return null;

  // Row 1, col 2: respondent count
  const respondents = parseNum(data[1]?.[2]);

  // Row 2: district name
  const districtName = String(data[2]?.[0] ?? "").trim();

  const level = classifySheet(sheetId);

  const means: XlsUnitData["means"] = [];
  const responseDistribution: XlsUnitData["responseDistribution"] = [];

  // Data starts at row 9 (index rows) / row 10 (question rows)
  // Pattern: pairs of rows — index row then question row
  for (let i = 9; i < data.length - 1; i += 2) {
    const indexRow = data[i];
    const questionRow = data[i + 1];

    // Validate: question row should start with "Fr N"
    const frLabel = String(questionRow?.[0] ?? "").trim();
    if (!frLabel.match(/^Fr\s+\d+$/i)) break;

    const rawText = String(questionRow?.[1] ?? "")
      .replace(/\n/g, " ")
      .trim();
    if (!rawText) break;

    const questionText = cleanQuestionText(rawText);

    // Index row: col 2 = unit index, col 4 = all-schools index
    const indexValue = parseNum(indexRow?.[2]);
    const indexAllSchools = parseNum(indexRow?.[4]);

    // Question row: col 2 = unit mean, col 4 = all-schools mean
    const meanValue = parseNum(questionRow?.[2]);
    const meanAllSchools = parseNum(questionRow?.[4]);

    // Response distribution: col 8 = low(1), col 9 = medium(2), col 10 = high(3), col 12 = no answer
    const pctLow = parseNum(questionRow?.[8]);
    const pctMedium = parseNum(questionRow?.[9]);
    const pctHigh = parseNum(questionRow?.[10]);
    const pctNoAnswer = parseNum(questionRow?.[12]);

    means.push({
      questionText,
      meanValue,
      meanAllSchools,
      indexValue,
      indexAllSchools,
    });

    responseDistribution.push({
      questionText,
      pctLow,
      pctMedium,
      pctHigh,
      pctNoAnswer,
    });
  }

  if (means.length === 0) return null;

  return {
    sheetId,
    unitName,
    districtName,
    respondents,
    level,
    means,
    responseDistribution,
  };
}

/**
 * Determine which T-sheet IDs should be included as individual units.
 * Hierarchy: district (..0000) → school_group (..X00) → unit (..XNN).
 * - District totals are always excluded.
 * - Individual units (last 2 digits != "00") are always included.
 * - School groups (last 2 digits = "00") are included only when they
 *   have NO child unit sheets (i.e., they are the finest granularity).
 */
function findUnitSheetIds(sheetNames: string[]): Set<string> {
  const tIds = sheetNames
    .filter((n) => n.startsWith("T") && !n.startsWith("TD") && n !== "Innehåll")
    .map((n) => n.replace(/^T/, ""));

  const unitIds = new Set<string>();

  for (const id of tIds) {
    // Skip district totals
    if (id.endsWith("0000")) continue;

    if (!id.endsWith("00")) {
      // Individual unit — always include
      unitIds.add(id);
    } else {
      // School group — include only if no child units exist
      const groupPrefix = id.slice(0, -2); // e.g., "10010201" from "1001020100"
      const hasChildren = tIds.some(
        (other) =>
          other !== id &&
          other.startsWith(groupPrefix) &&
          !other.endsWith("00"),
      );
      if (!hasChildren) {
        unitIds.add(id);
      }
    }
  }

  return unitIds;
}

/**
 * Resolve the xlsx path for a given file path.
 * If the path ends in .xls (not .xlsx), look for the pre-converted .xlsx version.
 */
function resolveXlsxPath(filePath: string): string {
  if (filePath.endsWith(".xls") && !filePath.endsWith(".xlsx")) {
    const xlsxPath = filePath + "x";
    if (existsSync(xlsxPath)) return xlsxPath;
  }
  return filePath;
}

/**
 * Parse an XLS/XLSX file and return data for all units found.
 * Returns leaf-node sheets only: individual units, or school groups
 * that have no sub-units (i.e., are themselves the finest granularity).
 * District totals (ID ending "0000") are always excluded.
 */
export async function parseXlsFile(filePath: string): Promise<XlsUnitData[]> {
  const resolvedPath = resolveXlsxPath(filePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(resolvedPath);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const leafIds = findUnitSheetIds(sheetNames);
  const results: XlsUnitData[] = [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    if (!sheetName.startsWith("T") || sheetName.startsWith("TD")) continue;
    if (sheetName === "Innehåll") continue;

    const numId = sheetName.replace(/^T/, "");
    if (!leafIds.has(numId)) continue;

    const parsed = parseSheet(ws, sheetName);
    if (!parsed) continue;

    results.push(parsed);
  }

  return results;
}
