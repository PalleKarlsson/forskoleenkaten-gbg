import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { loadSchoolDetail } from "../data/client.ts";
import type { SchoolDetail as SchoolDetailType, MeanEntry, UnitMeanEntry } from "../data/client.ts";
import { ResponseDistribution } from "../components/ResponseDistribution.tsx";
import { TrendChart } from "../components/TrendChart.tsx";
import { GenderSplitChart } from "../components/GenderSplitChart.tsx";
import { DemographicsPanel } from "../components/DemographicsPanel.tsx";

export function SchoolDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SchoolDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const [visibleAreas, setVisibleAreas] = useState<Set<string> | null>(null);

  // Reset state on id change to avoid stale data
  useEffect(() => {
    setDetail(null);
    setVisibleAreas(null);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const schoolId = parseInt(id, 10);

    // Try loading as report ID first
    loadSchoolDetail(schoolId)
      .then((data) => {
        setDetail(data);
        setReportId(schoolId);
      })
      .catch(() => {
        // If that fails, it might be a school ID — we'd need to look up the report
        setError(`Kunde inte ladda rapport ${id}`);
      });
  }, [id]);

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
        <Link to="/browse" style={{ color: "#58a6ff", textDecoration: "none" }}>&larr; Tillbaka</Link>
        <h2>Fel</h2>
        <p style={{ color: "#f85149" }}>{error}</p>
      </div>
    );
  }

  const areaNames = useMemo(() => {
    if (!detail) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const m of detail.means) {
      const area = m.area || "Övrigt";
      if (!seen.has(area)) {
        seen.add(area);
        names.push(area);
      }
    }
    return names;
  }, [detail]);

  // Initialize visibleAreas to all areas once data loads
  useEffect(() => {
    if (areaNames.length > 0 && visibleAreas === null) {
      setVisibleAreas(new Set(areaNames));
    }
  }, [areaNames, visibleAreas]);

  if (!detail) return <p style={{ padding: 16 }}>Laddar...</p>;

  const toggleArea = (area: string) => {
    setVisibleAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
      <Link to="/browse" style={{ color: "#58a6ff", textDecoration: "none" }}>
        &larr; Tillbaka
      </Link>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 4px" }}>{detail.schoolName}</h2>
        <p style={{ color: "#8b949e", margin: "0 0 4px" }}>
          {detail.areaName} · {detail.year}
          {detail.unitName && ` · ${detail.unitName}`}
          {detail.reportType !== "school" && ` (${detail.reportType})`}
        </p>
        {detail.pdfUrl && (
          <p style={{ margin: "0 0 16px" }}>
            <a
              href={detail.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#58a6ff", fontSize: 13 }}
            >
              Visa original-PDF
            </a>
          </p>
        )}

        {detail.relatedReports && detail.relatedReports.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            <Link
              to={`/school/${detail.id}`}
              style={{
                padding: "4px 12px",
                borderRadius: 16,
                fontSize: 13,
                textDecoration: "none",
                background: "#58a6ff",
                color: "#0d1117",
                fontWeight: 600,
              }}
            >
              {detail.unitName || "Totalt"}
            </Link>
            {detail.relatedReports.map((r) => (
              <Link
                key={r.reportId}
                to={`/school/${r.reportId}`}
                style={{
                  padding: "4px 12px",
                  borderRadius: 16,
                  fontSize: 13,
                  textDecoration: "none",
                  border: "1px solid #30363d",
                  background: "#161b22",
                  color: "#e6edf3",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#30363d")}
              >
                {r.unitName || r.schoolName}
              </Link>
            ))}
          </div>
        )}

        {detail.metadata && (
          <div
            style={{
              display: "flex",
              gap: 24,
              marginBottom: 24,
              flexWrap: "wrap",
            }}
          >
            {detail.metadata.responseRate !== null && (
              <Stat
                label="Svarsfrekvens"
                value={`${detail.metadata.responseRate}%`}
              />
            )}
            {detail.metadata.respondents !== null && (
              <Stat label="Antal svar" value={String(detail.metadata.respondents)} />
            )}
            {detail.metadata.totalInvited !== null && (
              <Stat
                label="Inbjudna"
                value={String(detail.metadata.totalInvited)}
              />
            )}
          </div>
        )}

        {/* Compare link */}
        {reportId && (
          <div style={{ marginBottom: 16 }}>
            <Link
              to={`/compare/build?from=${reportId}`}
              style={{
                display: "inline-block",
                padding: "6px 14px",
                background: "transparent",
                border: "1px solid #58a6ff",
                color: "#58a6ff",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
                transition: "background 0.15s",
              }}
            >
              Jämför med andra förskolor
            </Link>
          </div>
        )}

        {detail.means.length > 0 && (
          <Section title="Områdesmedelvärden vs Göteborg">
            <AreaScoreCards means={detail.means} />
          </Section>
        )}

        {detail.means.length > 0 && (
          <Section title="Utveckling över tid">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 12 }}>
              {areaNames.map((area) => (
                <label
                  key={area}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e6edf3", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={visibleAreas?.has(area) ?? true}
                    onChange={() => toggleArea(area)}
                    style={{ accentColor: "#58a6ff" }}
                  />
                  {area}
                </label>
              ))}
            </div>
            <TrendChart means={detail.means} currentYear={detail.year} visibleAreas={visibleAreas ?? undefined} />
          </Section>
        )}

        {detail.responses.length > 0 && (
          <Section title="Svarsfördelning">
            <ResponseDistribution responses={detail.responses} />
          </Section>
        )}

        {detail.genderSplit.length > 0 && (
          <Section title="Andel positiva svar">
            <GenderSplitChart data={detail.genderSplit} means={detail.means} />
          </Section>
        )}

        {detail.metadata && (
          <Section title="Bakgrund">
            <DemographicsPanel
              birthYearDistribution={detail.metadata.birthYearDistribution}
              childGenderDistribution={detail.metadata.childGenderDistribution}
              parentGenderDistribution={
                detail.metadata.parentGenderDistribution
              }
            />
          </Section>
        )}

        {detail.importantQuestions.length > 0 && (
          <Section title="Viktigaste frågorna">
            <ol style={{ color: "#e6edf3" }}>
              {detail.importantQuestions.map((q) => (
                <li key={q.rank} style={{ marginBottom: 4 }}>
                  {q.question}
                  {q.pct !== null && (
                    <span style={{ color: "#8b949e", marginLeft: 8 }}>
                      {q.pct}%
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {detail.unitMeans.length > 0 && (
          <Section title="Frågeområde per enhet">
            <UnitMeansTable unitMeans={detail.unitMeans} />
          </Section>
        )}

        {detail.means.length > 0 && (
          <Section title="Alla medelvärden">
            <MeansTable means={detail.means} />
          </Section>
        )}
      </div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        padding: "12px 20px",
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: "#e6edf3" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8b949e" }}>{label}</div>
    </div>
  );
}

function MeansTable({ means }: { means: SchoolDetailType["means"] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #30363d" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "#e6edf3" }}>Fråga</th>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "#e6edf3" }}>Område</th>
            <th style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}>Skola</th>
            <th style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}>GR</th>
            <th style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}>Göteborg</th>
            <th style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}>Stadsdel</th>
          </tr>
        </thead>
        <tbody>
          {means.map((m, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #21262d",
                background: i % 2 === 0 ? "#161b22" : "transparent",
              }}
            >
              <td style={{ padding: "6px 8px", color: "#e6edf3" }}>{m.question}</td>
              <td style={{ padding: "6px 8px", color: "#8b949e" }}>{m.area}</td>
              <td
                style={{
                  padding: "6px 8px",
                  textAlign: "right",
                  fontWeight: 600,
                  color: "#e6edf3",
                }}
              >
                {m.school?.toFixed(2) ?? "—"}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "#8b949e" }}>
                {m.gr?.toFixed(2) ?? "—"}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "#8b949e" }}>
                {m.goteborg?.toFixed(2) ?? "—"}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "#8b949e" }}>
                {m.district?.toFixed(2) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreaScoreCards({ means }: { means: MeanEntry[] }) {
  const areas = useMemo(() => {
    const map = new Map<string, { schoolVals: number[]; goteborgVals: number[] }>();
    for (const m of means) {
      const area = m.area || "Övrigt";
      if (!map.has(area)) map.set(area, { schoolVals: [], goteborgVals: [] });
      const entry = map.get(area)!;
      if (m.school !== null) entry.schoolVals.push(m.school);
      if (m.goteborg !== null) entry.goteborgVals.push(m.goteborg);
    }
    return [...map.entries()].map(([name, { schoolVals, goteborgVals }]) => {
      const schoolAvg = schoolVals.length > 0
        ? schoolVals.reduce((a, b) => a + b, 0) / schoolVals.length
        : null;
      const goteborgAvg = goteborgVals.length > 0
        ? goteborgVals.reduce((a, b) => a + b, 0) / goteborgVals.length
        : null;
      const delta = schoolAvg !== null && goteborgAvg !== null ? schoolAvg - goteborgAvg : null;
      return { name, schoolAvg, delta };
    });
  }, [means]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {areas.map((a) => (
        <div
          key={a.name}
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: "12px 20px",
            minWidth: 160,
            flex: "1 1 160px",
          }}
        >
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 4 }}>{a.name}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#e6edf3" }}>
            {a.schoolAvg !== null ? a.schoolAvg.toFixed(2) : "—"}
          </div>
          {a.delta !== null && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: a.delta >= 0 ? "#3fb950" : "#f85149",
                marginTop: 2,
              }}
            >
              {a.delta >= 0 ? "+" : ""}{a.delta.toFixed(2)} vs Göteborg
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function UnitMeansTable({ unitMeans }: { unitMeans: UnitMeanEntry[] }) {
  const { units, areas } = useMemo(() => {
    const areaSet = new Set<string>();
    const unitMap = new Map<string, Map<string, number | null>>();
    for (const um of unitMeans) {
      areaSet.add(um.area);
      if (!unitMap.has(um.unit)) unitMap.set(um.unit, new Map());
      unitMap.get(um.unit)!.set(um.area, um.mean);
    }
    return {
      areas: [...areaSet],
      units: [...unitMap.entries()].map(([name, areaMap]) => ({ name, areaMap })),
    };
  }, [unitMeans]);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #30363d" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "#e6edf3" }}>Enhet</th>
            {areas.map((a) => (
              <th key={a} style={{ textAlign: "right", padding: "6px 8px", color: "#e6edf3" }}>{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => (
            <tr
              key={u.name}
              style={{
                borderBottom: "1px solid #21262d",
                background: i % 2 === 0 ? "#161b22" : "transparent",
              }}
            >
              <td style={{ padding: "6px 8px", color: "#e6edf3" }}>{u.name}</td>
              {areas.map((a) => {
                const val = u.areaMap.get(a);
                return (
                  <td key={a} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#e6edf3" }}>
                    {val != null ? val.toFixed(2) : "—"}
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

