import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";

interface Agent {
  id: string;
  hostname: string;
  agentVersion: string;
  status: string;
  tags: string[];
  lastHeartbeat: string | null;
  enrolledAt: string;
}

export function FleetOverview() {
  const [tagFilter, setTagFilter] = useState("");

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
  });

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => fetch("/api/agents").then((r) => r.json()),
  });

  const allTags = [...new Set(agents.flatMap((a) => a.tags))].sort();
  const filtered = tagFilter
    ? agents.filter((a) => a.tags.includes(tagFilter))
    : agents;

  if (agents.length === 0 && !isLoading) {
    return (
      <div>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Fleet Overview</h1>
        <div style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: 32,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No agents enrolled yet</div>
          <div style={{ color: "#8b949e", fontSize: 14, maxWidth: 480, margin: "0 auto" }}>
            Install the UniGetUI Agent on a Windows machine and enroll it with a token
            generated from the dashboard. The agent will appear here after its first heartbeat.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24 }}>Fleet Overview</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {health && (
            <StatusBadge label={`DB: ${health.database}`} ok={health.database === "connected"} />
          )}
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              style={{
                background: "#21262d",
                color: "#c9d1d9",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 13,
              }}
            >
              <option value="">All machines</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left" }}>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Hostname</th>
            <th style={thStyle}>Agent Version</th>
            <th style={thStyle}>Tags</th>
            <th style={thStyle}>Last Heartbeat</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((agent) => (
            <tr key={agent.id} style={{ borderBottom: "1px solid #21262d" }}>
              <td style={tdStyle}>
                <StatusDot status={agent.status} />
              </td>
              <td style={tdStyle}>
                <Link to={`/machines/${agent.id}`} style={{ color: "#58a6ff", textDecoration: "none" }}>
                  {agent.hostname}
                </Link>
              </td>
              <td style={{ ...tdStyle, color: "#8b949e" }}>{agent.agentVersion}</td>
              <td style={tdStyle}>
                {agent.tags.map((t) => (
                  <span key={t} style={{
                    background: "#1f6feb33",
                    color: "#58a6ff",
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 11,
                    marginRight: 4,
                  }}>{t}</span>
                ))}
              </td>
              <td style={{ ...tdStyle, color: "#8b949e" }}>
                {agent.lastHeartbeat ? relativeTime(agent.lastHeartbeat) : "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "online" ? "#3fb950" : status === "degraded" ? "#d29922" : "#f85149";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block",
      }} />
      {status}
    </span>
  );
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 12,
      background: ok ? "#23863633" : "#f8514933",
      color: ok ? "#3fb950" : "#f85149",
    }}>
      {label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 500, color: "#8b949e" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
