/**
 * Export Postgres data to static JSON files for the frontend.
 * Run: npm run export
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";
import { getScale, normalize } from "./normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../frontend/public/data");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

/** Export index.json — all years, areas, schools */
async function exportIndex() {
  const years = await query(
    "SELECT year, crawled_at FROM survey_years ORDER BY year DESC",
  );

  const areas = await query(
    `SELECT a.id, a.year, a.name, a.url_slug FROM areas a ORDER BY a.year DESC, a.name`,
  );

  const schools = await query(
    `SELECT s.id, s.area_id, s.name, s.url_slug,
            a.year, a.name as area_name,
            s.lat, s.lng, s.parent_school_id
     FROM schools s
     JOIN areas a ON s.area_id = a.id
     ORDER BY a.year DESC, a.name, s.name`,
  );

  // Get school-level mean averages and report IDs for quick overview
  // Use 'school' type reports when available, fall back to any report type
  // Exclude NKI indices (0-100 scale) from average to avoid mixing scales
  const schoolMeans = await query(
    `SELECT DISTINCT ON (pr.school_id, pr.year)
            pr.school_id, pr.id as report_id, pr.year,
            (SELECT AVG(qm2.mean_school) FROM question_means qm2
             JOIN questions q2 ON q2.id = qm2.question_id
             WHERE qm2.pdf_report_id = pr.id AND q2.text NOT LIKE 'NKI %') as avg_mean,
            rm.respondents, rm.response_rate
     FROM pdf_reports pr
     LEFT JOIN report_metadata rm ON rm.pdf_report_id = pr.id
     WHERE pr.parsed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM question_means qm WHERE qm.pdf_report_id = pr.id)
     ORDER BY pr.school_id, pr.year,
       CASE pr.report_type WHEN 'school' THEN 0 ELSE 1 END,
       pr.id`,
  );

  const meansMap = new Map<string, { reportId: number; avgMean: number; avgNormalized: number; respondents: number | null; responseRate: number | null }>();
  for (const row of schoolMeans.rows) {
    const avgMean = parseFloat(parseFloat(row.avg_mean).toFixed(2));
    meansMap.set(`${row.school_id}-${row.year}`, {
      reportId: row.report_id,
      avgMean,
      avgNormalized: normalize(avgMean, row.year) ?? 0,
      respondents: row.respondents,
      responseRate: row.response_rate,
    });
  }

  // Crawler units: report_type='unit' reports that share school_id with parent
  const crawlerUnits = await query(
    `SELECT pr.id as report_id, pr.school_id, pr.year, pr.unit_name,
            (SELECT AVG(qm2.mean_school) FROM question_means qm2
             JOIN questions q2 ON q2.id = qm2.question_id
             WHERE qm2.pdf_report_id = pr.id AND q2.text NOT LIKE 'NKI %') as avg_mean,
            rm.respondents, rm.response_rate
     FROM pdf_reports pr
     LEFT JOIN report_metadata rm ON rm.pdf_report_id = pr.id
     WHERE pr.report_type = 'unit'
       AND pr.parsed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM question_means qm WHERE qm.pdf_report_id = pr.id)
     ORDER BY pr.school_id, pr.year, pr.unit_name`,
  );

  // Map crawler units by school_id-year
  const crawlerUnitsMap = new Map<string, Array<{
    reportId: number; name: string; avgMean: number | null;
    avgNormalized: number | null; respondents: number | null; responseRate: number | null;
  }>>();
  for (const row of crawlerUnits.rows) {
    const key = `${row.school_id}-${row.year}`;
    if (!crawlerUnitsMap.has(key)) crawlerUnitsMap.set(key, []);
    const avgMean = row.avg_mean ? parseFloat(parseFloat(row.avg_mean).toFixed(2)) : null;
    crawlerUnitsMap.get(key)!.push({
      reportId: row.report_id,
      name: row.unit_name,
      avgMean,
      avgNormalized: avgMean !== null ? normalize(avgMean, row.year) : null,
      respondents: row.respondents,
      responseRate: row.response_rate,
    });
  }

  // XLS children: schools with parent_school_id set
  // Build set of child school IDs and map from parent to children
  const childSchoolIds = new Set<number>();
  const xlsChildrenMap = new Map<string, Array<{
    reportId: number | null; name: string; avgMean: number | null;
    avgNormalized: number | null; respondents: number | null; responseRate: number | null;
  }>>();
  for (const s of schools.rows) {
    if (s.parent_school_id) {
      childSchoolIds.add(s.id);
      const means = meansMap.get(`${s.id}-${s.year}`);
      const key = `${s.parent_school_id}-${s.year}`;
      if (!xlsChildrenMap.has(key)) xlsChildrenMap.set(key, []);
      xlsChildrenMap.get(key)!.push({
        reportId: means?.reportId ?? null,
        name: s.name,
        avgMean: means?.avgMean ?? null,
        avgNormalized: means?.avgNormalized ?? null,
        respondents: means?.respondents ?? null,
        responseRate: means?.responseRate ?? null,
      });
    }
  }

  const index = {
    years: years.rows.map((y) => ({ year: y.year, crawledAt: y.crawled_at })),
    areas: areas.rows.map((a) => ({
      id: a.id,
      year: a.year,
      name: a.name,
      slug: a.url_slug,
    })),
    schools: schools.rows
      .filter((s) => !childSchoolIds.has(s.id))
      .map((s) => {
        const means = meansMap.get(`${s.id}-${s.year}`);
        const scale = getScale(s.year);

        // Merge crawler units + XLS children into a single units array
        const crawlerList = crawlerUnitsMap.get(`${s.id}-${s.year}`) || [];
        const xlsList = xlsChildrenMap.get(`${s.id}-${s.year}`) || [];
        const allUnits = [...crawlerList, ...xlsList];

        const entry: Record<string, unknown> = {
          id: s.id,
          areaId: s.area_id,
          year: s.year,
          name: s.name,
          areaName: s.area_name,
          reportId: means?.reportId ?? null,
          avgMean: means?.avgMean ?? null,
          avgNormalized: means?.avgNormalized ?? null,
          scale: scale.label,
          respondents: means?.respondents ?? null,
          responseRate: means?.responseRate ?? null,
          lat: s.lat ?? null,
          lng: s.lng ?? null,
        };
        if (allUnits.length > 0) entry.units = allUnits;
        return entry;
      }),
  };

  await writeJson(join(DATA_DIR, "index.json"), index);
  console.log(
    `Exported index.json: ${index.years.length} years, ${index.areas.length} areas, ${index.schools.length} schools`,
  );
}

