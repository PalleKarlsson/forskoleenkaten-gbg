/**
 * Downloads PDFs where downloaded_at IS NULL.
 * Saves to data/pdfs/{year}/{area}/{school}/
 * Run: npm run download
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const DATA_DIR = join(dirname(new URL(import.meta.url).pathname), "../../data/pdfs");
const DELAY_MS = 300;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function downloadPdf(
  url: string,
  retries = MAX_RETRIES,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          console.log(`    Retry ${attempt}/${retries} after ${res.status}...`);
          await sleep(DELAY_MS * attempt * 2);
          continue;
        }
        throw new Error(`HTTP ${res.status} after ${retries} retries`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      if (attempt < retries) {
        console.log(`    Retry ${attempt}/${retries}: ${err}`);
        await sleep(DELAY_MS * attempt * 2);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

async function main() {
  await ensureSchema();

  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const yearArg = args.find((a) => /^\d{4}$/.test(a));

  let sql = `
    SELECT pr.id, pr.pdf_url, pr.year,
           a.name as area_name, a.url_slug as area_slug,
           s.name as school_name, s.url_slug as school_slug
    FROM pdf_reports pr
    JOIN schools s ON pr.school_id = s.id
    JOIN areas a ON s.area_id = a.id
    WHERE pr.downloaded_at IS NULL
  `;
  const params: unknown[] = [];

  if (yearArg) {
    params.push(parseInt(yearArg, 10));
    sql += ` AND pr.year = $${params.length}`;
  }

  sql += " ORDER BY pr.year DESC, a.name, s.name";

  if (limit) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await query(sql, params);
  console.log(`Found ${rows.length} PDFs to download`);

  let downloaded = 0;
  let errors = 0;

  for (const row of rows) {
    const dir = join(
      DATA_DIR,
      String(row.year),
      slugify(row.area_slug),
      slugify(row.school_slug),
    );
    await mkdir(dir, { recursive: true });

    const urlFilename = row.pdf_url.split("/").pop() || "";
    const ext = urlFilename.match(/\.(pdf|xlsx?)$/i)?.[0] || ".pdf";
    const filename = urlFilename || `report-${row.id}${ext}`;
    const localPath = join(dir, decodeURIComponent(filename));

    try {
      console.log(`  [${downloaded + 1}/${rows.length}] ${row.school_name} (${row.year})`);
      const data = await downloadPdf(row.pdf_url);
      await writeFile(localPath, data);

      await query(
        `UPDATE pdf_reports SET downloaded_at = NOW(), local_path = $1 WHERE id = $2`,
        [localPath, row.id],
      );
      downloaded++;
    } catch (err) {
      console.error(`  ERROR: ${err}`);
      await query(
        `UPDATE pdf_reports SET parse_error = $1 WHERE id = $2`,
        [`Download failed: ${err}`, row.id],
      );
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDownloaded: ${downloaded}, Errors: ${errors}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Download failed:", err);
  process.exit(1);
});
