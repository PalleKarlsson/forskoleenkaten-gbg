/** Shared utilities for PDF parsing */

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

/** Group text items into rows based on Y-coordinate proximity */
export function groupByRows(items: TextItem[], tolerance = 2): TextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextItem[][] = [];
  let currentRow: TextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - sorted[i - 1].y) <= tolerance) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [sorted[i]];
    }
  }
  rows.push(currentRow.sort((a, b) => a.x - b.x));

  return rows;
}

/** Find text items within a rectangular region */
export function findInRegion(
  items: TextItem[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): TextItem[] {
  return items.filter(
    (t) =>
      t.x >= bounds.minX &&
      t.x <= bounds.maxX &&
      t.y >= bounds.minY &&
      t.y <= bounds.maxY,
  );
}

/** Parse a Swedish decimal number (comma as separator) */
export function parseSwedishFloat(s: string): number | null {
  const cleaned = s.replace(",", ".").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Parse a percentage string like "47%" → 47 */
export function parsePct(s: string): number | null {
  const match = s.match(/([\d,]+)\s*%/);
  if (!match) return null;
  return parseSwedishFloat(match[1]);
}

/** Merge text items that are horizontally adjacent on the same row */
export function mergeHorizontal(items: TextItem[], gap = 5): TextItem[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const merged: TextItem[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.x - (prev.x + prev.width) <= gap) {
      prev.text += curr.text;
      prev.width = curr.x + curr.width - prev.x;
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

/** Clean question text — remove leading ellipsis, normalize whitespace, truncate if needed */
export function cleanQuestionText(text: string): string {
  let cleaned = text
    .replace(/^[…\u2026]+\s*/, "")  // Unicode ellipsis
    .replace(/^\.{2,}\s*/, "")       // ASCII dots
    .replace(/\s+/g, " ")
    .trim();
  // Normalize first character to lowercase for consistent matching
  // (table "Helhetsomdöme" questions start with "Jag", chart versions start with "…jag")
  if (cleaned.length > 0) {
    cleaned = cleaned[0].toLowerCase() + cleaned.substring(1);
  }
  // Truncate to avoid btree index overflow (max ~2704 bytes, ~600 chars with UTF-8)
  if (cleaned.length > 500) {
    cleaned = cleaned.substring(0, 500);
  }
  return cleaned;
}
