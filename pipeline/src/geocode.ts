/**
 * Geocode schools using Nominatim (OpenStreetMap).
 * Run: npm run geocode
 */
import "dotenv/config";
import { query } from "./db.js";
import pool from "./db.js";
import { ensureSchema } from "./db.js";

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

async function geocodeSchool(cleanName: string, address: string | null, areaName: string): Promise<{ lat: number; lng: number } | null> {
  // Strategy 1: If we have an extracted address, search that directly
  if (address) {
    const result = await nominatimSearch(`${address}, Göteborg`);
    if (result) return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    await sleep(1100);
  }

  // Strategy 2: Strip "förskola"/"förskolan" suffix, search with Göteborg
  const stripped = cleanName.replace(/\s*(förskolan?)\s*$/i, "").trim();
  if (stripped !== cleanName) {
    const result = await nominatimSearch(`${stripped} förskola, Göteborg`);
    if (result) return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    await sleep(1100);
  }

  // Strategy 3: Full clean name + Göteborg
  const result2 = await nominatimSearch(`${cleanName}, Göteborg`);
  if (result2) return { lat: parseFloat(result2.lat), lng: parseFloat(result2.lon) };
  await sleep(1100);

  // Strategy 4: Name + area name + Göteborg
  const result3 = await nominatimSearch(`${cleanName}, ${areaName}, Göteborg`);
  if (result3) return { lat: parseFloat(result3.lat), lng: parseFloat(result3.lon) };

  return null;
}

async function main() {
  await ensureSchema();

  // Find schools that still need geocoding
  const needGeocoding = await query(
    `SELECT s.id, s.clean_name, s.address,
            (SELECT a.name FROM pdf_reports pr JOIN areas a ON pr.area_id = a.id
             WHERE pr.school_id = s.id LIMIT 1) as area_name
     FROM schools s
     WHERE s.lat IS NULL
     ORDER BY s.clean_name`,
  );

  console.log(`${needGeocoding.rows.length} schools to geocode.\n`);

  let found = 0;
  let notFound = 0;

  for (const row of needGeocoding.rows) {
    console.log(`Geocoding: ${row.clean_name} (${row.area_name})...`);

    const coords = await geocodeSchool(row.clean_name, row.address, row.area_name || "Göteborg");

    if (coords) {
      await query(
        `UPDATE schools SET lat = $1, lng = $2 WHERE id = $3`,
        [coords.lat, coords.lng, row.id],
      );
      console.log(`  -> ${coords.lat}, ${coords.lng}`);
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
