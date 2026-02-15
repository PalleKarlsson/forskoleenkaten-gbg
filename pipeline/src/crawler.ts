/**
 * Crawls enkater.goteborg.se to discover PDF URLs.
 * Breadth-first: year → areas → schools → PDFs
 * Run: npm run crawl
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const BASE_URL = "https://enkater.goteborg.se";
const DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// URL building is now inline in each discover function

/** Extract links from a listing page. Returns [{name, path}] */
function parseLinks(html: string): Array<{ name: string; href: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ name: string; href: string }> = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const name = $(el).text().trim();
    if (name && href) {
      links.push({ name, href });
    }
  });
  return links;
}

/** Discover available years from the home page and category pages */
async function discoverYears(): Promise<number[]> {
  const years: number[] = [];

  // 1. Check Default.aspx for links containing year in kat= parameter
  const html = await fetchPage(`${BASE_URL}/Default.aspx`);
  const $ = cheerio.load(html);

  // Links like href="ListEnkater.aspx?kat=2025%5cBARN__FORSKOLA"
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/kat=(\d{4})/);
    if (match) years.push(parseInt(match[1], 10));
  });

  // onclick handlers: openPage(2024) or window.open('...?Kat=2024', ...)
  $("[onclick]").each((_, el) => {
    const onclick = $(el).attr("onclick") || "";
    const m1 = onclick.match(/openPage\((\d{4})\)/);
    if (m1) years.push(parseInt(m1[1], 10));
    const m2 = onclick.match(/Kat=(\d{4})/);
    if (m2) years.push(parseInt(m2[1], 10));
  });

  // Also check .ImageYearText elements that contain plain year numbers
  $(".ImageYearText, .ImageYearTextArkiv").each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(/^(\d{4})$/);
    if (m) years.push(parseInt(m[1], 10));
  });

  // 2. If we found some years, also check a category page for the full year nav
  if (years.length > 0) {
    const sampleYear = Math.max(...years);
    await sleep(DELAY_MS);
    try {
      const catHtml = await fetchPage(
        `${BASE_URL}/ListEnkater.aspx?kat=${sampleYear}%5cBARN__F%c3%96RSKOLA`,
      );
      const $cat = cheerio.load(catHtml);
      $cat("[onclick]").each((_, el) => {
        const onclick = $cat(el).attr("onclick") || "";
        const m1 = onclick.match(/openPage\((\d{4})\)/);
        if (m1) years.push(parseInt(m1[1], 10));
        const m2 = onclick.match(/Kat=(\d{4})/);
        if (m2) years.push(parseInt(m2[1], 10));
      });
      $cat(".ImageYearText, .ImageYearTextArkiv").each((_, el) => {
        const text = $cat(el).text().trim();
        const m = text.match(/^(\d{4})$/);
        if (m) years.push(parseInt(m[1], 10));
      });
    } catch {
      // Non-critical — we still have years from Default.aspx
    }
  }

  // 3. Fallback: hardcode known range if nothing found
  if (years.length === 0) {
    console.log("  Warning: could not discover years, using known range 2007-2025");
    for (let y = 2025; y >= 2007; y--) years.push(y);
  }

  const unique = [...new Set(years)].sort((a, b) => b - a);
  // Only include years where preschool data exists (BARN__FÖRSKOLA category)
  // We'll verify during crawl — some years may have different category names
  return unique;
}

/**
 * Extract the raw slug from the last segment of a kat= parameter.
 * Keeps URL encoding intact so we can rebuild URLs correctly.
 */
function extractRawSlug(href: string): string {
  const match = href.match(/kat=(.+)$/);
  if (!match) return "";
  const raw = match[1];
  // Split by encoded or literal backslash
  const parts = raw.split(/(?:%5[cC]|\\)/);
  return parts[parts.length - 1] || "";
}

