/**
 * Coordinate-based chart label extraction using pdf2json output.
 * Extracts: response distributions, gender splits, demographics.
 */
import type { TextItem } from "./utils.js";
import {
  groupByRows,
  findInRegion,
  parsePct,
  cleanQuestionText,
} from "./utils.js";

export interface ResponseDistribution {
  questionText: string;
  pctStronglyAgree: number | null;
  pctAgree: number | null;
  pctNeither: number | null;
  pctDisagree: number | null;
  pctStronglyDisagree: number | null;
  pctDontKnow: number | null;
}

export interface GenderSplitRow {
  questionText: string;
  pctTotal: number | null;
  pctFlicka: number | null;
  pctPojke: number | null;
}

export interface Demographics {
  birthYearDistribution: Record<string, number>;
  childGenderDistribution: Record<string, number>;
  parentGenderDistribution: Record<string, number>;
}

/**
 * Given N percentages (left-to-right from stacked bar) and the school's mean value,
 * find the best assignment of percentages to the 6 response categories:
 *   [stronglyDisagree(1), disagree(2), neither(3), agree(4), stronglyAgree(5), dontKnow(excluded)]
 *
 * Uses brute-force over all C(6,N) ordered assignments, picking the one whose
 * weighted mean (excluding dont_know) is closest to the actual mean.
 */
function assignCategories(
  pcts: number[],
  meanValue: number | null,
): [number | null, number | null, number | null, number | null, number | null, number | null] {
  const N = pcts.length;
  const slots: [number | null, number | null, number | null, number | null, number | null, number | null] =
    [null, null, null, null, null, null];

  if (N === 0) return slots;
  if (N >= 6) {
    // All 6 categories present
    return [pcts[0] ?? null, pcts[1] ?? null, pcts[2] ?? null, pcts[3] ?? null, pcts[4] ?? null, pcts[5] ?? null];
  }

  // Generate all C(6,N) ordered slot assignments
  function* combinations(n: number, k: number, start = 0): Generator<number[]> {
    if (k === 0) { yield []; return; }
    for (let i = start; i <= n - k; i++) {
      for (const rest of combinations(n, k - 1, i + 1)) {
        yield [i, ...rest];
      }
    }
  }

  // Compute weighted mean for an assignment (excluding slot 5 = dont_know)
  function computeMean(assignment: number[]): number | null {
    let weightedSum = 0;
    let total = 0;
    for (let i = 0; i < assignment.length; i++) {
      const slot = assignment[i];
      if (slot < 5) { // slots 0-4 are Likert 1-5
        weightedSum += pcts[i] * (slot + 1);
        total += pcts[i];
      }
    }
    return total > 0 ? weightedSum / total : null;
  }

  if (meanValue === null) {
    // Fallback: no mean available. Use heuristic — assign to rightmost categories.
    const sum = pcts.reduce((a, b) => a + b, 0);
    if (sum < 90 && N >= 2) {
      // Last value is likely dont_know
      const startSlot = 5 - (N - 1); // fill from right, last goes to slot 5
      for (let i = 0; i < N - 1; i++) slots[Math.max(0, startSlot + i)] = pcts[i];
      slots[5] = pcts[N - 1];
    } else {
      // All Likert, assign to last N slots (most positive)
      const startSlot = 5 - N;
      for (let i = 0; i < N; i++) slots[Math.max(0, startSlot + i)] = pcts[i];
    }
    return slots;
  }

  // Brute force: try all C(6,N) assignments, pick closest mean
  // Penalize large dont_know (slot 5) values — in practice dont_know rarely exceeds 20%
  let bestAssignment: number[] | null = null;
  let bestScore = Infinity;

  for (const assignment of combinations(6, N)) {
    const computed = computeMean(assignment);
    if (computed === null) continue;
    const diff = Math.abs(computed - meanValue);

    // Penalty for unreasonably large dont_know values
    let dontKnowPct = 0;
    for (let i = 0; i < assignment.length; i++) {
      if (assignment[i] === 5) dontKnowPct += pcts[i];
    }
    const dkPenalty = Math.max(0, dontKnowPct - 20) * 0.03;

    // Contiguity penalty: in real surveys, non-zero Likert categories are adjacent.
    // Penalize gaps between Likert slots (0-4) to prevent e.g. D+SA beating A+SA.
    const likertSlots = assignment.filter(s => s < 5).sort((a, b) => a - b);
    let gapCount = 0;
    for (let j = 1; j < likertSlots.length; j++) {
      gapCount += likertSlots[j] - likertSlots[j - 1] - 1;
    }
    const gapPenalty = gapCount * 0.2;

    const score = diff + dkPenalty + gapPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestAssignment = assignment;
    }
  }

  if (bestAssignment) {
    for (let i = 0; i < bestAssignment.length; i++) {
      slots[bestAssignment[i]] = pcts[i];
    }
  }

  return slots;
}

