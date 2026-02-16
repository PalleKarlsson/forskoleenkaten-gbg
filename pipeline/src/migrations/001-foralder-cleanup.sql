-- Migration: Clean up junk entries + backfill report_category
-- Run after schema migration (npm run schema adds the report_category column)

BEGIN;

-- ============================================================
-- Part A: Backfill report_category on existing data
-- ============================================================

-- FÖRÄLDRAR reports (URL contains FÖRÄLDRAR)
UPDATE pdf_reports SET report_category = 'foralder'
WHERE pdf_url LIKE '%F%R%LDRAR%' AND report_category IS NULL;

-- BARN XLS reports (years <= 2009, XLS format, not FÖRÄLDRAR)
UPDATE pdf_reports SET report_category = 'barn'
WHERE year <= 2009 AND report_category IS NULL AND pdf_url LIKE '%.xls%'
  AND pdf_url NOT LIKE '%F%R%LDRAR%';

-- Child unit reports from XLS parsing inherit category from parent
UPDATE pdf_reports child SET report_category = parent.report_category
FROM pdf_reports parent
WHERE child.pdf_url LIKE '%#%'
  AND child.pdf_url LIKE '%.xls%'
  AND parent.pdf_url = split_part(child.pdf_url, '#', 1)
  AND child.report_category IS NULL
  AND parent.report_category IS NOT NULL;

-- ============================================================
-- Part B: Null out parent_school_id references to junk schools
-- ============================================================

-- .xls-named schools and area-name container schools
UPDATE pdf_reports SET parent_school_id = NULL
WHERE parent_school_id IN (
  SELECT s.id FROM schools s
  WHERE s.clean_name LIKE '%.xls'
     OR s.id IN (5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
                 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
                 5609, 5611, 5612, 5613, 5623, 5630)
);

-- ============================================================
-- Part C: Delete Centrum (5472) and Lundby (5473) junk reports
-- Only delete their 2007-2009 reports from 99_ANNAN_REGI, keep 2015+ data
-- ============================================================

-- Find reports to delete for Centrum/Lundby
DELETE FROM report_metadata WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5472, 5473)
    AND pr.year <= 2009
    AND pr.pdf_url LIKE '%99_ANNAN_REGI%'
);
DELETE FROM question_means WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5472, 5473)
    AND pr.year <= 2009
    AND pr.pdf_url LIKE '%99_ANNAN_REGI%'
);
DELETE FROM question_responses WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5472, 5473)
    AND pr.year <= 2009
    AND pr.pdf_url LIKE '%99_ANNAN_REGI%'
);
DELETE FROM pdf_reports
WHERE school_id IN (5472, 5473)
  AND year <= 2009
  AND pdf_url LIKE '%99_ANNAN_REGI%';

-- ============================================================
-- Part D: Delete .xls-named schools (322) and area-name containers (22)
-- These all have 0 question data
-- ============================================================

-- Delete dependents for .xls-named schools
DELETE FROM report_metadata WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  JOIN schools s ON pr.school_id = s.id
  WHERE s.clean_name LIKE '%.xls'
);
DELETE FROM question_means WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  JOIN schools s ON pr.school_id = s.id
  WHERE s.clean_name LIKE '%.xls'
);
DELETE FROM question_responses WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  JOIN schools s ON pr.school_id = s.id
  WHERE s.clean_name LIKE '%.xls'
);
DELETE FROM pdf_reports WHERE school_id IN (
  SELECT id FROM schools WHERE clean_name LIKE '%.xls'
);
DELETE FROM school_name_variants WHERE school_id IN (
  SELECT id FROM schools WHERE clean_name LIKE '%.xls'
);
DELETE FROM schools WHERE clean_name LIKE '%.xls';

-- Delete dependents for area-name container schools (excluding Centrum/Lundby which we keep)
DELETE FROM report_metadata WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
                          5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
                          5609, 5611, 5612, 5613, 5623, 5630)
);
DELETE FROM question_means WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
                          5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
                          5609, 5611, 5612, 5613, 5623, 5630)
);
DELETE FROM question_responses WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.school_id IN (5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
                          5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
                          5609, 5611, 5612, 5613, 5623, 5630)
);
DELETE FROM pdf_reports WHERE school_id IN (
  5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
  5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
  5609, 5611, 5612, 5613, 5623, 5630
);
DELETE FROM school_name_variants WHERE school_id IN (
  5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
  5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
  5609, 5611, 5612, 5613, 5623, 5630
);
DELETE FROM schools WHERE id IN (
  5592, 5593, 5594, 5595, 5596, 5597, 5598, 5600,
  5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608,
  5609, 5611, 5612, 5613, 5623, 5630
);

-- ============================================================
-- Part E: Deduplicate 2007 Göteborg Totalt
-- Delete unit reports from area 207 (00_Göteborg_Totalt_och_Bakgrundsdata)
-- that duplicate data from individual area XLS files
-- ============================================================

-- Delete child unit reports that belong to Göteborg Totalt area
DELETE FROM report_metadata WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.area_id = 207 AND pr.pdf_url LIKE '%#%'
);
DELETE FROM question_means WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.area_id = 207 AND pr.pdf_url LIKE '%#%'
);
DELETE FROM question_responses WHERE pdf_report_id IN (
  SELECT pr.id FROM pdf_reports pr
  WHERE pr.area_id = 207 AND pr.pdf_url LIKE '%#%'
);
DELETE FROM pdf_reports
WHERE area_id = 207 AND pdf_url LIKE '%#%';

COMMIT;
