# Förskoleenkäten Göteborg

Browse, compare, and visualize Gothenburg preschool quality surveys from 2007 to 2025. The Gothenburg Region (GR) publishes annual preschool surveys as individual PDF/XLS reports across ~12,000 reports spanning 5 format eras. This project extracts all data into a searchable, interactive static website.

**[Live site](https://forskoleenkaten-gbg.se)**

## Architecture

```
enkater.goteborg.se          PostgreSQL              GitHub Pages
       │                          │                       │
       ▼                          ▼                       ▼
  ┌──────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌──────────┐
  │  Crawl   │───▶│Download│───▶│ Parse  │───▶│ Export │───▶│ Frontend │
  │ (links)  │    │(PDF/XLS)    │(→ DB)  │    │(→ JSON)│    │ (React)  │
  └──────────┘    └────────┘    └────────┘    └────────┘    └──────────┘
                                 pdftotext                   Static JSON
                                 pdf2json                    ECharts
                                 xlsx                        Leaflet
```

**Pipeline** (local-only): Crawls the GR survey site, downloads PDF/XLS reports, parses them into PostgreSQL, and exports static JSON files.

**Frontend** (deployed): Static React app that reads exported JSON and provides map-based discovery, browsing, per-school detail views, and multi-school comparison.

## Data coverage

| Era | Years | Source | Scale | Reports |
|-----|-------|--------|-------|---------|
| XLS | 2007-2009 | Excel workbooks | 1-3 | ~3,600 units |
| Scandinfo/NKI | 2012-2014 | PDF (multi-entity) | 1-10 + NKI 0-100 | ~400 |
| ECERS | 2015 | PDF | 1-7 | ~300 |
| 7-point | 2016-2018 | PDF | 1-7 | ~1,000 |
| 5-point | 2020-2025 | PDF | 1-5 | ~6,500 |

All means are normalized to a 0-100 scale for cross-era comparison. See [docs/normalization.md](docs/normalization.md) for details.

## Quick start

### Pipeline (data extraction)

```bash
cd pipeline
cp .env.example .env   # Edit with your PostgreSQL credentials
npm install
npm run sync           # Crawl → Download → Parse → Export
```

Requires Node 20+, PostgreSQL, and `pdftotext` (poppler-utils).

### Frontend (development)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

## Project structure

```
forskoleenkaten-gbg/
├── pipeline/              # Data extraction pipeline (TypeScript, local-only)
│   ├── src/
│   │   ├── crawler.ts     # Crawl survey listing pages for PDF/XLS links
│   │   ├── downloader.ts  # Download PDF/XLS files
│   │   ├── parser/        # Format-specific parsers → PostgreSQL
│   │   ├── export.ts      # PostgreSQL → static JSON
│   │   ├── geocode.ts     # Geocode schools via Nominatim
│   │   └── validate.ts    # Validate parsed data against source PDFs
│   └── package.json
├── frontend/              # Static React app (deployed to GitHub Pages)
│   ├── src/
│   │   ├── pages/         # Map, Browse, Detail, Compare views
│   │   ├── components/    # Charts, search, comparison widgets
│   │   └── data/client.ts # Static JSON data loader
│   ├── public/data/       # Exported JSON (checked into git)
│   └── package.json
├── data/pdfs/             # Downloaded source files (gitignored)
├── docs/                  # Deep-dive documentation
│   ├── survey-formats.md  # Format eras and parsing details
│   └── normalization.md   # Cross-era mean normalization
└── .github/workflows/     # GitHub Pages deployment
```

See also: [pipeline/README.md](pipeline/README.md) | [frontend/README.md](frontend/README.md)

## Data attribution

Source: [Göteborgs Regionen / Institutet för kvalitetsindikatorer](https://enkater.goteborg.se/)

## License

See [LICENSE](LICENSE).