/**
 * Check if a line is a stacked bar chart legend line.
 * Handles both normal text ("Instämmer inte alls") and
 * spaced text ("In st ä m m er in t e a lls") in 2025 format.
 */
function isLegendLine(line: string): boolean {
  const stripped = line.replace(/\s+/g, "").toLowerCase();
  // Must contain "instämmer" (or variants) AND "vet" (for "vet inte")
  // AND "varken" (for "Varken eller") — this distinguishes real legend lines
  // from wrapped section headers like "(Instämmer helt), plus Vet inte."
  return (
    (stripped.includes("instämmer") || stripped.includes("instammer") ||
     stripped.includes("instämmerintealls") || stripped.includes("instammerintealls")) &&
    (stripped.includes("vetinte") || stripped.includes("vetej")) &&
    (stripped.includes("varkeneller") || stripped.includes("varken"))
  );
}

/**
 * Check if a line starts with ellipsis (question marker in charts).
 */
function startsWithEllipsis(trimmed: string): boolean {
  return trimmed.startsWith("\u2026") || trimmed.startsWith("…") || trimmed.startsWith("...");
}

/**
 * Extract response distributions from stacked bar chart pages.
 *
 * Only extracts from the actual "Svarsfördelning" stacked bar charts,
 * identified by the section marker "Detta diagram visar resultatet för frågorna".
 * Ignores other charts (Könsuppdelad, Högst andel) that also use "…" prefixes.
 *
 * Uses mean-guided assignment to correctly map percentages to Likert categories,
 * since the stacked bar only shows non-zero segments (making positional assignment unreliable).
 */
export function parseResponseDistributions(
  layoutText: string,
  meansMap: Map<string, number> = new Map(),
): ResponseDistribution[] {
  const results: ResponseDistribution[] = [];
  const seen = new Set<string>(); // deduplicate by question text
  const lines = layoutText.split("\n");

  let inStackedBarSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect stacked bar section start — multiple format variants:
    // 2025+: "Detta diagram visar resultatet för frågorna inom frågeområdet..."
    // 2020-2024: "Resultat per fråga" as standalone line (chart AND table pages share this header,
    //            but table pages have no "…XX%" lines so they produce no results)
    if ((trimmed.includes("Detta diagram visar resultatet f") &&
         trimmed.includes("r fr") &&
         trimmed.includes("gorna")) ||
        /^Resultat per fr.ga$/i.test(trimmed)) {
      inStackedBarSection = true;
      continue;
    }

    // Detect stacked bar section end (legend line)
    if (inStackedBarSection && isLegendLine(line)) {
      inStackedBarSection = false;
      continue;
    }

    // Terminate on non-response-distribution sections
    if (inStackedBarSection && (
        /K.nsuppdelad/i.test(trimmed) ||
        /Viktigaste\s+fr/i.test(trimmed) ||
        /H.gst andel/i.test(trimmed))) {
      inStackedBarSection = false;
      continue;
    }

    // Only process question lines within stacked bar sections
    if (!inStackedBarSection) continue;

    // Question lines either start with "…" or have text + percentages
    // (Helhetsomdöme questions start with "Jag" instead of "…")
    if (!startsWithEllipsis(trimmed)) {
      const textBeforePct = trimmed.replace(/\d+%.*/, "").trim();
      if (textBeforePct.length < 15 || !/\d+%/.test(trimmed)) continue;
    }

    // Collect this question's text and all percentages across continuation lines
    let questionText = "";
    const allPcts: number[] = [];
    let lastLine = i;

    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const l = lines[j].trim();
      if (j > i && (startsWithEllipsis(l) || l === "" ||
          (l.replace(/\d+%.*/, "").trim().length >= 15 && /\d+%/.test(l)))) break;

      // Extract percentages
      const pctMatches = l.match(/\d+%/g);
      if (pctMatches) {
        for (const p of pctMatches) {
          const val = parsePct(p);
          if (val !== null) allPcts.push(val);
        }
      }

      // Extract question text (non-percentage part)
      const textPart = l.replace(/\d+%/g, "").trim();
      if (textPart.length > 3) {
        questionText += (questionText ? " " : "") + textPart;
      }
      lastLine = j;
    }

    questionText = cleanQuestionText(questionText);

    if (allPcts.length >= 2 && questionText.length > 10 && !seen.has(questionText)) {
      seen.add(questionText);

      // Look up mean value for this question (fuzzy: table texts are often truncated)
      let meanValue = meansMap.get(questionText) ?? null;
      if (meanValue === null) {
        for (const [key, val] of meansMap) {
          if (questionText.startsWith(key) || key.startsWith(questionText)) {
            meanValue = val;
            break;
          }
        }
      }

      // Assign percentages to categories using mean-guided algorithm
      const [sd, d, n, a, sa, dk] = assignCategories(allPcts, meanValue);

      results.push({
        questionText,
        pctStronglyDisagree: sd,
        pctDisagree: d,
        pctNeither: n,
        pctAgree: a,
        pctStronglyAgree: sa,
        pctDontKnow: dk,
      });
    }

    i = lastLine;
  }

  return results;
}

