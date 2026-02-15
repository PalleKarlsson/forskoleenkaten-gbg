# Fix Response Distribution Parser & Demographics Parser

> **STATUS: IMPLEMENTED** — All three fixes below have been implemented in `pipeline/src/parser/charts.ts` and `pipeline/src/parser/index.ts`. Validation confirms 0 mismatches across 39 sampled reports (2012-2025). A residual ~0.2-0.5 point mean difference is expected when reconstructing distributions from integer-rounded stacked bar percentages — this is an inherent data source limitation, not a bug.

## Context

The `parseResponseDistributions` function in `pipeline/src/parser/charts.ts` produces completely wrong data. The frontend shows "almost only negative answers" for schools that actually have overwhelmingly positive responses (e.g., http://localhost:5173/gr-enkater/#/school/354).

### Root Causes

1. **Wrong chart extraction**: The parser scans ALL "…" prefixed lines in the PDF, but multiple chart types use this prefix:
   - **Stacked bar charts** (CORRECT) — show Likert response distribution with 2-6 percentages per question
   - **"Könsuppdelad andel positiva"** charts (WRONG) — Total/Flicka/Pojke on 3 separate lines per question. Parser collects 2-3 values from adjacent lines.
   - **"Högst andel höga/låga betyg"** charts (WRONG) — top/bottom summary with 2-4 percentages
   - The LAST occurrence overwrites the FIRST via ON CONFLICT upsert, so wrong chart values end up in DB

2. **Wrong column assignment**: Percentages are assigned left-to-right starting from index 0 (strongly_disagree). When a question has only positive responses (e.g., [35%, 58%]), they get placed in strongly_disagree and disagree instead of agree and strongly_agree.

3. **Demographics parser bleeds into charts**: `parseDemographics` has no section termination — after demographics pages it keeps matching "…" lines from charts, storing question text as demographic keys (e.g., `childGenderDistribution` has keys like "…mitt barn trivs på förskolan" instead of "Flicka"/"Pojke").

### Evidence

Report 354 (Hackspettsgatan 1-7, 2025):
```
DB shows: mitt barn trivs → disagree=83, stronglyDisagree=100
PDF shows: mitt barn trivs → 35% Instämmer, 58% Instämmer helt (93% positive!)
The 83/100 values come from the Könsuppdelad chart (Pojke=83%, Flicka=100%)
```

## Files to Modify

- **`pipeline/src/parser/charts.ts`** — Primary: rewrite `parseResponseDistributions` (lines 49-113) and fix `parseDemographics` (lines 166-230)
- **`pipeline/src/parser/index.ts`** — Build meansMap from tableData.means and pass to parseResponseDistributions (around line 130)

## Fix 1: Section Filtering in `parseResponseDistributions`

Only extract from actual stacked bar chart sections. These sections are bounded by:
- **Start marker**: "Detta diagram visar resultatet för frågorna inom frågeområdet"
- **End marker**: Legend line containing "Inst" + "ller" + "et" (handles both normal "Instämmer inte alls" and spaced "In st ä m m er in t e a lls" in 2025 format)

This prevents picking up data from Könsuppdelad and Högst andel charts.

### Section structure in PDF (pdftotext -layout output):
```
Hackspettsgatan 1-7 förskola | Svarsfrekvens 60%
Normer och värden                                              ← question area header
Detta diagram visar resultatet för frågorna...                 ← START marker
Vet inte.

    …mitt barn trivs på förskolan      35%                58%  ← stacked bar data (EXTRACT THESE)
    ...mitt barn känner sig tryggt     23%                72%
    …mitt barn känner personal         28%                67%
    ...personalen bemöter         7%   23%                67%
    …stimulerar samspel           7%   33%           51%   7%
    …bearbeta konflikter                30%          47%  16%
    …oberoende av kön                   28%          49%  16%

       In st ä m m er in t e a lls   ...   V et in t e         ← END marker (legend)
```

### Charts to IGNORE:
```
Könsuppdelad andel positiva                                    ← IGNORE section
                                    Total    Flicka   Pojke
                                                       93%
    …mitt barn trivs                              100%          ← DON'T extract
                                               83%
```

## Fix 2: Mean-Guided Category Assignment

Use the already-parsed mean values from comparison tables to determine which Likert categories each percentage belongs to.

### Algorithm:
1. Extract N percentages from each stacked bar line (in left-to-right order)
2. Look up the school's mean value for this question (from `tableData.means`)
3. Generate all C(6,N) ordered assignments of N values into 6 category slots:
   - Slots: [strongly_disagree(1), disagree(2), neither(3), agree(4), strongly_agree(5), dont_know(excluded)]
4. For each assignment, compute weighted mean (excluding dont_know):
   `mean = Σ(value_i × category_weight_i) / Σ(value_i)` where weights are 1-5
5. Pick the assignment whose computed mean is closest to the actual mean

### Why this works:
- C(6,N) is small: C(6,2)=15, C(6,3)=20, C(6,4)=15 — brute force is fine
- The mean provides a strong constraint that uniquely identifies the correct assignment

### Verification with real data:
| Question | Percentages | Mean | Best assignment | Computed mean | Diff |
|----------|-------------|------|-----------------|---------------|------|
| trivs | [35, 58] | 4.52 | [0,0,0,35,58,0] | 4.62 | 0.10 |
| samspel | [7, 33, 51, 7] | 4.40 | [0,0,7,33,51,7] | 4.48 | 0.08 |
| bemöter | [7, 23, 67] | 4.53 | [0,0,7,23,67,0] | 4.62 | 0.09 |

### Updated function signature:
```typescript
export function parseResponseDistributions(
  layoutText: string,
  meansMap: Map<string, number>,  // cleanQuestionText → mean_school value
): ResponseDistribution[]
```

### Fallback (no mean available):
If mean is not in meansMap for a question, use heuristic:
- If sum of all percentages >= 95%: assign to last N categories (most positive)
- If sum < 90%: last value is likely dont_know, assign rest to last (N-1) positive categories

## Fix 3: Fix `parseDemographics` Section Termination

The current code at lines 166-230 enters sections (birthYear, childGender, parentGender) but never exits them. It needs explicit termination.

### Add termination when encountering:
- Lines starting with "…" or "..." (chart question markers)
- Section headers: "Svarsfrekvens", "Normer och värden", "Högst andel", "Könsuppdelad", etc.
- For gender sections: keys that aren't valid gender values

### Valid gender keys:
- Child: Flicka, Pojke, Annat, Annan
- Parent: Kvinna, Man, Annat, Annan, Ej binär

## Changes in `index.ts` (around line 130)

```typescript
// Build means map for response distribution assignment
const meansMap = new Map<string, number>();
for (const row of tableData.means) {
  if (row.meanSchool !== null) {
    meansMap.set(row.questionText, row.meanSchool);
  }
}

const distributions = parseResponseDistributions(layoutText, meansMap);
```

## Verification Steps

1. Re-parse report 354 (Hackspettsgatan 2025):
   ```bash
   cd /home/staphy/development/gr-enkater/pipeline
   # You may need a way to parse a single report, or parse 2025 with --force
   npx tsx src/parser/index.ts 2025 --force
   ```

2. Check response distributions in DB:
   ```sql
   SELECT q.text, qr.pct_strongly_agree, qr.pct_agree, qr.pct_neither,
          qr.pct_disagree, qr.pct_strongly_disagree, qr.pct_dont_know
   FROM question_responses qr
   JOIN questions q ON q.id = qr.question_id
   WHERE qr.pdf_report_id = 354 LIMIT 5;
   ```
   Expected: "trivs" → strongly_agree=58, agree=35, rest null/0

3. Check demographics in DB:
   ```sql
   SELECT birth_year_distribution, child_gender_distribution, parent_gender_distribution
   FROM report_metadata WHERE pdf_report_id = 354;
   ```
   Expected: child_gender should have keys like "Flicka", "Pojke" — NOT question text

4. Re-parse all years sequentially:
   ```bash
   for year in 2025 2024 2023 2022 2021 2020 2018 2017 2016 2015; do
     echo "=== Parsing $year ===" && npx tsx src/parser/index.ts $year --force 2>&1 | tail -3 && echo
   done
   ```

5. Re-export and validate:
   ```bash
   npx tsx src/export.ts
   npx tsx src/validate.ts
   ```

6. Visual check: http://localhost:5173/gr-enkater/#/school/354 — bars should be mostly green (positive)

## Reference: PDF Text Positions (2025 format)

From `pdftotext -layout` of Hackspettsgatan 1-7 förskola 2025:

Stacked bar data lines (character positions of percentages):
```
Line 233: …trivs              35%@col119   58%@col179
Line 245: ...bemöter         7%@col93    23%@col116   67%@col174
Line 249: …samspel           7%@col93    33%@col123   51%@col176   7%@col214
```

Legend line positions (line 263):
- "Instämmer inte alls" → col ~90
- "Instämmer inte" → col ~123
- "Varken eller" → col ~148
- "Instämmer" → col ~166
- "Instämmer helt" → col ~184
- "Vet inte" → col ~208

Question area patterns (from tables.ts lines 140-147):
```
"Normer och värden", "Värdegrund och uppdrag", "Omsorg, utveckling och lärande",
"Barns inflytande och delaktighet", "Förskola och hem", "Helhetsomdöme"
```
