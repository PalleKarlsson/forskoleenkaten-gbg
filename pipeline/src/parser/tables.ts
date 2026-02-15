/**
 * Extracts comparison tables from PDF using pdftotext -layout.
 * These tables contain mean values across GR, Göteborg, District, School, and historical years.
 *
 * Supports three PDF format eras:
 * - 2020-2025 ("5point"): 5-point Likert scale, GR/Göteborg/District/School columns
 * - 2016-2018 ("7point"): 7-point scale, Year/School/District/Göteborg columns (no GR)
 * - 2011-2015 ("ecers"):  7-point scale, single mean value per question (unit only)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanQuestionText } from "./utils.js";

const execFileAsync = promisify(execFile);

export interface MeanRow {
  questionText: string;
  questionArea: string;
  meanGr: number | null;
  meanGoteborg: number | null;
  meanDistrict: number | null;
  meanSchool: number | null;
  historicalMeans: Record<string, number | null>;
}

export interface TableMetadata {
  schoolName: string;
  areaName: string;
  responseRate: number | null;
  respondents: number | null;
  totalInvited: number | null;
}

export interface ParsedTables {
  metadata: TableMetadata;
  means: MeanRow[];
  historicalYears: number[];
}

type PdfFormat = "5point" | "7point" | "ecers" | "scandinfo";

/** Run pdftotext -layout and return raw text */
export async function extractLayoutText(pdfPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], { maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    throw new Error(`pdftotext failed: ${err}`);
  }
}

/** Detect PDF format from text content */
function detectFormat(text: string): PdfFormat {
  // Scandinfo format (2011-2014): NKI-based, 10-point scale, quality factors
  // Identified by "NKI" header and "Kvalitetsfaktor"/"HELHET" quality factor names
  if (/\bNKI,?\s+HELHET\b/i.test(text) || /Kvalitetsfaktor.*Skalsteg/i.test(text)) {
    return "scandinfo";
  }

  // ECERS format (2011-2015): has "sjugradig"/"Otillräcklig" scale labels
  const hasSevenPoint = /sjugradig/i.test(text) || /Otillräcklig/i.test(text);

  if (!hasSevenPoint) return "5point";

  // Distinguish 7point (2016-2018) from ecers (2015)
  // 7point has "Resultat per fråga" sections — this is the key distinguishing feature
  // Some 2016 reports have no year columns but still use the 7-point Resultat per fråga layout
  const hasResultatPerFraga = /Resultat\s+per\s+fråga/i.test(text);

  if (hasResultatPerFraga) return "7point";
  return "ecers";
}

/** Parse the header/metadata from the first page */
function parseMetadata(text: string): TableMetadata {
  const meta: TableMetadata = {
    schoolName: "",
    areaName: "",
    responseRate: null,
    respondents: null,
    totalInvited: null,
  };

  // School name: appears as "Rapport för:\nSchoolName" or in header
  const rapportMatch = text.match(/Rapport\s+för:\s*\n\s*(.+)/);
  if (rapportMatch) meta.schoolName = rapportMatch[1].trim();

  // Response rate patterns (multiple formats across years):
  // 2024-2025: "Svarsfrekvens 48%", "svarsfrekvens om 43 %", "svarsfrekvensen om 83%"
  // 2016-2018: "alltså 52.6%"
  // 2011-2015: "svarsandel 71%", "n=10 (svarsandel 71%)"
  const rrMatch = text.match(/[Ss]varsfrekvens(?:en)?\s+(?:om\s+)?(\d+)\s*%/);
  if (rrMatch) {
    meta.responseRate = parseInt(rrMatch[1], 10);
  } else {
    // "alltså XX.X%" or "alltså XX%"
    const alltsaMatch = text.match(/allts[aå]\s+(\d+(?:[.,]\d+)?)\s*%/);
    if (alltsaMatch) {
      meta.responseRate = Math.round(parseFloat(alltsaMatch[1].replace(",", ".")));
    } else {
      // "svarsandel XX%"
      const svarsandelMatch = text.match(/svarsandel\s+(\d+)\s*%/);
      if (svarsandelMatch) {
        meta.responseRate = parseInt(svarsandelMatch[1], 10);
      }
    }
  }

  // Respondents: multiple patterns
  const normalized = text.replace(/\n/g, " ");

  // "XX vårdnadshavare av YY" (2016-2025)
  const respMatch = normalized.match(/(\d+)\s+vårdnadshavare\s+av\s+(\d+)/);
  if (respMatch) {
    meta.respondents = parseInt(respMatch[1], 10);
    meta.totalInvited = parseInt(respMatch[2], 10);
  } else {
    // "Antal svarande, n = XX (svarsandel YY%)" — Scandinfo/ECERS
    const antalMatch = normalized.match(/Antal\s+svarande,?\s*n\s*=\s*(\d+)\s*\(svarsandel\s+(\d+)\s*%\)/);
    if (antalMatch) {
      meta.respondents = parseInt(antalMatch[1], 10);
      if (!meta.responseRate) {
        meta.responseRate = parseInt(antalMatch[2], 10);
      }
    } else {
      // "n=XX" or "n = XX"
      const nMatch = normalized.match(/\bn\s*=\s*(\d+)/);
      if (nMatch) {
        meta.respondents = parseInt(nMatch[1], 10);
      }
    }
  }

  return meta;
}

// ── Question area detection ──