/**
 * Extract gender split data from the pdf2json coordinate data.
 * The gender chart shows Total/Flicka/Pojke percentages per question.
 */
export function parseGenderSplits(
  items: TextItem[],
  pageRange: { startPage: number; endPage: number },
): GenderSplitRow[] {
  const results: GenderSplitRow[] = [];

  // Filter items to the gender split pages
  const pageItems = items.filter(
    (t) => t.page >= pageRange.startPage && t.page <= pageRange.endPage,
  );

  // Group into rows by Y position
  const rows = groupByRows(pageItems, 1);

  for (const row of rows) {
    const text = row.map((t) => t.text).join(" ");

    // Look for question text followed by percentages
    // Pattern: question  XX%  YY%  ZZ%
    const questionItems = row.filter(
      (t) => !t.text.match(/^\d+%?$/) && t.text.length > 10,
    );
    const pctItems = row.filter((t) => t.text.match(/\d+%/));

    if (questionItems.length > 0 && pctItems.length >= 2) {
      const questionText = cleanQuestionText(
        questionItems.map((t) => t.text).join(" "),
      );
      const pcts = pctItems.map((t) => parsePct(t.text));

      results.push({
        questionText,
        pctTotal: pcts[0] ?? null,
        pctFlicka: pcts[1] ?? null,
        pctPojke: pcts[2] ?? null,
      });
    }
  }

  return results;
}

/**
 * Extract gender split data from pdftotext layout text (2025 fallback).
 * 2025 PDFs have all pdf2json items at the same coordinates, making
 * coordinate-based extraction useless. This parses the layout text instead.
 *
 * Format: each question has 3 percentage-bearing lines (Total, Flicka, Pojke).
 * Question text appears on one or more of these lines.
 */
