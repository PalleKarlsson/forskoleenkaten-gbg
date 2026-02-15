import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.tsx";

interface Props {
  schools: SchoolDetail[];
  colorMap?: Map<number, string>;
}

export function SchoolCompare({ schools, colorMap }: Props) {
  if (schools.length < 2) return null;

  // Build area-level comparison
  const areaNames = new Set<string>();
  const schoolAreaMeans = schools.map((s) => {
    const map = new Map<string, number[]>();
    for (const m of s.means) {
      const area = m.area || "Övrigt";
      areaNames.add(area);
      if (!map.has(area)) map.set(area, []);
      if (m.school !== null) map.get(area)!.push(m.school);
    }
    return map;
  });

  const areas = [...areaNames];
  const avg = (arr: number[]) =>
    arr.length > 0
      ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
      : 0;

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: schools.map((s) => s.schoolName),
      bottom: 0,
    },
    grid: {
      left: 150,
      right: 30,
      top: 10,
      bottom: 60,
    },
    xAxis: {
      type: "value",
      min: 1,
      max: 5,
    },
    yAxis: {
      type: "category",
      data: areas,
      inverse: true,
    },
    series: schools.map((s, i) => ({
      name: s.schoolName,
      type: "bar",
      data: areas.map((a) => avg(schoolAreaMeans[i].get(a) || [])),
      ...(colorMap?.get(s.id) ? { itemStyle: { color: colorMap.get(s.id) } } : {}),
    })),
  };

  return <ReactECharts option={option} theme="dark" style={{ height: 350 }} />;
}
