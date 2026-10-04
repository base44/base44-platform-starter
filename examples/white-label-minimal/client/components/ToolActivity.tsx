import { CircleAlert, Loader2, ChevronDown } from "lucide-react";
import type { ToolCall } from "../../types";

// A tool call the agent made, collapsed: its name and status, then the details.
export default function ToolActivity({ tool }: { tool: ToolCall }) {
  const working = tool.status === "running" || tool.status === "pending";
  const failed = tool.status === "error" || tool.status === "stopped";

  let icon = <span className="tool-dot" />;
  if (working) icon = <Loader2 size={14} className="spin" />;
  if (failed) icon = <CircleAlert size={14} />;

  return (
    <details className="tool-activity">
      <summary>
        {icon}
        <span>{tool.name || "Agent action"}</span>
        <span className="sr-only">{working ? "Working" : failed ? "Failed" : "Done"}</span>
        <ChevronDown size={12} className="tool-chevron" />
      </summary>
      {tool.arguments_string && <pre>{tool.arguments_string}</pre>}
      {tool.results && <pre>{tool.results}</pre>}
    </details>
  );
}
