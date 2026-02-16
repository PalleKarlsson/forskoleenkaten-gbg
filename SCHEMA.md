# Database Schema: gr_enkater

## Entity Relationship Diagram

```
┌─────────────────────────┐
│      survey_years       │
├─────────────────────────┤
│ PK  year        INTEGER │
│     crawled_at  TIMESTAMPTZ │
└──────────┬──────────────┘
           │
           │ 1
           ├──────────────────────────────────────┐
           │                                      │
           ▼ *                                    │
┌─────────────────────────┐                       │
│         areas           │                       │
├─────────────────────────┤                       │
│ PK  id        SERIAL    │                       │
│ FK  year      INTEGER ──┘                       │
│     name      TEXT NOT NULL                     │
│     url_slug  TEXT NOT NULL                     │
│     UNIQUE(year, url_slug)                      │
└──────────┬──────────────┘                       │
           │                                      │
           │ 1                                    │
           │                                      │
           ▼ *                                    │
┌────────────────────────────────┐                │
│    school_name_variants        │                │
├────────────────────────────────┤                │
│ PK  id              SERIAL    │                │
│ FK  school_id       INTEGER ──┼── schools.id   │
│     original_name   TEXT      │                │
│     url_slug        TEXT      │                │
│ FK  area_id         INTEGER ──┘                │
│     UNIQUE(area_id, url_slug)                  │
└────────────────────────────────┘                │
                                                  │
┌──────────────────────────────┐                  │
│          schools             │                  │
├──────────────────────────────┤                  │
│ PK  id              SERIAL   │                  │
│     clean_name      TEXT NOT NULL               │
│     address         TEXT                        │
│     lat             DOUBLE PRECISION            │
│     lng             DOUBLE PRECISION            │
│     UNIQUE INDEX ON                             │
│       COALESCE(address, clean_name)             │
└──────────┬──────────────────┘                   │
           │                                      │
           │ 1                                    │
           │                                      │
           ▼ *                                    │
┌──────────────────────────────────┐              │
│         pdf_reports              │              │
├──────────────────────────────────┤              │
│ PK  id              SERIAL      │              │
│ FK  school_id       INTEGER ────┘              │
│ FK  year            INTEGER ───────────────────┘
│ FK  area_id         INTEGER ── areas.id
│ FK  parent_school_id INTEGER ── schools.id
│     report_type     TEXT NOT NULL DEFAULT 'school'
│     unit_name       TEXT
│     pdf_url         TEXT NOT NULL UNIQUE
│     local_path      TEXT
│     downloaded_at   TIMESTAMPTZ
│     parsed_at       TIMESTAMPTZ
│     parse_error     TEXT
└──┬─────┬─────┬─────┬─────┬─────┘
   │     │     │     │     │
   │ 1   │ 1   │ 1   │ 1   │ 1
   │     │     │     │     │
   ▼ 1   │     │     │     │
┌────────────────────────────────┐
│      report_metadata           │
├────────────────────────────────┤
│PK/FK pdf_report_id     INTEGER │
│     response_rate         REAL │
│     respondents           INT  │
│     total_invited         INT  │
│     birth_year_distribution   JSONB
│     child_gender_distribution JSONB
│     parent_gender_distribution JSONB
└────────────────────────────────┘
   │     │     │     │
   │     │     │     │
   ▼ *   │     │     │
┌────────────────────────────────┐
│      question_means            │
├────────────────────────────────┤
│ PK  id              SERIAL    │
│ FK  pdf_report_id   INTEGER ──┼── pdf_reports.id
│ FK  question_id     INTEGER ──┼── questions.id
│     mean_gr         REAL      │
│     mean_goteborg   REAL      │
│     mean_district   REAL      │
│     mean_school     REAL      │
│     historical_means JSONB    │
│     UNIQUE(pdf_report_id,     │
│            question_id)       │
└───────────────────────────────┘
         │     │     │
         ▼ *   │     │
┌───────────────────────────────────┐
│      question_responses           │
├───────────────────────────────────┤
│ PK  id                    SERIAL  │
│ FK  pdf_report_id         INTEGER ┼── pdf_reports.id
│ FK  question_id           INTEGER ┼── questions.id
│     pct_strongly_agree    REAL    │
│     pct_agree             REAL    │
│     pct_neither           REAL    │
│     pct_disagree          REAL    │
│     pct_strongly_disagree REAL    │
│     pct_dont_know         REAL    │
│     UNIQUE(pdf_report_id,         │
│            question_id)           │
└───────────────────────────────────┘
               │     │
               ▼ *   │
┌──────────────────────────────┐
│       gender_split           │
├──────────────────────────────┤
│ PK  id              SERIAL  │
│ FK  pdf_report_id   INTEGER ┼── pdf_reports.id
│ FK  question_id     INTEGER ┼── questions.id
│     pct_total       REAL    │
│     pct_flicka      REAL    │
│     pct_pojke       REAL    │
│     UNIQUE(pdf_report_id,   │
│            question_id)     │
└─────────────────────────────┘
                     │
                     ▼ *
┌──────────────────────────────┐
│    important_questions       │
├──────────────────────────────┤
│ PK  id              SERIAL  │
│ FK  pdf_report_id   INTEGER ┼── pdf_reports.id
│ FK  question_id     INTEGER ┼── questions.id
│     rank            INTEGER │
│     pct             REAL    │
│     UNIQUE(pdf_report_id,   │
│            question_id)     │
└─────────────────────────────┘


┌─────────────────────────┐         ┌──────────────────────────────────┐
│    question_areas       │         │         unit_means               │
├─────────────────────────┤    1    ├──────────────────────────────────┤
│ PK  id           SERIAL │◄───────┤ PK  id               SERIAL     │
│     name    TEXT UNIQUE  │        │ FK  pdf_report_id    INTEGER ────┼── pdf_reports.id
│     display_order INTEGER│        │     unit_name        TEXT        │
└──────────┬──────────────┘        │ FK  question_area_id INTEGER ────┼── question_areas.id
           │                        │     mean_value       REAL        │
           │ 1                      │ UNIQUE(pdf_report_id,            │
           │                        │   unit_name, question_area_id)   │
           ▼ *                      └──────────────────────────────────┘
┌──────────────────┐
│    questions     │
├──────────────────┤
│ PK  id     SERIAL│
│ FK  question_area_id ── question_areas.id
│     text TEXT UNIQUE
└──────────────────┘
  Referenced by: question_means, question_responses,
                 gender_split, important_questions
```