/** Export per-area school summary files */
async function exportAreaSchools() {
  const areas = await query(
    "SELECT id, year, name, url_slug FROM areas ORDER BY year DESC, name",
  );

  let fileCount = 0;
  for (const area of areas.rows) {
    const schools = await query(
      `SELECT DISTINCT ON (s.id) s.id, s.name,
              pr.id as report_id,
              rm.response_rate, rm.respondents
       FROM schools s
       JOIN pdf_reports pr ON pr.school_id = s.id
       LEFT JOIN report_metadata rm ON rm.pdf_report_id = pr.id
       WHERE s.area_id = $1
         AND s.parent_school_id IS NULL
         AND pr.parsed_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM question_means qm WHERE qm.pdf_report_id = pr.id)
       ORDER BY s.id, CASE pr.report_type WHEN 'school' THEN 0 ELSE 1 END, pr.id`,
      [area.id],
    );

    // Get question area means for each school
    const schoolData = [];
    for (const school of schools.rows) {
      const areaMeans = await query(
        `SELECT qa.name as area_name, AVG(qm.mean_school) as mean
         FROM question_means qm
         JOIN questions q ON q.id = qm.question_id
         JOIN question_areas qa ON qa.id = q.question_area_id
         WHERE qm.pdf_report_id = $1
         GROUP BY qa.name, qa.display_order
         ORDER BY qa.display_order`,
        [school.report_id],
      );

      schoolData.push({
        id: school.id,
        name: school.name,
        responseRate: school.response_rate,
        respondents: school.respondents,
        areaMeans: areaMeans.rows.map((m) => ({
          area: m.area_name,
          mean: parseFloat(parseFloat(m.mean).toFixed(2)),
        })),
      });
    }

    const filename = `${area.year}-${slugify(area.url_slug)}.json`;
    await writeJson(join(DATA_DIR, "schools", filename), {
      year: area.year,
      area: area.name,
      schools: schoolData,
    });
    fileCount++;
  }

  console.log(`Exported ${fileCount} area school files`);
}

