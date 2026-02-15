/**
 * Validate and correct geocoded school coordinates.
 *
 * Phase 1: Detect cross-year coordinate conflicts for the same school name
 *          and fix by applying the dominant cluster's centroid.
 * Phase 2: Re-geocode address-like names via Nominatim structured search,
 *          which is more accurate than free-text for street addresses.
 *
 * Run: npm run geocode:validate
 * Dry run: npm run geocode:validate -- --dry-run
 */
import "dotenv/config";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";
import { cleanSchoolName } from "./normalize.js";

const USER_AGENT = "forskoleenkaten-gbg/1.0";
const CONFLICT_THRESHOLD_KM = 1.0;
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

/** True if the cleaned school name looks like a street address (ends with a number). */
function isAddressLike(name: string): boolean {
  const cleaned = cleanSchoolName(name);
  return /\d+\s*[a-zA-Z]?\s*$/.test(cleaned);
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

interface SchoolRow {
  id: number;
  name: string;
  year: number;
  lat: number;
  lng: number;
}

interface Cluster {
  lat: number;
  lng: number;
  count: number;
  ids: number[];
}

/** Group coordinates into clusters separated by more than thresholdKm. */
function clusterCoordinates(
  rows: Array<{ id: number; lat: number; lng: number }>,
  thresholdKm: number,
): Cluster[] {
  const clusters: Cluster[] = [];

  for (const row of rows) {
    let added = false;
    for (const cluster of clusters) {
      const centroidLat = cluster.lat / cluster.count;
      const centroidLng = cluster.lng / cluster.count;
      if (haversineKm(centroidLat, centroidLng, row.lat, row.lng) < thresholdKm) {
        cluster.lat += row.lat;
        cluster.lng += row.lng;
        cluster.count++;
        cluster.ids.push(row.id);
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({ lat: row.lat, lng: row.lng, count: 1, ids: [row.id] });
    }
  }

  return clusters;
}

// ── Phase 1: Cross-year conflict detection ──────────────────────────

async function phase1ConflictDetection(): Promise<number> {
  console.log("=== Phase 1: Cross-year conflict detection ===\n");

  const result = await query<SchoolRow>(
    `SELECT s.id, s.name, a.year, s.lat, s.lng
     FROM schools s
     JOIN areas a ON s.area_id = a.id
     WHERE s.lat IS NOT NULL
     ORDER BY s.name, a.year`,
  );

  // Group by name
  const byName = new Map<string, Array<{ id: number; lat: number; lng: number }>>();
  for (const row of result.rows) {
    const existing = byName.get(row.name);
    if (existing) {
      existing.push({ id: row.id, lat: row.lat, lng: row.lng });
    } else {
      byName.set(row.name, [{ id: row.id, lat: row.lat, lng: row.lng }]);
    }
  }

  let corrections = 0;

  for (const [name, rows] of byName) {
    const clusters = clusterCoordinates(rows, CONFLICT_THRESHOLD_KM);
    if (clusters.length < 2) continue;

    // Find dominant cluster (most rows)
    clusters.sort((a, b) => b.count - a.count);
    const dominant = clusters[0];
    const centroidLat = Math.round((dominant.lat / dominant.count) * 1e7) / 1e7;
    const centroidLng = Math.round((dominant.lng / dominant.count) * 1e7) / 1e7;

    // Collect IDs from non-dominant clusters
    const fixIds: number[] = [];
    for (let i = 1; i < clusters.length; i++) {
      fixIds.push(...clusters[i].ids);
    }

    const clusterSummary = clusters
      .map((c) => {
        const cLat = (c.lat / c.count).toFixed(4);
        const cLng = (c.lng / c.count).toFixed(4);
        return `(${cLat},${cLng} x${c.count})`;
      })
      .join(" vs ");

    console.log(`CONFLICT: "${name}" — ${clusters.length} clusters: ${clusterSummary}`);
    console.log(`  -> Fix ${fixIds.length} rows to dominant (${centroidLat}, ${centroidLng})`);

    if (!dryRun) {
      await query(`UPDATE schools SET lat = $1, lng = $2 WHERE id = ANY($3)`, [
        centroidLat,
        centroidLng,
        fixIds,
      ]);
    }

    corrections += fixIds.length;
  }

  console.log(
    `\nPhase 1: ${corrections} rows corrected${dryRun ? " (dry run)" : ""}.\n`,
  );
  return corrections;
}

// ── Phase 2: Structured re-geocoding for address-like names ─────────

async function phase2StructuredReGeocode(): Promise<number> {
  console.log("=== Phase 2: Structured re-geocode for address-like names ===\n");

  // Get distinct names with their current coordinates
  const result = await query<{ name: string; lat: number; lng: number }>(
    `SELECT DISTINCT ON (name) name, lat, lng
     FROM schools
     WHERE lat IS NOT NULL
     ORDER BY name, id`,
  );

  const addressNames = result.rows.filter((r) => isAddressLike(r.name));
  console.log(`${addressNames.length} address-like names to check.\n`);

  let corrections = 0;

  for (const row of addressNames) {
    const street = cleanSchoolName(row.name);
    const structuredResult = await nominatimStructuredSearch(street, "Göteborg");

    if (structuredResult) {
      const dist = haversineKm(row.lat, row.lng, structuredResult.lat, structuredResult.lng);

      if (dist > CORRECTION_THRESHOLD_KM) {
        console.log(
          `CORRECTION: "${row.name}" — stored (${row.lat}, ${row.lng}) vs structured (${structuredResult.lat}, ${structuredResult.lng}) — ${dist.toFixed(2)}km apart`,
        );

        if (!dryRun) {
          const updated = await query(
            `UPDATE schools SET lat = $1, lng = $2 WHERE name = $3`,
            [structuredResult.lat, structuredResult.lng, row.name],
          );
          console.log(`  -> Updated ${updated.rowCount} rows`);
        }

        corrections++;
      }
    }

    await sleep(1100);
  }

  console.log(
    `\nPhase 2: ${corrections} names corrected${dryRun ? " (dry run)" : ""}.\n`,
  );
  return corrections;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  await ensureSchema();

  if (dryRun) {
    console.log("** DRY RUN — no database changes will be made **\n");
  }

  const p1 = await phase1ConflictDetection();
  const p2 = await phase2StructuredReGeocode();

  console.log(`Done. Total corrections: Phase 1 = ${p1} rows, Phase 2 = ${p2} names.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
