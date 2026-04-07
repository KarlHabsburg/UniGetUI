import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface Policy {
  id: string;
  type: string;
  config: Record<string, unknown>;
  updatedAt: string;
}

export function Policies() {
  const queryClient = useQueryClient();

  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ["policies"],
    queryFn: () => fetch("/api/policies").then((r) => r.json()),
  });

  const updatePolicy = useMutation({
    mutationFn: async ({ type, config }: { type: string; config: Record<string, unknown> }) => {
      const res = await fetch(`/api/policies/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
  });

  if (isLoading) return <div style={{ color: "#8b949e" }}>Loading policies...</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Security Policies</h1>

      <div style={{ display: "grid", gap: 16 }}>
        <PolicyCard
          title="Package Blocklist"
          description="Packages that cannot be installed on any managed machine"
          policy={policies.find((p) => p.type === "package_blocklist")}
          type="package_blocklist"
          onSave={(config) => updatePolicy.mutate({ type: "package_blocklist", config })}
        />
        <PolicyCard
          title="Source Allowlist"
          description="Approved package source URLs per manager"
          policy={policies.find((p) => p.type === "source_allowlist")}
          type="source_allowlist"
          onSave={(config) => updatePolicy.mutate({ type: "source_allowlist", config })}
        />
        <PolicyCard
          title="Hash Verification"
          description="Prohibit SkipHashCheck across the fleet"
          policy={policies.find((p) => p.type === "hash_policy")}
          type="hash_policy"
          onSave={(config) => updatePolicy.mutate({ type: "hash_policy", config })}
        />
        <PolicyCard
          title="Command Allowlist"
          description="Pre/post-install commands that are permitted (default: deny all)"
          policy={policies.find((p) => p.type === "command_allowlist")}
          type="command_allowlist"
          onSave={(config) => updatePolicy.mutate({ type: "command_allowlist", config })}
        />
        <PolicyCard
          title="Approval Criteria"
          description="Which operations require admin approval before execution"
          policy={policies.find((p) => p.type === "approval_criteria")}
          type="approval_criteria"
          onSave={(config) => updatePolicy.mutate({ type: "approval_criteria", config })}
        />
      </div>
    </div>
  );
}

function PolicyCard({
  title,
  description,
  policy,
  type,
  onSave,
}: {
  title: string;
  description: string;
  policy?: Policy;
  type: string;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [configText, setConfigText] = useState(
    policy ? JSON.stringify(policy.config, null, 2) : "{}"
  );

  const handleSave = () => {
    try {
      const config = JSON.parse(configText);
      onSave(config);
      setEditing(false);
    } catch {
      alert("Invalid JSON");
    }
  };

  return (
    <div style={{
      background: "#161b22",
      border: "1px solid #30363d",
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }}>{description}</div>
        </div>
        <span style={{
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 12,
          background: policy ? "#23863633" : "#f8514933",
          color: policy ? "#3fb950" : "#f85149",
        }}>
          {policy ? "Active" : "Not configured"}
        </span>
      </div>

      {editing ? (
        <div>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            style={{
              width: "100%",
              height: 120,
              background: "#0d1117",
              color: "#c9d1d9",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: 8,
              fontFamily: "monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={handleSave} style={btnStyle("#238636")}>Save</button>
            <button onClick={() => setEditing(false)} style={btnStyle("#30363d")}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          {policy && (
            <pre style={{
              background: "#0d1117",
              padding: 8,
              borderRadius: 6,
              fontSize: 11,
              color: "#8b949e",
              overflow: "auto",
              maxHeight: 100,
            }}>
              {JSON.stringify(policy.config, null, 2)}
            </pre>
          )}
          <button onClick={() => setEditing(true)} style={{ ...btnStyle("#30363d"), marginTop: 8 }}>
            {policy ? "Edit" : "Configure"}
          </button>
        </div>
      )}
    </div>
  );
}

const btnStyle = (bg: string): React.CSSProperties => ({
  background: bg,
  color: "#c9d1d9",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "4px 12px",
  fontSize: 12,
  cursor: "pointer",
});
