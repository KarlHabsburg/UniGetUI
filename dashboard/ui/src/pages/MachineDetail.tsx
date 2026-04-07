import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageTable } from "../components/PackageTable";

interface AgentDetail {
  id: string;
  hostname: string;
  agentVersion: string;
  status: string;
  tags: string[];
  lastHeartbeat: string | null;
  enrolledAt: string;
  installedPackages: PackageInfo[];
  pendingUpdates: PackageInfo[];
}

interface PackageInfo {
  id: string;
  name: string;
  version: string;
  newVersion?: string;
  manager: string;
  source: string;
}

export function MachineDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: agent, isLoading } = useQuery<AgentDetail>({
    queryKey: ["agent", id],
    queryFn: () => fetch(`/api/agents/${id}`).then((r) => r.json()),
    enabled: !!id,
  });

  if (isLoading) {
    return <div style={{ color: "#8b949e" }}>Loading...</div>;
  }

  if (!agent) {
    return <div style={{ color: "#f85149" }}>Agent not found.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{agent.hostname}</h1>
          <div style={{ color: "#8b949e", fontSize: 13 }}>
            Agent v{agent.agentVersion} &middot; Enrolled {new Date(agent.enrolledAt).toLocaleDateString()}
          </div>
        </div>
        <StatusPill status={agent.status} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {agent.tags.map((t) => (
          <span key={t} style={{
            background: "#1f6feb33",
            color: "#58a6ff",
            padding: "4px 12px",
            borderRadius: 12,
            fontSize: 12,
          }}>{t}</span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 32 }}>
        <StatCard label="Installed Packages" value={agent.installedPackages.length} />
        <StatCard label="Pending Updates" value={agent.pendingUpdates.length} color={agent.pendingUpdates.length > 0 ? "#d29922" : undefined} />
        <StatCard label="Last Heartbeat" value={agent.lastHeartbeat ? relativeTime(agent.lastHeartbeat) : "never"} />
      </div>

      {agent.pendingUpdates.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <PackageTable packages={agent.pendingUpdates} title="Pending Updates" showUpdateColumn />
        </div>
      )}

      <PackageTable packages={agent.installedPackages} title="Installed Packages" />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "online" ? "#3fb950" : status === "degraded" ? "#d29922" : "#f85149";
  return (
    <span style={{
      padding: "4px 12px",
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: `${color}22`,
      color,
    }}>
      {status.toUpperCase()}
    </span>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      background: "#161b22",
      border: "1px solid #30363d",
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: color ?? "#c9d1d9" }}>{value}</div>
    </div>
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
