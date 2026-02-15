import ReactECharts from "echarts-for-react";

interface Props {
  birthYearDistribution: Record<string, number> | null;
  childGenderDistribution: Record<string, number> | null;
  parentGenderDistribution: Record<string, number> | null;
}

function HorizontalBar({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data);
  const categories = entries.map(([name]) => name);
  const values = entries.map(([, value]) => value);

  const option = {
    backgroundColor: "transparent",
    title: {
      text: title,
      left: "center",
      textStyle: { fontSize: 14, color: "#e6edf3" },
    },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: "{b}: {c}%" },
    grid: { left: 10, right: 50, top: 40, bottom: 10, containLabel: true },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: "#e6edf3", fontSize: 12 },
      inverse: true,
    },
    series: [
      {
        type: "bar",
        data: values,
        barMaxWidth: 24,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          formatter: "{c}%",
          color: "#8b949e",
          fontSize: 12,
        },
      },
    ],
  };

  const height = Math.max(120, categories.length * 36 + 60);

  return <ReactECharts option={option} theme="dark" style={{ height, flex: 1, minWidth: 280 }} />;
}

export function DemographicsPanel({
  birthYearDistribution,
  childGenderDistribution,
  parentGenderDistribution,
}: Props) {
  const hasData =
    birthYearDistribution || childGenderDistribution || parentGenderDistribution;
  if (!hasData) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {birthYearDistribution &&
        Object.keys(birthYearDistribution).length > 0 && (
          <HorizontalBar title="Födelseår" data={birthYearDistribution} />
        )}
      {childGenderDistribution &&
        Object.keys(childGenderDistribution).length > 0 && (
          <HorizontalBar title="Barnets kön" data={childGenderDistribution} />
        )}
      {parentGenderDistribution &&
        Object.keys(parentGenderDistribution).length > 0 && (
          <HorizontalBar title="Svarandens kön" data={parentGenderDistribution} />
        )}
    </div>
  );
}
