import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { FleetOverview } from "./pages/FleetOverview";
import { MachineDetail } from "./pages/MachineDetail";
import { Operations } from "./pages/Operations";
import { Policies } from "./pages/Policies";
import { Approvals } from "./pages/Approvals";
import { AuditLog } from "./pages/AuditLog";

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav style={{
          width: 220,
          background: "#161b22",
          padding: "20px 0",
          borderRight: "1px solid #30363d",
          flexShrink: 0,
        }}>
          <div style={{ padding: "0 16px 20px", fontSize: 18, fontWeight: 600, color: "#58a6ff" }}>
            UniGetUI Fleet
          </div>
          <NavItem to="/" label="Fleet Overview" />
          <NavItem to="/operations" label="Operations" />
          <NavItem to="/policies" label="Policies" />
          <NavItem to="/approvals" label="Approvals" />
          <NavItem to="/audit" label="Audit Log" />
        </nav>

        <main style={{ flex: 1, padding: 24 }}>
          <Routes>
            <Route path="/" element={<FleetOverview />} />
            <Route path="/machines/:id" element={<MachineDetail />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/audit" element={<AuditLog />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: "block",
        padding: "8px 16px",
        color: isActive ? "#58a6ff" : "#8b949e",
        textDecoration: "none",
        fontSize: 14,
        borderLeft: isActive ? "3px solid #58a6ff" : "3px solid transparent",
        background: isActive ? "rgba(88,166,255,0.08)" : "transparent",
      })}
    >
      {label}
    </NavLink>
  );
}
