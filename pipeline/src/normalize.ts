/**
 * Normalization utilities for survey values and school names.
 * Shared between crawler, geocoder, export, and tests.
 */

const KNOWN_LOWER_WORDS = new Set([
  "förskola", "förskolan", "föräldrakooperativ", "föräldrakooperativet", "och", "i",
]);

/** Check if a string is ALL CAPS (only looking at letter characters). */
function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^a-zA-ZåäöÅÄÖéÉ]/g, "");
  return letters.length > 1 && letters === letters.toUpperCase();
}

/** Convert ALL CAPS string to title case, lowercasing known filler words (except first). */
function titleCaseFromAllCaps(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && KNOWN_LOWER_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Compute a clean display name from the raw parsed school name.
 * 1. Strip .pdf suffix
 * 2. Strip leading numeric area prefixes (e.g. "03_Kortedala" → "Kortedala")
 * 3. Expand abbreviations (fsk → förskola, försk. → förskola, etc.)
 * 4. Normalize ALL CAPS to title case
 * 5. Ensure first letter is capitalized
 * 6. Trim and collapse whitespace
 */
export function computeCleanName(originalName: string): string {
  let s = originalName.trim();

  // 1. Strip .pdf suffix
  s = s.replace(/\.pdf$/i, "");

  // 2. Strip leading numeric area prefix (e.g. "03_Kortedala")
  s = s.replace(/^\d+[_-]/, "");

  // 2b. Strip "PO " prefix (pedagogisk omsorg unit naming, e.g. "PO Rimsmedsgatan 1H")
  s = s.replace(/^PO\s+/i, "");

  // 2c. Fix missing space in "FörskolaNAME" concatenation (e.g. "FörskolaMELONGATAN 3")
  s = s.replace(/^([Ff]örskola)([A-ZÅÄÖ].*)$/, (_, prefix, rest) => {
    if (isAllCaps(rest)) rest = titleCaseFromAllCaps(rest);
    return prefix + " " + rest;
  });

  // 3. Expand abbreviations (order matters: compound forms first)
  s = s.replace(/\bfam\.försk\.?/gi, "familjeförskola");
  s = s.replace(/\bfam\.dagh\.?/gi, "familjedaghem");
  s = s.replace(/försk\./gi, "förskola");
  s = s.replace(/\bfsk\.?(?=\s|$)/gi, "förskola");

  // 3b. Join "Montessori förskola/n" → compound word
  s = s.replace(/\bMontessori\s+(förskola|förskolan)\b/g, "Montessori$1");
  s = s.replace(/\bmontessori\s+(förskola|förskolan)\b/g, "montessori$1");

  // 3c. Normalize "cooperativ" → "kooperativ" (Swedish spelling)
  s = s.replace(/cooperativ/gi, "kooperativ");

  // 4. ALL CAPS → title case with known lowercase words
  if (isAllCaps(s)) {
    s = titleCaseFromAllCaps(s);
  }

  // 5. Ensure first letter is capitalized
  if (s.length > 0 && s[0] !== s[0].toUpperCase()) {
    s = s[0].toUpperCase() + s.slice(1);
  }

  // 6. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Normalize concatenated house number ranges by inserting a dash.
 * The 2021 survey website strips dashes from address ranges:
 * "Standargatan 1012" → "Standargatan 10-12"
 * Only applies when the trailing digits form a plausible ascending range
 * (both halves similar magnitude, difference ≤ 20).
 */
function normalizeAddressRange(address: string): string {
  return address.replace(/(\d{3,})$/, (numStr) => {
    const len = numStr.length;
    // Even-length: split at midpoint (e.g., "1012" → "10","12")
    if (len >= 4 && len % 2 === 0) {
      const mid = len / 2;
      const first = parseInt(numStr.slice(0, mid), 10);
      const second = parseInt(numStr.slice(mid), 10);
      if (second > first && second - first <= 20 && !numStr.slice(mid).startsWith("0")) {
        return `${first}-${second}`;
      }
    }
    // Odd-length: try shorter first half (e.g., "410" → "4","10")
    if (len >= 3 && len % 2 === 1) {
      const mid = Math.floor(len / 2);
      const first = parseInt(numStr.slice(0, mid), 10);
      const second = parseInt(numStr.slice(mid), 10);
      if (second > first && second - first <= 20 && !numStr.slice(mid).startsWith("0")) {
        return `${first}-${second}`;
      }
    }
    return numStr;
  });
}

/**
 * Extract a street address from a clean school name, if present.
 * Matches patterns like "Kärralundsgatan 11", "Bondegärdet 18 B", "Åkermansvägen 1-5".
 * Returns null if no address pattern is found.
 */
export function extractAddress(cleanName: string): string | null {
  const m = cleanName.match(
    /^(.+?\s+\d+(?:\s*-\s*\d+)?(?:\s*[A-Za-z])?)(?:\s+\S.*)?$/i,
  );
  if (!m) return null;
  return normalizeAddressRange(m[1]);
}

/**
 * Clean up a school name for display and geocoding.
 * @deprecated Use computeCleanName() instead.
 */
export function cleanSchoolName(name: string): string {
  return computeCleanName(name);
}

/**
 * Determine the measurement scale for a given year.
 * Different survey eras use different Likert scales:
 * - 2007-2009 BARN (XLS):        1-3 scale
 * - 2007-2009 FÖRÄLDRAR (XLS):   1-10 scale (+ NKI 0-100 indices)
 * - 2012-2014 (Scandinfo NKI):   1-10 scale (+ NKI 0-100 indices)
 * - 2015-2018 (ECERS/7-point):   1-7 scale
 * - 2020-2025 (5-point):         1-5 scale
 */
export function getScale(year: number, category?: 'barn' | 'foralder'): { min: number; max: number; label: string } {
  if (year <= 2009) {
    if (category === 'foralder') return { min: 1, max: 10, label: "1-10" };
    return { min: 1, max: 3, label: "1-3" };
  }
  if (year <= 2014) return { min: 1, max: 10, label: "1-10" };
  if (year <= 2018) return { min: 1, max: 7, label: "1-7" };
  return { min: 1, max: 5, label: "1-5" };
}

/**
 * Normalize a mean value to 0-100 scale.
 * For NKI indices (already 0-100), returns the value as-is.
 * For question means on any scale, linearly maps [min, max] → [0, 100].
 */
export function normalize(value: number | null, year: number, questionText?: string, category?: 'barn' | 'foralder'): number | null {
  if (value === null) return null;
  // NKI indices are already on 0-100 scale
  if (questionText && questionText.startsWith("NKI ")) return value;
  const scale = getScale(year, category);
  return Math.round(((value - scale.min) / (scale.max - scale.min)) * 100 * 100) / 100;
}