export function parseGenderSplitsFromLayout(
  layoutText: string,
): GenderSplitRow[] {
  const results: GenderSplitRow[] = [];
  const seen = new Set<string>();
  const lines = layoutText.split("\n");

  let inGenderSection = false;

  // Collect percentage-bearing lines within gender split sections
  type PctLine = { text: string; pct: number; lineIdx: number };
  const pctLines: PctLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect gender split section:
    // 2024-2025: "...andelen positiva...totalt och uppdelat på barnets kön"
    // 2020-2023: "Könsuppdelad andel positiva"
    if ((/andelen positiva/i.test(trimmed) && /barnets k.n/i.test(trimmed)) ||
        /^K.nsuppdelad andel positiva$/i.test(trimmed)) {
      inGenderSection = true;
      continue;
    }

    if (!inGenderSection) continue;

    // End of gender sections
    if (/Fr.geomr.de per enhet/i.test(trimmed) || /Medelv.rde per enhet/i.test(trimmed)) {
      break;
    }

    // Skip axis/scale lines (multiple percentages like "0%  10%  20%  ...")
    const allPcts = trimmed.match(/\d+%/g);
    if (!allPcts || allPcts.length !== 1) continue;

    // Skip "Total  Flicka  Pojke" header lines (no percentage data)
    if (/Total\s+Flicka\s+Pojke/i.test(trimmed)) continue;

    // Skip page header/footer lines (e.g. "Borgaregatan 5 förskola | Svarsfrekvens 48%")
    if (/Svarsfrekvens/i.test(trimmed)) continue;

    const pctVal = parsePct(allPcts[0]);
    if (pctVal === null) continue;

    // Extract non-percentage text
    const textPart = trimmed.replace(/\d+%/g, "").trim();

    pctLines.push({ text: textPart, pct: pctVal, lineIdx: i });
  }

  // Group into triplets: Total, Flicka, Pojke
  for (let i = 0; i + 2 < pctLines.length; i += 3) {
    const total = pctLines[i];
    const flicka = pctLines[i + 1];
    const pojke = pctLines[i + 2];

    // Collect question text from percentage-bearing lines AND
    // text-only lines between them (for multi-line questions where
    // text appears on non-percentage lines)
    const textParts: string[] = [];
    // Start from Total's line — only collect between-lines within the triplet
    let lastProcessedLine = total.lineIdx;
    // Include text from Total's line first
    if (total.text.length > 3) {
      textParts.push(total.text);
    }
    for (const entry of [flicka, pojke]) {
      // Grab text from non-pct lines between previous triplet entry and this one
      for (let li = lastProcessedLine + 1; li < entry.lineIdx; li++) {
        const between = lines[li].trim();
        if (between.length > 3 && !between.match(/\d+%/) && !/Svarsfrekvens/i.test(between) &&
            !/Total\s+Flicka/i.test(between) && !/andelen positiva/i.test(between)) {
          textParts.push(between);
        }
      }
      if (entry.text.length > 3) {
        textParts.push(entry.text);
      }
      lastProcessedLine = entry.lineIdx;
    }

    const questionText = cleanQuestionText(textParts.join(" "));
    if (questionText.length < 10) continue;
    if (seen.has(questionText)) continue;
    seen.add(questionText);

    results.push({
      questionText,
      pctTotal: total.pct,
      pctFlicka: flicka.pct,
      pctPojke: pojke.pct,
    });
  }

  return results;
}

/**
 * Extract demographic data (birth year, child gender, parent gender).
 * These appear as bar charts with labels.
 */
