const PALETTE = [
  "#58a6ff",
  "#f0883e",
  "#3fb950",
  "#bc8cff",
  "#f85149",
  "#d29922",
  "#79c0ff",
  "#e8a87c",
  "#b8c47a",
  "#db61a2",
];

export function schoolColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function buildSchoolColorMap(schoolIds: number[]): Map<number, string> {
  return new Map(schoolIds.map((id, i) => [id, schoolColor(i)]));
}
