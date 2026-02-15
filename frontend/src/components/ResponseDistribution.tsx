import ReactECharts from "echarts-for-react";
import type { ResponseEntry } from "../data/client.tsx";

interface Props {
  responses: ResponseEntry[];
}

const COLORS = {
  stronglyAgree: "#2e7d32",
  agree: "#66bb6a",
  neither: "#ffd54f",
  disagree: "#ef5350",
  stronglyDisagree: "#c62828",
  dontKnow: "#484f58",
};

export function ResponseDistribution({ responses }: Props) {
  if (responses.length === 0) return null;

  const questions = responses.map((r) => r.question);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: [
        "Stämmer helt",
        "Stämmer ganska bra",
        "Varken eller",
        "Stämmer ganska dåligt",
        "Stämmer inte alls",
        "Vet ej",
      ],
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
      data: questions,
      inverse: true,
      axisLabel: {
        fontSize: 11,
        width: 300,
        overflow: "break",
      },
    },
    series: [
      {
        name: "Stämmer helt",
        type: "bar",
        stack: "total",
        color: COLORS.stronglyAgree,
        data: responses.map((r) => r.stronglyAgree),
      },
      {
        name: "Stämmer ganska bra",
        type: "bar",
        stack: "total",
        color: COLORS.agree,
        data: responses.map((r) => r.agree),
      },
      {
        name: "Varken eller",
        type: "bar",
        stack: "total",
        color: COLORS.neither,
        data: responses.map((r) => r.neither),
      },
      {
        name: "Stämmer ganska dåligt",
        type: "bar",
        stack: "total",
        color: COLORS.disagree,
        data: responses.map((r) => r.disagree),
      },
      {
        name: "Stämmer inte alls",
        type: "bar",
        stack: "total",
        color: COLORS.stronglyDisagree,
        data: responses.map((r) => r.stronglyDisagree),
      },
      {
        name: "Vet ej",
        type: "bar",
        stack: "total",
        color: COLORS.dontKnow,
        data: responses.map((r) => r.dontKnow),
      },
    ],
  };

  const height = Math.max(300, responses.length * 50 + 100);

  return <ReactECharts option={option} theme="dark" style={{ height }} />;
}