## Table Summary

| Table | PK | Foreign Keys | Unique Constraints |
|---|---|---|---|
| **survey_years** | `year` | -- | -- |
| **areas** | `id` | `year` -> survey_years | `(year, url_slug)` |
| **schools** | `id` | -- | `COALESCE(address, clean_name)` (expression index) |
| **school_name_variants** | `id` | `school_id` -> schools (CASCADE), `area_id` -> areas | `(area_id, url_slug)` |
| **pdf_reports** | `id` | `school_id` -> schools, `year` -> survey_years, `area_id` -> areas, `parent_school_id` -> schools | `(pdf_url)` |
| **report_metadata** | `pdf_report_id` | `pdf_report_id` -> pdf_reports | -- |
| **question_areas** | `id` | -- | `(name)` |
| **questions** | `id` | `question_area_id` -> question_areas | `(text)` |
| **question_means** | `id` | `pdf_report_id` -> pdf_reports, `question_id` -> questions | `(pdf_report_id, question_id)` |
| **question_responses** | `id` | `pdf_report_id` -> pdf_reports, `question_id` -> questions | `(pdf_report_id, question_id)` |
| **gender_split** | `id` | `pdf_report_id` -> pdf_reports, `question_id` -> questions | `(pdf_report_id, question_id)` |
| **unit_means** | `id` | `pdf_report_id` -> pdf_reports, `question_area_id` -> question_areas | `(pdf_report_id, unit_name, question_area_id)` |
| **important_questions** | `id` | `pdf_report_id` -> pdf_reports, `question_id` -> questions | `(pdf_report_id, question_id)` |

## Core Hierarchy

```
survey_years  ->  areas  ->  school_name_variants  ->  schools
                    |                                     |
                    └──────────────── pdf_reports ────────┘
                                        |
                          +---------+---+---+---------+---------+
                          |         |       |         |         |
                    report_   question_ question_ gender_  important_
                    metadata  means     responses split    questions
```

- **survey_years**: One row per survey year (2007-2025)
- **areas**: Geographic districts within a year (e.g. "Centrum 1")
- **schools**: One row per physical preschool, deduplicated by `COALESCE(address, clean_name)`
- **school_name_variants**: Maps original crawled names/URL slugs back to their canonical school; one entry per (area, url_slug) combination
- **pdf_reports**: Individual PDF/XLS reports; `report_type` is 'school', 'unit', or 'total'; `area_id` preserves year/area grouping; `parent_school_id` links XLS sub-unit reports to their parent school
- **report_metadata**: 1:1 with pdf_reports; survey response demographics
- **question_areas**: Thematic groupings (e.g. "Trygghet och trivsel")
- **questions**: Individual survey questions
- **question_means**: Mean scores at GR/Goteborg/district/school level per question per report
- **question_responses**: Likert response distributions per question per report
- **gender_split**: Responses broken down by child gender
- **unit_means**: Per-unit mean scores by question area (from multi-unit school reports)
- **important_questions**: Ranked "most important" questions from each report
