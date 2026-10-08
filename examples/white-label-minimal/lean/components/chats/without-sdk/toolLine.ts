import type { ToolCall } from "@base44/platform";

// One tool step as a short line, e.g. "✓ write_file src/pages/Home.jsx".
export function toolLine(tool: ToolCall) {
  const icon = tool.status === "running" ? "…" : tool.status === "error" ? "✗" : "✓";
  return `${icon} ${tool.name} ${tool.display?.file_paths?.join(", ") ?? ""}`;
}
