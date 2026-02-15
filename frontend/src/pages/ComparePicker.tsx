import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { loadIndex, loadSchoolDetail } from "../data/client.ts";
import type { Index, SchoolDetail } from "../data/client.ts";
import { haversineKm } from "../utils/geo.ts";

type SortMode = "distance" | "name" | "area" | "mean";

export function ComparePicker() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fromId = Number(searchParams.get("from")) || null;

  const [index, setIndex] = useState<Index | null>(null);
  const [origin, setOrigin] = useState<SchoolDetail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("distance");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      loadIndex(),
      fromId ? loadSchoolDetail(fromId) : Promise.resolve(null),
    ])
      .then(([idx, det]) => {
        setIndex(idx);
        setOrigin(det);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fromId]);

  const originEntry = useMemo(() => {
    if (!index || !fromId) return null;
    return index.schools.find((s) => s.reportId === fromId) ?? null;
  }, [index, fromId]);

  const candidates = useMemo(() => {
    if (!index || !origin) return [];
    return index.schools.filter(
      (s) =>
        s.reportId !== null &&
        s.reportId !== fromId &&
        s.year === origin.year,
    );
  }, [index, origin, fromId]);

  const withDistance = useMemo(() => {
    const oLat = originEntry?.lat;
    const oLng = originEntry?.lng;
    return candidates.map((s) => {
      const dist =
        oLat != null && oLng != null && s.lat != null && s.lng != null
          ? haversineKm(oLat, oLng, s.lat, s.lng)
          : Infinity;
      return { ...s, distance: dist };
    });
  }, [candidates, originEntry]);

  const filtered = useMemo(() => {
    let list = withDistance;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.areaName.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "distance":
        sorted.sort((a, b) => a.distance - b.distance);
        break;
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name, "sv"));
        break;
      case "area":
        sorted.sort(
          (a, b) =>
            a.areaName.localeCompare(b.areaName, "sv") ||
            a.name.localeCompare(b.name, "sv"),
        );
        break;
      case "mean":
        sorted.sort((a, b) => (b.avgMean ?? 0) - (a.avgMean ?? 0));
        break;
    }
    return sorted;
  }, [withDistance, search, sort]);

  const toggle = (reportId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  const handleCompare = () => {
    if (!fromId || selected.size === 0) return;
    const ids = [fromId, ...selected].join(",");
    navigate(`/compare?ids=${ids}`);
  };

  if (loading) return <p style={{ padding: 16 }}>Laddar...</p>;

  if (!origin || !index) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
        <Link to="/browse" style={{ color: "#58a6ff", textDecoration: "none" }}>
          &larr; Tillbaka
        </Link>
        <p style={{ color: "#f85149", marginTop: 16 }}>
          Kunde inte hitta utgångsförskola.
        </p>
      </div>
    );
  }

  const sortBtn = (mode: SortMode, label: string) => (
    <button
      onClick={() => setSort(mode)}
      style={{
        padding: "4px 12px",
        fontSize: 13,
        border:
          sort === mode ? "1px solid #58a6ff" : "1px solid #30363d",
        borderRadius: 6,
        background: sort === mode ? "#58a6ff" : "transparent",
        color: sort === mode ? "#0d1117" : "#e6edf3",
        cursor: "pointer",
        fontWeight: sort === mode ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 0" }}>
      <Link
        to={`/school/${fromId}`}
        style={{ color: "#58a6ff", textDecoration: "none" }}
      >
        &larr; Tillbaka till {origin.schoolName}
      </Link>

      <h2 style={{ marginTop: 16, marginBottom: 8 }}>
        Välj förskolor att jämföra med
      </h2>

      {/* Origin school card */}
      <div
        style={{
          background: "#161b22",
          border: "1px solid #58a6ff",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
        }}
      >
        <strong style={{ color: "#e6edf3" }}>{origin.schoolName}</strong>
        <span style={{ color: "#8b949e", marginLeft: 8, fontSize: 13 }}>
          {origin.areaName} · {origin.year}
        </span>
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: "#58a6ff",
            border: "1px solid #58a6ff",
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          Utgångsförskola
        </span>
      </div>

      {/* Search + sort */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök förskola..."
          style={{
            flex: 1,
            minWidth: 200,
            padding: "8px 12px",
            border: "1px solid #30363d",
            borderRadius: 6,
            fontSize: 14,
            background: "#161b22",
            color: "#e6edf3",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {sortBtn("distance", "Avstånd")}
          {sortBtn("name", "Namn")}
          {sortBtn("area", "Område")}
          {sortBtn("mean", "Medelvärde")}
        </div>
      </div>

      {/* School list */}
      <div
        style={{
          maxHeight: "calc(100vh - 360px)",
          overflowY: "auto",
          border: "1px solid #30363d",
          borderRadius: 8,
          background: "#0d1117",
        }}
      >
        {filtered.map((s) => (
          <label
            key={s.reportId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderBottom: "1px solid #21262d",
              cursor: "pointer",
              background: selected.has(s.reportId!)
                ? "#1c2333"
                : "transparent",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!selected.has(s.reportId!))
                e.currentTarget.style.background = "#161b22";
            }}
            onMouseLeave={(e) => {
              if (!selected.has(s.reportId!))
                e.currentTarget.style.background = "transparent";
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(s.reportId!)}
              onChange={() => toggle(s.reportId!)}
              style={{ accentColor: "#58a6ff", flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#e6edf3", fontSize: 14 }}>{s.name}</div>
              <div style={{ color: "#8b949e", fontSize: 12 }}>
                {s.areaName}
                {s.avgMean !== null && ` · Snitt ${s.avgMean.toFixed(2)}`}
                {s.respondents !== null && ` · ${s.respondents} svar`}
              </div>
            </div>
            <div
              style={{
                color: "#8b949e",
                fontSize: 12,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {s.distance !== Infinity
                ? `${s.distance.toFixed(1)} km`
                : "—"}
            </div>
          </label>
        ))}
        {filtered.length === 0 && (
          <p style={{ padding: 16, color: "#8b949e", textAlign: "center" }}>
            Inga förskolor hittade.
          </p>
        )}
      </div>

      {/* Sticky footer */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "#0d1117",
          borderTop: "1px solid #30363d",
          padding: "12px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <span style={{ color: "#8b949e", fontSize: 14 }}>
          {selected.size} förskola{selected.size !== 1 ? "r" : ""} valda
        </span>
        <button
          onClick={handleCompare}
          disabled={selected.size === 0}
          style={{
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            borderRadius: 6,
            background: selected.size > 0 ? "#58a6ff" : "#30363d",
            color: selected.size > 0 ? "#0d1117" : "#8b949e",
            cursor: selected.size > 0 ? "pointer" : "not-allowed",
          }}
        >
          Jämför
        </button>
      </div>
    </div>
  );
}
