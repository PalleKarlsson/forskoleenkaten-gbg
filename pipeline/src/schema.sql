-- gr_enkater schema

CREATE TABLE IF NOT EXISTS survey_years (
  year        INTEGER PRIMARY KEY,
  crawled_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS areas (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL REFERENCES survey_years(year),
  name        TEXT NOT NULL,
  url_slug    TEXT NOT NULL,
  UNIQUE (year, url_slug)
);

CREATE TABLE IF NOT EXISTS schools (
  id          SERIAL PRIMARY KEY,
  clean_name  TEXT NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION
);

-- Merge case-only duplicate schools before creating the case-insensitive index.
-- Idempotent: safe to re-run even if no duplicates exist.
DO $$
DECLARE
  r RECORD;
  keep_id INTEGER;
BEGIN
  FOR r IN
    SELECT LOWER(COALESCE(address, clean_name)) AS lkey,
           array_agg(id ORDER BY id) AS ids
    FROM schools
    GROUP BY LOWER(COALESCE(address, clean_name))
    HAVING COUNT(*) > 1
  LOOP
    keep_id := r.ids[1];
    FOR i IN 2..array_length(r.ids, 1) LOOP
      -- Move references from duplicate to canonical school
      UPDATE school_name_variants SET school_id = keep_id WHERE school_id = r.ids[i];
      UPDATE pdf_reports SET school_id = keep_id WHERE school_id = r.ids[i];
      UPDATE pdf_reports SET parent_school_id = keep_id WHERE parent_school_id = r.ids[i];
      DELETE FROM schools WHERE id = r.ids[i];
    END LOOP;
  END LOOP;
END $$;

-- Drop old case-sensitive index if it exists, then create case-insensitive one
DROP INDEX IF EXISTS schools_dedup_key;
CREATE UNIQUE INDEX IF NOT EXISTS schools_dedup_key
  ON schools (LOWER(COALESCE(address, clean_name)));

CREATE TABLE IF NOT EXISTS school_name_variants (
  id          SERIAL PRIMARY KEY,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  url_slug    TEXT NOT NULL,
  area_id     INTEGER NOT NULL REFERENCES areas(id),
  UNIQUE (area_id, url_slug)
);

CREATE TABLE IF NOT EXISTS pdf_reports (
  id            SERIAL PRIMARY KEY,
  school_id     INTEGER NOT NULL REFERENCES schools(id),
  year          INTEGER NOT NULL REFERENCES survey_years(year),
  report_type   TEXT NOT NULL DEFAULT 'school',  -- 'school' | 'unit' | 'total'
  unit_name     TEXT,
  pdf_url       TEXT NOT NULL UNIQUE,
  local_path    TEXT,
  downloaded_at TIMESTAMPTZ,
  parsed_at     TIMESTAMPTZ,
  parse_error   TEXT,
  area_id       INTEGER REFERENCES areas(id),
  parent_school_id INTEGER REFERENCES schools(id)
);

-- For existing databases: add new columns to pdf_reports
ALTER TABLE pdf_reports ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES areas(id);
ALTER TABLE pdf_reports ADD COLUMN IF NOT EXISTS parent_school_id INTEGER REFERENCES schools(id);
ALTER TABLE pdf_reports ADD COLUMN IF NOT EXISTS report_category TEXT;

CREATE TABLE IF NOT EXISTS report_metadata (
  pdf_report_id           INTEGER PRIMARY KEY REFERENCES pdf_reports(id),
  response_rate           REAL,
  respondents             INTEGER,
  total_invited           INTEGER,
  birth_year_distribution JSONB,
  child_gender_distribution JSONB,
  parent_gender_distribution JSONB
);

CREATE TABLE IF NOT EXISTS question_areas (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id               SERIAL PRIMARY KEY,
  question_area_id INTEGER REFERENCES question_areas(id),
  text             TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS question_means (
  id              SERIAL PRIMARY KEY,
  pdf_report_id   INTEGER NOT NULL REFERENCES pdf_reports(id),
  question_id     INTEGER NOT NULL REFERENCES questions(id),
  mean_gr         REAL,
  mean_goteborg   REAL,
  mean_district   REAL,
  mean_school     REAL,
  historical_means JSONB,
  UNIQUE (pdf_report_id, question_id)
);

CREATE TABLE IF NOT EXISTS question_responses (
  id                    SERIAL PRIMARY KEY,
  pdf_report_id         INTEGER NOT NULL REFERENCES pdf_reports(id),
  question_id           INTEGER NOT NULL REFERENCES questions(id),
  pct_strongly_agree    REAL,
  pct_agree             REAL,
  pct_neither           REAL,
  pct_disagree          REAL,
  pct_strongly_disagree REAL,
  pct_dont_know         REAL,
  UNIQUE (pdf_report_id, question_id)
);

CREATE TABLE IF NOT EXISTS gender_split (
  id              SERIAL PRIMARY KEY,
  pdf_report_id   INTEGER NOT NULL REFERENCES pdf_reports(id),
  question_id     INTEGER NOT NULL REFERENCES questions(id),
  pct_total       REAL,
  pct_flicka      REAL,
  pct_pojke       REAL,
  UNIQUE (pdf_report_id, question_id)
);

CREATE TABLE IF NOT EXISTS unit_means (
  id               SERIAL PRIMARY KEY,
  pdf_report_id    INTEGER NOT NULL REFERENCES pdf_reports(id),
  unit_name        TEXT NOT NULL,
  question_area_id INTEGER NOT NULL REFERENCES question_areas(id),
  mean_value       REAL,
  UNIQUE (pdf_report_id, unit_name, question_area_id)
);

CREATE TABLE IF NOT EXISTS important_questions (
  id              SERIAL PRIMARY KEY,
  pdf_report_id   INTEGER NOT NULL REFERENCES pdf_reports(id),
  question_id     INTEGER NOT NULL REFERENCES questions(id),
  rank            INTEGER NOT NULL,
  pct             REAL,
  UNIQUE (pdf_report_id, question_id)
);
