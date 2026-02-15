import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { loadIndex } from "../data/client.ts";
import type { Index } from "../data/client.ts";
import { haversineKm } from "../utils/geo.ts";
import { useAddressSearch } from "../hooks/useAddressSearch.ts";

const GOTHENBURG_CENTER: [number, number] = [57.7089, 11.9746];
const DEFAULT_ZOOM = 12;

function scoreColor(normalized: number | null): string {
  if (normalized === null) return "#484f58";
  if (normalized >= 70) return "#3fb950";
  if (normalized >= 50) return "#d29922";
  return "#f85149";
}

function schoolIcon(normalized: number | null): L.DivIcon {
  const color = scoreColor(normalized);
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: ${color}; border: 2px solid #161b22;
      box-shadow: 0 1px 4px rgba(0,0,0,0.6);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

const userIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 18px; height: 18px; border-radius: 50%;
    background: #58a6ff; border: 3px solid #161b22;
    box-shadow: 0 1px 4px rgba(0,0,0,0.6);
  "></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function MapController({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom ?? 14, { duration: 1 });
    }
  }, [center, zoom, map]);
  return null;
}

export function MapHome() {
  const [index, setIndex] = useState<Index | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const [showNoCoords, setShowNoCoords] = useState(false);

  const { results: addressResults, loading: addressLoading } = useAddressSearch(addressInput);

  useEffect(() => {
    loadIndex()
      .then((data) => {
        setIndex(data);
        if (data.years.length > 0) setSelectedYear(data.years[0].year);
      })
      .catch((err) => setError(err.message));
  }, []);

  const yearSchools = useMemo(() => {
    if (!index || !selectedYear) return [];
    return index.schools.filter((s) => s.year === selectedYear);
  }, [index, selectedYear]);

  const schoolsWithCoords = useMemo(
    () => yearSchools.filter((s) => s.lat != null && s.lng != null),
    [yearSchools],
  );

  const schoolsWithoutCoords = useMemo(
    () => yearSchools.filter((s) => s.lat == null || s.lng == null),
    [yearSchools],
  );

  const nearbySchools = useMemo(() => {
    if (!userLocation) return [];
    return schoolsWithCoords
      .map((s) => ({
        ...s,
        distance: haversineKm(userLocation.lat, userLocation.lng, s.lat!, s.lng!),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
  }, [userLocation, schoolsWithCoords]);

  const handleAddressSelect = useCallback(
    (lat: number, lng: number) => {
      setUserLocation({ lat, lng });
      setFlyTarget([lat, lng]);
      setShowSuggestions(false);
      setShowNearby(true);
    },
    [],
  );

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <h2>Kunde inte ladda data</h2>
        <p style={{ color: "#f85149" }}>{error}</p>
      </div>
    );
  }

  if (!index) return <p style={{ padding: 32 }}>Laddar...</p>;

  return (
    <div style={{ position: "relative", height: "calc(100vh - 60px)" }}>
      {/* Search & controls overlay */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          pointerEvents: "none",
        }}
      >
        {/* Address search */}
        <div style={{ position: "relative", pointerEvents: "auto" }}>
          <input
            type="text"
            value={addressInput}
            onChange={(e) => {
              setAddressInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Sök din adress..."
            style={{
              padding: "10px 14px",
              border: "1px solid #30363d",
              borderRadius: 8,
              width: 320,
              fontSize: 14,
              background: "#161b22ee",
              color: "#e6edf3",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          />
          {showSuggestions && (addressResults.length > 0 || addressLoading) && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: "0 0 8px 8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {addressLoading && (
                <div style={{ padding: "8px 14px", color: "#8b949e", fontSize: 13 }}>
                  Söker...
                </div>
              )}
              {addressResults.map((r, i) => (
                <div
                  key={i}
                  onClick={() => handleAddressSelect(r.lat, r.lng)}
                  style={{
                    padding: "8px 14px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#e6edf3",
                    borderBottom: "1px solid #21262d",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2333")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {r.displayName}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Year selector */}
        <select
          value={selectedYear ?? ""}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          style={{
            padding: "10px 14px",
            border: "1px solid #30363d",
            borderRadius: 8,
            fontSize: 14,
            background: "#161b22ee",
            color: "#e6edf3",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            pointerEvents: "auto",
            cursor: "pointer",
          }}
        >
          {index.years.map((y) => (
            <option key={y.year} value={y.year}>
              {y.year}
            </option>
          ))}
        </select>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "8px 14px",
            background: "#161b22ee",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            fontSize: 12,
            color: "#e6edf3",
            pointerEvents: "auto",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3fb950", display: "inline-block" }} />
            Bra
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#d29922", display: "inline-block" }} />
            Medel
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f85149", display: "inline-block" }} />
            Låg
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#484f58", display: "inline-block" }} />
            Ingen data
          </span>
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={GOTHENBURG_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController center={flyTarget} />

        {schoolsWithCoords.map((s) => (
          <Marker
            key={s.id}
            position={[s.lat!, s.lng!]}
            icon={schoolIcon(s.avgNormalized ?? null)}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <strong>{s.name}</strong>
                <br />
                <span style={{ color: "#8b949e", fontSize: 12 }}>{s.areaName}</span>
                <br />
                {s.avgMean !== null && (
                  <span style={{ fontSize: 13 }}>
                    Snitt: {s.avgMean.toFixed(2)} · {s.respondents ?? "?"} svar
                  </span>
                )}
                {userLocation && (
                  <>
                    <br />
                    <span style={{ fontSize: 12, color: "#8b949e" }}>
                      {haversineKm(userLocation.lat, userLocation.lng, s.lat!, s.lng!).toFixed(1)} km bort
                    </span>
                  </>
                )}
                {s.reportId && (
                  <>
                    <br />
                    <Link
                      to={`/school/${s.reportId}`}
                      style={{ fontSize: 13, color: "#58a6ff" }}
                    >
                      Visa detaljer
                    </Link>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>Din plats</Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Nearby panel */}
      {showNearby && nearbySchools.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 12,
            width: 320,
            maxHeight: "calc(100% - 80px)",
            overflow: "auto",
            background: "#161b22ee",
            borderRadius: 8,
            border: "1px solid #30363d",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            zIndex: 1000,
            fontSize: 13,
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid #30363d",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong style={{ color: "#e6edf3" }}>Närliggande förskolor</strong>
            <button
              onClick={() => setShowNearby(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                color: "#8b949e",
              }}
            >
              x
            </button>
          </div>
          {nearbySchools.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid #21262d",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                {s.reportId ? (
                  <Link
                    to={`/school/${s.reportId}`}
                    style={{ color: "#58a6ff", textDecoration: "none", fontWeight: 500 }}
                  >
                    {s.name}
                  </Link>
                ) : (
                  <span style={{ color: "#e6edf3" }}>{s.name}</span>
                )}
                <div style={{ color: "#8b949e", fontSize: 11 }}>
                  {s.areaName}
                  {s.avgMean !== null && ` · ${s.avgMean.toFixed(2)}`}
                  {s.respondents !== null && ` · ${s.respondents} svar`}
                </div>
              </div>
              <span style={{ color: "#8b949e", whiteSpace: "nowrap", marginLeft: 8 }}>
                {s.distance.toFixed(1)} km
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Schools without coordinates */}
      {schoolsWithoutCoords.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            zIndex: 1000,
            background: "#161b22ee",
            border: "1px solid #30363d",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            fontSize: 12,
            maxWidth: 320,
            maxHeight: showNoCoords ? 300 : undefined,
            overflow: showNoCoords ? "auto" : undefined,
          }}
        >
          <div
            onClick={() => setShowNoCoords(!showNoCoords)}
            style={{ padding: "8px 14px", cursor: "pointer", color: "#8b949e" }}
          >
            {schoolsWithoutCoords.length} förskolor utan koordinater
            {showNoCoords ? " (dölj)" : " (visa)"}
          </div>
          {showNoCoords && (
            <div style={{ padding: "0 14px 8px" }}>
              {schoolsWithoutCoords.map((s) => (
                <div key={s.id} style={{ padding: "3px 0" }}>
                  {s.reportId ? (
                    <Link to={`/school/${s.reportId}`} style={{ color: "#58a6ff", textDecoration: "none" }}>
                      {s.name}
                    </Link>
                  ) : (
                    <span style={{ color: "#e6edf3" }}>{s.name}</span>
                  )}
                  <span style={{ color: "#484f58", marginLeft: 6 }}>{s.areaName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
