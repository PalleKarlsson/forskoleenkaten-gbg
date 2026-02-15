import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { loadIndex } from "../data/client.ts";
import type { Index, SchoolEntry, AreaEntry } from "../data/client.ts";
import { SchoolSearch } from "../components/SchoolSearch.tsx";

export function Home() {
  const [index, setIndex] = useState<Index | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadIndex()
      .then((data) => {
        setIndex(data);
        if (data.years.length > 0) {
          setSelectedYear(data.years[0].year);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const yearAreas = useMemo(() => {
    if (!index || !selectedYear) return [];
    return index.areas.filter((a) => a.year === selectedYear);
  }, [index, selectedYear]);

  const yearSchools = useMemo(() => {
    if (!index || !selectedYear) return [];
    return index.schools.filter((s) => s.year === selectedYear);
  }, [index, selectedYear]);

  const schoolsByArea = useMemo(() => {
    const map = new Map<number, SchoolEntry[]>();
    for (const s of yearSchools) {
      if (!map.has(s.areaId)) map.set(s.areaId, []);
      map.get(s.areaId)!.push(s);
    }
    return map;
  }, [yearSchools]);

  if (error) {
    return (
      <div>
        <h2>Kunde inte ladda data</h2>
        <p style={{ color: "#f85149" }}>{error}</p>
        <p style={{ color: "#8b949e" }}>
          Har du kört pipeline och exporterat data? Se README.md.
        </p>
      </div>
    );
  }

  if (!index) return <p>Laddar...</p>;

  function handleSchoolSelect(school: SchoolEntry, unitReportId?: number) {
    const targetId = unitReportId ?? school.reportId;
    if (targetId) {
      navigate(`/school/${targetId}`);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
      <div style={{ marginBottom: 24 }}>
        <SchoolSearch
          schools={index.schools}
          onSelect={handleSchoolSelect}
        />
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {index.years.map((y) => (
          <button
            key={y.year}
            onClick={() => setSelectedYear(y.year)}
            style={{
              padding: "8px 16px",
              border: y.year === selectedYear ? "1px solid #58a6ff" : "1px solid #30363d",
              borderRadius: 6,
              background: y.year === selectedYear ? "#58a6ff" : "#161b22",
              color: y.year === selectedYear ? "#0d1117" : "#e6edf3",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: y.year === selectedYear ? 600 : 400,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            {y.year}
          </button>
        ))}
      </div>

      {selectedYear && (
        <>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>
            {selectedYear} — {yearAreas.length} områden, {yearSchools.length} förskolor
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {yearAreas.map((area) => (
              <AreaCard
                key={area.id}
                area={area}
                schools={schoolsByArea.get(area.id) || []}
                onSchoolClick={(s) => handleSchoolSelect(s)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AreaCard({
  area,
  schools,
  onSchoolClick,
}: {
  area: AreaEntry;
  schools: SchoolEntry[];
  onSchoolClick: (s: SchoolEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const avgMean =
    schools.filter((s) => s.avgMean !== null).length > 0
      ? (
          schools
            .filter((s) => s.avgMean !== null)
            .reduce((sum, s) => sum + s.avgMean!, 0) /
          schools.filter((s) => s.avgMean !== null).length
        ).toFixed(2)
      : "—";

  return (
    <div
      style={{
        border: "1px solid #30363d",
        borderRadius: 8,
        padding: 16,
        background: "#161b22",
        transition: "border-color 0.15s",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer" }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#e6edf3" }}>{area.name}</h3>
        <p style={{ margin: 0, color: "#8b949e", fontSize: 13 }}>
          {schools.length} förskolor · Snitt: {avgMean}
        </p>
      </div>

      {expanded && (
        <ul
          style={{
            margin: "12px 0 0",
            padding: 0,
            listStyle: "none",
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          {schools
            .sort((a, b) => a.name.localeCompare(b.name, "sv"))
            .map((s) => (
              <SchoolItem key={s.id} school={s} onSchoolClick={onSchoolClick} />
            ))}
        </ul>
      )}
    </div>
  );
}

function SchoolItem({
  school,
  onSchoolClick,
}: {
  school: SchoolEntry;
  onSchoolClick: (s: SchoolEntry) => void;
}) {
  const [unitsExpanded, setUnitsExpanded] = useState(false);
  const navigate = useNavigate();
  const hasUnits = school.units && school.units.length > 0;

  return (
    <li>
      <div
        style={{
          padding: "6px 8px",
          cursor: school.reportId ? "pointer" : "default",
          borderRadius: 4,
          fontSize: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: school.reportId ? 1 : 0.5,
          color: "#e6edf3",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2333")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span
          onClick={() => school.reportId && onSchoolClick(school)}
          style={{ cursor: school.reportId ? "pointer" : "default", flex: 1 }}
        >
          {school.name}
        </span>
        <span style={{ color: "#8b949e", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          {school.avgMean !== null ? school.avgMean.toFixed(2) : "—"}
          {school.respondents !== null && ` · ${school.respondents} svar`}
          {hasUnits && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUnitsExpanded(!unitsExpanded);
              }}
              style={{
                padding: "2px 6px",
                fontSize: 11,
                border: "1px solid #30363d",
                borderRadius: 4,
                background: unitsExpanded ? "#1c2333" : "transparent",
                color: "#8b949e",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {school.units!.length} enheter {unitsExpanded ? "▾" : "▸"}
            </button>
          )}
        </span>
      </div>
      {hasUnits && unitsExpanded && (
        <ul style={{ margin: 0, padding: "0 0 0 16px", listStyle: "none" }}>
          {school.units!.map((unit, i) => (
            <li
              key={unit.reportId ?? i}
              onClick={() => unit.reportId && navigate(`/school/${unit.reportId}`)}
              style={{
                padding: "4px 8px",
                cursor: unit.reportId ? "pointer" : "default",
                borderRadius: 4,
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                opacity: unit.reportId ? 1 : 0.5,
                color: "#c9d1d9",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2333")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span>{unit.name}</span>
              <span style={{ color: "#8b949e", fontSize: 11 }}>
                {unit.avgMean !== null ? unit.avgMean.toFixed(2) : "—"}
                {unit.respondents !== null && ` · ${unit.respondents} svar`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
