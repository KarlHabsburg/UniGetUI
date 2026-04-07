import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface AuditEntry {
  id: number;
  agentId: string | null;
  initiatedBy: string;
  operationType: string;
  packageId: string;
  manager: string;
  version: string;
  status: string;
  loggedAt: string;
}

export function AuditLog() {
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit"],
    queryFn: () => fetch("/api/audit?limit=200").then((r) => r.json()),
  });

  const filtered = entries.filter((e) => {
    if (typeFilter && e.operationType !== typeFilter) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    return true;
  });

  const operationTypes = [...new Set(entries.map((e) => e.operationType))].sort();
  const statuses = [...new Set(entries.map((e) => e.status))].sort();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24 }}>Audit Log</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
            <option value="">All types</option>
            {operationTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <a
            href="/api/audit/export?format=csv"
            download
            style={{ background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 6, padding: "4px 12px", fontSize: 12, textDecoration: "none", display: "flex", alignItems: "center" }}
          >
            Export CSV
          </a>
          <a
            href="/api/audit/export?format=json"
            download
            style={{ background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 6, padding: "4px 12px", fontSize: 12, textDecoration: "none", display: "flex", alignItems: "center" }}
          >
            Export JSON
          </a>
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: "#8b949e" }}>Loading...</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left" }}>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Package</th>
              <th style={thStyle}>Manager</th>
              <th style={thStyle}>Initiated By</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ ...tdStyle, color: "#8b949e" }}>{e.id}</td>
                <td style={tdStyle}>{e.operationType}</td>
                <td style={tdStyle}>{e.packageId || "-"}</td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>{e.manager || "-"}</td>
                <td style={tdStyle}>{e.initiatedBy}</td>
                <td style={tdStyle}>
                  <StatusBadge status={e.status} />
                </td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>
                  {new Date(e.loggedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "#3fb950", failed: "#f85149", running: "#58a6ff",
    pending: "#d29922", cancelled: "#8b949e",
  };
  const color = colors[status] ?? "#8b949e";
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: `${color}22`, color }}>
      {status}
    </span>
  );
}

const selectStyle: React.CSSProperties = {
  background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d",
  borderRadius: 6, padding: "4px 8px", fontSize: 13,
};
const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 500, color: "#8b949e" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