/** Filter out breadcrumb and navigation links */
function isContentLink(link: { name: string; href: string }): boolean {
  if (!link.href.includes("ListEnkater.aspx")) return false;
  if (link.name.includes(">>") || link.name.includes("›")) return false;
  if (link.href.includes("Default.aspx")) return false;
  return true;
}

/**
 * Discover the preschool category paths for a given year.
 * The year page lists categories — we find all that match preschool (förskola).
 * Years 2007-2009, 2011 have two separate categories:
 *   BARN__FÖRSKOLA (children's surveys) and FÖRÄLDRAR__FÖRSKOLA (parent surveys).
 * Years 2012+ have a single combined BARN__FÖRSKOLA category.
 * Returns array of raw kat= values, e.g. ["2011%5cBARN__F%c3%96RSKOLA", "2011%5cF%c3%96R%c3%84LDRAR__F%c3%96RSKOLA"]
 */
async function discoverPreschoolCategoryPaths(year: number): Promise<string[]> {
  const url = `${BASE_URL}/ListEnkater.aspx?Kat=${year}`;
  const html = await fetchPage(url);
  const links = parseLinks(html);
  const paths: string[] = [];

  for (const link of links) {
    // Look for preschool category links (contains "förskola" in text)
    if (
      link.name.toLowerCase().includes("förskola") &&
      link.href.includes("ListEnkater.aspx")
    ) {
      const match = link.href.match(/kat=(.+)$/i);
      if (match) paths.push(match[1]);
    }
  }

  return paths;
}

/** Discover areas for a given year */
async function discoverAreas(
  year: number,
  catPath: string,
): Promise<Array<{ name: string; slug: string }>> {
  const url = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}`;
  const html = await fetchPage(url);
  const links = parseLinks(html);

  return links
    .filter(isContentLink)
    .map((l) => {
      const slug = extractRawSlug(l.href);
      const name = l.name.replace(/^-\s*/, "").replace(/\s*-$/, "").trim();
      return { name, slug };
    })
    .filter((a) => a.name && a.slug && !a.name.match(/^\d{4}$/));
}

/** Discover schools for a given year + area */
async function discoverSchools(
  catPath: string,
  areaSlug: string,
): Promise<Array<{ name: string; slug: string }>> {
  const url = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}%5c${areaSlug}`;
  const html = await fetchPage(url);
  const links = parseLinks(html);

  return links
    .filter(isContentLink)
    .map((l) => {
      const slug = extractRawSlug(l.href);
      return { name: l.name.trim(), slug };
    })
    .filter((s) => s.name && s.slug && !s.name.match(/^\d{4}$/));
}

/** Parse PDF links from an already-fetched HTML page */
function parsePdfLinksFromHtml(
  html: string,
  schoolSlug: string,
): Array<{ name: string; url: string; reportType: string; unitName: string | null }> {
  const links = parseLinks(html);

  return links
    .filter((l) => /\.(pdf|xlsx?)$/i.test(l.href))
    .map((l) => {
      // Normalize URL: backslashes to forward slashes, encode properly
      const pdfPath = l.href.replace(/\\/g, "/");
      const pdfUrl = pdfPath.startsWith("http")
        ? pdfPath
        : `${BASE_URL}/${pdfPath}`;

      // Determine report type from filename
      const filename = decodeURIComponent(pdfPath.split("/").pop() || "");
      const decodedSchoolSlug = decodeURIComponent(schoolSlug.replace(/\+/g, " "));
      const baseName = filename
        .replace(/_uppsk(?:alning)?\.pdf$/i, "")
        .replace(/\.(pdf|xlsx?)$/i, "")
        .trim();
      let reportType = "school";
      let unitName: string | null = null;

      if (filename.includes("(total)")) {
        reportType = "total";
      } else if (
        baseName.toLowerCase() !== decodedSchoolSlug.toLowerCase() &&
        !baseName.toLowerCase().startsWith(decodedSchoolSlug.toLowerCase())
      ) {
        reportType = "unit";
        unitName = baseName;
      }

      return { name: l.name, url: pdfUrl, reportType, unitName };
    });
}

