/**
 * Validate parsed data against source PDFs.
 * Picks random samples from each format era, re-extracts text via pdftotext,
 * and compares against stored DB values.
 *
 * Run: npx tsx src/validate.ts
 */
import "dotenv/config";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";
import { extractLayoutText, parseTables } from "./parser/tables.js";

interface ValidationResult {
  reportId: number;
  year: number;
  schoolName: string;
  pdfPath: string;
  format: string;
  dbQuestionCount: number;
  parsedQuestionCount: number;
  mismatches: Array<{
    question: string;
    field: string;
    dbValue: number | null;
    parsedValue: number | null;
  }>;
  missingInDb: string[];
  missingInParse: string[];
}

async function validateReport(reportId: number): Promise<ValidationResult> {
  // Get report info
  const reportRes = await query(
    `SELECT pr.id, pr.local_path, pr.year, s.name as school_name, a.name as area_name
     FROM pdf_reports pr
     JOIN schools s ON pr.school_id = s.id
     JOIN areas a ON s.area_id = a.id
     WHERE pr.id = $1`,
    [reportId],
  );
  const report = reportRes.rows[0];

  // Get DB means
  const dbMeans = await query(
    `SELECT q.text as question, qm.mean_gr, qm.mean_goteborg, qm.mean_district, qm.mean_school
     FROM question_means qm
     JOIN questions q ON q.id = qm.question_id
     WHERE qm.pdf_report_id = $1
     ORDER BY q.text`,
    [reportId],
  );

  // Re-parse from PDF
  const text = await extractLayoutText(report.local_path);
  const parsed = parseTables(text);

  // Detect format for logging
  let format = "unknown";
  if (/\bNKI,?\s+HELHET\b/i.test(text)) format = "scandinfo";
  else if (/sjugradig/i.test(text) || /Otillräcklig/i.test(text)) {
    if (/Resultat\s+per\s+fråga/i.test(text) && /\b20\d{2}\s+20\d{2}\b/.test(text)) format = "7point";
    else format = "ecers";
  } else format = "5point";

  const result: ValidationResult = {
    reportId,
    year: report.year,
    schoolName: report.school_name,
    pdfPath: report.local_path,
    format,
    dbQuestionCount: dbMeans.rows.length,
    parsedQuestionCount: parsed.means.length,
    mismatches: [],
    missingInDb: [],
    missingInParse: [],
  };

  // Build maps for comparison (normalize question text for matching)
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().substring(0, 80);

  const dbMap = new Map<string, typeof dbMeans.rows[0]>();
  for (const row of dbMeans.rows) {
    dbMap.set(normalize(row.question), row);
  }

  const parsedMap = new Map<string, typeof parsed.means[0]>();
  for (const row of parsed.means) {
    parsedMap.set(normalize(row.questionText), row);
  }

  // Compare: check each DB entry against parsed
  for (const [normQ, dbRow] of dbMap) {
    const parsedRow = parsedMap.get(normQ);
    if (!parsedRow) {
      result.missingInParse.push(dbRow.question.substring(0, 80));
      continue;
    }

    // Compare values
    const fields: Array<{ name: string; dbVal: number | null; parsedVal: number | null }> = [
      { name: "mean_school", dbVal: dbRow.mean_school ? parseFloat(dbRow.mean_school) : null, parsedVal: parsedRow.meanSchool },
      { name: "mean_goteborg", dbVal: dbRow.mean_goteborg ? parseFloat(dbRow.mean_goteborg) : null, parsedVal: parsedRow.meanGoteborg },
      { name: "mean_district", dbVal: dbRow.mean_district ? parseFloat(dbRow.mean_district) : null, parsedVal: parsedRow.meanDistrict },
      { name: "mean_gr", dbVal: dbRow.mean_gr ? parseFloat(dbRow.mean_gr) : null, parsedVal: parsedRow.meanGr },
    ];

    for (const f of fields) {
      if (f.dbVal === null && f.parsedVal === null) continue;
      if (f.dbVal !== null && f.parsedVal !== null && Math.abs(f.dbVal - f.parsedVal) < 0.011) continue;
      result.mismatches.push({
        question: dbRow.question.substring(0, 60),
        field: f.name,
        dbValue: f.dbVal,
        parsedValue: f.parsedVal,
      });
    }
  }

  // Check for parsed rows not in DB
  for (const [normQ, parsedRow] of parsedMap) {
    if (!dbMap.has(normQ)) {
      result.missingInParse.push(`EXTRA: ${parsedRow.questionText.substring(0, 80)}`);
    }
  }

  return result;
}

async function main() {
  await ensureSchema();

  // Pick 3 random reports from each year that has data
  const years = [2025, 2024, 2023, 2022, 2021, 2020, 2018, 2017, 2016, 2015, 2014, 2013, 2012];

  let totalMismatches = 0;
  let totalReports = 0;

  for (const year of years) {
    const samples = await query(
      `SELECT pr.id FROM pdf_reports pr
       JOIN schools s ON pr.school_id = s.id
       JOIN areas a ON s.area_id = a.id
       WHERE a.year = $1
         AND pr.parsed_at IS NOT NULL
         AND pr.local_path IS NOT NULL
         AND EXISTS (SELECT 1 FROM question_means qm WHERE qm.pdf_report_id = pr.id)
       ORDER BY RANDOM() LIMIT 3`,
      [year],
    );

    if (samples.rows.length === 0) {
      console.log(`\n${year}: No parsed reports with means found`);
      continue;
    }

    console.log(`\n═══ ${year} ═══`);
    for (const sample of samples.rows) {
      try {
        const result = await validateReport(sample.id);
        totalReports++;

        const mismatchCount = result.mismatches.length;
        totalMismatches += mismatchCount;

        const status = mismatchCount === 0 ? "✓" : `✗ ${mismatchCount} mismatches`;
        console.log(`  [${result.format}] Report #${result.reportId} ${result.schoolName.substring(0, 40)}`);
        console.log(`    DB: ${result.dbQuestionCount} questions, Parsed: ${result.parsedQuestionCount} → ${status}`);

        if (mismatchCount > 0) {
          for (const m of result.mismatches.slice(0, 5)) {
            console.log(`    MISMATCH: "${m.question}" ${m.field}: DB=${m.dbValue} vs Parsed=${m.parsedValue}`);
          }
          if (mismatchCount > 5) console.log(`    ... and ${mismatchCount - 5} more`);
        }

        if (result.missingInParse.length > 0) {
          console.log(`    Missing in re-parse: ${result.missingInParse.length} (${result.missingInParse.slice(0, 3).join(", ")})`);
        }
      } catch (err) {
        console.log(`  Report #${sample.id}: ERROR: ${err}`);
      }
    }
  }

  console.log(`\n═══ SUMMARY ═══`);
  console.log(`Validated ${totalReports} reports, found ${totalMismatches} value mismatches`);

  await pool.end();
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
