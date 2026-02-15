import { useState, useMemo } from "react";
import type { SchoolEntry } from "../data/client.ts";

interface SearchResult {
  school: SchoolEntry;
  unitReportId?: number;
  displayName: string;
  subtitle: string;
}

interface Props {
  schools: SchoolEntry[];
  onSelect: (school: SchoolEntry, unitReportId?: number) => void;
}

export function SchoolSearch({ schools, onSelect }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const results: SearchResult[] = [];

    for (const s of schools) {
      // Match school name or area name
      if (s.name.toLowerCase().includes(q) || s.areaName.toLowerCase().includes(q)) {
        results.push({
          school: s,
          displayName: s.name,
          subtitle: `${s.areaName} · ${s.year}${s.avgMean !== null ? ` · Snitt ${s.avgMean.toFixed(2)}` : ""}`,
        });
      }

      // Also search within units
      if (s.units) {
        for (const unit of s.units) {
          if (unit.name.toLowerCase().includes(q)) {
            results.push({
              school: s,
              unitReportId: unit.reportId ?? undefined,
              displayName: unit.name,
              subtitle: `${s.name} · ${s.areaName} · ${s.year}`,
            });
          }
        }
      }

      if (results.length >= 20) break;
    }

    return results.slice(0, 20);
  }, [search, schools]);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Sök förskola eller enhet..."
        style={{
          width: "100%",
          padding: "10px 14px",
          fontSize: 16,
          border: "1px solid #30363d",
          borderRadius: 8,
          boxSizing: "border-box",
          background: "#161b22",
          color: "#e6edf3",
        }}
      />
      {filtered.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#161b22",
            border: "1px solid #30363d",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: 400,
            overflow: "auto",
            zIndex: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {filtered.map((r, i) => (
            <li
              key={`${r.school.id}-${r.unitReportId ?? "s"}-${i}`}
              onClick={() => {
                onSelect(r.school, r.unitReportId);
                setSearch("");
              }}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                borderBottom: "1px solid #21262d",
                color: "#e6edf3",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#1c2333")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <strong>{r.displayName}</strong>
              <span style={{ color: "#8b949e", marginLeft: 8, fontSize: 13 }}>
                {r.subtitle}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
