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
  area_id     INTEGER NOT NULL REFERENCES areas(id),
  name        TEXT NOT NULL,
  url_slug    TEXT NOT NULL,
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
  parse_error   TEXT
);

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

ALTER TABLE schools ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS parent_school_id INTEGER REFERENCES schools(id);
