/**
 * Geocode missing schools using SCB's open geodata for preschools.
 * Downloads the SCB preschool GeoPackage and fuzzy-matches school names
 * against company/organization names in the Gothenburg area.
 *
 * Run: npm run geocode:scb
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

/** Convert SWEREF99TM (EPSG:3006) to WGS84 lat/lng */
function swerefToWgs84(east: number, north: number): { lat: number; lng: number } {
  // Constants for SWEREF99 TM
  const axis = 6378137.0;
  const flattening = 1.0 / 298.257222101;
  const centralMeridian = 15.0;
  const scale = 0.9996;
  const falseNorthing = 0.0;
  const falseEasting = 500000.0;

  const e2 = flattening * (2.0 - flattening);
  const n = flattening / (2.0 - flattening);
  const aRoof = (axis / (1.0 + n)) * (1.0 + n * n / 4.0 + n * n * n * n / 64.0);

  const delta1 = n / 2.0 - (2.0 * n * n) / 3.0 + (37.0 * n * n * n) / 96.0 - (n * n * n * n) / 360.0;
  const delta2 = (n * n) / 48.0 + (n * n * n) / 15.0 - (437.0 * n * n * n * n) / 1440.0;
  const delta3 = (17.0 * n * n * n) / 480.0 - (37.0 * n * n * n * n) / 840.0;
  const delta4 = (4397.0 * n * n * n * n) / 161280.0;

  const Astar = (e2 + e2 * e2 + e2 * e2 * e2 + e2 * e2 * e2 * e2) / 4.0;
  const Bstar = -(7.0 * e2 * e2 + 17.0 * e2 * e2 * e2 + 30.0 * e2 * e2 * e2 * e2) / 80.0;
  const Cstar = (517.0 * e2 * e2 * e2 + 1262.0 * e2 * e2 * e2 * e2) / 2688.0;
  const Dstar = -(8011.0 * e2 * e2 * e2 * e2) / 17920.0;

  const degToRad = Math.PI / 180.0;
  const lambda0 = centralMeridian * degToRad;

  const xi = (north - falseNorthing) / (scale * aRoof);
  const eta = (east - falseEasting) / (scale * aRoof);

  const xiPrim =
    xi -
    delta1 * Math.sin(2.0 * xi) * Math.cosh(2.0 * eta) -
    delta2 * Math.sin(4.0 * xi) * Math.cosh(4.0 * eta) -
    delta3 * Math.sin(6.0 * xi) * Math.cosh(6.0 * eta) -
    delta4 * Math.sin(8.0 * xi) * Math.cosh(8.0 * eta);

  const etaPrim =
    eta -
    delta1 * Math.cos(2.0 * xi) * Math.sinh(2.0 * eta) -
    delta2 * Math.cos(4.0 * xi) * Math.sinh(4.0 * eta) -
    delta3 * Math.cos(6.0 * xi) * Math.sinh(6.0 * eta) -
    delta4 * Math.cos(8.0 * xi) * Math.sinh(8.0 * eta);

  const phiStar = Math.asin(Math.sin(xiPrim) / Math.cosh(etaPrim));
  const deltaLambda = Math.atan(Math.sinh(etaPrim) / Math.cos(xiPrim));

  const lonRadian = lambda0 + deltaLambda;
  const latRadian =
    phiStar +
    Math.sin(phiStar) *
      Math.cos(phiStar) *
      (Astar +
        Bstar * Math.pow(Math.sin(phiStar), 2) +
        Cstar * Math.pow(Math.sin(phiStar), 4) +
        Dstar * Math.pow(Math.sin(phiStar), 6));

  return {
    lat: Math.round((latRadian * 180.0) / Math.PI * 1e7) / 1e7,
    lng: Math.round((lonRadian * 180.0) / Math.PI * 1e7) / 1e7,
  };
}

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

  // Read via python (sqlite3 with binary geometry parsing)
  const script = `
import sqlite3, struct, json, sys
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
    results.append({"firma": r[0] or "", "foretag": r[1] or "", "address": r[2] or "", "east": x, "north": y})
print(json.dumps(results))
`;
  const output = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}' '${GPKG_PATH}'`, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const raw: Array<{ firma: string; foretag: string; address: string; east: number; north: number }> =
    JSON.parse(output.toString());

  return raw.map((r) => {
    const coords = swerefToWgs84(r.east, r.north);
    return { firma: r.firma, foretag: r.foretag, address: r.address, ...coords };
  });
}

async function main() {
  await ensureSchema();

  const scbData = await loadScbData();
  console.log(`Loaded ${scbData.length} Gothenburg preschools from SCB.\n`);

  // Build lookup maps for SCB data
  // 1. By normalized company/org name
  const scbByName = new Map<string, ScbEntry>();
  // 2. By normalized street address
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

  // Get missing schools
  const missing = await query(
    `SELECT DISTINCT ON (s.name) s.name, a.name as area_name
     FROM schools s
     JOIN areas a ON s.area_id = a.id
     WHERE s.lat IS NULL
     ORDER BY s.name, a.year DESC`,
  );

  console.log(`${missing.rows.length} unique school names without coordinates.\n`);

  let matched = 0;
  let unmatched = 0;

  for (const row of missing.rows) {
    const schoolNorm = normalizeName(row.name);
    let scbMatch: ScbEntry | undefined;
    let matchType = "";

    // Strategy 1: Exact normalized name match
    scbMatch = scbByName.get(schoolNorm);
    if (scbMatch) matchType = "name";

    // Strategy 2: Name with förskola/förskolan suffix variations
    if (!scbMatch) {
      for (const suffix of [" förskola", " förskolan"]) {
        scbMatch = scbByName.get(normalizeName(row.name + suffix));
        if (scbMatch) { matchType = "name+suffix"; break; }
      }
    }

    // Strategy 3: Match our school name (which is often a street address) against SCB addresses
    if (!scbMatch) {
      const addrNorm = normalizeAddress(row.name);
      scbMatch = scbByAddress.get(addrNorm);
      if (scbMatch) matchType = "address";
    }

    // Strategy 4: Strip "förskola" from our name and match as address
    if (!scbMatch) {
      const stripped = row.name.replace(/\s*(förskolan?)\s*$/i, "").trim();
      if (stripped !== row.name) {
        const addrNorm = normalizeAddress(stripped);
        scbMatch = scbByAddress.get(addrNorm);
        if (scbMatch) matchType = "stripped-address";
      }
    }

    if (scbMatch) {
      const result = await query(
        `UPDATE schools SET lat = $1, lng = $2 WHERE name = $3 AND lat IS NULL`,
        [scbMatch.lat, scbMatch.lng, row.name],
      );
      console.log(`[${matchType}] ${row.name} -> ${scbMatch.firma || scbMatch.foretag} (${scbMatch.address}) = ${scbMatch.lat}, ${scbMatch.lng} (${result.rowCount} rows)`);
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`\nDone. Matched: ${matched}, Unmatched: ${unmatched}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
