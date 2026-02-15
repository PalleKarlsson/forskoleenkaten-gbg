import ReactECharts from "echarts-for-react";
import type { MeanEntry } from "../data/client.tsx";

interface Props {
  means: MeanEntry[];
  currentYear: number;
  visibleAreas?: Set<string>;
}

export function TrendChart({ means, currentYear, visibleAreas }: Props) {
  // Collect all historical years + current
  const yearSet = new Set<number>();
  yearSet.add(currentYear);

  for (const m of means) {
    if (m.history) {
      for (const y of Object.keys(m.history)) {
        yearSet.add(parseInt(y, 10));
      }
    }
  }

  const years = [...yearSet].sort();
  if (years.length < 2) return null;

  // Group by question area
  const areaMap = new Map<string, Map<number, number[]>>();

  for (const m of means) {
    const area = m.area || "Övrigt";
    if (!areaMap.has(area)) areaMap.set(area, new Map());
    const yearMap = areaMap.get(area)!;

    // Current year value
    if (m.school !== null) {
      if (!yearMap.has(currentYear)) yearMap.set(currentYear, []);
      yearMap.get(currentYear)!.push(m.school);
    }

    // Historical values
    if (m.history) {
      for (const [y, val] of Object.entries(m.history)) {
        const yr = parseInt(y, 10);
        if (val !== null) {
          if (!yearMap.has(yr)) yearMap.set(yr, []);
          yearMap.get(yr)!.push(val);
        }
      }
    }
  }

  const avg = (arr: number[]) =>
    arr.length > 0
      ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
      : null;

  const allSeries = [...areaMap.entries()].map(([area, yearMap]) => ({
    name: area,
    type: "line" as const,
    data: years.map((y) => avg(yearMap.get(y) || [])),
    smooth: true,
  }));

  const series = visibleAreas
    ? allSeries.filter((s) => visibleAreas.has(s.name))
    : allSeries;

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { bottom: 0 },
    grid: { left: 50, right: 30, top: 10, bottom: 60 },
    xAxis: {
      type: "category",
      data: years.map(String),
    },
    yAxis: {
      type: "value",
      min: 1,
      max: 5,
    },
    series,
  };

  return <ReactECharts option={option} notMerge={true} theme="dark" style={{ height: 350 }} />;
}
