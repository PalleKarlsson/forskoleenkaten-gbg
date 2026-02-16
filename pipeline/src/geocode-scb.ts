/**
 * Geocode missing schools using SCB's open geodata for preschools.
 * Downloads the SCB preschool GeoPackage and fuzzy-matches school names
 * against company/organization names in the Gothenburg area.
 *
 * Run: npm run geocode:scb
 * Refine existing coordinates: npm run geocode:scb -- --refine
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const GPKG_PATH = join(DATA_DIR, "forskolor_2025.gpkg");
const ZIP_URL = "https://www.scb.se/contentassets/51c8cfbe88a94a36927ad34618e636b9/forskolor_2025_sweref2.zip";

interface ScbEntry {
  firma: string;
  foretag: string;
  address: string;
  lat: number;
  lng: number;
}

/** Normalize a name for fuzzy matching */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,.\-_]/g, " ")
    .replace(/\b(förskola|förskolan|föräldrakooperativ|föräldrakooperativet|ek\.?\s*för\.?|ekonomisk\s+förening|ab|hb)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a street address for matching */
function normalizeAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(förskola|förskolan?)\b/gi, "")
    .replace(/\.pdf$/i, "")
    .replace(/[,.\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadScbData(): Promise<ScbEntry[]> {
  // Download if needed
  if (!existsSync(GPKG_PATH)) {
    console.log("Downloading SCB preschool geodata...");
    mkdirSync(DATA_DIR, { recursive: true });
    const zipPath = join(DATA_DIR, "forskolor_2025.zip");
    execSync(`curl -sL '${ZIP_URL}' -o '${zipPath}'`);
    execSync(`unzip -o '${zipPath}' -d '${DATA_DIR}'`);
    // The extracted file has a Swedish name
    const extracted = join(DATA_DIR, "Förskolor_2025_sweref.gpkg");
    if (existsSync(extracted) && extracted !== GPKG_PATH) {
      execSync(`mv '${extracted}' '${GPKG_PATH}'`);
    }
  }

  // Read via python (sqlite3 with binary geometry parsing + pyproj for coordinate conversion)
  const script = `
import sqlite3, struct, json, sys
from pyproj import Transformer
t = Transformer.from_crs('EPSG:3006', 'EPSG:4326', always_xy=True)
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("""
    SELECT Firmabenämning, Företagsnamn, Besöksadress, geom
    FROM "Förskolor_2025_sweref"
    WHERE Kommun = '1480'
""")
results = []
for r in cur.fetchall():
    geom = r[3]
    flags = geom[3]
    envelope_type = (flags >> 1) & 0x07
    header_size = 8
    if envelope_type == 1:
        wkb_offset = header_size + 32
    else:
        wkb_offset = header_size
    wkb = geom[wkb_offset:]
    byte_order = wkb[0]
    fmt = '<dd' if byte_order == 1 else '>dd'
    x, y = struct.unpack(fmt, wkb[5:21])
    lng, lat = t.transform(x, y)
    results.append({"firma": r[0] or "", "foretag": r[1] or "", "address": r[2] or "", "lat": round(lat, 7), "lng": round(lng, 7)})
print(json.dumps(results))
`;
  const output = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}' '${GPKG_PATH}'`, {
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(output.toString()) as ScbEntry[];
}

const refineMode = process.argv.includes("--refine");

function buildScbLookups(scbData: ScbEntry[]) {
  const scbByName = new Map<string, ScbEntry>();
  const scbByAddress = new Map<string, ScbEntry>();

  for (const entry of scbData) {
    for (const nameField of [entry.firma, entry.foretag]) {
      if (!nameField) continue;
      const key = normalizeName(nameField);
      if (key.length >= 4 && !scbByName.has(key)) {
        scbByName.set(key, entry);
      }
    }
    if (entry.address) {
      const addrKey = normalizeAddress(entry.address);
      if (!scbByAddress.has(addrKey)) {
        scbByAddress.set(addrKey, entry);
      }
    }
  }

  return { scbByName, scbByAddress };
}

function findScbMatch(
  name: string,
  scbByName: Map<string, ScbEntry>,
  scbByAddress: Map<string, ScbEntry>,
): { match: ScbEntry; matchType: string } | null {
  const schoolNorm = normalizeName(name);

  // Strategy 1: Exact normalized name match
  let scbMatch = scbByName.get(schoolNorm);
  if (scbMatch) return { match: scbMatch, matchType: "name" };

  // Strategy 2: Name with förskola/förskolan suffix variations
  for (const suffix of [" förskola", " förskolan"]) {
    scbMatch = scbByName.get(normalizeName(name + suffix));
    if (scbMatch) return { match: scbMatch, matchType: "name+suffix" };
  }

  // Strategy 3: Match our school name (which is often a street address) against SCB addresses
  const addrNorm = normalizeAddress(name);
  scbMatch = scbByAddress.get(addrNorm);
  if (scbMatch) return { match: scbMatch, matchType: "address" };

  // Strategy 4: Strip "förskola" from our name and match as address
  const stripped = name.replace(/\s*(förskolan?)\s*$/i, "").trim();
  if (stripped !== name) {
    scbMatch = scbByAddress.get(normalizeAddress(stripped));
    if (scbMatch) return { match: scbMatch, matchType: "stripped-address" };
  }

  return null;
}

async function main() {
  await ensureSchema();

  const scbData = await loadScbData();
  console.log(`Loaded ${scbData.length} Gothenburg preschools from SCB.\n`);

  const { scbByName, scbByAddress } = buildScbLookups(scbData);

  if (refineMode) {
    console.log("=== Refine mode: updating all matched schools with SCB coordinates ===\n");

    const all = await query<{ id: number; clean_name: string; lat: number | null; lng: number | null }>(
      `SELECT id, clean_name, lat, lng FROM schools ORDER BY clean_name`,
    );

    let refined = 0;
    let alreadyCorrect = 0;
    let noMatch = 0;

    for (const row of all.rows) {
      const result = findScbMatch(row.clean_name, scbByName, scbByAddress);
      if (!result) { noMatch++; continue; }

      const { match, matchType } = result;

      // Skip if coordinates already match SCB
      if (row.lat !== null && Math.abs(row.lat - match.lat) < 0.0001 && Math.abs(row.lng! - match.lng) < 0.0001) {
        alreadyCorrect++;
        continue;
      }

      await query(
        `UPDATE schools SET lat = $1, lng = $2 WHERE id = $3`,
        [match.lat, match.lng, row.id],
      );
      const oldCoords = row.lat !== null ? `(${row.lat}, ${row.lng})` : "(none)";
      console.log(`[${matchType}] ${row.clean_name}: ${oldCoords} -> (${match.lat}, ${match.lng}) via ${match.firma || match.foretag} (${match.address})`);
      refined++;
    }

    console.log(`\nDone. Refined: ${refined}, Already correct: ${alreadyCorrect}, No SCB match: ${noMatch}`);
  } else {
    // Original mode: only fill in missing coordinates
    const missing = await query(
      `SELECT s.id, s.clean_name
       FROM schools s
       WHERE s.lat IS NULL
       ORDER BY s.clean_name`,
    );

    console.log(`${missing.rows.length} unique school names without coordinates.\n`);

    let matched = 0;
    let unmatched = 0;

    for (const row of missing.rows) {
      const result = findScbMatch(row.clean_name, scbByName, scbByAddress);

      if (result) {
        const { match, matchType } = result;
        await query(
          `UPDATE schools SET lat = $1, lng = $2 WHERE id = $3`,
          [match.lat, match.lng, row.id],
        );
        console.log(`[${matchType}] ${row.clean_name} -> ${match.firma || match.foretag} (${match.address}) = ${match.lat}, ${match.lng}`);
        matched++;
      } else {
        unmatched++;
      }
    }

    console.log(`\nDone. Matched: ${matched}, Unmatched: ${unmatched}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
