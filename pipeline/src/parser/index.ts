/**
 * Parser orchestrator: PDF/XLS → structured data → PostgreSQL.
 * Run: npm run parse
 */
import "dotenv/config";
import { query, ensureSchema } from "../db.js";
import pool from "../db.js";
import { extractTextItems } from "./pdf-text.js";
import { parseTablesFromPdf, extractLayoutText } from "./tables.js";
import {
  parseResponseDistributions,
  parseGenderSplits,
  parseGenderSplitsFromLayout,
  parseDemographics,
  parseImportantQuestions,
  parseUnitMeans,
} from "./charts.js";
import { parseXlsFile } from "./xls.js";
import { findOrCreateSchool } from "../school-helpers.js";

async function getOrCreateQuestionArea(
  name: string,
  order: number,
): Promise<number> {
  const result = await query(
    `INSERT INTO question_areas (name, display_order)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET display_order = $2
     RETURNING id`,
    [name, order],
  );
  return result.rows[0].id;
}

async function getOrCreateQuestion(
  text: string,
  areaId: number | null,
): Promise<number> {
  const result = await query(
    `INSERT INTO questions (text, question_area_id)
     VALUES ($1, $2)
     ON CONFLICT (text) DO UPDATE SET question_area_id = COALESCE($2, questions.question_area_id)
     RETURNING id`,
    [text, areaId],
  );
  return result.rows[0].id;
}

const AREA_ORDER: Record<string, number> = {
  "Trygghet och trivsel": 1,
  "Utveckling och lärande": 2,
  "Inflytande": 3,
  "Relation och kommunikation": 4,
  "Helhetsomdöme": 5,
  "Övergripande": 6,
};

async function parseSinglePdf(reportId: number, pdfPath: string) {
  console.log(`  Parsing: ${pdfPath}`);

  // Clean up existing data for this report (important for --force re-parsing)
  await query("DELETE FROM question_means WHERE pdf_report_id = $1", [reportId]);
  await query("DELETE FROM question_responses WHERE pdf_report_id = $1", [reportId]);
  await query("DELETE FROM gender_split WHERE pdf_report_id = $1", [reportId]);
  await query("DELETE FROM important_questions WHERE pdf_report_id = $1", [reportId]);
  await query("DELETE FROM unit_means WHERE pdf_report_id = $1", [reportId]);

  // Extract data using both methods
  const [tableData, textData, layoutText] = await Promise.all([
    parseTablesFromPdf(pdfPath),
    extractTextItems(pdfPath),
    extractLayoutText(pdfPath),
  ]);

  // 1. Store metadata
  if (
    tableData.metadata.responseRate !== null ||
    tableData.metadata.respondents !== null
  ) {
    const demographics = parseDemographics(textData.items, layoutText);

    await query(
      `INSERT INTO report_metadata (pdf_report_id, response_rate, respondents, total_invited,
         birth_year_distribution, child_gender_distribution, parent_gender_distribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pdf_report_id) DO UPDATE SET
         response_rate = $2, respondents = $3, total_invited = $4,
         birth_year_distribution = $5, child_gender_distribution = $6,
         parent_gender_distribution = $7`,
      [
        reportId,
        tableData.metadata.responseRate,
        tableData.metadata.respondents,
        tableData.metadata.totalInvited,
        JSON.stringify(demographics.birthYearDistribution),
        JSON.stringify(demographics.childGenderDistribution),
        JSON.stringify(demographics.parentGenderDistribution),
      ],
    );
  }

  // 2. Store question means
  for (const row of tableData.means) {
    const areaId = row.questionArea
      ? await getOrCreateQuestionArea(
          row.questionArea,
          AREA_ORDER[row.questionArea] || 99,
        )
      : null;

    const questionId = await getOrCreateQuestion(row.questionText, areaId);

    await query(
      `INSERT INTO question_means (pdf_report_id, question_id, mean_gr, mean_goteborg,
         mean_district, mean_school, historical_means)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET
         mean_gr = $3, mean_goteborg = $4, mean_district = $5,
         mean_school = $6, historical_means = $7`,
      [
        reportId,
        questionId,
        row.meanGr,
        row.meanGoteborg,
        row.meanDistrict,
        row.meanSchool,
        JSON.stringify(row.historicalMeans),
      ],
    );
  }

  // 3. Store response distributions
  // Build means map for mean-guided category assignment
  const meansMap = new Map<string, number>();
  for (const row of tableData.means) {
    if (row.meanSchool !== null) {
      meansMap.set(row.questionText, row.meanSchool);
    }
  }
  const distributions = parseResponseDistributions(layoutText, meansMap);
  for (const dist of distributions) {
    // Try to find matching question
    const qResult = await query(
      "SELECT id FROM questions WHERE text = $1",
      [dist.questionText],
    );
    if (qResult.rows.length === 0) continue;
    const questionId = qResult.rows[0].id;

    await query(
      `INSERT INTO question_responses (pdf_report_id, question_id,
         pct_strongly_agree, pct_agree, pct_neither, pct_disagree,
         pct_strongly_disagree, pct_dont_know)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET
         pct_strongly_agree = $3, pct_agree = $4, pct_neither = $5,
         pct_disagree = $6, pct_strongly_disagree = $7, pct_dont_know = $8`,
      [
        reportId,
        questionId,
        dist.pctStronglyAgree,
        dist.pctAgree,
        dist.pctNeither,
        dist.pctDisagree,
        dist.pctStronglyDisagree,
        dist.pctDontKnow,
      ],
    );
  }

  // 4. Store gender splits (prefer layout-based — coordinate-based is unreliable
  //    because pdf2json often collapses all items to the same coordinates)
  let genderSplits = parseGenderSplitsFromLayout(layoutText);
  if (genderSplits.length === 0) {
    genderSplits = parseGenderSplits(textData.items, {
      startPage: 1,
      endPage: textData.pageCount,
    });
  }
  for (const gs of genderSplits) {
    const qResult = await query(
      "SELECT id FROM questions WHERE text = $1",
      [gs.questionText],
    );
    if (qResult.rows.length === 0) continue;
    const questionId = qResult.rows[0].id;

    await query(
      `INSERT INTO gender_split (pdf_report_id, question_id, pct_total, pct_flicka, pct_pojke)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET
         pct_total = $3, pct_flicka = $4, pct_pojke = $5`,
      [reportId, questionId, gs.pctTotal, gs.pctFlicka, gs.pctPojke],
    );
  }

  // 5. Store important questions
  const important = parseImportantQuestions(layoutText);
  for (const iq of important) {
    const qResult = await query(
      "SELECT id FROM questions WHERE text = $1",
      [iq.questionText],
    );
    if (qResult.rows.length === 0) {
      // Create the question if it doesn't exist
      const newQ = await getOrCreateQuestion(iq.questionText, null);
      await query(
        `INSERT INTO important_questions (pdf_report_id, question_id, rank, pct)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET rank = $3, pct = $4`,
        [reportId, newQ, iq.rank, iq.pct],
      );
    } else {
      await query(
        `INSERT INTO important_questions (pdf_report_id, question_id, rank, pct)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET rank = $3, pct = $4`,
        [reportId, qResult.rows[0].id, iq.rank, iq.pct],
      );
    }
  }

  // 6. Store unit means
  const unitMeans = parseUnitMeans(layoutText);
  for (const um of unitMeans) {
    // Find or create question area
    let qaId: number | null = null;
    for (const [areaName, order] of Object.entries(AREA_ORDER)) {
      if (areaName.toLowerCase().startsWith(um.areaName.toLowerCase())) {
        qaId = await getOrCreateQuestionArea(areaName, order);
        break;
      }
    }
    if (qaId === null) continue;

    await query(
      `INSERT INTO unit_means (pdf_report_id, unit_name, question_area_id, mean_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pdf_report_id, unit_name, question_area_id) DO UPDATE SET mean_value = $4`,
      [reportId, um.unitName, qaId, um.meanValue],
    );
  }

  // Mark as parsed
  await query(
    `UPDATE pdf_reports SET parsed_at = NOW(), parse_error = NULL WHERE id = $1`,
    [reportId],
  );
}