/** Question area names for 2020-2025 format */
const QUESTION_AREA_PATTERNS_5POINT = [
  "Normer och värden",
  "Värdegrund och uppdrag",
  "Omsorg, utveckling och lärande",
  "Barns inflytande och delaktighet",
  "Förskola och hem",
  "Helhetsomdöme",
];

/** Question area names for 2016-2018 format */
const QUESTION_AREA_PATTERNS_7POINT = [
  "TRYGGHET OCH GEMENSKAP",
  "INFORMATION OCH INFLYTANDE",
  "FÖRUTSÄTTNINGAR",
  "PEDAGOGIK",
  "KONTINUITET",
];

/** Map to standard area names used in DB */
function mapAreaName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("normer") || lower.includes("trivsel") || lower.includes("trygghet") || lower.includes("gemenskap")) return "Trygghet och trivsel";
  if (lower.includes("värdegrund") || lower.includes("uppdrag")) return "Utveckling och lärande";
  if (lower.includes("omsorg") || lower.includes("utveckling") || lower.includes("lärande")) return "Utveckling och lärande";
  if (lower.includes("inflytande") || lower.includes("delaktighet")) return "Inflytande";
  if (lower.includes("information")) return "Inflytande";
  if (lower.includes("förskola och hem") || lower.includes("relation") || lower.includes("kommunikation")) return "Relation och kommunikation";
  if (lower.includes("helhets") || lower.includes("helhetsomdöme")) return "Helhetsomdöme";
  if (lower.includes("förutsättningar")) return "Utveckling och lärande";
  if (lower.includes("pedagogik")) return "Utveckling och lärande";
  if (lower.includes("kontinuitet")) return "Relation och kommunikation";
  return name;
}

// ── 2020-2025: 5-point format ──

/**
 * Column layout for 5-point format:
 * - "gr-first": GR, Göteborg, District, School, [historical...]
 * - "gr-last": [School historical...], District, Göteborg, GR
 */
type ColumnLayout5Point = "gr-first" | "gr-last";

function detectColumnLayout5Point(headerLine: string): ColumnLayout5Point {
  const grIdx = headerLine.indexOf("GR");
  const goIdx = Math.max(headerLine.indexOf("Göteborg"), headerLine.indexOf("Goteborg"));
  if (grIdx >= 0 && goIdx >= 0) {
    return grIdx < goIdx ? "gr-first" : "gr-last";
  }
  return "gr-first";
}

