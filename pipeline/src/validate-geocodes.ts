/**
 * Validate and correct geocoded school coordinates.
 *
 * Re-geocodes address-like names via Nominatim structured search,
 * which is more accurate than free-text for street addresses.
 *
 * Run: npm run geocode:validate
 * Dry run: npm run geocode:validate -- --dry-run
 */
import "dotenv/config";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const USER_AGENT = "forskoleenkaten-gbg/1.0";
const CORRECTION_THRESHOLD_KM = 0.5;

const dryRun = process.argv.includes("--dry-run");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Haversine distance in kilometers between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Nominatim structured search — more accurate for street addresses. */
async function nominatimStructuredSearch(
  street: string,
  city: string,
): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    street,
    city,
    country: "Sweden",
    format: "json",
    limit: "1",
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    console.error(`  Nominatim HTTP ${res.status} for street="${street}"`);
    return null;
  }

  const data: NominatimResult[] = await res.json();
  if (data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// ── Structured re-geocoding for address-like names ─────────

async function structuredReGeocode(): Promise<number> {
  console.log("=== Structured re-geocode for address-like names ===\n");

  // Get schools with an address and coordinates
  const result = await query<{ id: number; clean_name: string; address: string; lat: number; lng: number }>(
    `SELECT id, clean_name, address, lat, lng
     FROM schools
     WHERE lat IS NOT NULL AND address IS NOT NULL
     ORDER BY clean_name`,
  );

  console.log(`${result.rows.length} address-like names to check.\n`);

  let corrections = 0;

  for (const row of result.rows) {
    const structuredResult = await nominatimStructuredSearch(row.address, "Göteborg");

    if (structuredResult) {
      const dist = haversineKm(row.lat, row.lng, structuredResult.lat, structuredResult.lng);

      if (dist > CORRECTION_THRESHOLD_KM) {
        console.log(
          `CORRECTION: "${row.clean_name}" — stored (${row.lat}, ${row.lng}) vs structured (${structuredResult.lat}, ${structuredResult.lng}) — ${dist.toFixed(2)}km apart`,
        );

        if (!dryRun) {
          await query(
            `UPDATE schools SET lat = $1, lng = $2 WHERE id = $3`,
            [structuredResult.lat, structuredResult.lng, row.id],
          );
          console.log(`  -> Updated`);
        }

        corrections++;
      }
    }

    await sleep(1100);
  }

  console.log(
    `\n${corrections} names corrected${dryRun ? " (dry run)" : ""}.\n`,
  );
  return corrections;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  await ensureSchema();

  if (dryRun) {
    console.log("** DRY RUN — no database changes will be made **\n");
  }

  const corrections = await structuredReGeocode();

  console.log(`Done. Total corrections: ${corrections} names.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