export function parseDemographics(
  items: TextItem[],
  layoutText: string,
): Demographics {
  const demographics: Demographics = {
    birthYearDistribution: {},
    childGenderDistribution: {},
    parentGenderDistribution: {},
  };

  const lines = layoutText.split("\n");

  // Birth year distribution: lines like "2020    15%"  or "2019    32%"
  let inBirthYear = false;
  let inChildGender = false;
  let inParentGender = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.includes("födelseår") || lower.includes("fodelsear") || lower.includes("barnets födelseår")) {
      inBirthYear = true;
      inChildGender = false;
      inParentGender = false;
      continue;
    }
    if (lower.includes("barnets kön") || lower.includes("barnets kon")) {
      inBirthYear = false;
      inChildGender = true;
      inParentGender = false;
      continue;
    }
    if (lower.includes("svarandens kön") || lower.includes("svarandens kon") || lower.includes("vårdnadshavarens kön")) {
      inBirthYear = false;
      inChildGender = false;
      inParentGender = true;
      continue;
    }

    // Terminate demographic sections when we leave the demographics page
    const trimmedDemo = line.trim();
    if (trimmedDemo.length > 0 && (inBirthYear || inChildGender || inParentGender)) {
      // Stop on chart markers or section headers
      if (startsWithEllipsis(trimmedDemo) ||
          /Svarsfrekvens/i.test(trimmedDemo) ||
          /Normer och v/i.test(trimmedDemo) ||
          /H.gst andel/i.test(trimmedDemo) ||
          /K.nsuppdelad/i.test(trimmedDemo) ||
          /Detta diagram/i.test(trimmedDemo) ||
          /Resultat per fr/i.test(trimmedDemo) ||
          /Viktigaste/i.test(trimmedDemo)) {
        inBirthYear = false;
        inChildGender = false;
        inParentGender = false;
        continue;
      }
    }

    // Empty line — keep going within section
    if (line.trim() === "") continue;

    // Parse key-value: "2020   15%" or "Flicka   48%"
    const kvMatch = line.match(/^\s*(.+?)\s{2,}(\d+)\s*%/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = parseInt(kvMatch[2], 10);

      if (inBirthYear && /^\d{4}$/.test(key)) {
        demographics.birthYearDistribution[key] = value;
      } else if (inChildGender) {
        // Only accept valid gender keys
        const validChild = /^(flicka|pojke|annat|annan|ej bin|non.bin)/i;
        if (validChild.test(key)) {
          demographics.childGenderDistribution[key] = value;
        } else {
          // Unrecognized key — likely left the demographics section
          inChildGender = false;
        }
      } else if (inParentGender) {
        const validParent = /^(kvinna|man|annat|annan|ej bin|non.bin)/i;
        if (validParent.test(key)) {
          demographics.parentGenderDistribution[key] = value;
        } else {
          inParentGender = false;
        }
      }
    }
  }

  return demographics;
}

/**
 * Extract important questions (most valued by parents).
 * These appear as a ranked list.
 */
export interface ImportantQuestion {
  rank: number;
  questionText: string;
  pct: number | null;
}

export function parseImportantQuestions(
  layoutText: string,
): ImportantQuestion[] {
  const results: ImportantQuestion[] = [];
  const lines = layoutText.split("\n");

  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (lower.includes("viktigaste") || lower.includes("mest betydelse")) {
      // Skip TOC entries (end with a page number like "  24")
      if (/\s+\d{1,3}\s*$/.test(line.trim())) continue;
      inSection = true;
      continue;
    }

    if (inSection) {
      const trimmed = line.trim();

      // Numbered format (2020-2024): "1. mitt barn trivs   23%"
      const match = trimmed.match(/^(\d+)[.\s]+(.+?)\s{2,}(\d+)\s*%/);
      if (match) {
        results.push({
          rank: parseInt(match[1], 10),
          questionText: cleanQuestionText(match[2]),
          pct: parseInt(match[3], 10),
        });
        if (results.length >= 5 || (trimmed === "" && results.length > 0)) break;
        continue;
      }

      // If we found a numbered result, use old break logic
      if (results.length > 0 && trimmed === "") break;

      // Stop on axis lines (2025 bar chart: "0%   10%   20%  ...  100%")
      const pctMatches = trimmed.match(/\d+%/g);
      if (pctMatches && pctMatches.length >= 5) break;

      // Unnumbered format (2025): collect remaining section lines, group by blanks
      if (results.length === 0 && !match) {
        // Collect all section lines until axis line
        const sectionLines: string[] = [];
        for (let j = i; j < lines.length; j++) {
          const sl = lines[j].trim();
          const slPcts = sl.match(/\d+%/g);
          if (slPcts && slPcts.length >= 5) break; // axis line
          sectionLines.push(sl);
        }

        // Split into groups by blank lines
        const groups: string[][] = [];
        let current: string[] = [];
        for (const sl of sectionLines) {
          if (sl === "") {
            if (current.length > 0) { groups.push(current); current = []; }
          } else {
            current.push(sl);
          }
        }
        if (current.length > 0) groups.push(current);

        // Each group with a percentage is a question
        for (const group of groups) {
          const fullText = group.join(" ");
          const pctMatch = fullText.match(/(\d+)\s*%/);
          if (!pctMatch) continue;
          const pct = parseInt(pctMatch[1], 10);
          const textPart = fullText.replace(/\d+\s*%/g, "").replace(/\s+/g, " ").trim();
          if (textPart.length >= 15) {
            results.push({
              rank: results.length + 1,
              questionText: cleanQuestionText(textPart),
              pct,
            });
            if (results.length >= 5) break;
          }
        }
        break; // Done with 2025 format
      }
    }
  }

  return results;
}

