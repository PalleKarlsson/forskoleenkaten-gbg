import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.ts";

interface Props {
  schools: SchoolDetail[];
  colorMap: Map<number, string>;
}

export function CompareTrendChart({ schools, colorMap }: Props) {
  // Collect all unique area names
  const areaNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const s of schools) {
      for (const m of s.means) {
        const area = m.area || "Övrigt";
        if (!seen.has(area)) {
          seen.add(area);
          names.push(area);
        }
      }
    }
    return names;
  }, [schools]);

  const [selectedArea, setSelectedArea] = useState("Helhetsomdöme");
  const [visibleSchools, setVisibleSchools] = useState<Set<number>>(
    () => new Set(schools.map((s) => s.id)),
  );

  // Use first available area if default doesn't exist
  const activeArea = areaNames.includes(selectedArea)
    ? selectedArea
    : areaNames[0] ?? "";

  // Collect all years across all schools for the selected area
  const { years, schoolSeries } = useMemo(() => {
    const yearSet = new Set<number>();

    const perSchool = schools.map((s) => {
      const yearMap = new Map<number, number[]>();
      for (const m of s.means) {
        if ((m.area || "Övrigt") !== activeArea) continue;

        // Current year
        if (m.school !== null) {
          if (!yearMap.has(s.year)) yearMap.set(s.year, []);
          yearMap.get(s.year)!.push(m.school);
          yearSet.add(s.year);
        }

        // History
        if (m.history) {
          for (const [y, val] of Object.entries(m.history)) {
            const yr = parseInt(y, 10);
            if (val !== null) {
              yearSet.add(yr);
              if (!yearMap.has(yr)) yearMap.set(yr, []);
              yearMap.get(yr)!.push(val);
            }
          }
        }
      }
      return { school: s, yearMap };
    });

    const sortedYears = [...yearSet].sort();

    const avg = (arr: number[]) =>
      arr.length > 0
        ? parseFloat(
            (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
          )
        : null;

    const series = perSchool.map(({ school, yearMap }) => ({
      id: school.id,
      name: school.schoolName,
      data: sortedYears.map((y) => avg(yearMap.get(y) ?? [])),
    }));

    return { years: sortedYears, schoolSeries: series };
  }, [schools, activeArea]);

  const toggleSchool = (id: number) => {
    setVisibleSchools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (years.length < 2) {
    return (
      <p style={{ color: "#8b949e", fontSize: 13 }}>
        Otillräcklig historisk data för trenddiagram.
      </p>
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { show: false },
    grid: { left: 50, right: 30, top: 10, bottom: 30 },
    xAxis: {
      type: "category",
      data: years.map(String),
    },
    yAxis: {
      type: "value",
      min: 1,
      max: 5,
    },
    series: schoolSeries
      .filter((s) => visibleSchools.has(s.id))
      .map((s) => ({
        name: s.name,
        type: "line",
        data: s.data,
        smooth: true,
        lineStyle: { color: colorMap.get(s.id), width: 2 },
        itemStyle: { color: colorMap.get(s.id) },
        symbolSize: 6,
      })),
  };

  return (
    <div>
      {/* Area selector */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={activeArea}
          onChange={(e) => setSelectedArea(e.target.value)}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid #30363d",
            borderRadius: 6,
            background: "#161b22",
            color: "#e6edf3",
          }}
        >
          {areaNames.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* School toggles */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 16px",
          marginBottom: 12,
        }}
      >
        {schools.map((s) => (
          <label
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#e6edf3",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={visibleSchools.has(s.id)}
              onChange={() => toggleSchool(s.id)}
              style={{ accentColor: colorMap.get(s.id) }}
            />
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: colorMap.get(s.id),
                display: "inline-block",
              }}
            />
            {s.schoolName}
          </label>
        ))}
      </div>

      <ReactECharts
        option={option}
        notMerge={true}
        theme="dark"
        style={{ height: 350 }}
      />
    </div>
  );
}
