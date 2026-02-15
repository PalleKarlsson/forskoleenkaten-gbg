import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.ts";

interface Props {
  schools: SchoolDetail[];
  colorMap: Map<number, string>;
}

type Reference = "goteborg" | "gr";

export function CompareDeviation({ schools, colorMap }: Props) {
  const [ref, setRef] = useState<Reference>("goteborg");

  const { areas, series } = useMemo(() => {
    // Collect all area names
    const areaSet = new Set<string>();
    for (const s of schools) {
      for (const m of s.means) {
        areaSet.add(m.area || "Övrigt");
      }
    }
    const areaList = [...areaSet];

    const seriesList = schools.map((s) => {
      // Compute per-area averages for school and reference
      const areaSchool = new Map<string, number[]>();
      const areaRef = new Map<string, number[]>();

      for (const m of s.means) {
        const area = m.area || "Övrigt";
        if (!areaSchool.has(area)) areaSchool.set(area, []);
        if (!areaRef.has(area)) areaRef.set(area, []);
        if (m.school !== null) areaSchool.get(area)!.push(m.school);
        const refVal = ref === "goteborg" ? m.goteborg : m.gr;
        if (refVal !== null) areaRef.get(area)!.push(refVal);
      }

      const avg = (arr: number[]) =>
        arr.length > 0
          ? arr.reduce((a, b) => a + b, 0) / arr.length
          : null;

      const data = areaList.map((area) => {
        const sAvg = avg(areaSchool.get(area) ?? []);
        const rAvg = avg(areaRef.get(area) ?? []);
        if (sAvg === null || rAvg === null) return 0;
        return parseFloat((sAvg - rAvg).toFixed(2));
      });

      return {
        name: s.schoolName,
        type: "bar" as const,
        data,
        itemStyle: { color: colorMap.get(s.id) },
      };
    });

    return { areas: areaList, series: seriesList };
  }, [schools, colorMap, ref]);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ seriesName: string; value: number; marker: string }>) => {
        const lines = params.map(
          (p) =>
            `${p.marker} ${p.seriesName}: ${p.value >= 0 ? "+" : ""}${p.value.toFixed(2)}`,
        );
        return lines.join("<br/>");
      },
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
      axisLabel: {
        formatter: (v: number) => (v >= 0 ? `+${v}` : String(v)),
      },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    yAxis: {
      type: "category",
      data: areas,
      inverse: true,
    },
    series,
  };

  const height = Math.max(250, areas.length * 60 + 100);

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <button
          onClick={() => setRef("goteborg")}
          style={{
            padding: "4px 12px",
            fontSize: 13,
            border:
              ref === "goteborg"
                ? "1px solid #58a6ff"
                : "1px solid #30363d",
            borderRadius: 6,
            background: ref === "goteborg" ? "#58a6ff" : "transparent",
            color: ref === "goteborg" ? "#0d1117" : "#e6edf3",
            cursor: "pointer",
            fontWeight: ref === "goteborg" ? 600 : 400,
          }}
        >
          vs Göteborg
        </button>
        <button
          onClick={() => setRef("gr")}
          style={{
            padding: "4px 12px",
            fontSize: 13,
            border:
              ref === "gr" ? "1px solid #58a6ff" : "1px solid #30363d",
            borderRadius: 6,
            background: ref === "gr" ? "#58a6ff" : "transparent",
            color: ref === "gr" ? "#0d1117" : "#e6edf3",
            cursor: "pointer",
            fontWeight: ref === "gr" ? 600 : 400,
          }}
        >
          vs GR
        </button>
      </div>
      <ReactECharts
        option={option}
        theme="dark"
        style={{ height }}
      />
    </div>
  );
}
