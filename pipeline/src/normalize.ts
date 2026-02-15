/**
 * Normalization utilities for survey values and school names.
 * Shared between crawler, geocoder, export, and tests.
 */

/**
 * Clean up a school name for display and geocoding.
 * - Strips .pdf suffix
 * - For address-based names, strips trailing "förskola"/"förskolan"/"fsk"
 * - Trims whitespace
 */
export function cleanSchoolName(name: string): string {
  let s = name.trim();
  // Strip .pdf suffix
  s = s.replace(/\.pdf$/i, "");
  // Strip trailing " förskola", " förskolan", " fsk" as separate words
  s = s.replace(/\s+(?:förskolan?|fsk)$/i, "");
  return s.trim();
}

/**
 * Determine the measurement scale for a given year.
 * Different survey eras use different Likert scales:
 * - 2007-2009 (XLS):             1-3 scale
 * - 2012-2014 (Scandinfo NKI):   1-10 scale (+ NKI 0-100 indices)
 * - 2015-2018 (ECERS/7-point):   1-7 scale
 * - 2020-2025 (5-point):         1-5 scale
 */
export function getScale(year: number): { min: number; max: number; label: string } {
  if (year <= 2009) return { min: 1, max: 3, label: "1-3" };
  if (year <= 2014) return { min: 1, max: 10, label: "1-10" };
  if (year <= 2018) return { min: 1, max: 7, label: "1-7" };
  return { min: 1, max: 5, label: "1-5" };
}

/**
 * Normalize a mean value to 0-100 scale.
 * For NKI indices (already 0-100), returns the value as-is.
 * For question means on any scale, linearly maps [min, max] → [0, 100].
 */
export function normalize(value: number | null, year: number, questionText?: string): number | null {
  if (value === null) return null;
  // NKI indices (2012-2014) are already on 0-100 scale
  if (questionText && questionText.startsWith("NKI ")) return value;
  const scale = getScale(year);
  return Math.round(((value - scale.min) / (scale.max - scale.min)) * 100 * 100) / 100;
}