function parseMeanRows5Point(text: string): { rows: MeanRow[]; historicalYears: number[] } {
  const lines = text.split("\n");
  const rows: MeanRow[] = [];
  let currentArea = "";
  let historicalYears: number[] = [];
  let columnLayout: ColumnLayout5Point = "gr-first";

  // First, find historical years from table headers
  // Years may be on the same line as GR/Göteborg, or on an adjacent line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("GR") && (line.includes("Göteborg") || line.includes("Goteborg"))) {
      // Check this line and the next 2 lines for year numbers
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        const yearMatches = lines[j].match(/\b(20\d{2})\b/g);
        if (yearMatches && yearMatches.length >= 2) {
          historicalYears = yearMatches.map((y) => parseInt(y, 10));
          break;
        }
      }
      if (historicalYears.length > 0) break;
    }
  }

  const pageHeaderRe = /\|.*[Ss]varsfrekvens/;
  let inTable = false;
  let pendingQuestionText = "";
  const numberOrDashRe = /(\d[.,]\d{2})\b|-(?=\s{2,}|\s*$)/g;
  let doneWithTables = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop parsing when we reach gender split or unit means sections,
    // but only AFTER we've already found some data (to skip table-of-contents references)
    if (rows.length > 0 && (/Könsuppdelad\s+andel/i.test(trimmed) || /Frågeområde\s+per\s+enhet/i.test(trimmed))) {
      doneWithTables = true;
    }
    if (doneWithTables) continue;

    if (pageHeaderRe.test(trimmed)) {
      inTable = false;
      pendingQuestionText = "";
      continue;
    }

    // Detect area headers regardless of inTable state.
    // 2020-2023 PDFs lack "Årsjämförelsen" lines and page headers between areas,
    // so inTable is never reset — area detection must work even when inTable is true.
    for (const area of QUESTION_AREA_PATTERNS_5POINT) {
      if (trimmed === area || trimmed.startsWith(area + " ")) {
        currentArea = mapAreaName(area);
        inTable = false;
        pendingQuestionText = "";
        break;
      }
    }

    // Detect table header line: must have "GR" AND "Göteborg" as column headers
    if (/\bGR\b/.test(line) && /G.teborg/.test(line)) {
      const words = line.trim().split(/\s{2,}/);
      if (words.length >= 2 && words.some((w) => w.trim() === "GR")) {
        inTable = true;
        pendingQuestionText = "";
        columnLayout = detectColumnLayout5Point(line);
        // Check this line and the next 2 lines for year numbers
        for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
          const yearMatches = lines[j].match(/\b(20\d{2})\b/g);
          if (yearMatches && yearMatches.length >= 1) {
            historicalYears = yearMatches.map((y) => parseInt(y, 10));
            break;
          }
        }
        continue;
      }
    }

    if (inTable && trimmed.startsWith("Årsjämförelsen")) {
      inTable = false;
      pendingQuestionText = "";
      continue;
    }

    if (!inTable) continue;
    if (trimmed === "") continue;

    const values: (number | null)[] = [];
    let firstMatchIdx = -1;
    let match;
    numberOrDashRe.lastIndex = 0;
    while ((match = numberOrDashRe.exec(line)) !== null) {
      if (firstMatchIdx < 0) firstMatchIdx = match.index;
      if (match[1]) {
        values.push(parseFloat(match[1].replace(",", ".")));
      } else {
        values.push(null);
      }
    }

    const numericCount = values.filter((v) => v !== null).length;
    if (numericCount >= 3 && firstMatchIdx >= 0) {
      let questionText = line.substring(0, firstMatchIdx).trim();

      if (pendingQuestionText) {
        if (questionText.length > 3) {
          questionText = pendingQuestionText + " " + questionText;
        } else {
          questionText = pendingQuestionText;
        }
      }

      questionText = cleanQuestionText(questionText);

      if (questionText.length > 5) {
        let meanGr: number | null = null;
        let meanGoteborg: number | null = null;
        let meanDistrict: number | null = null;
        let meanSchool: number | null = null;
        const histMeans: Record<string, number | null> = {};

        const numHist = historicalYears.length;

        if (columnLayout === "gr-first") {
          // gr-first layout: [GR] [Göteborg] [District] [School] [Unit?] [year1] [year2] ...
          // Geographic columns are at the START, historical years at the END
          const histStart = values.length - numHist;
          meanGr = values[0] ?? null;
          meanGoteborg = values.length >= 2 ? (values[1] ?? null) : null;
          meanDistrict = values.length >= 3 ? (values[2] ?? null) : null;
          meanSchool = values.length >= 4 ? (values[3] ?? null) : null;
          // values[4..histStart-1] are unit columns (ignored)
          for (let j = 0; j < numHist; j++) {
            histMeans[String(historicalYears[j])] = values[histStart + j];
          }
        } else {
          // gr-last layout: [Unit year1] [Unit year2] ... [School?] [District] [Göteborg] [GR]
          // Geographic columns are at the END (last 3), historical/school at the START
          const len = values.length;
          meanGr = len >= 1 ? (values[len - 1] ?? null) : null;
          meanGoteborg = len >= 2 ? (values[len - 2] ?? null) : null;
          meanDistrict = len >= 3 ? (values[len - 3] ?? null) : null;
          const beforeGeo = values.slice(0, Math.max(0, len - 3));

          if (beforeGeo.length > numHist) {
            // Extra value(s) beyond historical years = school-level aggregate
            // School aggregate is the last value before geographic columns
            meanSchool = beforeGeo[beforeGeo.length - 1] ?? null;
            const histValues = beforeGeo.slice(0, beforeGeo.length - 1);
            for (let j = 0; j < histValues.length && j < numHist; j++) {
              histMeans[String(historicalYears[j])] = histValues[j];
            }
          } else {
            // No school aggregate — unit values map directly to historical years
            // meanSchool = first value (unit's most recent year or sole value)
            meanSchool = beforeGeo.length >= 1 ? (beforeGeo[0] ?? null) : null;
            for (let j = 0; j < beforeGeo.length && j < numHist; j++) {
              histMeans[String(historicalYears[j])] = beforeGeo[j];
            }
          }
        }

        rows.push({
          questionText,
          questionArea: currentArea,
          meanGr,
          meanGoteborg,
          meanDistrict,
          meanSchool,
          historicalMeans: histMeans,
        });

        // Look-ahead: consume continuation lines trailing from wrapped questions
        // (e.g., "samspel i grupp" or "lärande" on separate lines after data)
        let lookAhead = i + 1;
        while (lookAhead < lines.length) {
          const la = lines[lookAhead].trim();
          if (la === "") { lookAhead++; continue; }
          if (la.length >= 3 && la.length < 60
              && !/\d/.test(la) && /^[a-zåäö]/.test(la)) {
            rows[rows.length - 1].questionText = cleanQuestionText(
              rows[rows.length - 1].questionText + " " + la
            );
            i = lookAhead;
            lookAhead++;
          } else {
            break;
          }
        }
      }

      pendingQuestionText = "";
    } else if (trimmed.startsWith("\u2026") || trimmed.startsWith("…") || trimmed.startsWith("...")) {
      pendingQuestionText = trimmed;
    } else if (inTable && numericCount === 0 && trimmed.length > 10
        && /^[A-ZÅÄÖ]/.test(trimmed)
        && !QUESTION_AREA_PATTERNS_5POINT.some(a => trimmed === a || trimmed.startsWith(a))
        && !/^Resultat|^Jämförelse|^Årsjämförelse|^Könsuppdelad|^Frågeområde/i.test(trimmed)) {
      // Question text starting with uppercase (Helhetsomdöme questions: "Jag känner mig...")
      pendingQuestionText = trimmed;
    } else if (pendingQuestionText && trimmed.length > 0 && numericCount === 0) {
      pendingQuestionText += " " + trimmed;
    }
  }

  return { rows, historicalYears };
}

// ── 2016-2018: 7-point format ──

/**
 * Parse mean rows from 2016-2018 format PDFs.
 *
 * Table structure:
 *   Header: 2018   2017   2016   [School]   [District]   Göteborg
 *   Row:    [question text]   [percentages with %]   5.6   6.2   5.9   5.5   5.6   5.7
 *
 * Key differences from 5-point format:
 * - No GR column — geographic comparisons are School, District, Göteborg
 * - Historical year means come FIRST, then geographic comparisons at end
 * - One decimal precision (5.6 not 5.67)
 * - Percentage values (10%, 20%) appear before mean values on same line
 */
