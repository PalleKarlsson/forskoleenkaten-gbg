# forskoleenkaten-gbg

## Architecture

- **pipeline/**: Local-only TypeScript pipeline (crawl PDFs → parse → Postgres → export JSON)
- **frontend/**: Static React app reading JSON files (deployed to GitHub Pages)
- **data/pdfs/**: Downloaded PDFs (gitignored, local only)
- **frontend/public/data/**: Exported JSON (checked into git)

## Conventions

- ESM-only (`"type": "module"` in all package.json)
- TypeScript strict mode everywhere
- PostgreSQL (localhost:5432), database: gr_enkater
- Pipeline scripts: `npm run crawl`, `npm run download`, `npm run parse`, `npm run export`, `npm run sync`
- Frontend uses HashRouter for GitHub Pages compatibility
- Data attribution: "Göteborgs Regionen / Institutet för kvalitetsindikatorer"

## Key URL Patterns

- Listing: `https://enkater.goteborg.se/ListEnkater.aspx?kat={path}`
- Path separator: `%5c` (backslash)
- Preschool category: `BARN__F%c3%96RSKOLA`
- PDF URLs use backslashes in href attributes

## Running

```bash
# Pipeline
cd pipeline && npm run sync

# Frontend dev
cd frontend && npm run dev
```
