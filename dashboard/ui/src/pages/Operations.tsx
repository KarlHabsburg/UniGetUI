import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { OperationLog } from "../components/OperationLog";
import { useWebSocket } from "../hooks/useWebSocket";

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

interface LogLine {
  text: string;
  lineType: string;
  timestamp: string;
}

export function Operations() {
  const [liveLines, setLiveLines] = useState<LogLine[]>([]);
  const [activeOpId, setActiveOpId] = useState<string | null>(null);

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { type?: string; line?: string; lineType?: string; timestamp?: string; operationId?: string };
    if (msg.type === "operation_log" && msg.operationId === activeOpId) {
      setLiveLines((prev) => [...prev, {
        text: msg.line ?? "",
        lineType: msg.lineType ?? "VerboseDetails",
        timestamp: msg.timestamp ?? new Date().toISOString(),
      }]);
    }
  }, [activeOpId]);

  useWebSocket({
    url: "/ws/dashboard",
    onMessage: handleWsMessage,
    enabled: activeOpId !== null,
  });

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["operations"],
    queryFn: () => fetch("/api/audit?limit=50").then((r) => r.json()),
  });

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Operations</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h3 style={{ fontSize: 14, color: "#8b949e", marginBottom: 8 }}>Recent Operations</h3>
          {isLoading ? (
            <div style={{ color: "#8b949e" }}>Loading...</div>
          ) : entries.length === 0 ? (
            <div style={{ color: "#8b949e" }}>No operations recorded yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left" }}>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Package</th>
                  <th style={thStyle}>Manager</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Time</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => {
                      setActiveOpId(String(entry.id));
                      setLiveLines([]);
                    }}
                    style={{
                      borderBottom: "1px solid #21262d",
                      cursor: "pointer",
                      background: activeOpId === String(entry.id) ? "#161b22" : "transparent",
                    }}
                  >
                    <td style={tdStyle}>{entry.operationType}</td>
                    <td style={tdStyle}>{entry.packageId || "-"}</td>
                    <td style={{ ...tdStyle, color: "#8b949e" }}>{entry.manager || "-"}</td>
                    <td style={tdStyle}>
                      <StatusBadge status={entry.status} />
                    </td>
                    <td style={{ ...tdStyle, color: "#8b949e" }}>
                      {new Date(entry.loggedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: 14, color: "#8b949e", marginBottom: 8 }}>
            {activeOpId ? `Operation Log #${activeOpId}` : "Select an operation"}
          </h3>
          <OperationLog lines={liveLines} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "#3fb950",
    failed: "#f85149",
    running: "#58a6ff",
    pending: "#d29922",
    cancelled: "#8b949e",
  };
  const color = colors[status] ?? "#8b949e";
  return (
    <span style={{
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 12,
      background: `${color}22`,
      color,
    }}>
      {status}
    </span>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 500, color: "#8b949e" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