function parseMeanRows7Point(text: string): { rows: MeanRow[]; historicalYears: number[] } {
  const lines = text.split("\n");
  const rows: MeanRow[] = [];
  let currentArea = "";
  let historicalYears: number[] = [];

  // Number regex for 7-point format: 1-2 decimal places, NOT followed by % or more digits
  const meanRe = /(\d[.,]\d{1,2})\b(?![\d%])/g;

  // Find the DATA TABLE header line (must appear AFTER "Resultat per fråga")
  // This avoids picking up the summary chart header that appears earlier in the PDF.
  //
  // Column layouts by year:
  // 2018: "[year]  [School name]  [District name]  Göteborg"  → no GR, school has named column
  // 2017: "[year]  [year-1]  [year-2]  [District]  Göteborg  GR"  → GR present, school value in year columns
  // 2016: "[year]  [year-1]  Göteborg  GR"  → GR present, school value in year columns
  let numYearColumns = 0;
  let hasGrColumn = false;
  let headerFound = false;
  let sawResultatPerFraga = false;

  for (let hIdx = 0; hIdx < lines.length; hIdx++) {
    const line = lines[hIdx];
    if (/Resultat\s+per\s+fråga/i.test(line)) {
      sawResultatPerFraga = true;
      continue;
    }
    // Only consider header lines AFTER "Resultat per fråga" to find data table header.
    // The header may span multiple lines. In 2018, "Göteborgsregionen" is split:
    //   line A: "... Göteborgs"
    //   line B: "1  2  3  4  5  6  7  Vet ej"
    //   line C: "2018  2017  ...  Centrum  Göteborg  regionen"
    // We scan this + following lines to collect year columns and GR detection.
    if (sawResultatPerFraga && /G.teborg/.test(line)) {
      for (let j = hIdx; j < Math.min(hIdx + 5, lines.length); j++) {
        const hLine = lines[j];
        const yearMatches = hLine.match(/\b(20\d{2})\b/g);
        if (yearMatches && yearMatches.length >= 1 && historicalYears.length === 0) {
          historicalYears = yearMatches.map((y) => parseInt(y, 10));
          numYearColumns = yearMatches.length;
        }
        if (
          /\bGR\s*$/.test(hLine.trim()) ||
          /regionen\s*$/i.test(hLine.trim()) ||
          /G.teborgs\s*$/i.test(hLine.trim())
        ) {
          hasGrColumn = true;
        }
      }
      headerFound = true;
      break;
    }
  }

  if (!headerFound) return { rows, historicalYears };

  // Page footer pattern
  const pageFooterRe = /Rapporten\s+gäller|Varje\s+färgat\s+fält|möjliga.*allts/;
  // Scale header detection (marks start of actual data table)
  const scaleHeaderRe = /Otillräcklig.*Utmärkt|Utmärkt.*Otillräcklig/;

  let pendingQuestionText = "";
  let inDataSection = false;
  let sawResultatHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === "") continue;

    // "Resultat per fråga" marks the start of a question results section
    if (/Resultat\s+per\s+fråga/i.test(trimmed)) {
      sawResultatHeader = true;
      continue;
    }

    // Skip page footers — also reset header skip state
    if (pageFooterRe.test(trimmed)) {
      inDataSection = false;
      pendingQuestionText = "";
      continue;
    }

    // Scale header activates data section only AFTER seeing "Resultat per fråga"
    if (sawResultatHeader && scaleHeaderRe.test(trimmed)) {
      inDataSection = true;
      pendingQuestionText = "";
      continue;
    }

    // Skip scale labels line: "1   2   3   4   5   6   7   Vet ej"
    if (/^\d\s+\d\s+\d\s+\d/.test(trimmed)) continue;

    // Skip column header lines: year + Göteborg/GR, or year headers
    if (/^\d{4}\s+\d{4}/.test(trimmed)) continue;
    if (/\b20\d{2}\b/.test(trimmed) && /G.teborg|\bGR\b/i.test(trimmed)) {
      pendingQuestionText = "";
      continue;
    }
    // Skip column name fragments that wrap from the header (school/district names without question content)
    if (inDataSection && /Vet\s+ej/.test(trimmed)) {
      pendingQuestionText = "";
      continue;
    }

    // Check for question area headers
    for (const area of QUESTION_AREA_PATTERNS_7POINT) {
      if (trimmed.toUpperCase() === area || trimmed.toUpperCase().startsWith(area + " ")) {
        currentArea = mapAreaName(area);
        break;
      }
    }

    // Section headers
    if (/^Beskrivning|^Regiongemensam|^Om\s+undersökning|^Metod$|^Redovisning|^Här\s+visas/i.test(trimmed)) {
      continue;
    }

    if (!inDataSection) continue;

    // Extract mean values from the line (excluding percentage values)
    // First, remove percentage patterns to avoid confusion
    const lineWithoutPct = line.replace(/\d+\s*%/g, "   ");

    const values: (number | null)[] = [];
    let firstMatchIdx = -1;
    let match;
    meanRe.lastIndex = 0;
    while ((match = meanRe.exec(lineWithoutPct)) !== null) {
      const val = parseFloat(match[1].replace(",", "."));
      // Filter out values clearly outside 1-7 range (probably not means)
      if (val >= 1.0 && val <= 7.0) {
        if (firstMatchIdx < 0) firstMatchIdx = match.index;
        values.push(val);
      }
    }

    const numericCount = values.filter((v) => v !== null).length;

    if (numericCount >= 3 && firstMatchIdx >= 0) {
      // This is a data row with mean values
      // Question text is everything before the percentage values
      // Find where the first percentage or number starts in the original line
      const pctStartMatch = line.match(/\d+\s*%/);
      let questionText = "";
      if (pctStartMatch && pctStartMatch.index !== undefined) {
        questionText = line.substring(0, pctStartMatch.index).trim();
      } else {
        // No percentage, take text before first mean value
        questionText = line.substring(0, firstMatchIdx).trim();
      }

      if (pendingQuestionText) {
        if (questionText.length > 3) {
          questionText = pendingQuestionText + " " + questionText;
        } else {
          questionText = pendingQuestionText;
        }
      }

      questionText = cleanQuestionText(questionText);

      if (questionText.length > 5) {
        const histMeans: Record<string, number | null> = {};

        let meanGr: number | null = null;
        let meanGoteborg: number | null = null;
        let meanDistrict: number | null = null;
        let meanSchool: number | null = null;

        if (hasGrColumn) {
          // 2016-2017 format with GR column:
          // Layout: [year columns...] [geographic columns... Göteborg GR]
          // The school's own value is in the first year column (current year).
          // Geographic columns are everything after the year columns.
          const numGeo = values.length - numYearColumns;
          const geoStart = numYearColumns;
          const histValues = values.slice(0, numYearColumns);
          const geoValues = values.slice(geoStart);

          // Map year column values to historical years
          for (let j = 0; j < histValues.length && j < historicalYears.length; j++) {
            histMeans[String(historicalYears[j])] = histValues[j];
          }

          // School's own value = first year column (current year)
          meanSchool = histValues.length >= 1 ? (histValues[0] ?? null) : null;

          // Geographic columns from right: GR (last), Göteborg (2nd-to-last), District (3rd-to-last)
          meanGr = geoValues.length >= 1 ? (geoValues[geoValues.length - 1] ?? null) : null;
          meanGoteborg = geoValues.length >= 2 ? (geoValues[geoValues.length - 2] ?? null) : null;
          meanDistrict = numGeo >= 3 ? (geoValues[geoValues.length - 3] ?? null) : null;
        } else {
          // 2018 format without GR column:
          // Layout: [year columns...] [School] [District] Göteborg
          // Geographic columns from right: Göteborg, District, School
          const numGeo = Math.max(3, values.length - numYearColumns);
          const geoStart = Math.max(0, values.length - numGeo);
          const histValues = values.slice(0, geoStart);
          const geoValues = values.slice(geoStart);

          for (let j = 0; j < histValues.length && j < historicalYears.length; j++) {
            histMeans[String(historicalYears[j])] = histValues[j];
          }

          meanGoteborg = geoValues.length >= 1 ? (geoValues[geoValues.length - 1] ?? null) : null;
          meanDistrict = geoValues.length >= 2 ? (geoValues[geoValues.length - 2] ?? null) : null;
          meanSchool = geoValues.length >= 3 ? (geoValues[geoValues.length - 3] ?? null) : null;
        }

        rows.push({
          questionText,
          questionArea: currentArea,
          meanGr,
          meanGoteborg,
          meanDistrict,
          meanSchool,
          historicalMeans: histMeans,
        });

        // Look-ahead: if the next non-empty line is a short text continuation
        // (e.g., "matematik" or "naturvetenskap" trailing from a wrapped question),
        // append it to the just-pushed question text
        let lookAhead = i + 1;
        while (lookAhead < lines.length && lines[lookAhead].trim() === "") lookAhead++;
        if (lookAhead < lines.length) {
          const nextTrimmed = lines[lookAhead].trim();
          // Short text, no numbers/percentages, starts with lowercase = continuation word
          if (nextTrimmed.length >= 3 && nextTrimmed.length < 40
              && !/\d/.test(nextTrimmed) && /^[a-zåäö]/.test(nextTrimmed)) {
            rows[rows.length - 1].questionText = cleanQuestionText(
              rows[rows.length - 1].questionText + " " + nextTrimmed
            );
            i = lookAhead; // skip the consumed line
          }
        }
      }

      pendingQuestionText = "";
    } else if (numericCount === 0 && trimmed.length > 10 && !scaleHeaderRe.test(trimmed)) {
      // Possible question text line (question wraps to next line with data)
      // In 7-point format, questions don't start with ellipsis
      // Skip column header fragments: lines with large gaps between words (2+ segments with 3+ spaces)
      const segments = trimmed.split(/\s{3,}/);
      const isColumnHeader = segments.length >= 2 && segments.every((s) => s.length < 25);
      if (!isColumnHeader && (/^[A-ZÅÄÖ]/.test(trimmed) || pendingQuestionText)) {
        if (pendingQuestionText) {
          pendingQuestionText += " " + trimmed;
        } else {
          pendingQuestionText = trimmed;
        }
      }
    }
  }

  return { rows, historicalYears };
}

