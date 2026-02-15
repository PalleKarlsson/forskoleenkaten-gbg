/** Loads JSON files from public/data/ — no API calls */

const BASE = import.meta.env.BASE_URL + "data";

export interface YearEntry {
  year: number;
  crawledAt: string | null;
}

export interface AreaEntry {
  id: number;
  year: number;
  name: string;
  slug: string;
}

export interface UnitEntry {
  reportId: number | null;
  name: string;
  avgMean: number | null;
  avgNormalized: number | null;
  respondents: number | null;
  responseRate: number | null;
}

export interface SchoolEntry {
  id: number;
  areaId: number;
  year: number;
  name: string;
  areaName: string;
  reportId: number | null;
  avgMean: number | null;
  avgNormalized: number | null;
  respondents: number | null;
  responseRate: number | null;
  lat: number | null;
  lng: number | null;
  units?: UnitEntry[];
}

export interface Index {
  years: YearEntry[];
  areas: AreaEntry[];
  schools: SchoolEntry[];
}

export interface AreaSchoolSummary {
  id: number;
  name: string;
  responseRate: number | null;
  respondents: number | null;
  areaMeans: Array<{ area: string; mean: number }>;
}

export interface AreaSchools {
  year: number;
  area: string;
  schools: AreaSchoolSummary[];
}

export interface MeanEntry {
  question: string;
  area: string;
  gr: number | null;
  goteborg: number | null;
  district: number | null;
  school: number | null;
  history: Record<string, number | null>;
}

export interface ResponseEntry {
  question: string;
  stronglyAgree: number | null;
  agree: number | null;
  neither: number | null;
  disagree: number | null;
  stronglyDisagree: number | null;
  dontKnow: number | null;
}

export interface GenderEntry {
  question: string;
  total: number | null;
  flicka: number | null;
  pojke: number | null;
}

export interface ImportantEntry {
  question: string;
  rank: number;
  pct: number | null;
}

export interface UnitMeanEntry {
  unit: string;
  area: string;
  mean: number | null;
}

export interface RelatedReport {
  reportId: number;
  reportType: string;
  unitName: string | null;
  schoolName: string;
}

export interface SchoolDetail {
  id: number;
  schoolId: number;
  schoolName: string;
  areaName: string;
  year: number;
  reportType: string;
  unitName: string | null;
  pdfUrl: string;
  metadata: {
    responseRate: number | null;
    respondents: number | null;
    totalInvited: number | null;
    birthYearDistribution: Record<string, number> | null;
    childGenderDistribution: Record<string, number> | null;
    parentGenderDistribution: Record<string, number> | null;
  } | null;
  means: MeanEntry[];
  responses: ResponseEntry[];
  genderSplit: GenderEntry[];
  importantQuestions: ImportantEntry[];
  unitMeans: UnitMeanEntry[];
  relatedReports?: RelatedReport[];
}

let indexCache: Index | null = null;

export async function loadIndex(): Promise<Index> {
  if (indexCache) return indexCache;
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`Failed to load index: ${res.status}`);
  indexCache = await res.json();
  return indexCache!;
}

export async function loadAreaSchools(
  year: number,
  areaSlug: string,
): Promise<AreaSchools> {
  const res = await fetch(`${BASE}/schools/${year}-${areaSlug}.json`);
  if (!res.ok) throw new Error(`Failed to load area schools: ${res.status}`);
  return res.json();
}

export async function loadSchoolDetail(id: number): Promise<SchoolDetail> {
  const res = await fetch(`${BASE}/detail/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load detail: ${res.status}`);
  return res.json();
}
