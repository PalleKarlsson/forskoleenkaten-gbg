/**
 * Test script: for each discovered year, crawl one school, download its PDF,
 * and run the parser to verify the pipeline works across years.
 *
 * This does NOT write to the database — it's a dry-run diagnostic.
 * Run: npx tsx src/test-years.ts
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseTables, extractLayoutText } from "./parser/tables.js";
import { extractTextItems } from "./parser/pdf-text.js";
import {
  parseResponseDistributions,
  parseGenderSplits,
  parseDemographics,
  parseImportantQuestions,
  parseUnitMeans,
} from "./parser/charts.js";

const BASE_URL = "https://enkater.goteborg.se";
const DELAY_MS = 600;
const TMP_DIR = join(dirname(new URL(import.meta.url).pathname), "../../data/test-pdfs");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseLinks(html: string): Array<{ name: string; href: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ name: string; href: string }> = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const name = $(el).text().trim();
    if (name && href) links.push({ name, href });
  });
  return links;
}

/** Discover available years */
async function discoverYears(): Promise<number[]> {
  const years: number[] = [];
  const html = await fetchPage(`${BASE_URL}/Default.aspx`);
  const $ = cheerio.load(html);

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/kat=(\d{4})/);
    if (match) years.push(parseInt(match[1], 10));
  });

  $("[onclick]").each((_, el) => {
    const onclick = $(el).attr("onclick") || "";
    const m1 = onclick.match(/openPage\((\d{4})\)/);
    if (m1) years.push(parseInt(m1[1], 10));
    const m2 = onclick.match(/Kat=(\d{4})/);
    if (m2) years.push(parseInt(m2[1], 10));
  });

  $(".ImageYearText, .ImageYearTextArkiv").each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(/^(\d{4})$/);
    if (m) years.push(parseInt(m[1], 10));
  });

  return [...new Set(years)].sort((a, b) => b - a);
}

/** Discover the preschool category path for a year */
async function discoverPreschoolCategoryPath(year: number): Promise<string | null> {
  const url = `${BASE_URL}/ListEnkater.aspx?Kat=${year}`;
  const html = await fetchPage(url);
  const links = parseLinks(html);

  for (const link of links) {
    if (
      link.name.toLowerCase().includes("förskola") &&
      link.href.includes("ListEnkater.aspx")
    ) {
      const match = link.href.match(/kat=(.+)$/i);
      if (match) return match[1];
    }
  }
  return null;
}

function extractRawSlug(href: string): string {
  const match = href.match(/kat=(.+)$/);
  if (!match) return "";
  const raw = match[1];
  const parts = raw.split(/(?:%5[cC]|\\)/);
  return parts[parts.length - 1] || "";
}

function isContentLink(link: { name: string; href: string }): boolean {
  if (!link.href.includes("ListEnkater.aspx")) return false;
  if (link.name.includes(">>") || link.name.includes("›")) return false;
  if (link.href.includes("Default.aspx")) return false;
  return true;
}

/** Check if an area name looks like a summary/total entry (not a real geographic area) */
function isSummaryArea(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("(total)") ||
    lower.includes("totalt") ||
    lower.includes("total") ||
    lower.includes("bakgrundsdata") ||
    lower.includes("new folder") ||
    lower.includes("rapporter") ||
    lower.includes("resultat per") ||
    lower.startsWith("00_") ||
    lower.startsWith("-") ||
    lower.startsWith("göteborg") && (lower.includes("gr") || lower.includes("total"))
  );
}


/**
 * Parse school and unit name from flat-hierarchy PDF link text.
 * Patterns: "GR, Göteborg, Centrum 1, School, Unit" or "School, Unit"
 */
