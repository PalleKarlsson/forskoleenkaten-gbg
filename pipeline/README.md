# Pipeline

Data extraction pipeline that crawls, downloads, parses, and exports Gothenburg preschool survey data.

```
enkater.goteborg.se → PDF/XLS files → PostgreSQL → static JSON
```

## Prerequisites

- **Node.js 20+**
- **PostgreSQL** (tested on 15+)
- **pdftotext** from [poppler-utils](https://poppler.freedesktop.org/) (`apt install poppler-utils` / `brew install poppler`)

## Setup

```bash
cp .env.example .env   # Edit with your database credentials
npm install
```

`.env` format:

```
DATABASE_HOST=192.168.0.187
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=
DATABASE_NAME=gr_enkater
```

The database schema is created automatically on first run.

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run sync` | `tsx src/pipeline.ts` | Run full pipeline (crawl → download → parse → export) |
| `npm run crawl` | `tsx src/crawler.ts` | Crawl survey listing pages for PDF/XLS links |
| `npm run download` | `tsx src/downloader.ts` | Download PDF/XLS files to `data/pdfs/` |
| `npm run parse` | `tsx src/parser/index.ts` | Parse downloaded files into PostgreSQL |
| `npm run export` | `tsx src/export.ts` | Export PostgreSQL data to static JSON |
| `npm run geocode` | `tsx src/geocode.ts` | Geocode schools via Nominatim (OpenStreetMap) |
| `npm run schema` | `tsx src/schema-runner.ts` | Run schema migrations |

The parse and sync commands accept optional arguments: `npm run parse 2025` (single year), `npm run parse -- --force` (re-parse all).

## Pipeline stages

### 1. Crawl (`crawler.ts`)

Navigates the hierarchical survey listing at `enkater.goteborg.se`:
- Discovers available years from the homepage
- For each year, finds the preschool category (`BARN__FÖRSKOLA`)
- Traverses area → school → report hierarchy
- Stores PDF/XLS URLs in the `pdf_reports` table

URL pattern: `https://enkater.goteborg.se/ListEnkater.aspx?kat={path}` where path segments are separated by `%5c` (backslash).

### 2. Download (`downloader.ts`)

Downloads all PDF/XLS files referenced in `pdf_reports` to `data/pdfs/`, organized by year. Skips already-downloaded files unless `--force` is used.

### 3. Parse (`parser/index.ts`)

Detects the format era of each file and dispatches to the appropriate parser. Results are stored in PostgreSQL. See [Parser architecture](#parser-architecture) below.

### 4. Export (`export.ts`)

Reads PostgreSQL and writes three types of JSON files to `frontend/public/data/`:

- **`index.json`** — Master index: all years, areas, schools with aggregate scores, coordinates, and units
- **`schools/{year}-{area}.json`** — Per-area school summaries with question area breakdowns
- **`detail/{reportId}.json`** — Full per-school detail: means, response distributions, gender splits, demographics, unit means, important questions, related reports

Mean values are normalized to 0-100 during export. See [docs/normalization.md](../docs/normalization.md).

## Parser architecture

### Format detection

`detectFormat()` in `tables.ts` examines the PDF text content to determine the era:

1. **Scandinfo** — matched by `NKI, HELHET` or `Kvalitetsfaktor.*Skalsteg`
2. **ECERS** — matched by `sjugradig` or `Otillräcklig`
3. **7-point** — ECERS match + `Resultat per fråga` section
4. **5-point** — default (no 7-point markers)
5. **XLS** — detected by file extension (`.xls`/`.xlsx`), not by content

### Extraction methods

Each PDF is processed with two tools in parallel:

- **`pdftotext -layout`** → spatial text layout for table parsing (means, response distributions, demographics)
- **`pdf2json`** → positioned text items for coordinate-aware chart extraction (gender splits)

### Data extracted per report

| Data | Source | Stored in |
|------|--------|-----------|
| School name, response rate, respondent count | Header text | `report_metadata` |
| Question means (school, district, city, GR) | Comparison tables | `question_means` |
| Historical means (prior years) | Comparison tables | `question_means.historical_means` (JSONB) |
| Response distributions (Likert percentages) | Stacked bar charts | `question_responses` |
| Gender splits (Flicka/Pojke/Total) | Gender charts | `gender_split` |
| Demographics (birth year, child/parent gender) | Demographics section | `report_metadata` (JSONB) |
| Important questions (parent rankings) | Ranked list | `important_questions` |
| Unit/class means | Unit comparison table | `unit_means` |

## Supported formats

| Era | Years | Scale | Source | Key characteristics |
|-----|-------|-------|--------|---------------------|
| XLS | 2007-2009 | 1-3 | Excel workbooks | 10 questions, unit hierarchy in sheets, index values |
| Scandinfo/NKI | 2012-2014 | 1-10 + NKI 0-100 | PDF | Quality factors, multi-entity PDFs, NKI indices |
| ECERS | 2015 | 1-7 | PDF | Single/dual column, `Otillräcklig`-`Utmärkt` scale |
| 7-point | 2016-2018 | 1-7 | PDF | `Resultat per fråga` tables, variable year columns |
| 5-point | 2020-2025 | 1-5 | PDF | GR/Goteborg/District/School columns, `gr-first`/`gr-last` layouts |

For detailed format documentation, see [docs/survey-formats.md](../docs/survey-formats.md).

## Database schema

```
survey_years ──┐
               ├── areas ──── schools ──── pdf_reports ──┬── report_metadata
               │                  │                      ├── question_means
               │                  │                      ├── question_responses
               │                  │                      ├── gender_split
               │                  │                      ├── important_questions
               │                  │                      └── unit_means
               │                  │
               │                  └── (lat, lng, parent_school_id)
               │
               └── question_areas ──── questions
```

Key tables:

- **`schools`** — One per preschool per area/year, with optional geocoordinates and parent-child hierarchy (for XLS units)
- **`pdf_reports`** — One per downloaded PDF/XLS (or XLS sheet), tracks download and parse status
- **`question_means`** — Mean scores at four levels (GR, Goteborg, district, school) plus historical means as JSONB
- **`question_responses`** — Likert response distribution percentages (strongly agree through don't know)
- **`question_areas`** — 5 standard areas: Trygghet och trivsel, Utveckling och larande, Inflytande, Relation och kommunikation, Helhetsomdome

## Source files

```
pipeline/src/
├── crawler.ts              # Web crawler for survey listings
├── downloader.ts           # PDF/XLS file downloader
├── parser/
│   ├── index.ts            # Parser orchestrator (routes to format-specific parsers)
│   ├── tables.ts           # pdftotext-based table parser (5-point, 7-point, ECERS, Scandinfo)
│   ├── charts.ts           # Chart/diagram parser (response distributions, gender, demographics)
│   ├── xls.ts              # XLS parser (2007-2009 Excel workbooks)
│   ├── pdf-text.ts         # pdf2json wrapper for positioned text extraction
│   └── utils.ts            # Shared utilities (text cleaning, coordinate grouping)
├── export.ts               # PostgreSQL → JSON exporter
├── pipeline.ts             # Full pipeline orchestrator (sync command)
├── geocode.ts              # Nominatim geocoding
├── geocode-scb.ts          # SCB (Statistics Sweden) geocoding
├── geocode-import.ts       # Import geocoding results
├── geocode-export-missing.ts # Export schools missing coordinates
├── validate.ts             # Validation: re-parse samples and diff against DB
├── test-years.ts           # Diagnostic: test parser across all years
├── db.ts                   # PostgreSQL connection pool
├── schema.sql              # Database schema definition
└── schema-runner.ts        # Schema migration runner
```