/** Export detailed per-school report files */
async function exportDetails() {
  const reports = await query(
    `SELECT pr.id, pr.school_id, pr.year, pr.report_type, pr.unit_name,
            pr.pdf_url,
            s.name as school_name, s.parent_school_id,
            a.name as area_name
     FROM pdf_reports pr
     JOIN schools s ON pr.school_id = s.id
     JOIN areas a ON s.area_id = a.id
     WHERE pr.parsed_at IS NOT NULL
     ORDER BY pr.id`,
  );

  // Build related reports lookup:
  // For crawler units: siblings share the same school_id
  // For XLS units: linked via parent_school_id
  const reportsBySchoolId = new Map<string, Array<{
    reportId: number; reportType: string; unitName: string | null; schoolName: string;
  }>>();
  for (const r of reports.rows) {
    const key = `${r.school_id}-${r.year}`;
    if (!reportsBySchoolId.has(key)) reportsBySchoolId.set(key, []);
    reportsBySchoolId.get(key)!.push({
      reportId: r.id,
      reportType: r.report_type,
      unitName: r.unit_name,
      schoolName: r.school_name,
    });
  }

  // Map parent_school_id → child schools for XLS units
  const xlsParentToChildren = new Map<string, Array<{
    reportId: number; reportType: string; unitName: string | null; schoolName: string;
  }>>();
  const xlsChildToParent = new Map<number, { parentSchoolId: number; year: number }>();
  for (const r of reports.rows) {
    if (r.parent_school_id) {
      const key = `${r.parent_school_id}-${r.year}`;
      if (!xlsParentToChildren.has(key)) xlsParentToChildren.set(key, []);
      xlsParentToChildren.get(key)!.push({
        reportId: r.id,
        reportType: r.report_type,
        unitName: r.unit_name || r.school_name,
        schoolName: r.school_name,
      });
      xlsChildToParent.set(r.school_id, { parentSchoolId: r.parent_school_id, year: r.year });
    }
  }

  let fileCount = 0;
  for (const report of reports.rows) {
    // Metadata
    const meta = await query(
      `SELECT * FROM report_metadata WHERE pdf_report_id = $1`,
      [report.id],
    );

    // Question means
    const means = await query(
      `SELECT q.text as question, qa.name as area,
              qm.mean_gr, qm.mean_goteborg, qm.mean_district, qm.mean_school,
              qm.historical_means
       FROM question_means qm
       JOIN questions q ON q.id = qm.question_id
       LEFT JOIN question_areas qa ON qa.id = q.question_area_id
       WHERE qm.pdf_report_id = $1
       ORDER BY qa.display_order, q.id`,
      [report.id],
    );

    // Response distributions
    const responses = await query(
      `SELECT q.text as question,
              qr.pct_strongly_agree, qr.pct_agree, qr.pct_neither,
              qr.pct_disagree, qr.pct_strongly_disagree, qr.pct_dont_know
       FROM question_responses qr
       JOIN questions q ON q.id = qr.question_id
       WHERE qr.pdf_report_id = $1
       ORDER BY q.id`,
      [report.id],
    );

    // Gender splits
    const gender = await query(
      `SELECT q.text as question, gs.pct_total, gs.pct_flicka, gs.pct_pojke
       FROM gender_split gs
       JOIN questions q ON q.id = gs.question_id
       WHERE gs.pdf_report_id = $1
       ORDER BY q.id`,
      [report.id],
    );

    // Important questions
    const important = await query(
      `SELECT q.text as question, iq.rank, iq.pct
       FROM important_questions iq
       JOIN questions q ON q.id = iq.question_id
       WHERE iq.pdf_report_id = $1
       ORDER BY iq.rank`,
      [report.id],
    );

    // Unit means
    const units = await query(
      `SELECT um.unit_name, qa.name as area, um.mean_value
       FROM unit_means um
       JOIN question_areas qa ON qa.id = um.question_area_id
       WHERE um.pdf_report_id = $1
       ORDER BY um.unit_name, qa.display_order`,
      [report.id],
    );

    const scale = getScale(report.year);
    const detail = {
      id: report.id,
      schoolId: report.school_id,
      schoolName: report.school_name,
      areaName: report.area_name,
      year: report.year,
      reportType: report.report_type,
      unitName: report.unit_name,
      pdfUrl: report.pdf_url,
      scale: scale.label,
      metadata: meta.rows[0]
        ? {
            responseRate: meta.rows[0].response_rate,
            respondents: meta.rows[0].respondents,
            totalInvited: meta.rows[0].total_invited,
            birthYearDistribution: meta.rows[0].birth_year_distribution,
            childGenderDistribution: meta.rows[0].child_gender_distribution,
            parentGenderDistribution: meta.rows[0].parent_gender_distribution,
          }
        : null,
      means: means.rows.map((m) => ({
        question: m.question,
        area: m.area,
        gr: m.mean_gr,
        goteborg: m.mean_goteborg,
        district: m.mean_district,
        school: m.mean_school,
        normalized: normalize(m.mean_school, report.year, m.question),
        history: m.historical_means,
      })),
      responses: responses.rows.map((r) => ({
        question: r.question,
        stronglyAgree: r.pct_strongly_agree,
        agree: r.pct_agree,
        neither: r.pct_neither,
        disagree: r.pct_disagree,
        stronglyDisagree: r.pct_strongly_disagree,
        dontKnow: r.pct_dont_know,
      })),
      genderSplit: gender.rows.map((g) => ({
        question: g.question,
        total: g.pct_total,
        flicka: g.pct_flicka,
        pojke: g.pct_pojke,
      })),
      importantQuestions: important.rows.map((i) => ({
        question: i.question,
        rank: i.rank,
        pct: i.pct,
      })),
      unitMeans: units.rows.map((u) => ({
        unit: u.unit_name,
        area: u.area,
        mean: u.mean_value,
      })),
    };

    // Build relatedReports: sibling reports (same school_id) + XLS parent/children
    const related: Array<{ reportId: number; reportType: string; unitName: string | null; schoolName: string }> = [];
    const siblings = reportsBySchoolId.get(`${report.school_id}-${report.year}`) || [];
    for (const sib of siblings) {
      if (sib.reportId !== report.id) related.push(sib);
    }
    // If this is a parent school, include XLS children
    const xlsChildren = xlsParentToChildren.get(`${report.school_id}-${report.year}`) || [];
    for (const child of xlsChildren) related.push(child);
    // If this is an XLS child, include parent and other siblings
    const parentInfo = xlsChildToParent.get(report.school_id);
    if (parentInfo) {
      const parentReports = reportsBySchoolId.get(`${parentInfo.parentSchoolId}-${parentInfo.year}`) || [];
      for (const pr of parentReports) {
        if (!related.some((r) => r.reportId === pr.reportId)) related.push(pr);
      }
      const otherChildren = xlsParentToChildren.get(`${parentInfo.parentSchoolId}-${parentInfo.year}`) || [];
      for (const oc of otherChildren) {
        if (oc.reportId !== report.id && !related.some((r) => r.reportId === oc.reportId)) related.push(oc);
      }
    }
    if (related.length > 0) (detail as Record<string, unknown>).relatedReports = related;

    await writeJson(join(DATA_DIR, "detail", `${report.id}.json`), detail);
    fileCount++;
  }

  console.log(`Exported ${fileCount} detail files`);
}

async function main() {
  await ensureSchema();

  console.log("Exporting data to JSON...\n");

  await exportIndex();
  await exportAreaSchools();
  await exportDetails();

  console.log("\nExport complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
