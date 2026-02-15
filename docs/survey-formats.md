# Survey Format Eras

The Gothenburg Region (GR) preschool surveys have been published in 5 distinct format eras since 2007. Each era uses a different file format, Likert scale, report layout, and set of questions. The pipeline detects the format automatically and dispatches to the appropriate parser.

## Overview

| Era | Years | Source | Scale | Questions | Entities per report |
|-----|-------|--------|-------|-----------|---------------------|
| [XLS](#xls-2007-2009) | 2007-2009 | Excel (.xls) | 1-3 | 10 | Multiple (one sheet per unit) |
| [Scandinfo/NKI](#scandinfo-nki-2012-2014) | 2012-2014 | PDF | 1-10 + NKI 0-100 | ~15 + indices | Single |
| [ECERS](#ecers-2015) | 2015 | PDF | 1-7 | ~15 | Single |
| [7-point](#7-point-2016-2018) | 2016-2018 | PDF | 1-7 | ~15 | Single |
| [5-point](#5-point-2020-2025) | 2020-2025 | PDF | 1-5 | ~28 | Single |

No surveys were published in 2010-2011, 2019, or gaps between format eras.

## Format detection

Format detection is performed by `detectFormat()` in `pipeline/src/parser/tables.ts`. The logic:

1. **Scandinfo** — Text contains `NKI, HELHET` or `Kvalitetsfaktor.*Skalsteg`
2. **ECERS** — Text contains `sjugradig` or `Otillräcklig` (7-point scale markers)
3. **7-point** — Has ECERS markers AND `Resultat per fråga` section headers
4. **5-point** — Default when no 7-point markers are found
5. **XLS** — Detected by file extension (`.xls`/`.xlsx`), not by content

XLS files are routed to `xls.ts`; all PDF formats are handled by `tables.ts` + `charts.ts`.

---

## XLS (2007-2009)

**Parser:** `pipeline/src/parser/xls.ts`

### Source format

Excel workbooks (`.xls`) with one sheet per organizational unit. Each workbook covers an entire district, containing sheets for:
- District totals (sheet ID ending in `0000`) — excluded from parsing
- School groups (sheet ID ending in `X00`) — included only if no child unit sheets exist
- Individual units (sheet ID ending in `XNN`, NN != 00) — always included

Sheet naming convention: `T{id}` = data table, `TD{id}` = chart data (ignored).

### Scale

**1-3 Likert** (children aged 3-5):
- 1 = Low / Negative
- 2 = Medium / Neutral
- 3 = High / Positive

### Data layout

Each data sheet has a fixed layout:
- **Row 0, col 6:** Unit name
- **Row 1, col 2:** Respondent count
- **Row 2:** District name
- **Rows 9+:** Alternating index/question row pairs

Each question row pair contains:
- **Index row:** col 2 = unit index, col 4 = all-schools index
- **Question row:** col 0 = label (`Fr N`), col 1 = question text, col 2 = unit mean, col 4 = all-schools mean
- **Response distribution:** col 8 = low (1), col 9 = medium (2), col 10 = high (3), col 12 = no answer

### Questions (10 standard questions)

All XLS-era surveys use the same 10 questions covering child safety, development, participation, and parent communication.

### Data extracted

- Unit name, district name, respondent count
- Per-question: mean value, all-schools mean, index value, all-schools index
- Response distribution: % low, % medium, % high, % no answer

### Response distribution mapping

The 3-point scale is mapped to the 5-point storage schema:
- Low (1) → `pct_strongly_disagree`
- Medium (2) → `pct_neither`
- High (3) → `pct_strongly_agree`

### Known quirks

- Some XLS files have too few respondents (<7) and contain no data — these are skipped with a parse note
- The hierarchy detection (`findUnitSheetIds`) ensures only leaf-node units are parsed, avoiding double-counting of aggregate totals
- Unit schools are linked to their parent school group via `parent_school_id`

---

## Scandinfo/NKI (2012-2014)

**Parser:** `pipeline/src/parser/tables.ts` (`parseMeanRowsScandinfo`)

### Source format

PDF reports produced by Scandinfo AB using the NKI (Nöjd Kund Index / Customer Satisfaction Index) methodology. Each PDF covers a single preschool unit.

### Scale

Two measurement systems:
- **Question means:** 1-10 Likert scale
- **NKI indices:** 0-100 composite score (weighted combination of quality factors)

### Report structure

- **Quality factors** (Kvalitetsfaktor): named dimensions like "TRYGGHET", "STIMULANS", etc.
- **NKI, HELHET:** Overall satisfaction index
- Each quality factor contains individual questions on the 1-10 scale
- NKI indices are aggregated composites, not simple averages

### Data extracted

- School name, respondent count (`n=XX`), response rate (`svarsandel XX%`)
- Question means (1-10 scale)
- NKI indices (0-100 scale) — stored as-is, not normalized further

### Column layout

- Single data column per question (unit mean only)
- Some reports include comparison columns (district, all units)

### Known quirks

- NKI indices are already on a 0-100 scale, so the normalizer detects questions starting with `"NKI "` and returns the value unchanged
- Multi-entity PDFs may contain data for several units — detected by section headers
- Format detection uses both `NKI, HELHET` and `Kvalitetsfaktor.*Skalsteg` as markers since some PDFs omit one pattern

---

## ECERS (2015)

**Parser:** `pipeline/src/parser/tables.ts` (`parseMeanRowsEcers`)

### Source format

PDF reports using the ECERS (Early Childhood Environment Rating Scale) framework, adapted for Swedish preschools. 7-point scale with descriptive anchors.

### Scale

**1-7 Likert:**
- 1 = Otillräcklig (Inadequate)
- 3 = Minimal
- 5 = God (Good)
- 7 = Utmärkt (Excellent)

Identified by the presence of `sjugradig` (seven-point) or `Otillräcklig` in the PDF text.

### Report structure

- Single or dual column layouts
- Mean values per question, sometimes with unit-level breakdowns
- No `Resultat per fråga` section (this distinguishes ECERS from the 2016-2018 7-point format)

### Data extracted

- School name, response rate, respondent count
- Per-question mean values (school level)
- Limited comparison data (no GR/Goteborg columns in this era)

### Known quirks

- Some 2015 reports share characteristics with both ECERS and 7-point formats
- The key distinguishing feature from 7-point is the absence of `Resultat per fråga` section headers

---

## 7-point (2016-2018)

**Parser:** `pipeline/src/parser/tables.ts` (`parseMeanRows7Point`)

### Source format

PDF reports with a 7-point Likert scale and structured `Resultat per fråga` (Results per question) sections.

### Scale

**1-7 Likert** (same anchors as ECERS):
- 1 = Otillräcklig (Inadequate)
- 7 = Utmärkt (Excellent)

### Report structure

Contains `Resultat per fråga` sections — the key feature distinguishing this from ECERS. Each section shows:
- A scale bar (1-7 with "Vet ej" / Don't know)
- Question text with percentage distribution across the 7 points
- Mean values for historical years, school/district, and Goteborg

### Column layout (varies by year)

The column structure differs significantly across years:

**2018:**
```
[Year] [Year-1] [School Name] [District Name] Göteborg
```
No GR column. School identified by named column.

**2017:**
```
[Year] [Year-1] [Year-2] [District] Göteborg GR
```
GR present. School value in year columns.

**2016:**
```
[Year] [Year-1] Göteborg GR
```
GR present. Fewer historical year columns.

### Question areas (5 areas)

| Area | Mapped to |
|------|-----------|
| TRYGGHET OCH GEMENSKAP | Trygghet och trivsel |
| INFORMATION OCH INFLYTANDE | Inflytande |
| FÖRUTSÄTTNINGAR | Utveckling och lärande |
| PEDAGOGIK | Utveckling och lärande |
| KONTINUITET | Relation och kommunikation |

### Data extracted

- School name, response rate (from `alltså XX.X%`), respondent count
- Per-question means with historical year columns
- Geographic comparison means (district, Goteborg, sometimes GR)
- Response distributions (from chart sections)
- Gender splits, demographics, important questions

### Known quirks

- The `Göteborgsregionen` column header is often split across multiple lines (`Göteborgs` on one line, `regionen` below), requiring multi-line header scanning
- Percentage values (10%, 20%) appear inline with mean values on the same line — the parser filters these using a regex that excludes values followed by `%`
- Page footer patterns (`Rapporten gäller`, `Varje färgat fält`) must be detected to reset parser state

---

## 5-point (2020-2025)

**Parser:** `pipeline/src/parser/tables.ts` (`parseMeanRows5Point`)

### Source format

PDF reports using a 5-point Likert scale, the current format since 2020. Most reports (~6,500) are in this format.

### Scale

**1-5 Likert:**
- 1 = Instämmer inte alls (Strongly disagree)
- 2 = Instämmer inte (Disagree)
- 3 = Varken eller (Neither)
- 4 = Instämmer (Agree)
- 5 = Instämmer helt (Strongly agree)
- Plus: Vet inte (Don't know)

### Report structure

Each PDF contains comparison tables with mean values across multiple entity levels:
- **GR** (Göteborgsregionen — the greater Gothenburg region)
- **Göteborg** (the city)
- **District** (stadsdel/område)
- **School** (the specific preschool)
- Historical year columns (2-4 prior years)

### Column layout

Two layouts detected by `detectColumnLayout5Point()`:

**`gr-first`** (most common):
```
GR   Göteborg   [District]   [School]   [Unit?]   2024   2023   2022
```
Geographic columns first, historical years at end.

**`gr-last`** (some years):
```
[2024]   [2023]   [2022]   [School?]   [District]   Göteborg   GR
```
Historical years first, geographic columns at end.

The layout is detected by comparing the position of "GR" vs "Göteborg" in the header line.

### Question areas (5-6 areas, ~28 questions)

| Area | Question count |
|------|---------------|
| Normer och värden / Trygghet och trivsel | 7 |
| Omsorg, utveckling och lärande | 12 |
| Barns inflytande och delaktighet | 2 |
| Förskola och hem / Relation och kommunikation | 5 |
| Helhetsomdöme | 2 |

Area detection scans for exact matches against `QUESTION_AREA_PATTERNS_5POINT`. Area names are then mapped to the 5 standard database categories via `mapAreaName()`.

### Data extracted

- **Metadata:** School name, response rate, respondents/invited count
- **Question means:** 4-level comparison (GR, Goteborg, district, school) + historical means
- **Response distributions:** Likert percentages from stacked bar charts
- **Gender splits:** Flicka/Pojke/Total positive response percentages
- **Demographics:** Birth year, child gender, parent gender distributions
- **Important questions:** Top 5 parent-ranked questions
- **Unit means:** Per-class/unit breakdown by question area

### Known quirks

- **Area detection bug (fixed):** In 2020-2023 PDFs, `inTable` was never reset between areas because these PDFs lack `Årsjämförelsen` lines and page headers. Area detection was moved outside the `!inTable` guard to fix this.
- **Question text wrapping:** Long questions wrap across multiple lines. The parser handles both pending question text (text before data values) and look-ahead continuation lines (text after data values).
- **Page headers:** Lines matching `|.*Svarsfrekvens` are page headers that reset table state.
- **Helhetsomdome questions:** Start with uppercase (`Jag känner mig...`) unlike other questions that start with ellipsis (`...mitt barn trivs`).

---

## Response distribution extraction

**Parser:** `pipeline/src/parser/charts.ts` (`parseResponseDistributions`)

Response distributions are extracted from stacked bar chart sections in the PDF layout text. This applies to all PDF format eras (not XLS, which stores distributions directly).

### Section detection

Only data between these markers is extracted:
- **Start:** `"Detta diagram visar resultatet för frågorna inom frågeområdet"`
- **End:** Legend line containing `"Inst"` + `"ller"` + `"et"` (handles both normal text and spaced-out characters in 2025 format)

This prevents accidentally extracting data from:
- `Könsuppdelad andel positiva` charts (Total/Flicka/Pojke per question)
- `Högst andel höga/låga betyg` charts (summary top/bottom charts)

### Percentage extraction

Each question line starts with an ellipsis (`...` or `...`) followed by question text and 2-6 percentage values:
```
    ...mitt barn trivs på förskolan      35%                58%
    ...personalen bemöter         7%   23%                67%
```

### Mean-guided C(6,N) category assignment

The key challenge: percentages are extracted left-to-right from the bar chart, but we don't know which Likert category each percentage belongs to. A question with `[35%, 58%]` could be `[agree=35, strongly_agree=58]` or `[strongly_disagree=35, disagree=58]`.

**Algorithm:**
1. Extract N percentage values from each stacked bar line
2. Look up the school's mean value for the question (from the already-parsed comparison tables)
3. Generate all C(6,N) ordered assignments of N values into 6 category slots:
   - Slots: strongly_disagree(1), disagree(2), neither(3), agree(4), strongly_agree(5), dont_know(excluded from mean)
4. For each assignment, compute weighted mean: `mean = sum(value_i * weight_i) / sum(value_i)`
5. Pick the assignment whose computed mean is closest to the actual school mean

**Why this works:** C(6,N) is small — C(6,2)=15, C(6,3)=20, C(6,4)=15 — so brute force is feasible. The mean value provides a strong constraint that uniquely identifies the correct slot assignment.

**Fallback (no mean available):** If the question has no matching mean value, use a heuristic:
- Sum >= 95%: assign to last N categories (most positive)
- Sum < 90%: last value is likely `dont_know`, assign rest to last (N-1) positive categories

### Residual limitations

Reconstructed distributions may have ~0.2-0.5 point mean difference from the actual value because stacked bar percentages are integer-rounded in the PDF and values below ~5% may be invisible in the chart.

---

## Demographics parsing

**Parser:** `pipeline/src/parser/charts.ts` (`parseDemographics`)

Demographics sections contain three distributions:
- **Birth year** (`Födelseår`): keys are 4-digit years
- **Child gender** (`Barnets kön`): keys are Flicka, Pojke, Annat, Annan
- **Parent gender** (`Svarandens kön`): keys are Kvinna, Man, Annat, Annan, Ej binär

The parser enters each section on header detection and exits on:
- Lines starting with `...` (chart question markers)
- Section headers (Svarsfrekvens, Normer och värden, etc.)
- Invalid keys for the current section (e.g., a gender section encountering a non-gender key)

---

## Gender split parsing

**Parser:** `pipeline/src/parser/charts.ts` (`parseGenderSplitsFromLayout`, `parseGenderSplits`)

Two extraction methods are tried in order:

1. **Layout-based** (preferred): Parses `pdftotext -layout` output for `Könsuppdelad andel positiva` sections. Matches patterns like:
   - 2024-2025: `"Könsuppdelad andel positiva svar"` section header
   - 2020-2023: `"Könsuppdelad andel positiva"` header

2. **Coordinate-based** (fallback): Uses pdf2json positioned text items for coordinate-aware extraction. Less reliable because pdf2json often collapses all items to the same coordinates.

Each question has three values: Total, Flicka (girls), Pojke (boys) as percentage of positive responses.
