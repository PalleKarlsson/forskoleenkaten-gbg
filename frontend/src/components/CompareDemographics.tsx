import ReactECharts from "echarts-for-react";
import type { SchoolDetail } from "../data/client.ts";

interface Props {
  schools: SchoolDetail[];
  colorMap: Map<number, string>;
}

export function CompareDemographics({ schools, colorMap }: Props) {
  const schoolNames = schools.map((s) => s.schoolName);

  const responseRates = schools.map(
    (s) => s.metadata?.responseRate ?? null,
  );
  const hasRates = responseRates.some((r) => r !== null);

  const option = hasRates
    ? {
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
        grid: {
          left: 150,
          right: 60,
          top: 10,
          bottom: 10,
        },
        xAxis: {
          type: "value",
          min: 0,
          max: 100,
          axisLabel: { formatter: "{value}%" },
        },
        yAxis: {
          type: "category",
          data: schoolNames,
          inverse: true,
        },
        series: [
          {
            name: "Svarsfrekvens",
            type: "bar",
            data: schools.map((s) => ({
              value: s.metadata?.responseRate ?? 0,
              itemStyle: { color: colorMap.get(s.id) },
            })),
            barMaxWidth: 30,
            label: {
              show: true,
              position: "right",
              formatter: (p: { value: number }) =>
                p.value > 0 ? `${p.value}%` : "—",
              color: "#e6edf3",
              fontSize: 12,
            },
          },
        ],
      }
    : null;

  return (
    <div>
      {option && (
        <div style={{ marginBottom: 16 }}>
          <h4
            style={{ fontSize: 14, color: "#8b949e", margin: "0 0 8px" }}
          >
            Svarsfrekvens
          </h4>
          <ReactECharts
            option={option}
            theme="dark"
            style={{ height: Math.max(120, schools.length * 50 + 40) }}
          />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ borderBottom: "2px solid #30363d" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  color: "#e6edf3",
                }}
              >
                Förskola
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "6px 8px",
                  color: "#e6edf3",
                }}
              >
                Svarsfrekvens
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "6px 8px",
                  color: "#e6edf3",
                }}
              >
                Antal svar
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "6px 8px",
                  color: "#e6edf3",
                }}
              >
                Inbjudna
              </th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s, i) => (
              <tr
                key={s.id}
                style={{
                  borderBottom: "1px solid #21262d",
                  background: i % 2 === 0 ? "#161b22" : "transparent",
                }}
              >
                <td style={{ padding: "6px 8px", color: "#e6edf3" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: colorMap.get(s.id),
                      marginRight: 8,
                      verticalAlign: "middle",
                    }}
                  />
                  {s.schoolName}
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    color: "#e6edf3",
                  }}
                >
                  {s.metadata?.responseRate != null
                    ? `${s.metadata.responseRate}%`
                    : "—"}
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    color: "#e6edf3",
                  }}
                >
                  {s.metadata?.respondents ?? "—"}
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    color: "#e6edf3",
                  }}
                >
                  {s.metadata?.totalInvited ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
