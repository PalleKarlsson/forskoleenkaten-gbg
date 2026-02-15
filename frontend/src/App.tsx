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
      <a
        href="https://enkater.goteborg.se/"
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginLeft: "auto", color: "#484f58", fontSize: 11, textDecoration: "none" }}
      >
        Källa: Göteborgs Regionen / Institutet för kvalitetsindikatorer
      </a>
    </header>
  );
}

export function App() {
  return (
    <HashRouter>
      <NavHeader />
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
