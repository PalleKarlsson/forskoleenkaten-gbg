# forskoleenkaten-gbg

## Architecture

- **pipeline/**: Local-only TypeScript pipeline (crawl PDFs → parse → Postgres → export JSON)
- **frontend/**: Static React app reading JSON files (deployed to GitHub Pages)
- **data/pdfs/**: Downloaded PDFs (gitignored, local only)
- **frontend/public/data/**: Exported JSON (checked into git)

## Conventions

- ESM-only (`"type": "module"` in all package.json)
- TypeScript strict mode everywhere
- PostgreSQL database: `gr_enkater`
- Connection configured via `pipeline/.env` (DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME)
- Frontend uses HashRouter for GitHub Pages compatibility
- Data attribution: "Göteborgs Regionen / Institutet för kvalitetsindikatorer"

## Key URL Patterns

- Listing: `https://enkater.goteborg.se/ListEnkater.aspx?kat={path}`
- Path separator: `%5c` (backslash)
- Preschool category: `BARN__F%c3%96RSKOLA`
- PDF URLs use backslashes in href attributes

## Pipeline: Full Setup from Scratch

### Prerequisites

- Node.js (v18+)
- PostgreSQL with an empty database (`createdb gr_enkater`)
- `cd pipeline && npm install`
- Create `pipeline/.env` with database connection details

### Step 1: Create schema

```bash
cd pipeline
npm run schema
```

Creates all tables (`survey_years`, `areas`, `schools`, `school_name_variants`, `pdf_reports`, etc). Safe to re-run — uses `CREATE TABLE IF NOT EXISTS`.

### Step 2: Crawl, download, and parse

```bash
npm run sync          # runs all 4 steps below in sequence
# — or run individually: —
npm run crawl         # discover PDF URLs from enkater.goteborg.se
npm run download      # download PDFs to data/pdfs/
npm run parse         # extract survey data from PDFs into Postgres
npm run export        # write JSON files for the frontend
```

All scripts accept an optional year argument (e.g. `npm run crawl 2025`) to process a single year. The crawl step is idempotent — re-running it skips already-crawled years unless you pass `--force`. The parse step skips already-parsed reports unless `--force`.

After this step, the database has all survey data but schools will be missing geographic coordinates.

### Step 3: Geocode schools

Run these geocoding scripts in order. Each one fills in coordinates that the previous ones missed.

```bash
# 1. SCB government registry — best source, covers most municipal schools
npm run geocode:scb

# 2. Nominatim (OpenStreetMap) — free-text search, catches address-based names
npm run geocode

# 3. OSM Overpass — queries all kindergartens in Gothenburg, fuzzy-matches names
npm run geocode:osm

# 4. (Optional) Refine existing coords with SCB's more precise data
npm run geocode:scb -- --refine

# 5. (Optional) Validate address-based geocodes via structured Nominatim search
npm run geocode:validate
```

### Step 4: Handle remaining missing coordinates

After automated geocoding, some schools will still lack coordinates — typically small parent cooperatives (`föräldrakooperativ`), church-run preschools, or schools that have since closed.

```bash
# Export a TSV of schools still missing coordinates
npm run geocode:missing
# Output: data/missing-coords.tsv (columns: name, area_name, address)
```

Fill in the `address` column manually (search for each school online), then import:

```bash
npm run geocode:import
# Reads data/missing-coords.tsv, geocodes addresses via Nominatim, updates the database
```

For schools you can't find an address for, you can update coordinates directly in the database or use the admin tool (`cd admin && npm run dev`).

### Step 5: Export

```bash
npm run export
```

Regenerates all JSON files in `frontend/public/data/`. Run this after any database changes (geocoding, data cleanup, etc).

## Pipeline Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run sync` | Full pipeline: crawl → download → parse → export |
| `npm run crawl [year]` | Discover PDF URLs from enkater.goteborg.se |
| `npm run download [year]` | Download PDFs/XLS files to `data/pdfs/` |
| `npm run parse [year]` | Parse PDFs/XLS → Postgres (means, responses, demographics) |
| `npm run export` | Export Postgres → JSON for frontend |
| `npm run schema` | Create/update database schema |
| `npm run geocode` | Geocode via Nominatim (free-text search) |
| `npm run geocode:scb` | Geocode via SCB government preschool registry |
| `npm run geocode:osm` | Geocode via OSM Overpass (all kindergartens in Gothenburg) |
| `npm run geocode:missing` | Export TSV of schools missing coordinates |
| `npm run geocode:import` | Import manually filled addresses from TSV, geocode them |
| `npm run geocode:validate` | Re-check address-based geocodes with structured search |
| `npm run test` | Run parser + normalize tests |
| `npm run typecheck` | TypeScript type checking |

## Database Schema

See `SCHEMA.md` for the full entity-relationship diagram.

Key design: `schools` has one row per physical school, deduplicated by `COALESCE(address, clean_name)`. The `school_name_variants` table maps all crawled name/URL-slug combinations back to their canonical school. The `pdf_reports` table links to both `schools` (via `school_id`) and `areas` (via `area_id`), with optional `parent_school_id` for XLS sub-unit reports.

## Frontend

```bash
cd frontend && npm run dev
```

Static React app that reads the exported JSON files. Uses HashRouter for GitHub Pages. No backend needed — all data is pre-exported.

## Running

```bash
# Full pipeline (crawl + download + parse + export)
cd pipeline && npm run sync

# Frontend dev
cd frontend && npm run dev
```
