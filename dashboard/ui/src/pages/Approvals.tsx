import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Approval {
  id: string;
  agentId: string;
  operationId: string;
  packageId: string;
  manager: string;
  action: string;
  reason: string;
  initiatedBy: string;
  createdAt: string;
  expiresAt: string;
}

export function Approvals() {
  const queryClient = useQueryClient();

  const { data: approvals = [], isLoading } = useQuery<Approval[]>({
    queryKey: ["approvals"],
    queryFn: () => fetch("/api/approvals").then((r) => r.json()),
    refetchInterval: 10_000,
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/approvals/${id}/approve`, { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e));
        return r.json();
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
    onError: (err: any) => alert(err.message ?? "Approval failed"),
  });

  const deny = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/approvals/${id}/deny`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Pending Approvals</h1>

      {isLoading ? (
        <div style={{ color: "#8b949e" }}>Loading...</div>
      ) : approvals.length === 0 ? (
        <div style={{ color: "#8b949e", background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 24, textAlign: "center" }}>
          No pending approvals.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {approvals.map((a) => (
            <div key={a.id} style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{a.action.toUpperCase()}</span>{" "}
                  <span style={{ color: "#58a6ff" }}>{a.packageId}</span>{" "}
                  <span style={{ color: "#8b949e" }}>via {a.manager}</span>
                </div>
                <span style={{ fontSize: 11, color: "#8b949e" }}>
                  Expires {new Date(a.expiresAt).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#d29922", marginBottom: 8 }}>
                {a.reason}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 12 }}>
                Initiated by: {a.initiatedBy} &middot; Agent: {a.agentId.slice(0, 8)}...
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => approve.mutate(a.id)}
                  style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}
                >
                  Approve
                </button>
                <button
                  onClick={() => deny.mutate(a.id)}
                  style={{ background: "#da3633", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