function parseSchoolFromLinkText(linkText: string): { schoolName: string; unitName: string | null } | null {
  const parts = linkText.split(",").map((s) => s.trim());
  if (parts.length <= 2) {
    const combined = parts.join(" ").toLowerCase();
    if (combined.includes("göteborg") || combined.includes("gr")) return null;
  }
  if (parts.length >= 4 && parts[0].toLowerCase() === "gr") {
    return { schoolName: parts[3], unitName: parts.length >= 5 ? parts.slice(4).join(", ") : null };
  }
  if (parts.length >= 1) {
    return { schoolName: parts[0], unitName: parts.length >= 2 ? parts.slice(1).join(", ") : null };
  }
  return null;
}

/** Pick a school-level PDF (not a summary/total) from link info */
function pickSchoolPdf(links: Array<{ name: string; href: string }>): { url: string; schoolName: string } | null {
  for (const l of links) {
    // Skip summary directory PDFs
    if (l.href.includes("2__RAPPORTER") || l.href.includes("2__rapporter")) continue;

    const pdfPath = l.href.replace(/\\/g, "/");
    const url = pdfPath.startsWith("http") ? pdfPath : `${BASE_URL}/${pdfPath}`;
    const filename = decodeURIComponent(pdfPath.split("/").pop() || "").toLowerCase();

    // Skip total/summary PDFs (only if that's all the filename is)
    if (filename.includes("(total)") || filename === "göteborg, gr.pdf") continue;

    // Try to extract school name from link text
    const parsed = parseSchoolFromLinkText(l.name.trim());
    if (parsed) {
      return { url, schoolName: parsed.schoolName };
    }

    // Fallback: use filename as school name
    const baseName = decodeURIComponent(pdfPath.split("/").pop() || "")
      .replace(/_uppsk(?:alning)?\.pdf$/i, "")
      .replace(/\.pdf$/i, "")
      .trim();
    if (baseName.length > 3) {
      return { url, schoolName: baseName };
    }
  }
  return null;
}

interface TestResult {
  year: number;
  catPath: string | null;
  areaCount: number | null;
  schoolName: string | null;
  pdfUrl: string | null;
  pdfFormat: string;
  downloaded: boolean;
  parseResult: {
    schoolName: string;
    responseRate: number | null;
    respondents: number | null;
    totalInvited: number | null;
    meansCount: number;
    historicalYears: number[];
    responseDistributions: number;
    genderSplits: number;
    importantQuestions: number;
    unitMeans: number;
    sampleMeans: Array<{ question: string; school: number | null; gr: number | null }>;
  } | null;
  error: string | null;
}

