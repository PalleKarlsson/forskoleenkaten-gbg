/**
 * Export schools missing coordinates to a TSV for manual geocoding.
 * Run: npm run geocode:missing
 *
 * Output: data/missing-coords.tsv
 * Columns: name, area_name, address
 *
 * Fill in the address column and import with: npm run geocode:import
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, ensureSchema } from "./db.js";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../../data/missing-coords.tsv");

async function main() {
  await ensureSchema();

  const result = await query(
    `SELECT DISTINCT ON (s.name)
            s.name,
            a.name as area_name
     FROM schools s
     JOIN areas a ON s.area_id = a.id
     WHERE s.lat IS NULL
     ORDER BY s.name, a.year DESC`,
  );

  const rows = result.rows;
  console.log(`${rows.length} unique school names without coordinates.`);

  const lines = ["name\tarea_name\taddress"];
  for (const row of rows) {
    lines.push(`${row.name}\t${row.area_name}\t`);
  }

  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf-8");
  console.log(`Written to: ${OUT_PATH}`);
  console.log(`\nFill in the address column, then run: npm run geocode:import`);

  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
