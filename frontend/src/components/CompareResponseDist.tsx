import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.ts";

interface Props {
  schools: SchoolDetail[];
  colorMap: Map<number, string>;
}

const COLORS = {
  stronglyAgree: "#2e7d32",
  agree: "#66bb6a",
  neither: "#ffd54f",
  disagree: "#ef5350",
  stronglyDisagree: "#c62828",
  dontKnow: "#484f58",
};

const RESPONSE_KEYS = [
  { key: "stronglyAgree" as const, label: "Stämmer helt", color: COLORS.stronglyAgree },
  { key: "agree" as const, label: "Stämmer ganska bra", color: COLORS.agree },
  { key: "neither" as const, label: "Varken eller", color: COLORS.neither },
  { key: "disagree" as const, label: "Stämmer ganska dåligt", color: COLORS.disagree },
  { key: "stronglyDisagree" as const, label: "Stämmer inte alls", color: COLORS.stronglyDisagree },
  { key: "dontKnow" as const, label: "Vet ej", color: COLORS.dontKnow },
];

/** Build a question → area map from means */
function buildQuestionAreaMap(schools: SchoolDetail[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of schools) {
    for (const m of s.means) {
      if (!map.has(m.question)) {
        map.set(m.question, m.area || "Övrigt");
      }
    }
  }
  return map;
}

export function CompareResponseDist({ schools }: Props) {
  const questionAreaMap = useMemo(() => buildQuestionAreaMap(schools), [schools]);

  // Collect unique area names
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

  const [selectedArea, setSelectedArea] = useState(() => areaNames[0] ?? "");

  const activeArea = areaNames.includes(selectedArea)
    ? selectedArea
    : areaNames[0] ?? "";

  // Get questions in this area and build y-axis labels (school + question)
  const { yLabels, series } = useMemo(() => {
    // Find questions in this area
    const areaQuestions = new Set<string>();
    for (const [q, area] of questionAreaMap) {
      if (area === activeArea) areaQuestions.add(q);
    }
    const questions = [...areaQuestions];

    // Build rows: for each question, one row per school
    const labels: string[] = [];
    for (const q of questions) {
      for (const s of schools) {
        labels.push(`${s.schoolName}: ${q}`);
      }
    }

    // Build series (one per response category)
    const seriesList = RESPONSE_KEYS.map(({ key, label, color }) => ({
      name: label,
      type: "bar" as const,
      stack: "total",
      color,
      data: questions.flatMap((q) =>
        schools.map((s) => {
          const resp = s.responses.find((r) => r.question === q);
          return resp ? (resp[key] ?? 0) : 0;
        }),
      ),
    }));

    return { yLabels: labels, series: seriesList };
  }, [schools, activeArea, questionAreaMap]);

  if (yLabels.length === 0) {
    return (
      <p style={{ color: "#8b949e", fontSize: 13 }}>
        Ingen svarsfördelningsdata tillgänglig.
      </p>
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: RESPONSE_KEYS.map((r) => r.label),
      bottom: 0,
      textStyle: { fontSize: 11 },
    },
    grid: {
      left: 10,
      right: 30,
      top: 10,
      bottom: 60,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      inverse: true,
      axisLabel: {
        fontSize: 10,
        width: 350,
        overflow: "break",
      },
    },
    series,
  };

  const height = Math.max(300, yLabels.length * 40 + 100);

  return (
    <div>
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

      <ReactECharts
        option={option}
        theme="dark"
        style={{ height }}
      />
    </div>
  );
}