async function testYear(year: number): Promise<TestResult> {
  const result: TestResult = {
    year,
    catPath: null,
    areaCount: null,
    schoolName: null,
    pdfUrl: null,
    pdfFormat: "unknown",
    downloaded: false,
    parseResult: null,
    error: null,
  };

  try {
    // 1. Discover category path
    await sleep(DELAY_MS);
    const catPath = await discoverPreschoolCategoryPath(year);
    result.catPath = catPath;
    if (!catPath) {
      result.error = "No preschool category found";
      return result;
    }

    // 2. Discover areas
    await sleep(DELAY_MS);
    const areaUrl = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}`;
    const areaHtml = await fetchPage(areaUrl);
    const allAreaLinks = parseLinks(areaHtml)
      .filter(isContentLink)
      .map((l) => ({
        name: l.name.replace(/^-\s*/, "").replace(/\s*-$/, "").replace(/\s*∗\s*$/, "").replace(/\s*∧\s*$/, "").replace(/\s*[−–]\s*$/, "").trim(),
        slug: extractRawSlug(l.href),
      }))
      .filter((a) => a.name && a.slug && !a.name.match(/^\d{4}$/));
    result.areaCount = allAreaLinks.length;

    // Also check for PDFs at this category level (some years have them here)
    const catPdfLinks = parseLinks(areaHtml).filter((l) => l.href.toLowerCase().endsWith(".pdf"));

    if (allAreaLinks.length === 0 && catPdfLinks.length === 0) {
      result.error = "No areas or PDFs found";
      return result;
    }

    // Filter out summary/total areas
    const realAreas = allAreaLinks.filter((a) => !isSummaryArea(a.name));
    const areasToTry = realAreas.length > 0 ? realAreas : allAreaLinks;

    let pdfUrl: string | null = null;

    // Try each area until we find a school-level PDF
    for (const area of areasToTry.slice(0, 3)) {
      await sleep(DELAY_MS);
      const areaPageUrl = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}%5c${area.slug}`;
      const areaPageHtml = await fetchPage(areaPageUrl);

      // Strategy 1: Look for school sub-folder links (2024+ structure)
      const schoolLinks = parseLinks(areaPageHtml)
        .filter(isContentLink)
        .map((l) => ({ name: l.name.trim(), slug: extractRawSlug(l.href) }))
        .filter((s) => s.name && s.slug && !s.name.match(/^\d{4}$/) && !isSummaryArea(s.name));

      if (schoolLinks.length > 0) {
        // Found school sub-folders — pick first school, get its PDFs
        const school = schoolLinks[0];
        result.schoolName = school.name;
        await sleep(DELAY_MS);
        const schoolPageUrl = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}%5c${area.slug}%5c${school.slug}`;
        const schoolPageHtml = await fetchPage(schoolPageUrl);
        const pdfLinksOnPage = parseLinks(schoolPageHtml).filter((l) => l.href.toLowerCase().endsWith(".pdf"));
        const picked = pickSchoolPdf(pdfLinksOnPage);
        if (picked) {
          pdfUrl = picked.url;
          break;
        }
      }

      // Strategy 2: Look for PDFs directly at area level (2020-2023 structure)
      const directPdfLinks = parseLinks(areaPageHtml).filter((l) => l.href.toLowerCase().endsWith(".pdf"));
      if (directPdfLinks.length > 0) {
        const picked = pickSchoolPdf(directPdfLinks);
        if (picked) {
          pdfUrl = picked.url;
          result.schoolName = picked.schoolName;
          break;
        }
      }
    }

    if (!pdfUrl) {
      result.error = `No school-level PDFs found in any area`;
      return result;
    }

    result.pdfUrl = pdfUrl;

    // 3. Download the PDF
    await mkdir(TMP_DIR, { recursive: true });
    const pdfFilename = `test-${year}.pdf`;
    const localPath = join(TMP_DIR, pdfFilename);

    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      result.error = `HTTP ${pdfRes.status} downloading PDF`;
      return result;
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    await writeFile(localPath, pdfBuffer);
    result.downloaded = true;

    // 4. Detect PDF format (check scale)
    const layoutText = await extractLayoutText(localPath);

    if (layoutText.includes("sjugradig") || layoutText.includes("1 och 7") || layoutText.includes("Utmärkt")) {
      result.pdfFormat = "old-7point (2016-2018)";
    } else if (layoutText.includes("Scandinfo") || layoutText.includes("ECERS")) {
      result.pdfFormat = "ecers (2007-2015)";
    } else if (layoutText.includes("1 och 5") || layoutText.includes("Instämmer helt")) {
      result.pdfFormat = "new-5point (2019+)";
    } else {
      result.pdfFormat = "unknown";
    }

    // 5. Parse the PDF
    const [tableData, textData] = await Promise.all([
      parseTables(layoutText),
      extractTextItems(localPath),
    ]);

    const distributions = parseResponseDistributions(layoutText);
    const genderSplits = parseGenderSplits(textData.items, {
      startPage: 1,
      endPage: textData.pageCount,
    });
    const important = parseImportantQuestions(layoutText);
    const unitMeans = parseUnitMeans(layoutText);

    result.parseResult = {
      schoolName: tableData.metadata.schoolName,
      responseRate: tableData.metadata.responseRate,
      respondents: tableData.metadata.respondents,
      totalInvited: tableData.metadata.totalInvited,
      meansCount: tableData.means.length,
      historicalYears: tableData.historicalYears,
      responseDistributions: distributions.length,
      genderSplits: genderSplits.length,
      importantQuestions: important.length,
      unitMeans: unitMeans.length,
      sampleMeans: tableData.means.slice(0, 3).map((m) => ({
        question: m.questionText,
        school: m.meanSchool,
        gr: m.meanGr,
      })),
    };
  } catch (err) {
    result.error = `${err}`;
  }

  return result;
}

async function main() {
  console.log("Discovering available years...\n");
  const years = await discoverYears();
  console.log(`Found years: ${years.join(", ")}\n`);

  const results: TestResult[] = [];

  for (const year of years) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Testing year ${year}`);
    console.log("=".repeat(60));

    const result = await testYear(year);
    results.push(result);

    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
    } else if (result.parseResult) {
      const p = result.parseResult;
      console.log(`  Category: ${result.catPath}`);
      console.log(`  Areas: ${result.areaCount}`);
      console.log(`  Format: ${result.pdfFormat}`);
      console.log(`  School: ${result.schoolName}`);
      console.log(`  Response rate: ${p.responseRate ?? "—"}%`);
      console.log(`  Respondents: ${p.respondents ?? "—"}/${p.totalInvited ?? "—"}`);
      console.log(`  Means: ${p.meansCount} questions`);
      console.log(`  Historical years: ${p.historicalYears.join(", ") || "—"}`);
      console.log(`  Response distributions: ${p.responseDistributions}`);
      console.log(`  Gender splits: ${p.genderSplits}`);
      console.log(`  Important questions: ${p.importantQuestions}`);
      console.log(`  Unit means: ${p.unitMeans}`);
      if (p.sampleMeans.length > 0) {
        console.log(`  Sample means:`);
        for (const m of p.sampleMeans) {
          console.log(`    "${m.question}" → school=${m.school}, GR=${m.gr}`);
        }
      }
    }
  }

  // Summary table
  console.log(`\n\n${"=".repeat(90)}`);
  console.log("SUMMARY");
  console.log("=".repeat(90));
  console.log(
    `${"Year".padEnd(6)} ${"Format".padEnd(22)} ${"Areas".padEnd(6)} ${"School".padEnd(30)} ${"Means".padEnd(6)} ${"Resp%".padEnd(6)} ${"Status".padEnd(10)}`,
  );
  console.log("-".repeat(90));

  for (const r of results) {
    if (r.error) {
      console.log(
        `${String(r.year).padEnd(6)} ${"—".padEnd(22)} ${"—".padEnd(6)} ${"—".padEnd(30)} ${"—".padEnd(6)} ${"—".padEnd(6)} FAIL: ${r.error.substring(0, 40)}`,
      );
    } else if (r.parseResult) {
      const p = r.parseResult;
      console.log(
        `${String(r.year).padEnd(6)} ${r.pdfFormat.padEnd(22)} ${String(r.areaCount ?? "—").padEnd(6)} ${(r.schoolName || "—").substring(0, 29).padEnd(30)} ${String(p.meansCount).padEnd(6)} ${(p.responseRate !== null ? `${p.responseRate}%` : "—").padEnd(6)} OK`,
      );
    }
  }

  const ok = results.filter((r) => r.parseResult !== null).length;
  const fail = results.filter((r) => r.error !== null).length;
  const with5pointFormat = results.filter((r) => r.pdfFormat.includes("5point")).length;
  const withMeans = results.filter((r) => r.parseResult && r.parseResult.meansCount > 0).length;
  console.log(`\nTotal: ${ok} downloaded, ${fail} failed, ${with5pointFormat} new-format, ${withMeans} parsed means`);
  console.log(`\nNote: Parser is designed for new-5point format (2019+). Older formats need separate parsers.`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
