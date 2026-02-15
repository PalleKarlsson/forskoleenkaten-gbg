import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.ts";

interface Props {
  schools: SchoolDetail[];
  colorMap: Map<number, string>;
}

export function CompareGenderGap({ schools, colorMap }: Props) {
  // Build question → area lookup from means
  const questionAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of schools) {
      for (const m of s.means) {
        if (!map.has(m.question)) map.set(m.question, m.area || "Övrigt");
      }
    }
    return map;
  }, [schools]);

  const schoolsWithData = useMemo(
    () => schools.filter((s) => s.genderSplit.length > 0),
    [schools],
  );
  const schoolsWithout = useMemo(
    () => schools.filter((s) => s.genderSplit.length === 0),
    [schools],
  );

  const { areas, series } = useMemo(() => {
    // Collect all area names
    const areaSet = new Set<string>();
    for (const s of schoolsWithData) {
      for (const g of s.genderSplit) {
        const area = questionAreaMap.get(g.question) || "Övrigt";
        areaSet.add(area);
      }
    }
    const areaList = [...areaSet];

    const seriesList = schoolsWithData.map((s) => {
      // Group gender entries by area and compute avg gap
      const areaGaps = new Map<string, number[]>();
      for (const g of s.genderSplit) {
        const area = questionAreaMap.get(g.question) || "Övrigt";
        if (g.flicka !== null && g.pojke !== null) {
          if (!areaGaps.has(area)) areaGaps.set(area, []);
          areaGaps.get(area)!.push(g.flicka - g.pojke);
        }
      }

      const data = areaList.map((area) => {
        const gaps = areaGaps.get(area);
        if (!gaps || gaps.length === 0) return 0;
        return parseFloat(
          (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1),
        );
      });

      return {
        name: s.schoolName,
        type: "bar" as const,
        data,
        itemStyle: { color: colorMap.get(s.id) },
      };
    });

    return { areas: areaList, series: seriesList };
  }, [schoolsWithData, colorMap, questionAreaMap]);

  if (schoolsWithData.length === 0) {
    return (
      <p style={{ color: "#8b949e", fontSize: 13 }}>
        Ingen könsuppdelad data tillgänglig.
      </p>
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ seriesName: string; value: number; marker: string }>) => {
        const lines = params.map((p) => {
          const label =
            p.value > 0
              ? `Flicka +${p.value}pp`
              : p.value < 0
                ? `Pojke +${Math.abs(p.value)}pp`
                : "Lika";
          return `${p.marker} ${p.seriesName}: ${label}`;
        });
        return lines.join("<br/>");
      },
    },
    legend: {
      data: schoolsWithData.map((s) => s.schoolName),
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
        formatter: (v: number) =>
          v > 0 ? `+${v}pp` : v < 0 ? `${v}pp` : "0",
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
      <p style={{ color: "#8b949e", fontSize: 12, margin: "0 0 8px" }}>
        Positiv = flicka högre andel positiva svar, negativ = pojke högre
      </p>
      <ReactECharts option={option} theme="dark" style={{ height }} />
      {schoolsWithout.length > 0 && (
        <p style={{ color: "#8b949e", fontSize: 12, marginTop: 8 }}>
          Saknar könsdata:{" "}
          {schoolsWithout.map((s) => s.schoolName).join(", ")}
        </p>
      )}
    </div>
  );
}