/** Discover PDF links for a given school */
async function discoverPdfs(
  catPath: string,
  areaSlug: string,
  schoolSlug: string,
): Promise<Array<{ name: string; url: string; reportType: string; unitName: string | null }>> {
  const url = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}%5c${areaSlug}%5c${schoolSlug}`;
  const html = await fetchPage(url);
  return parsePdfLinksFromHtml(html, schoolSlug);
}

/**
 * Parse school and unit name from flat-hierarchy PDF link text.
 * Link text patterns:
 *   2023: "GR, Göteborg, Centrum 1, Borgaregatan 5 förskola, Grodan"
 *   2020: "Borgaregatan 5 förskola, Grodan"
 * Returns { schoolName, unitName } or null if it's a summary PDF.
 */
function parseSchoolFromLinkText(linkText: string): { schoolName: string; unitName: string | null } | null {
  // Format 1 (2020): "GR-Göteborg-Centrum 1-Albotorget 5-Junibacken_2020.pdf"
  // Dashes as separators, _YYYY suffix
  const dashMatch = linkText.match(/^GR-[^-]+-[^-]+-(.+?)(?:_\d{4})?\.pdf$/i);
  if (dashMatch) {
    const remainder = dashMatch[1]; // "Albotorget 5-Junibacken" or "Albotorget 5"
    const dashParts = remainder.split("-");
    const schoolName = dashParts[0].trim();
    const unitName = dashParts.length >= 2 ? dashParts.slice(1).join("-").trim() : null;
    return { schoolName, unitName };
  }

  // Format 2 (2023): "GR, Göteborg, Centrum 1, Borgaregatan 5 förskola, Grodan"
  // Commas as separators
  const parts = linkText.split(",").map((s) => s.trim());

  // Skip pure summary PDFs (e.g., "Göteborg, GR" or "Göteborgsregionen 2020")
  if (parts.length <= 2) {
    const combined = parts.join(" ").toLowerCase();
    if (combined.includes("göteborg") || /\bgr\b/.test(combined) || combined.includes("göteborgsregionen")) return null;
  }

  // "GR, Göteborg, Area, School, Unit" format (5+ parts)
  if (parts.length >= 4 && parts[0].toLowerCase() === "gr") {
    const schoolName = parts[3];
    const unitName = parts.length >= 5 ? parts.slice(4).join(", ") : null;
    return { schoolName, unitName };
  }

  // "School, Unit" format (2-3 parts, no GR prefix)
  if (parts.length >= 1) {
    return { schoolName: parts[0], unitName: parts.length >= 2 ? parts.slice(1).join(", ") : null };
  }

  return null;
}

/**
 * Discover PDFs directly at the area level (flat hierarchy for 2020-2023).
 * Groups PDFs by school name extracted from link text.
 * Returns map of schoolName → PDF list.
 */
async function discoverAreaPdfs(
  catPath: string,
  areaSlug: string,
): Promise<Map<string, Array<{ name: string; url: string; reportType: string; unitName: string | null }>>> {
  const url = `${BASE_URL}/ListEnkater.aspx?kat=${catPath}%5c${areaSlug}`;
  const html = await fetchPage(url);
  const links = parseLinks(html);
  const pdfLinks = links.filter((l) => /\.(pdf|xlsx?)$/i.test(l.href));

  const schoolMap = new Map<string, Array<{ name: string; url: string; reportType: string; unitName: string | null }>>();

  for (const l of pdfLinks) {
    const pdfPath = l.href.replace(/\\/g, "/");
    const pdfUrl = pdfPath.startsWith("http") ? pdfPath : `${BASE_URL}/${pdfPath}`;

    // Skip PDFs in the 2__RAPPORTER summary directory
    if (pdfPath.includes("2__RAPPORTER") || pdfPath.includes("2__rapporter")) {
      continue;
    }

    const parsed = parseSchoolFromLinkText(l.name.trim());
    if (!parsed) continue;

    const { schoolName, unitName } = parsed;
    const reportType = unitName ? "unit" : "school";

    if (!schoolMap.has(schoolName)) {
      schoolMap.set(schoolName, []);
    }
    schoolMap.get(schoolName)!.push({
      name: l.name,
      url: pdfUrl,
      reportType,
      unitName,
    });
  }

  return schoolMap;
}

async function crawlYear(year: number, force: boolean) {
  // Check if already crawled
  const existing = await query(
    "SELECT crawled_at FROM survey_years WHERE year = $1",
    [year],
  );
  if (existing.rows.length > 0 && existing.rows[0].crawled_at && !force) {
    console.log(`  Year ${year} already crawled, skipping (use --force to re-crawl)`);
    return;
  }

  // Upsert year
  await query(
    `INSERT INTO survey_years (year) VALUES ($1) ON CONFLICT (year) DO NOTHING`,
    [year],
  );

  // Discover the preschool category paths for this year
  console.log(`  Discovering preschool categories for ${year}...`);
  await sleep(DELAY_MS);
  const catPaths = await discoverPreschoolCategoryPaths(year);
  if (catPaths.length === 0) {
    console.log(`  No preschool category found for ${year}, skipping`);
    return;
  }
  console.log(`  Category paths: ${catPaths.join(", ")}`);

  // Collect areas from all category paths (e.g. BARN__FÖRSKOLA + FÖRÄLDRAR__FÖRSKOLA)
  const allAreas: Array<{ name: string; slug: string; catPath: string }> = [];
  for (const catPath of catPaths) {
    console.log(`  Discovering areas for ${year} (${catPath})...`);
    await sleep(DELAY_MS);
    const areas = await discoverAreas(year, catPath);
    for (const area of areas) {
      allAreas.push({ ...area, catPath });
    }
  }
  const areas = allAreas;
  console.log(`  Found ${areas.length} areas`);

  for (const area of areas) {
    // Upsert area
    const areaResult = await query(
      `INSERT INTO areas (year, name, url_slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (year, url_slug) DO UPDATE SET name = $2
       RETURNING id`,
      [year, area.name, decodeURIComponent(area.slug.replace(/\+/g, " "))],
    );
    const areaId = areaResult.rows[0].id;

    // Fetch area page to check both school links and direct PDFs
    await sleep(DELAY_MS);
    const areaPageUrl = `${BASE_URL}/ListEnkater.aspx?kat=${area.catPath}%5c${area.slug}`;
    let areaPageHtml: string;
    try {
      areaPageHtml = await fetchPage(areaPageUrl);
    } catch (err) {
      console.error(`    ERROR fetching area page for ${area.name}: ${err}`);
      continue;
    }

    // Check for school sub-folder links
    const schoolLinks = parseLinks(areaPageHtml)
      .filter(isContentLink)
      .map((l) => ({
        name: l.name.replace(/^-\s*/, "").replace(/\s*-$/, "").trim(),
        slug: extractRawSlug(l.href),
      }))
      .filter((s) => s.name && s.slug && !s.name.match(/^\d{4}$/));

    // Check for direct PDF links at area level
    const areaPdfLinks = parseLinks(areaPageHtml).filter((l) =>
      /\.(pdf|xlsx?)$/i.test(l.href),
    );

    // Decide strategy: use flat hierarchy if there are significantly more
    // direct PDFs than school sub-folders, or if there are no schools
    const useFlat = schoolLinks.length === 0 || areaPdfLinks.length > schoolLinks.length * 5;

    if (!useFlat && schoolLinks.length > 0) {
      // Standard hierarchy: area → school folders → PDFs
      console.log(`    ${area.name}: ${schoolLinks.length} schools`);

      for (const school of schoolLinks) {
        try {
          const schoolResult = await query(
            `INSERT INTO schools (area_id, name, url_slug)
             VALUES ($1, $2, $3)
             ON CONFLICT (area_id, url_slug) DO UPDATE SET name = $2
             RETURNING id`,
            [areaId, school.name, school.slug],
          );
          const schoolId = schoolResult.rows[0].id;

          await sleep(DELAY_MS);
          const pdfs = await discoverPdfs(area.catPath, area.slug, school.slug);

          for (const pdf of pdfs) {
            await query(
              `INSERT INTO pdf_reports (school_id, year, report_type, unit_name, pdf_url)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (pdf_url) DO NOTHING`,
              [schoolId, year, pdf.reportType, pdf.unitName, pdf.url],
            );
          }
        } catch (err) {
          console.error(`      ERROR crawling ${school.name}: ${err}`);
        }
      }
    } else {
      // Flat hierarchy: PDFs directly at area level
      console.log(`    ${area.name}: flat hierarchy (${areaPdfLinks.length} PDFs at area level)`);
      try {
        // Parse PDFs from the already-fetched HTML
        const schoolMap = new Map<string, Array<{ name: string; url: string; reportType: string; unitName: string | null }>>();

        for (const l of areaPdfLinks) {
          const pdfPath = l.href.replace(/\\/g, "/");
          const pdfUrl = pdfPath.startsWith("http") ? pdfPath : `${BASE_URL}/${pdfPath}`;

          if (pdfPath.includes("2__RAPPORTER") || pdfPath.includes("2__rapporter")) continue;

          const parsed = parseSchoolFromLinkText(l.name.trim());
          if (!parsed) continue;

          const { schoolName, unitName } = parsed;
          const reportType = unitName ? "unit" : "school";

          if (!schoolMap.has(schoolName)) {
            schoolMap.set(schoolName, []);
          }
          schoolMap.get(schoolName)!.push({ name: l.name, url: pdfUrl, reportType, unitName });
        }

        let pdfCount = 0;
        for (const [schoolName, pdfs] of schoolMap) {
          const schoolResult = await query(
            `INSERT INTO schools (area_id, name, url_slug)
             VALUES ($1, $2, $3)
             ON CONFLICT (area_id, url_slug) DO UPDATE SET name = $2
             RETURNING id`,
            [areaId, schoolName, schoolName],
          );
          const schoolId = schoolResult.rows[0].id;

          for (const pdf of pdfs) {
            await query(
              `INSERT INTO pdf_reports (school_id, year, report_type, unit_name, pdf_url)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (pdf_url) DO NOTHING`,
              [schoolId, year, pdf.reportType, pdf.unitName, pdf.url],
            );
            pdfCount++;
          }
        }
        console.log(`      Found ${schoolMap.size} schools, ${pdfCount} PDFs`);
      } catch (err) {
        console.error(`    ERROR discovering area PDFs for ${area.name}: ${err}`);
      }
    }
  }

  // Mark year as crawled
  await query(
    `UPDATE survey_years SET crawled_at = NOW() WHERE year = $1`,
    [year],
  );
  console.log(`  Year ${year} crawl complete.`);
}

async function main() {
  await ensureSchema();

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const yearArg = args.find((a) => /^\d{4}$/.test(a));

  if (yearArg) {
    const year = parseInt(yearArg, 10);
    console.log(`Crawling year ${year}...`);
    await crawlYear(year, force);
  } else {
    console.log("Discovering available years...");
    const years = await discoverYears();
    console.log(`Found years: ${years.join(", ")}`);

    for (const year of years) {
      console.log(`\nCrawling ${year}...`);
      await crawlYear(year, force);
    }
  }

  const { rows } = await query("SELECT count(*) as n FROM pdf_reports");
  console.log(`\nTotal PDF reports discovered: ${rows[0].n}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Crawl failed:", err);
  process.exit(1);
});
