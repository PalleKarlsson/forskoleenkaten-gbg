# Contributing

Thanks for your interest in contributing! This project extracts and visualizes Gothenburg preschool survey data from PDF/XLS reports spanning 2007-2025.

## Prerequisites

- **Node.js 20+**
- **pdftotext** (from poppler-utils) — used by the pipeline to extract text from PDFs
- **PostgreSQL** — used by the pipeline to store parsed data (not needed for frontend-only work)

Install pdftotext:

```bash
# Arch
sudo pacman -S poppler

# Ubuntu/Debian
sudo apt install poppler-utils

# macOS
brew install poppler
```

## Getting started

```bash
git clone https://github.com/PalleKarlsson/forskoleenkaten-gbg.git
cd forskoleenkaten-gbg
```

### Frontend only

The frontend reads pre-exported JSON files checked into `frontend/public/data/`, so you can work on it without running the pipeline or having PostgreSQL:

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

### Pipeline

The pipeline requires PostgreSQL and pdftotext:

```bash
cd pipeline
cp .env.example .env   # Edit with your PostgreSQL credentials
npm install
npm run sync           # Full pipeline: crawl → download → parse → export
```

Individual steps: `npm run crawl`, `npm run download`, `npm run parse`, `npm run export`.

### Running tests

```bash
cd pipeline
npm test               # Run snapshot + normalization tests (no DB needed)
npm run test:snapshot  # Regenerate snapshots after intentional parser changes
```

The tests compare current parser output against saved JSON snapshots in `pipeline/tests/snapshots/`. If you change a parser and tests fail, verify the new output is correct, then run `npm run test:snapshot` to update the snapshots.

## Project structure

- **pipeline/** — TypeScript data pipeline (local-only, not deployed)
- **frontend/** — Static React app (deployed to GitHub Pages)
- **data/test-pdfs/** — Representative test PDFs/XLS, one per year (2009-2025)
- **docs/** — Documentation on survey formats and normalization

## Making changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `cd pipeline && npm test` to verify parser tests still pass
4. Submit a pull request

### Parser changes

If you modify any parser function in `pipeline/src/parser/`, the snapshot tests will catch any output differences. This is intentional — it ensures we notice every change in parsing behavior. After verifying the new output is correct:

```bash
npm run test:snapshot  # Update snapshots
npm test               # Verify everything passes
```

### Frontend changes

```bash
cd frontend
npm run dev            # Dev server with hot reload
npm run build          # Verify production build works
```
