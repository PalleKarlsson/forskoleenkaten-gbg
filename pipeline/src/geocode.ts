/**
 * Geocode schools using Nominatim (OpenStreetMap).
 * Run: npm run geocode
 */
import "dotenv/config";
import { query } from "./db.js";
import pool from "./db.js";
import { ensureSchema } from "./db.js";
import { cleanSchoolName } from "./normalize.js";

const USER_AGENT = "forskoleenkaten-gbg/1.0";
const VIEWBOX = "11.5,57.5,12.3,58.1";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function nominatimSearch(q: string): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    viewbox: VIEWBOX,
    bounded: "1",
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    console.error(`  Nominatim HTTP ${res.status} for: ${q}`);
    return null;
  }

  const data: NominatimResult[] = await res.json();
  return data.length > 0 ? data[0] : null;
}

async function geocodeSchool(name: string, areaName: string): Promise<{ lat: number; lng: number } | null> {
  // Clean name before geocoding (strip .pdf, trailing förskola/fsk)
  const cleaned = cleanSchoolName(name);

  // Strategy 1: Strip "förskola"/"förskolan" suffix, search with Göteborg
  const stripped = cleaned.replace(/\s*(förskolan?)\s*$/i, "").trim();
  if (stripped !== cleaned) {
    const result = await nominatimSearch(`${stripped} förskola, Göteborg`);
    if (result) return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    await sleep(1100);
  }

  // Strategy 2: Full name + Göteborg
  const result2 = await nominatimSearch(`${cleaned}, Göteborg`);
  if (result2) return { lat: parseFloat(result2.lat), lng: parseFloat(result2.lon) };
  await sleep(1100);

  // Strategy 3: Name + area name + Göteborg
  const result3 = await nominatimSearch(`${cleaned}, ${areaName}, Göteborg`);
  if (result3) return { lat: parseFloat(result3.lat), lng: parseFloat(result3.lon) };

  return null;
}

async function main() {
  await ensureSchema();

  // Step 1: Propagate existing coordinates to schools with the same name
  const propagated = await query(
    `UPDATE schools s
     SET lat = src.lat, lng = src.lng
     FROM (
       SELECT DISTINCT ON (name) name, lat, lng
       FROM schools
       WHERE lat IS NOT NULL
     ) src
     WHERE s.name = src.name AND s.lat IS NULL`,
  );
  console.log(`Propagated coordinates to ${propagated.rowCount} schools from existing data.`);

  // Step 2: Find unique school names that still need geocoding
  const needGeocoding = await query(
    `SELECT DISTINCT s.name, MIN(a.name) as area_name
     FROM schools s
     JOIN areas a ON s.area_id = a.id
     WHERE s.lat IS NULL
     GROUP BY s.name
     ORDER BY s.name`,
  );

  console.log(`\n${needGeocoding.rows.length} unique school names to geocode.\n`);

  let found = 0;
  let notFound = 0;

  for (const row of needGeocoding.rows) {
    console.log(`Geocoding: ${row.name} (${row.area_name})...`);

    const coords = await geocodeSchool(row.name, row.area_name);

    if (coords) {
      const updated = await query(
        `UPDATE schools SET lat = $1, lng = $2 WHERE name = $3 AND lat IS NULL`,
        [coords.lat, coords.lng, row.name],
      );
      console.log(`  -> ${coords.lat}, ${coords.lng} (updated ${updated.rowCount} rows)`);
      found++;
    } else {
      console.log(`  -> NOT FOUND`);
      notFound++;
    }

    await sleep(1100);
  }

  console.log(`\nDone. Found: ${found}, Not found: ${notFound}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Geocoding failed:", err);
  process.exit(1);
});
