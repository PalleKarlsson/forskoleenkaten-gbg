import { useState, useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { loadSchoolDetail } from "../data/client.ts";
import type { SchoolDetail } from "../data/client.ts";
import { buildSchoolColorMap } from "../utils/colors.ts";
import { SchoolCompare } from "../components/SchoolCompare.tsx";
import { CompareDemographics } from "../components/CompareDemographics.tsx";
import { CompareTrendChart } from "../components/CompareTrendChart.tsx";
import { CompareDeviation } from "../components/CompareDeviation.tsx";
import { CompareResponseDist } from "../components/CompareResponseDist.tsx";
import { CompareGenderGap } from "../components/CompareGenderGap.tsx";

export function Compare() {
  const [searchParams] = useSearchParams();
  const ids = (searchParams.get("ids") || "")
    .split(",")
    .filter(Boolean)
    .map(Number);

  const [schools, setSchools] = useState<SchoolDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length < 2) {
      setError("Välj minst 2 förskolor att jämföra.");
      setLoading(false);
      return;
    }

    Promise.all(ids.map((id) => loadSchoolDetail(id)))
      .then(setSchools)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const colorMap = useMemo(
    () => buildSchoolColorMap(schools.map((s) => s.id)),
    [schools],
  );

  const hasResponses = schools.some((s) => s.responses.length > 0);
  const hasGenderData = schools.some((s) => s.genderSplit.length > 0);

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
        <Link to="/browse" style={{ color: "#58a6ff", textDecoration: "none" }}>&larr; Tillbaka</Link>
        <h2>Jämför</h2>
        <p style={{ color: "#f85149" }}>{error}</p>
      </div>
    );
  }

  if (loading) return <p style={{ padding: 16 }}>Laddar...</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
      <Link to="/browse" style={{ color: "#58a6ff", textDecoration: "none" }}>
        &larr; Tillbaka
      </Link>

      <h2 style={{ marginTop: 16 }}>
        Jämför: {schools.map((s) => s.schoolName).join(" vs ")}
      </h2>

      {/* School info cards with color dots */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {schools.map((s) => (
          <div
            key={s.id}
            style={{
              flex: 1,
              minWidth: 200,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: colorMap.get(s.id),
                  flexShrink: 0,
                }}
              />
              <Link
                to={`/school/${s.id}`}
                style={{ color: "#58a6ff", textDecoration: "none" }}
              >
                {s.schoolName}
              </Link>
            </h3>
            <p style={{ margin: 0, color: "#8b949e", fontSize: 13 }}>
              {s.areaName} · {s.year}
            </p>
            {s.metadata && (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8b949e" }}>
                Svarsfrekvens: {s.metadata.responseRate ?? "—"}% ·{" "}
                {s.metadata.respondents ?? "—"} svar
              </p>
            )}
          </div>
        ))}
      </div>

      <Section title="Jämförelse per frågeområde">
        <SchoolCompare schools={schools} colorMap={colorMap} />
      </Section>

      <Section title="Utveckling över tid">
        <CompareTrendChart schools={schools} colorMap={colorMap} />
      </Section>

      <Section title="Bakgrund och svarsfrekvens">
        <CompareDemographics schools={schools} colorMap={colorMap} />
      </Section>

      <Section title="Avvikelse från genomsnitt">
        <CompareDeviation schools={schools} colorMap={colorMap} />
      </Section>

      {hasResponses && (
        <Section title="Svarsfördelning">
          <CompareResponseDist schools={schools} colorMap={colorMap} />
        </Section>
      )}

      {hasGenderData && (
        <Section title="Könsskillnader">
          <CompareGenderGap schools={schools} colorMap={colorMap} />
        </Section>
      )}

      <Section title="Medelvärden sida vid sida">
        <ComparisonTable schools={schools} />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3
        style={{
          fontSize: 18,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid #30363d",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function ComparisonTable({ schools }: { schools: SchoolDetail[] }) {
  // Collect all unique questions
  const allQuestions = new Map<string, string>();
  for (const s of schools) {
    for (const m of s.means) {
      if (!allQuestions.has(m.question)) {
        allQuestions.set(m.question, m.area);
      }
    }
  }

  const questions = [...allQuestions.entries()];

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #30363d" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "#e6edf3" }}>Fråga</th>
            {schools.map((s) => (
              <th
                key={s.id}
                style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}
              >
                {s.schoolName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {questions.map(([q, area], i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #21262d",
                background: i % 2 === 0 ? "#161b22" : "transparent",
              }}
            >
              <td style={{ padding: "6px 8px", color: "#e6edf3" }}>
                {q}
                <span
                  style={{ color: "#484f58", fontSize: 11, marginLeft: 8 }}
                >
                  {area}
                </span>
              </td>
              {schools.map((s) => {
                const mean = s.means.find((m) => m.question === q);
                return (
                  <td
                    key={s.id}
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontWeight: 600,
                      color: "#e6edf3",
                    }}
                  >
                    {mean?.school?.toFixed(2) ?? "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