// ── 2011-2015: ECERS format ──

/**
 * Parse mean rows from 2015 ECERS format PDFs.
 *
 * Supports two column variants:
 * - Single column: just "Medelvärde" at end of line (per-school reports)
 * - Dual column: "Medelvärde SDN Göteborg" or "Medelvärde Enhet Göteborg" (district reports)
 *
 * Format:
 *   [Question text]   [percentage bars]   [mean value(s)]
 *
 * Questions are numbered: "3. Förskolan...", "4. Du som förälder..."
 */
function parseMeanRowsEcers(text: string): { rows: MeanRow[]; historicalYears: number[] } {
  const lines = text.split("\n");
  const rows: MeanRow[] = [];
  let currentArea = "";

  // ECERS area patterns from the PDFs
  const ecersAreas = ["Förutsättningar", "Lärande", "Helhetsbedömning"];

  // Detect dual-column format: "SDN  Göteborg" or "Enhet  Göteborg" in header
  const hasDualColumns = /Medelvärde\s*\n?\s*(SDN|Enhet)\s+(Göteborg|G.teborg)/m.test(text)
    || /SDN\s+Göteborg/m.test(text);

  // Mean value regex: one or two decimal numbers at end of line
  // Single: "5,8" or dual: "5,7  5,8"
  const singleMeanRe = /(\d[.,]\d)\s*$/;
  const dualMeanRe = /(\d[.,]\d)\s+(\d[.,]\d)\s*$/;

  let pendingQuestionText = "";
  let inDataSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") continue;

    // "Medelvärde" header marks start of data section (skip demographics page)
    if (/Medelvärde/i.test(trimmed) && !inDataSection) {
      inDataSection = true;
      continue;
    }

    if (!inDataSection) continue;

    // Check for area headers
    for (const area of ecersAreas) {
      if (trimmed === area || trimmed.startsWith(area + "\n")) {
        currentArea = mapAreaName(area);
        break;
      }
    }

    // Skip non-data lines
    if (/^FÖRSKOLEENKÄT|^Bakgrund|^Antal\s+svarande|^Fristående|^Medelvärde|^Otillräck|^\d\.\s*(Otillräck|God|Minimal|Utmärkt)/i.test(trimmed)) continue;
    if (/^SDN\s+Göteborg|^Kommunal\s+verksamhet|^Ranking|^Frågeställning/i.test(trimmed)) continue;
    // Skip scale legend line
    if (/^\d+\.\s*(Otillräcklig|God|Minimal|Utmärkt)/.test(trimmed)) continue;
    // Skip page headers: "SchoolName, n=XX" or "SchoolName - SubType" repeating headers
    if (/,\s*n\s*=\s*\d+/.test(trimmed) && trimmed.length < 80) {
      pendingQuestionText = "";
      continue;
    }

    // Try dual-column match first, then single
    let meanSchool: number | null = null;
    let meanDistrict: number | null = null;
    let meanGoteborg: number | null = null;
    let matchLength = 0;
    let foundMean = false;

    if (hasDualColumns) {
      const dualMatch = trimmed.match(dualMeanRe);
      if (dualMatch) {
        const val1 = parseFloat(dualMatch[1].replace(",", "."));
        const val2 = parseFloat(dualMatch[2].replace(",", "."));
        if (val1 >= 1.0 && val1 <= 7.0 && val2 >= 1.0 && val2 <= 7.0) {
          // In district-level reports: first is SDN (district), second is Göteborg
          meanDistrict = val1;
          meanGoteborg = val2;
          meanSchool = val1; // Use district value as the primary value
          matchLength = dualMatch[0].length;
          foundMean = true;
        }
      }
    }

    if (!foundMean) {
      const singleMatch = trimmed.match(singleMeanRe);
      if (singleMatch) {
        const val = parseFloat(singleMatch[1].replace(",", "."));
        if (val >= 1.0 && val <= 7.0) {
          meanSchool = val;
          matchLength = singleMatch[0].length;
          foundMean = true;
        }
      }
    }

    if (foundMean) {
      // Extract question text: everything before percentages or the mean value
      let questionText = trimmed.substring(0, trimmed.length - matchLength).trim();

      // Remove percentage patterns
      questionText = questionText.replace(/\d+\s*%/g, "").trim();
      // Remove leading numbers and scale position indicators (0, 10, 20, etc.)
      questionText = questionText.replace(/\b\d{1,3}\b/g, "").trim();
      // Clean up multiple spaces
      questionText = questionText.replace(/\s{2,}/g, " ").trim();

      if (pendingQuestionText) {
        if (questionText.length > 3) {
          questionText = pendingQuestionText + " " + questionText;
        } else {
          questionText = pendingQuestionText;
        }
      }

      // Remove question number prefix: "3. ", "10. "
      questionText = questionText.replace(/^\d+\.\s*/, "");
      questionText = cleanQuestionText(questionText);

      if (questionText.length > 5) {
        rows.push({
          questionText,
          questionArea: currentArea,
          meanGr: null,
          meanGoteborg,
          meanDistrict,
          meanSchool,
          historicalMeans: {},
        });
      }

      pendingQuestionText = "";
    } else if (/^\d+\.\s+[A-ZÅÄÖ]/.test(trimmed) || /^[A-ZÅÄÖ]/.test(trimmed)) {
      // Question text that wraps to next line (starts with number+period or capital letter)
      if (trimmed.length > 10 && !/^FÖRSKOLE|^Bakgrund|^Antal|^Fristående|^Medelvärde|^Otillräck/i.test(trimmed)) {
        // Strip bar chart percentage numbers: take only text before first large gap followed by numbers
        let textPart = trimmed;
        const gapBeforeNumbers = trimmed.match(/^(.+?)\s{3,}\d/);
        if (gapBeforeNumbers) {
          textPart = gapBeforeNumbers[1].trim();
        }
        if (textPart.length > 5) {
          // If a new numbered question starts (e.g., "12. Barnen..."), reset pending text
          // to avoid merging leftover text from a previous question's continuation
          if (/^\d+\.\s+/.test(trimmed)) {
            pendingQuestionText = textPart;
          } else if (pendingQuestionText) {
            pendingQuestionText += " " + textPart;
          } else {
            pendingQuestionText = textPart;
          }
        }
      }
    }
  }

  return { rows, historicalYears: [] };
}

