/**
 * Import manually provided addresses, geocode them via Nominatim, and update the database.
 * Run: npm run geocode:import
 *
 * Reads: data/missing-coords.tsv (tab-separated)
 * Expected columns: name, area_name, address
 * Rows with empty address are skipped.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(__dirname, "../../data/missing-coords.tsv");

const USER_AGENT = "forskoleenkaten-gbg/1.0";
const VIEWBOX = "11.5,57.5,12.3,58.1";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    viewbox: VIEWBOX,
    bounded: "1",
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    console.error(`  Nominatim HTTP ${res.status}`);
    return null;
  }

  const data: Array<{ lat: string; lon: string }> = await res.json();
  if (data.length === 0) return null;

  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function main() {
  await ensureSchema();

  const content = readFileSync(TSV_PATH, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const dataLines = lines.slice(1);

  let geocoded = 0;
  let failed = 0;
  let skipped = 0;

  for (const line of dataLines) {
    const parts = line.split("\t");
    const name = parts[0]?.trim();
    const address = parts[2]?.trim();

    if (!name || !address) {
      skipped++;
      continue;
    }

    // Append ", Göteborg" if not already present
    const searchAddress = /göteborg/i.test(address) ? address : `${address}, Göteborg`;

    const coords = await geocodeAddress(searchAddress);

    if (coords) {
      const result = await query(
        `UPDATE schools SET lat = $1, lng = $2 WHERE clean_name = $3 AND lat IS NULL`,
        [coords.lat, coords.lng, name],
      );
      console.log(`${name} -> ${coords.lat}, ${coords.lng} (${result.rowCount} rows)`);
      geocoded++;
    } else {
      console.log(`${name} -> NOT FOUND (searched: "${searchAddress}")`);
      failed++;
    }

    await sleep(1100);
  }

  console.log(`\nDone. Geocoded: ${geocoded}, Not found: ${failed}, Skipped (no address): ${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
