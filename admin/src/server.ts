import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from pipeline if it exists
const __dirname = dirname(fileURLToPath(import.meta.url));
const pipelineEnv = resolve(__dirname, "../../pipeline/.env");
if (existsSync(pipelineEnv)) {
  const dotenv = await import("dotenv");
  dotenv.config({ path: pipelineEnv });
}

import express from "express";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST || "localhost",
  port: Number(process.env.DATABASE_PORT) || 5432,
  user: process.env.DATABASE_USER || "postgres",
  password: process.env.DATABASE_PASSWORD || "",
  database: process.env.DATABASE_NAME || "gr_enkater",
});

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, "../public")));

app.get("/api/schools", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT clean_name as name, lat, lng, 1 as row_count
      FROM schools
      WHERE lat IS NOT NULL
      ORDER BY clean_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching schools:", err);
    res.status(500).json({ error: "Failed to fetch schools" });
  }
});

app.patch("/api/schools", async (req, res) => {
  const { updates } = req.body as {
    updates: { name: string; lat: number; lng: number }[];
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    res.status(400).json({ error: "Expected non-empty updates array" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let totalUpdated = 0;
    for (const { name, lat, lng } of updates) {
      const result = await client.query(
        "UPDATE schools SET lat = $1, lng = $2 WHERE clean_name = $3",
        [lat, lng, name],
      );
      totalUpdated += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    res.json({ updated: totalUpdated, schools: updates.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating schools:", err);
    res.status(500).json({ error: "Failed to update schools" });
  } finally {
    client.release();
  }
});

const PORT = Number(process.env.ADMIN_PORT) || 3456;
app.listen(PORT, () => {
  console.log(`Admin server running at http://localhost:${PORT}`);
});