// ── 2011-2014: Scandinfo NKI format ──

/**
 * Parse data from 2011-2014 Scandinfo NKI format PDFs.
 *
 * These PDFs use a 10-point scale (1-10) and NKI index (0-100).
 * They contain multi-level data: district overview + per-school + per-unit.
 *
 * We extract from the FIRST section (the top-level entity this PDF represents):
 * - NKI and quality factor indices (0-100 scale) → stored as mean values
 * - Per-question mean values (1-10 scale) → stored as question means
 *
 * Layout per section:
 *   NKI, HELHET                72        73   69   76
 *   TRIVSEL                    83        85   83   86
 *   ...
 *   Antal svarande, n = 688 (svarsandel 24%)
 *
 *   KVALITETSFAKTOR  ...  Medelvärde  Ingen åsikt  Ej svar
 *   HELHET                 72
 *   Hur nöjd är du...       7,7   0   1
 *   ...
 */
function parseMeanRowsScandinfo(text: string): { rows: MeanRow[]; historicalYears: number[] } {
  const lines = text.split("\n");
  const rows: MeanRow[] = [];
  let currentArea = "";
  let pendingQuestionText = "";

  // Scandinfo quality factor → area mapping
  const scandInfoAreaMap: Record<string, string> = {
    "HELHET": "Helhetsomdöme",
    "TRIVSEL": "Trygghet och trivsel",
    "TRYGGHET": "Trygghet och trivsel",
    "BEMÖTANDE": "Relation och kommunikation",
    "PEDAGOGISK HANDLEDNING": "Utveckling och lärande",
    "PEDAGOGISK PROCESS": "Utveckling och lärande",
    "SÄKERHET": "Trygghet och trivsel",
    "DELAKTIGHET/INFLYTANDE": "Inflytande",
    "DELAKTIGHET/INFYTANDE": "Inflytande",
    "MILJÖ": "Helhetsomdöme",
    "FÖRSKOLEMILJÖ": "Helhetsomdöme",
    "MÅLTIDER": "Helhetsomdöme",
    "FÖRTROENDE": "Helhetsomdöme",
    "SERVICE VIA TELEFON": "Relation och kommunikation",
    "SERVICE VIA TELEFONVÄXELN": "Relation och kommunikation",
  };

  // Parse the first section's NKI + quality factor indices
  let inNkiSection = false;
  let pastFirstNki = false;
  let inQuestionSection = false;
  let sectionCount = 0;

  // Reference values from the NKI section header
  // "Referens SDN" or "Referens Område i GBG" columns
  let nkiReferenceValue: number | null = null;

  // Mean value regex for per-question rows: "7,7" or "7.7"
  const meanValueRe = /(\d[.,]\d)\s+(\d+)\s+(\d+)\s*$/; // mean, "ingen åsikt %", "ej svar %"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") continue;

    // Track section boundaries — "NKI, HELHET" marks start of a new entity section
    if (/^NKI,?\s+HELHET/i.test(trimmed)) {
      sectionCount++;
      if (sectionCount === 1) {
        inNkiSection = true;
        // Extract NKI value from this line: "NKI, HELHET  72  73  69  76"
        const nkiMatch = trimmed.match(/NKI,?\s+HELHET\s+(\d+)/i);
        if (nkiMatch) {
          const nkiValue = parseInt(nkiMatch[1], 10);
          const refMatch = trimmed.match(/NKI,?\s+HELHET\s+\d+\s+(\d+)/i);
          nkiReferenceValue = refMatch ? parseInt(refMatch[1], 10) : null;

          rows.push({
            questionText: "NKI Helhetsbedömning",
            questionArea: "Helhetsomdöme",
            meanGr: null,
            meanGoteborg: nkiReferenceValue,
            meanDistrict: null,
            meanSchool: nkiValue,
            historicalMeans: {},
          });
        }
      } else {
        // We've reached a sub-school section — stop parsing
        break;
      }
      continue;
    }

    // Parse quality factor indices from the NKI section
    if (inNkiSection && !pastFirstNki) {
      // Quality factor lines: "TRIVSEL  83  85  83  86"
      const factorMatch = trimmed.match(/^([A-ZÅÄÖ][A-ZÅÄÖ/ ]+?)\s{2,}(\d+)\s+(\d+)/);
      if (factorMatch) {
        const factorName = factorMatch[1].trim();
        const factorValue = parseInt(factorMatch[2], 10);
        const refValue = parseInt(factorMatch[3], 10);

        if (factorValue >= 0 && factorValue <= 100 && scandInfoAreaMap[factorName]) {
          rows.push({
            questionText: `NKI ${factorName.charAt(0) + factorName.slice(1).toLowerCase()}`,
            questionArea: scandInfoAreaMap[factorName] || "Helhetsomdöme",
            meanGr: null,
            meanGoteborg: refValue,
            meanDistrict: null,
            meanSchool: factorValue,
            historicalMeans: {},
          });
        }
        continue;
      }

      // "MEDELINDEX" marks end of NKI overview, start of per-question section
      if (/^MEDELINDEX/i.test(trimmed)) {
        pastFirstNki = true;
        continue;
      }

      // "Antal svarande" line
      if (/^Antal\s+svarande/i.test(trimmed)) {
        pastFirstNki = true;
        continue;
      }
    }

    // Per-question section (after NKI overview)
    if (pastFirstNki && sectionCount === 1) {
      // Detect quality factor section headers
      if (/^KVALITETSFAKTOR/i.test(trimmed)) {
        inQuestionSection = true;
        continue;
      }

      // Quality factor header in the question detail section
      // These appear as "Helhet  72" or "Trivsel  83" (mixed case in 2011)
      for (const [factor, area] of Object.entries(scandInfoAreaMap)) {
        const upperTrimmed = trimmed.toUpperCase();
        if (upperTrimmed.startsWith(factor) && /^\s+\d+\s*$/.test(trimmed.substring(factor.length))) {
          currentArea = area;
          pendingQuestionText = "";
          break;
        }
      }

      if (!inQuestionSection) continue;

      // Per-question data rows: "Hur nöjd är du med verksamheten...  63  28  9  7,7  0  1"
      // Layout: [question text] [pct 8-10] [pct 5-7] [pct 1-4] [mean] [ingen åsikt] [ej svar]
      // The mean is the key value we want - it's on a 1-10 scale
      const qMatch = trimmed.match(meanValueRe);
      if (qMatch) {
        const meanVal = parseFloat(qMatch[1].replace(",", "."));
        if (meanVal >= 1.0 && meanVal <= 10.0) {
          // Extract question text — everything before the percentage groups
          // Find where numeric data starts (first sequence of digits that are percentages)
          let questionText = "";

          // The percentage data is a sequence of numbers separated by spaces
          // Find the leftmost position where we see percentage-like numbers
          const pctStartMatch = line.match(/\s{3,}(\d{1,2}\s{2,})/);
          if (pctStartMatch && pctStartMatch.index !== undefined) {
            questionText = line.substring(0, pctStartMatch.index).trim();
          } else {
            // Fallback: take text before the mean value match
            const meanIdx = line.lastIndexOf(qMatch[1]);
            questionText = line.substring(0, meanIdx).trim();
            // Remove trailing numbers (percentages)
            questionText = questionText.replace(/(\s+\d{1,2})+\s*$/, "").trim();
          }

          // In 2011 PDFs, long questions wrap across multiple lines.
          // The data line may have no question text — use accumulated pending text.
          if (pendingQuestionText) {
            if (questionText.length > 3) {
              questionText = pendingQuestionText + " " + questionText;
            } else {
              questionText = pendingQuestionText;
            }
          }

          questionText = cleanQuestionText(questionText);
          pendingQuestionText = "";

          if (questionText.length > 5) {
            rows.push({
              questionText,
              questionArea: currentArea,
              meanGr: null,
              meanGoteborg: null,
              meanDistrict: null,
              meanSchool: meanVal,
              historicalMeans: {},
            });
          }
        }
      } else if (trimmed.length > 10
                 && !/^KVALITETSFAKTOR/i.test(trimmed)
                 && !/^Delfr.ga/i.test(trimmed)
                 && !/^I tabellen/i.test(trimmed)
                 && !/^\d+\s+ScandInfo/i.test(trimmed)
                 && !/^Referens/i.test(trimmed)
                 && !/^\d{1,3}\s{2,}\d{1,3}\s{2,}/.test(trimmed)) {
        // Accumulate question text from non-data, non-header lines
        // (handles multi-line questions in 2011 PDFs)
        let isFactorHeader = false;
        for (const [factor] of Object.entries(scandInfoAreaMap)) {
          const upperTrimmed = trimmed.toUpperCase();
          if (upperTrimmed.startsWith(factor) && /^\s+\d+\s*$/.test(trimmed.substring(factor.length))) {
            isFactorHeader = true;
            break;
          }
        }
        if (!isFactorHeader) {
          if (pendingQuestionText) {
            pendingQuestionText += " " + trimmed;
          } else {
            pendingQuestionText = trimmed;
          }
        }
      }
    }
  }

  return { rows, historicalYears: [] };
}

// ── Main entry points ──

export function parseTables(text: string): ParsedTables {
  const metadata = parseMetadata(text);
  const format = detectFormat(text);

  let result: { rows: MeanRow[]; historicalYears: number[] };

  switch (format) {
    case "5point":
      result = parseMeanRows5Point(text);
      break;
    case "7point":
      result = parseMeanRows7Point(text);
      break;
    case "ecers":
      result = parseMeanRowsEcers(text);
      break;
    case "scandinfo":
      result = parseMeanRowsScandinfo(text);
      break;
  }

  return { metadata, means: result.rows, historicalYears: result.historicalYears };
}

export async function parseTablesFromPdf(pdfPath: string): Promise<ParsedTables> {
  const text = await extractLayoutText(pdfPath);
  return parseTables(text);
}
