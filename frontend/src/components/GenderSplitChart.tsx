import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { GenderEntry, MeanEntry } from "../data/client.ts";

interface Props {
  data: GenderEntry[];
  means: MeanEntry[];
}

interface AreaGroup {
  area: string;
  entries: GenderEntry[];
}

export function GenderSplitChart({ data, means }: Props) {
  const [showGender, setShowGender] = useState(false);

  // Build question → area lookup from means
  const questionAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of means) {
      map.set(m.question, m.area || "Övrigt");
    }
    return map;
  }, [means]);

  // Group gender entries by area, preserving area order from means
  const areaGroups = useMemo(() => {
    const seen = new Set<string>();
    const areaOrder: string[] = [];
    for (const m of means) {
      const area = m.area || "Övrigt";
      if (!seen.has(area)) {
        seen.add(area);
        areaOrder.push(area);
      }
    }

    const groups = new Map<string, GenderEntry[]>();
    for (const area of areaOrder) groups.set(area, []);

    for (const entry of data) {
      const area = questionAreaMap.get(entry.question) || "Övrigt";
      if (!groups.has(area)) {
        groups.set(area, []);
        areaOrder.push(area);
      }
      groups.get(area)!.push(entry);
    }

    const result: AreaGroup[] = [];
    for (const area of areaOrder) {
      const entries = groups.get(area)!;
      if (entries.length > 0) result.push({ area, entries });
    }
    return result;
  }, [data, means, questionAreaMap]);

  if (data.length === 0) return null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#e6edf3", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showGender}
            onChange={() => setShowGender((v) => !v)}
            style={{ accentColor: "#58a6ff" }}
          />
          Visa könsuppdelat (Flicka / Pojke)
        </label>
      </div>

      {areaGroups.map((group) => (
        <AreaChart key={group.area} group={group} showGender={showGender} />
      ))}
    </div>
  );
}

function AreaChart({ group, showGender }: { group: AreaGroup; showGender: boolean }) {
  const labels = group.entries.map((e) => e.question);
  const barHeight = showGender ? 28 : 18;
  const rowHeight = showGender ? barHeight * 3 + 20 : barHeight + 24;
  const height = Math.max(150, group.entries.length * rowHeight + 80);

  const series: object[] = [
    {
      name: "Totalt",
      type: "bar",
      barGap: showGender ? "20%" : "0%",
      data: group.entries.map((d) => d.total),
      itemStyle: { color: "#3d8c8c" },
      label: {
        show: true,
        position: "right",
        formatter: (p: { value: number | null }) => p.value != null ? `${p.value}%` : "",
        fontSize: 11,
        color: "#e6edf3",
      },
    },
  ];

  if (showGender) {
    series.push(
      {
        name: "Flicka",
        type: "bar",
        data: group.entries.map((d) => d.flicka),
        itemStyle: { color: "#b8c47a" },
        label: {
          show: true,
          position: "right",
          formatter: (p: { value: number | null }) => p.value != null ? `${p.value}%` : "",
          fontSize: 11,
          color: "#e6edf3",
        },
      },
      {
        name: "Pojke",
        type: "bar",
        data: group.entries.map((d) => d.pojke),
        itemStyle: { color: "#e8a87c" },
        label: {
          show: true,
          position: "right",
          formatter: (p: { value: number | null }) => p.value != null ? `${p.value}%` : "",
          fontSize: 11,
          color: "#e6edf3",
        },
      },
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ seriesName: string; value: number | null; marker: string }>) => {
        const lines = params
          .filter((p) => p.value != null)
          .map((p) => `${p.marker} ${p.seriesName}: ${p.value}%`);
        return lines.join("<br/>");
      },
    },
    legend: showGender
      ? { data: ["Totalt", "Flicka", "Pojke"], bottom: 0, textStyle: { color: "#8b949e" } }
      : undefined,
    grid: {
      left: 220,
      right: 60,
      top: 10,
      bottom: showGender ? 40 : 10,
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { formatter: "{value}%", color: "#8b949e" },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    yAxis: {
      type: "category",
      data: labels,
      inverse: true,
      axisLabel: { fontSize: 11, color: "#c9d1d9", width: 200, overflow: "break" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#30363d" } },
    },
    series,
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={{ fontSize: 14, color: "#8b949e", margin: "0 0 4px" }}>{group.area}</h4>
      <ReactECharts option={option} notMerge={true} theme="dark" style={{ height }} />
    </div>
  );
}
