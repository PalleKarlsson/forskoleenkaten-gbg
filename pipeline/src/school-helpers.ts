/**
 * Shared helpers for school dedup — used by crawler and parser.
 */
import { query } from "./db.js";
import { computeCleanName, extractAddress } from "./normalize.js";

/**
 * Find or create a school, maintaining dedup by COALESCE(address, clean_name).
 * Records the name variant in school_name_variants for crawler matching.
 * Returns the canonical school_id.
 */
export async function findOrCreateSchool(
  originalName: string,
  urlSlug: string,
  areaId: number,
): Promise<number> {
  const cleanName = computeCleanName(originalName);
  const address = extractAddress(cleanName);
  const dedupKey = address || cleanName;

  // 1. Check school_name_variants for existing mapping
  const variantResult = await query(
    `SELECT school_id FROM school_name_variants WHERE area_id = $1 AND url_slug = $2`,
    [areaId, urlSlug],
  );
  if (variantResult.rows.length > 0) {
    return variantResult.rows[0].school_id;
  }

  // 2. Look up schools by dedup key
  let schoolId: number;
  const schoolResult = await query(
    `SELECT id FROM schools WHERE LOWER(COALESCE(address, clean_name)) = LOWER($1)`,
    [dedupKey],
  );

  if (schoolResult.rows.length > 0) {
    schoolId = schoolResult.rows[0].id;
    // Update clean_name if current one is longer (more descriptive)
    await query(
      `UPDATE schools SET clean_name = $1 WHERE id = $2 AND LENGTH($1) > LENGTH(clean_name)`,
      [cleanName, schoolId],
    );
  } else {
    // 3. Insert new school
    const insertResult = await query(
      `INSERT INTO schools (clean_name, address) VALUES ($1, $2) RETURNING id`,
      [cleanName, address],
    );
    schoolId = insertResult.rows[0].id;
  }

  // 4. Record variant
  await query(
    `INSERT INTO school_name_variants (school_id, original_name, url_slug, area_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (area_id, url_slug) DO UPDATE SET school_id = $1, original_name = $2`,
    [schoolId, originalName, urlSlug, areaId],
  );

  return schoolId;
}
