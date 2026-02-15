# TODO

## Inbox

_(empty)_

---

## Tasks

### 1. [x] Fix category/question area mapping

**Origin:** "Fix the categories, right now only Trygghet och trivsel and Helhetsomdöme is showing, and I think they are incorrect as well"

**Analysis:** Area detection in `parseMeanRows5Point` only fired when `!inTable`. In 2024-2025 PDFs, `inTable` resets between areas via "Årsjämförelsen" lines and page headers. But 2020-2023 PDFs lack both, so `inTable` stayed true after the first table — area detection was skipped for all subsequent areas, putting all questions into "Trygghet och trivsel". Since parsing runs year DESC, the 2020 parse ran last and overwrote correct assignments.

**Fix:** Moved area detection outside the `!inTable` guard and added `inTable = false` reset on area header detection (`pipeline/src/parser/tables.ts:239`). Verified correct 5-area output (7+12+2+5+2 questions) for 2020, 2021, and 2025 PDFs. Full re-parse + re-export needed to apply (deferred to after all fixes).

**Files:** `pipeline/src/parser/tables.ts`

---

### 2. [x] Build detail and comparison pages for 2025 survey with trends

**Origin:** "Make the details and comparison pages based on the 2025 survey and add trends where available/applicable"

**Status:** Complete. 2025 data is fully parsed (1,142 reports), exported (380 schools, 379 with means), and includes historical trend data (2020-2024). Detail pages (`SchoolDetail.tsx`) and comparison pages (`Compare.tsx`) render 2025 data with `TrendChart.tsx` showing multi-year trends.

**Files:** `pipeline/src/parser/tables.ts`, `pipeline/src/export.ts`, `frontend/src/pages/SchoolDetail.tsx`, `frontend/src/pages/Compare.tsx`

---

### 3. [x] Show gender split (Pojke/Flicka/Alla) with Alla as default

**Origin:** "Make all info that is reported for Pojke, Flicka and Alla be visible with Alla being the default value"

**Status:** Complete. UI shows "Totalt" (Alla) by default with checkbox toggle for Flicka/Pojke via `GenderSplitChart.tsx`. Parser bug fixed: two issues caused 0 gender splits — (1) coordinate-based `parseGenderSplits` returned 1 garbage result (pdf2json collapses all coordinates), blocking the layout-based fallback; (2) layout-based `parseGenderSplitsFromLayout` only matched 2024-2025 section headers, missing 2020-2023 "Könsuppdelad andel positiva" format. Fix: swapped method order (layout-first) and added alternative section header regex. Re-parsed all years: **65,005 gender splits** across 2020-2025.

**Files:** `pipeline/src/parser/charts.ts`, `pipeline/src/parser/index.ts`, `frontend/src/components/GenderSplitChart.tsx`

---

### 4. [x] Create school/unit hierarchy (parent-child preschool structure)

**Origin:** "Create a hierarchy for preschools where both the complete results as well as unit for unit results are reported"

**Status:** Complete. Added `parent_school_id` column to `schools` table. XLS parser (2007-2009) sets `parent_school_id` when creating unit schools. Export builds nested `units` arrays on parent schools in `index.json` (9,244 units across 3,611 schools) and `relatedReports` in detail JSON for cross-navigation. Frontend shows expandable "N enheter" buttons on Home page, pill-based related reports navigation on Detail page, and unit-aware search.

**Files:** `pipeline/src/schema.sql`, `pipeline/src/parser/index.ts`, `pipeline/src/export.ts`, `frontend/src/data/client.ts`, `frontend/src/pages/Home.tsx`, `frontend/src/pages/SchoolDetail.tsx`, `frontend/src/components/SchoolSearch.tsx`

---

### 5. [x] Rename project to forskoleenkaten-gbg / Förskoleenkäten Göteborg

**Origin:** "Rename the project forskoleenkaten-gbg in code/directory names and so on and Forskoleenkaten - Goteborg in text displayed on the site"

**Status:** Complete. Renamed all package names to `@forskoleenkaten-gbg/*`, site title/header to "Förskoleenkäten Göteborg", Vite base path to `/forskoleenkaten-gbg/`, User-Agent strings, and docs. Added `.github/workflows/deploy.yml` for GitHub Pages deployment. Also fixed 4 pre-existing unused import errors that blocked `tsc -b`. Parent directory rename is a manual step outside the working tree.