/**
 * Extract per-unit/class mean values.
 * These appear in a table with unit names as rows and question areas as columns.
 */
export interface UnitMeanRow {
  unitName: string;
  areaName: string;
  meanValue: number | null;
}

export function parseUnitMeans(layoutText: string): UnitMeanRow[] {
  const results: UnitMeanRow[] = [];
  const lines = layoutText.split("\n");

  // Look for the unit comparison table
  // Header: "                  Trygghet  Utveckling  Inflytande  Relation  Helhets..."
  // Row:    "Avdelning Sol      4.32       4.21        4.10       4.45      4.20"

  const AREA_NAMES_SHORT = [
    "Trygghet",
    "Utveckling",
    "Inflytande",
    "Relation",
    "Helhet",
    "Övergripande",
  ];

  // Fixed column-to-area mapping for 2025 format (6 columns in fixed order)
  // 2025 uses full area names across multiple header lines; we map by position
  // to the same short names the caller (index.ts) uses for AREA_ORDER lookup.
  const AREA_NAMES_2025 = [
    "Trygghet",
    "Utveckling",
    "Inflytande",
    "Relation",
    "Helhet",
    "Övergripande",
  ];

  let headerLineIdx = -1;
  let columnPositions: Array<{ name: string; start: number }> = [];
  let in2025Section = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 2025 format: detect section header "Frågeområde per enhet" or "Medelvärde per enhet"
    // Skip TOC entries (end with a page number)
    if ((/Fr.geomr.de per enhet/i.test(trimmed) || /Medelv.rde per enhet/i.test(trimmed)) &&
        !/\s+\d{1,3}\s*$/.test(trimmed)) {
      in2025Section = true;
      headerLineIdx = -1; // reset, will find data rows by number pattern
      continue;
    }

    // In 2025 section: skip header lines (area names), find data rows with 6 decimal numbers
    if (in2025Section) {
      if (trimmed === "") continue;

      // Data row: unit name followed by 6 decimal numbers
      const numbers = line.match(/\d+\.\d+/g);
      if (numbers && numbers.length >= 6) {
        // Extract unit name: text before the first number
        const firstNumIdx = line.indexOf(numbers[0]);
        const unitName = line.substring(0, firstNumIdx).trim();
        if (unitName.length > 0) {
          for (let j = 0; j < 6 && j < numbers.length; j++) {
            const val = parseFloat(numbers[j]);
            if (!isNaN(val)) {
              results.push({
                unitName,
                areaName: AREA_NAMES_2025[j],
                meanValue: val,
              });
            }
          }
        }
      }
      continue;
    }

    // Legacy format: detect header line with short area names
    const matchingAreas = AREA_NAMES_SHORT.filter((a) =>
      line.toLowerCase().includes(a.toLowerCase()),
    );
    if (matchingAreas.length >= 3) {
      headerLineIdx = i;
      // Record column positions
      columnPositions = matchingAreas.map((a) => ({
        name: a,
        start: line.toLowerCase().indexOf(a.toLowerCase()),
      }));
      continue;
    }

    // Parse data rows after header (legacy format)
    if (headerLineIdx >= 0 && i > headerLineIdx) {
      if (line.trim() === "") {
        // Might be end of table
        if (i - headerLineIdx > 2) break;
        continue;
      }

      // Extract unit name (text before numbers)
      const nameMatch = line.match(/^\s*(.+?)\s{2,}[\d,]/);
      if (nameMatch) {
        const unitName = nameMatch[1].trim();
        // Extract numbers at each column position
        const numbers = line.match(/[\d,]+\.\d+|[\d,]+,\d+/g);
        if (numbers && columnPositions.length > 0) {
          for (
            let j = 0;
            j < Math.min(numbers.length, columnPositions.length);
            j++
          ) {
            const val = parseFloat(numbers[j].replace(",", "."));
            if (!isNaN(val)) {
              results.push({
                unitName,
                areaName: columnPositions[j].name,
                meanValue: val,
              });
            }
          }
        }
      }
    }
  }

  return results;
}
