interface Package {
  id: string;
  name: string;
  version: string;
  newVersion?: string;
  manager: string;
  source: string;
}

interface PackageTableProps {
  packages: Package[];
  title: string;
  showUpdateColumn?: boolean;
}

export function PackageTable({ packages, title, showUpdateColumn }: PackageTableProps) {
  if (packages.length === 0) {
    return (
      <div style={{ color: "#8b949e", padding: "16px 0" }}>
        No {title.toLowerCase()} found.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, color: "#8b949e", marginBottom: 8 }}>
        {title} ({packages.length})
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left" }}>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>ID</th>
            <th style={thStyle}>Version</th>
            {showUpdateColumn && <th style={thStyle}>Available</th>}
            <th style={thStyle}>Manager</th>
            <th style={thStyle}>Source</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={`${pkg.manager}-${pkg.id}`} style={{ borderBottom: "1px solid #21262d" }}>
              <td style={tdStyle}>{pkg.name}</td>
              <td style={{ ...tdStyle, color: "#8b949e" }}>{pkg.id}</td>
              <td style={tdStyle}>{pkg.version}</td>
              {showUpdateColumn && (
                <td style={{ ...tdStyle, color: pkg.newVersion ? "#3fb950" : "#8b949e" }}>
                  {pkg.newVersion ?? "-"}
                </td>
              )}
              <td style={tdStyle}>{pkg.manager}</td>
              <td style={{ ...tdStyle, color: "#8b949e" }}>{pkg.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 500, color: "#8b949e" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