**Files:** `pipeline/package.json`, `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/hooks/useAddressSearch.ts`, `pipeline/src/geocode.ts`, `pipeline/src/geocode-import.ts`, `CLAUDE.md`, `README.md`, `.github/workflows/deploy.yml`

---

### 6. [x] Validate parsed data against source PDFs

**Origin:** "Validate all data, you seem very good at parsing the pdfs, so please do some random sampling and see if the data you can parse from the pdf looks correct in the database."

**Status:** Complete. Validation script (`pipeline/src/validate.ts`) samples 3 random reports per year across all format eras (5point, 7point, ecers, scandinfo) and compares re-parsed values against DB. Latest run: **39 reports validated, 0 mismatches** across 2012-2025. Response distribution bug (Task 10) was discovered during validation and has been fixed.

**Files:** `pipeline/src/validate.ts`, `data/pdfs/`, `frontend/public/data/detail/`, `pipeline/src/parser/`

---

### 7. [ ] Create public GitHub repo and initial commit

**Origin:** "Create a public GitHub directory and make an initial commit - Do this after all other TODOs are done."

**Analysis:** Final step after everything else is complete. Requires ensuring `.gitignore` covers local-only files (PDFs, database credentials, node_modules), and that the repo is clean for public release.

**Plan:**

1. Review `.gitignore` for completeness
2. Ensure no secrets or credentials are in tracked files
3. Create GitHub repo (`gh repo create`)
4. Initial commit and push
5. Set up GitHub Pages for frontend deployment

**Blocked by:** Task 9

**Files:** `.gitignore`, `README.md`

---

### 8. [x] Add .gitignore with sane defaults

**Origin:** "Add a .gitignore with sane defaults that also makes sure no pdfs or other data that is not directly used to display the site is checked in."

**Status:** Complete. `.gitignore` covers: `node_modules/`, `dist/`, `.env` + variants, IDE files (`.vscode/`, `.idea/`), OS files (`.DS_Store`, `Thumbs.db`), logs, `data/pdfs/` (downloaded source PDFs), and Vite cache. `frontend/public/data/` (exported JSON) is not excluded and will be checked in.

**Files:** `.gitignore`

---

### 9. [ ] Add pipeline integration tests for language migration

**Origin:** "In the future I'd like to manually refactor the pipeline to another language. Could you add tests for each part of the pipeline where I can compare the output of the current code with the output of code that I write?"

**Status:** Not started. A diagnostic script (`pipeline/src/test-years.ts`, 436 lines) exists that discovers years, downloads sample PDFs, and runs the parser with detailed logging — but it does not save snapshots or produce diffable output. 14 test PDFs are pre-downloaded in `data/test-pdfs/`.

**Plan:**

1. Select representative sample inputs (a few PDFs per era: 2007 XLS, 2012-2014 NKI, 2015-2018 ECERS, 2020-2025 5-point)
2. Capture parser output as JSON snapshots (means, responses, metadata per report)
3. Capture export output snapshots (index.json structure, detail JSON for sample schools)
4. Write test harness that runs pipeline stages and diffs against snapshots
5. Document how to regenerate snapshots when intentional changes are made

**Files:** `pipeline/tests/` (new), `pipeline/src/test-years.ts` (existing diagnostic), `data/test-pdfs/`, `pipeline/package.json`

---

### 10. [x] Fix response distribution parser (critical data bug)

**Origin:** Discovered during validation — response distributions are completely wrong for many schools. Detailed analysis in `PLAN-response-distribution-fix.md`.

**Status:** Complete. All three fixes implemented and verified:
1. Section filtering — `parseResponseDistributions` now only extracts between "Detta diagram visar" start marker and legend end marker, ignoring Könsuppdelad/Högst andel charts
2. Mean-guided C(6,N) category assignment — brute-force over all ordered slot assignments, picking the one whose weighted mean is closest to the actual school mean
3. Demographics parser termination — stops parsing when encountering chart markers or non-demographic keys

**Residual limitation:** ~0.2-0.5 point mean difference can occur in reconstructed distributions because stacked bar percentages are integer-rounded and small values (<5%) are invisible. This is inherent to the data source, not a parser bug.

**Files:** `pipeline/src/parser/charts.ts`, `pipeline/src/parser/index.ts`