/**
 * Parse an XLS file containing multiple units.
 * Creates separate school + pdf_reports entries for each unit found in the XLS.
 */
async function parseXlsReport(reportId: number, xlsPath: string, year: number, reportCategory: string = 'barn') {
  console.log(`  Parsing XLS: ${xlsPath}`);

  const format = reportCategory === 'foralder' ? 'foralder' : 'barn';
  const units = await parseXlsFile(xlsPath, format as 'barn' | 'foralder');
  if (units.length === 0) {
    // Some XLS files have too few respondents (<7) and contain no data
    await query(
      `UPDATE pdf_reports SET parsed_at = NOW(), parse_error = 'No unit data (too few respondents)' WHERE id = $1`,
      [reportId],
    );
    console.log(`    Skipped: no unit data found (too few respondents)`);
    return;
  }

  // Look up the area and parent school for this report
  const reportInfo = await query(
    `SELECT pr.area_id, pr.school_id as parent_school_id, pr.pdf_url
     FROM pdf_reports pr
     WHERE pr.id = $1`,
    [reportId],
  );
  if (reportInfo.rows.length === 0) throw new Error("Report not found");
  const { area_id: areaId, parent_school_id: parentSchoolId, pdf_url: basePdfUrl } = reportInfo.rows[0];

  let unitCount = 0;
  for (const unit of units) {
    // Create/find a school entry for this unit (deduped)
    const rawName = unit.unitName.trim();
    const schoolId = await findOrCreateSchool(rawName, rawName, areaId);

    // Create a pdf_reports entry with #sheetId fragment for uniqueness
    const unitPdfUrl = `${basePdfUrl}#${unit.sheetId}`;
    const unitReportResult = await query(
      `INSERT INTO pdf_reports (school_id, year, report_type, unit_name, pdf_url, local_path, downloaded_at, area_id, parent_school_id, report_category)
       VALUES ($1, $2, 'unit', $3, $4, $5, NOW(), $6, $7, $8)
       ON CONFLICT (pdf_url) DO UPDATE SET
         school_id = $1, unit_name = $3, local_path = $5, area_id = $6, parent_school_id = $7, report_category = $8
       RETURNING id`,
      [schoolId, year, unit.unitName.trim(), unitPdfUrl, xlsPath, areaId, parentSchoolId, reportCategory],
    );
    const unitReportId = unitReportResult.rows[0].id;

    // Clean up existing data for this unit report (for --force)
    await query("DELETE FROM question_means WHERE pdf_report_id = $1", [unitReportId]);
    await query("DELETE FROM question_responses WHERE pdf_report_id = $1", [unitReportId]);

    // Store metadata (respondents)
    if (unit.respondents !== null) {
      await query(
        `INSERT INTO report_metadata (pdf_report_id, respondents)
         VALUES ($1, $2)
         ON CONFLICT (pdf_report_id) DO UPDATE SET respondents = $2`,
        [unitReportId, unit.respondents],
      );
    }

    // Store question means
    for (const m of unit.means) {
      const questionId = await getOrCreateQuestion(m.questionText, null);
      await query(
        `INSERT INTO question_means (pdf_report_id, question_id, mean_school, mean_district, historical_means)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET
           mean_school = $3, mean_district = $4, historical_means = $5`,
        [unitReportId, questionId, m.meanValue, m.meanAllSchools, "{}"],
      );
    }

    // Store response distributions (3-point: low→strongly_disagree, medium→neither, high→strongly_agree)
    for (const r of unit.responseDistribution) {
      const qResult = await query(
        "SELECT id FROM questions WHERE text = $1",
        [r.questionText],
      );
      if (qResult.rows.length === 0) continue;
      const questionId = qResult.rows[0].id;

      await query(
        `INSERT INTO question_responses (pdf_report_id, question_id,
           pct_strongly_agree, pct_neither, pct_strongly_disagree)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (pdf_report_id, question_id) DO UPDATE SET
           pct_strongly_agree = $3, pct_neither = $4, pct_strongly_disagree = $5`,
        [unitReportId, questionId, r.pctHigh, r.pctMedium, r.pctLow],
      );
    }

    // Mark unit report as parsed
    await query(
      `UPDATE pdf_reports SET parsed_at = NOW(), parse_error = NULL WHERE id = $1`,
      [unitReportId],
    );
    unitCount++;
  }

  // Mark the original district-level report as parsed
  await query(
    `UPDATE pdf_reports SET parsed_at = NOW(), parse_error = NULL WHERE id = $1`,
    [reportId],
  );

  console.log(`    Created ${unitCount} unit reports from XLS`);
}

