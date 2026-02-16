/**
 * Geocode missing schools using OpenStreetMap Overpass API.
 * Queries all kindergartens in Gothenburg and fuzzy-matches names.
 *
 * Run: npm run geocode:osm
 * Dry run: npm run geocode:osm -- --dry-run
 */
import "dotenv/config";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const dryRun = process.argv.includes("--dry-run");

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Fetch all kindergartens in Gothenburg area from Overpass API */
async function fetchOsmKindergartens(): Promise<
  Array<{ name: string; operator: string; lat: number; lng: number }>
> {
  // Bounding box: roughly Gothenburg municipality
  const bbox = "57.55,11.70,57.85,12.20";
  const overpassQuery = `
    [out:json][timeout:60];
    (
      node["amenity"="kindergarten"](${bbox});
      way["amenity"="kindergarten"](${bbox});
      relation["amenity"="kindergarten"](${bbox});
    );
    out center;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(overpassQuery)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) throw new Error(`Overpass API HTTP ${res.status}`);
  const data: { elements: OsmElement[] } = await res.json();

  const results: Array<{ name: string; operator: string; lat: number; lng: number }> = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;

    const name = el.tags?.name || "";
    const operator = el.tags?.operator || "";
    if (!name && !operator) continue;

    results.push({ name, operator, lat, lng });
  }

  return results;
}

/** Normalize a name for fuzzy matching */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,.\-_']/g, " ")
    .replace(
      /\b(förskola|förskolan|förskolor|föräldrakooperativ|föräldrakooperativet|kooperativa|föreningen|fristående|montessori|ek\.?\s*för\.?|ekonomisk\s+förening|ab|hb|i ur och skur)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two normalized strings are a close-enough match.
 * Requires the shorter string to be at least 60% of the longer string's
 * length, and that it appears at a word boundary (not mid-word).
 */
function isPartialMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  // Avoid matching very short strings like "vind" inside "västanvind"
  if (shorter.length < 4 || shorter.length / longer.length < 0.6) return false;

  // Check that the shorter string appears at a word boundary in the longer one
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  return re.test(longer);
}

async function main() {
  await ensureSchema();

  if (dryRun) console.log("** DRY RUN — no database changes **\n");

  console.log("Fetching kindergartens from OpenStreetMap...");
  const osmData = await fetchOsmKindergartens();
  console.log(`Found ${osmData.length} kindergartens in Gothenburg area.\n`);

  // Build lookup maps from OSM data
  const osmByNormName = new Map<string, (typeof osmData)[0]>();
  const osmByNormOperator = new Map<string, (typeof osmData)[0]>();
  for (const entry of osmData) {
    if (entry.name) {
      const key = norm(entry.name);
      if (key.length >= 3 && !osmByNormName.has(key)) {
        osmByNormName.set(key, entry);
      }
    }
    if (entry.operator) {
      const key = norm(entry.operator);
      if (key.length >= 3 && !osmByNormOperator.has(key)) {
        osmByNormOperator.set(key, entry);
      }
    }
  }

  // Get schools missing coordinates
  const missing = await query<{
    id: number;
    clean_name: string;
    address: string | null;
  }>(
    `SELECT s.id, s.clean_name, s.address
     FROM schools s
     WHERE s.lat IS NULL
     ORDER BY s.clean_name`,
  );

  console.log(`${missing.rows.length} schools without coordinates.\n`);

  let matched = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const row of missing.rows) {
    // Skip XLS artifact names and very short unit names
    if (/\.xls/i.test(row.clean_name)) { skipped++; continue; }

    const schoolNorm = norm(row.clean_name);
    if (schoolNorm.length < 3) { skipped++; continue; }

    // Strategy 1: Exact match on normalized name
    let osmMatch = osmByNormName.get(schoolNorm);
    let matchType = "name";

    // Strategy 2: Exact match on normalized operator
    if (!osmMatch) {
      osmMatch = osmByNormOperator.get(schoolNorm);
      matchType = "operator";
    }

    // Strategy 3: Partial match against OSM name (word-boundary, length check)
    if (!osmMatch) {
      for (const [osmKey, osmEntry] of osmByNormName) {
        if (isPartialMatch(schoolNorm, osmKey)) {
          osmMatch = osmEntry;
          matchType = "partial-name";
          break;
        }
      }
    }

    // Strategy 4: Partial match against OSM operator
    if (!osmMatch) {
      for (const [osmKey, osmEntry] of osmByNormOperator) {
        if (isPartialMatch(schoolNorm, osmKey)) {
          osmMatch = osmEntry;
          matchType = "partial-operator";
          break;
        }
      }
    }

    if (osmMatch) {
      console.log(
        `[${matchType}] ${row.clean_name} -> "${osmMatch.name}" (${osmMatch.operator}) = ${osmMatch.lat}, ${osmMatch.lng}`,
      );
      if (!dryRun) {
        await query("UPDATE schools SET lat = $1, lng = $2 WHERE id = $3", [
          osmMatch.lat,
          osmMatch.lng,
          row.id,
        ]);
      }
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(
    `\nDone. Matched: ${matched}, Skipped: ${skipped}, Unmatched: ${unmatched}${dryRun ? " (dry run)" : ""}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
