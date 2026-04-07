import { useRef, useEffect } from "react";

interface LogLine {
  text: string;
  lineType: string;
  timestamp: string;
}

interface OperationLogProps {
  lines: LogLine[];
  autoScroll?: boolean;
}

export function OperationLog({ lines, autoScroll = true }: OperationLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  return (
    <div
      ref={containerRef}
      style={{
        background: "#0d1117",
        border: "1px solid #30363d",
        borderRadius: 6,
        padding: 12,
        fontFamily: "'Cascadia Code', 'Fira Code', monospace",
        fontSize: 12,
        lineHeight: 1.6,
        maxHeight: 400,
        overflowY: "auto",
      }}
    >
      {lines.length === 0 ? (
        <div style={{ color: "#484f58" }}>Waiting for output...</div>
      ) : (
        lines.map((line, i) => (
          <div key={i} style={{ color: lineColor(line.lineType), whiteSpace: "pre-wrap" }}>
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}

function lineColor(lineType: string): string {
  switch (lineType) {
    case "Error": return "#f85149";
    case "Information": return "#58a6ff";
    case "ProgressIndicator": return "#8b949e";
    default: return "#c9d1d9";
  }
}