async function main() {
  await ensureSchema();

  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const yearArg = args.find((a) => /^\d{4}$/.test(a));
  const force = args.includes("--force");

  let sql = `
    SELECT id, local_path, year, pdf_url, COALESCE(report_category, 'barn') as report_category
    FROM pdf_reports
    WHERE downloaded_at IS NOT NULL
      AND local_path IS NOT NULL
      AND pdf_url NOT LIKE '%#%'
  `;
  const params: unknown[] = [];

  if (!force) {
    sql += " AND parsed_at IS NULL";
  }
  // Always skip reports with manually set parse errors (unparseable formats)
  sql += " AND (parse_error IS NULL OR parsed_at IS NOT NULL)";

  if (yearArg) {
    params.push(parseInt(yearArg, 10));
    sql += ` AND year = $${params.length}`;
  }

  sql += " ORDER BY year DESC, id";

  if (limit) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await query(sql, params);
  console.log(`Found ${rows.length} PDFs to parse`);

  let parsed = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const isXls = /\.xlsx?$/i.test(row.local_path);
      if (isXls) {
        await parseXlsReport(row.id, row.local_path, row.year, row.report_category);
      } else {
        await parseSinglePdf(row.id, row.local_path);
      }
      parsed++;
      console.log(`  [${parsed}/${rows.length}] OK`);
    } catch (err) {
      console.error(`  ERROR parsing ${row.local_path}: ${err}`);
      await query(
        `UPDATE pdf_reports SET parse_error = $1 WHERE id = $2`,
        [`${err}`, row.id],
      );
      errors++;
    }
  }

  console.log(`\nParsed: ${parsed}, Errors: ${errors}`);

  // Summary
  const counts = await Promise.all([
    query("SELECT count(*) as n FROM question_means"),
    query("SELECT count(*) as n FROM question_responses"),
    query("SELECT count(*) as n FROM gender_split"),
    query("SELECT count(*) as n FROM questions"),
  ]);
  console.log(
    `Data: ${counts[3].rows[0].n} questions, ${counts[0].rows[0].n} means, ` +
      `${counts[1].rows[0].n} response distributions, ${counts[2].rows[0].n} gender splits`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("Parse failed:", err);
  process.exit(1);
});
