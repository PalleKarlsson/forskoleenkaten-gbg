# Cross-Era Mean Normalization

## The problem

The Gothenburg preschool surveys use 4 different measurement scales across 5 format eras:

| Era | Years | Scale | Range |
|-----|-------|-------|-------|
| XLS | 2007-2009 | 1-3 | 3-point Likert |
| Scandinfo/NKI | 2012-2014 | 1-10 + NKI 0-100 | 10-point Likert + composite index |
| ECERS | 2015 | 1-7 | 7-point Likert |
| 7-point | 2016-2018 | 1-7 | 7-point Likert |
| 5-point | 2020-2025 | 1-5 | 5-point Likert |

A score of 4.0 means very different things on a 1-5 scale (80th percentile) vs. a 1-7 scale (50th percentile) vs. a 1-10 scale (33rd percentile). To enable cross-era comparison and consistent color-coding on the map, all means are normalized to a common 0-100 scale.

## Storage approach

**Raw means** are stored in PostgreSQL in their native scale. The `question_means` table contains the original values exactly as parsed from the source PDF/XLS:

```sql
-- Example: 5-point era school mean
INSERT INTO question_means (pdf_report_id, question_id, mean_school)
VALUES (354, 12, 4.52);  -- Stored as-is on the 1-5 scale
```

**Normalization happens at export time** in `pipeline/src/export.ts`. This means:
- The database always contains source-faithful data
- Normalization can be adjusted without re-parsing
- Both raw and normalized values are available in the exported JSON

## Scale detection

The `getScale()` function determines the measurement scale based on year:

```typescript
function getScale(year: number): { min: number; max: number; label: string } {
  if (year <= 2009) return { min: 1, max: 3, label: "1-3" };
  if (year <= 2014) return { min: 1, max: 10, label: "1-10" };
  if (year <= 2018) return { min: 1, max: 7, label: "1-7" };
  return { min: 1, max: 5, label: "1-5" };
}
```

## Normalization formula

For standard question means:

```
normalized = ((value - min) / (max - min)) * 100
```

Rounded to 2 decimal places:

```typescript
function normalize(value: number | null, year: number, questionText?: string): number | null {
  if (value === null) return null;
  if (questionText && questionText.startsWith("NKI ")) return value;  // Already 0-100
  const scale = getScale(year);
  return Math.round(((value - scale.min) / (scale.max - scale.min)) * 100 * 100) / 100;
}
```

### NKI special case

NKI indices (questions with text starting with `"NKI "`) from the 2012-2014 Scandinfo era are already on a 0-100 scale. These are returned as-is without transformation.

## Concrete examples

### 5-point era (2020-2025)

A school mean of **4.52** on the 1-5 scale:

```
normalized = ((4.52 - 1) / (5 - 1)) * 100
           = (3.52 / 4) * 100
           = 88.00
```

### 7-point era (2016-2018)

A school mean of **5.60** on the 1-7 scale:

```
normalized = ((5.60 - 1) / (7 - 1)) * 100
           = (4.60 / 6) * 100
           = 76.67
```

### Scandinfo era (2012-2014)

A question mean of **7.80** on the 1-10 scale:

```
normalized = ((7.80 - 1) / (10 - 1)) * 100
           = (6.80 / 9) * 100
           = 75.56
```

An NKI index of **72** (already 0-100):

```
normalized = 72  (no transformation)
```

### XLS era (2007-2009)

A unit mean of **2.40** on the 1-3 scale:

```
normalized = ((2.40 - 1) / (3 - 1)) * 100
           = (1.40 / 2) * 100
           = 70.00
```

## Where normalization is used

### Export (index.json)

The `exportIndex()` function computes `avgNormalized` for each school — the normalized average across all question means (excluding NKI indices):

```typescript
const avgMean = parseFloat(parseFloat(row.avg_mean).toFixed(2));
meansMap.set(`${row.school_id}-${row.year}`, {
  avgMean,
  avgNormalized: normalize(avgMean, row.year) ?? 0,
  // ...
});
```

NKI indices are excluded from the average calculation (`q2.text NOT LIKE 'NKI %'`) to avoid mixing scales.

### Export (detail JSON)

Each question mean in the detail file includes both raw and normalized values:

```typescript
means: means.rows.map((m) => ({
  question: m.question,
  school: m.mean_school,             // Raw value in native scale
  normalized: normalize(m.mean_school, report.year, m.question),  // 0-100
  // ...
})),
```

### Frontend (map colors)

The map view uses normalized scores for color-coding school markers:
- Green (`#3fb950`): normalized >= 70
- Orange (`#d29922`): normalized >= 50
- Red (`#f85149`): normalized < 50
- Gray (`#484f58`): no data

## Response distribution mapping

Response distributions use a different mapping approach since they represent percentages, not means.

### XLS era (3-point → 5-point storage)

The 3-point XLS responses are mapped to the 5-point storage columns:

| XLS category | Weight | Stored as |
|-------------|--------|-----------|
| Low (1) | Negative | `pct_strongly_disagree` |
| Medium (2) | Neutral | `pct_neither` |
| High (3) | Positive | `pct_strongly_agree` |
| No answer | — | (not stored) |

The intermediate categories (`pct_disagree`, `pct_agree`) are left null.

### 5-point PDF era (mean-guided assignment)

For PDF formats, stacked bar chart percentages must be assigned to the correct Likert category using the mean-guided C(6,N) brute-force algorithm. See [survey-formats.md](survey-formats.md#mean-guided-c6n-category-assignment) for the full algorithm description.

## Limitations and caveats

1. **Cross-era comparison is approximate.** Different scales, question wordings, and survey methodologies mean that a normalized score of 75 in 2008 is not directly comparable to 75 in 2024. The normalization enables rough comparison and consistent visualization, not statistical equivalence.

2. **NKI indices are composite scores**, not simple means. They are weighted combinations of multiple quality factors. Comparing NKI 72 to a normalized mean of 72 from another era is particularly imprecise.

3. **Scale endpoints differ in meaning.** A 1 on a 3-point scale ("low") is a weaker negative signal than a 1 on a 5-point scale ("strongly disagree"). Linear normalization treats them equivalently.

4. **Response distribution reconstruction** from PDF bar charts introduces error of ~0.2-0.5 points because:
   - Bar chart percentages are integer-rounded in the PDF
   - Very small values (<5%) may be invisible in the chart
   - The C(6,N) assignment picks the best match but may not be exact

5. **School identity across eras** is not tracked. A school may have changed names, merged, or split between survey years. The system treats each year's data independently.
