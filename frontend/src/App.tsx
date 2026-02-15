import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { Home } from "./pages/Home.tsx";
import { SchoolDetail } from "./pages/SchoolDetail.tsx";
import { Compare } from "./pages/Compare.tsx";
import { ComparePicker } from "./pages/ComparePicker.tsx";
import { MapHome } from "./pages/MapHome.tsx";

function NavHeader() {
  const location = useLocation();
  const path = location.pathname;

  const linkStyle = (active: boolean) => ({
    textDecoration: "none",
    color: active ? "#58a6ff" : "#8b949e",
    fontWeight: active ? 600 : 400 as number,
    fontSize: 14,
    padding: "4px 0",
    borderBottom: active ? "2px solid #58a6ff" : "2px solid transparent",
    transition: "color 0.15s, border-color 0.15s",
  });

  return (
    <header
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid #30363d",
        display: "flex",
        alignItems: "center",
        gap: 24,
        background: "#161b22",
        height: 60,
        boxSizing: "border-box",
      }}
    >
      <Link to="/" style={{ textDecoration: "none", color: "#e6edf3" }}>
        <h1 style={{ margin: 0, fontSize: 20, whiteSpace: "nowrap" }}>
          Förskoleenkäten Göteborg
        </h1>
      </Link>
      <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Link to="/" style={linkStyle(path === "/")}>
          Karta
        </Link>
        <Link to="/browse" style={linkStyle(path === "/browse")}>
          Bläddra
        </Link>
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <a
          href="https://enkater.goteborg.se/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#484f58", fontSize: 11, textDecoration: "none" }}
        >
          Källa: Göteborgs Regionen / Institutet för kvalitetsindikatorer
        </a>
        <a
          href="https://github.com/PalleKarlsson/forskoleenkaten-gbg"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
          style={{ color: "#484f58", display: "flex", transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e6edf3")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#484f58")}
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </header>
  );
}

function DataNotice() {
  return (
    <div
      style={{
        padding: "6px 16px",
        background: "#1c2128",
        borderBottom: "1px solid #30363d",
        fontSize: 12,
        color: "#848d97",
        textAlign: "center",
      }}
    >
      All data has been parsed programmatically from PDF/XLS reports and may contain errors.
      {" "}
      <a
        href="https://github.com/PalleKarlsson/forskoleenkaten-gbg/issues/new?template=data_error.md"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#58a6ff", textDecoration: "none" }}
      >
        Report a data error
      </a>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <NavHeader />
      <DataNotice />
      <Routes>
        <Route path="/" element={<MapHome />} />
        <Route path="/browse" element={<Home />} />
        <Route path="/school/:id" element={<SchoolDetail />} />
        <Route path="/compare/build" element={<ComparePicker />} />
        <Route path="/compare" element={<Compare />} />
      </Routes>
    </HashRouter>
  );
}
