import { CircleAlert, Loader2, ChevronDown } from "lucide-react";
import type { ToolCall } from "../lib/types";

export default function ToolActivity({ tool }: { tool: ToolCall }) {
  const pending = ["running", "pending"].includes(tool.status || "");
  const failed = ["error", "stopped"].includes(tool.status || "");
  let argumentsText = tool.arguments_string || "";
  try { argumentsText = JSON.stringify(JSON.parse(argumentsText), null, 2); } catch {}
  return <details className="tool-activity">
    <summary>
      {pending ? <Loader2 size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <span className="tool-dot" />}
      <span>{tool.name || "Agent action"}</span>
      <span className="sr-only">{pending ? "Working" : failed ? "Failed" : "Done"}</span>
      <ChevronDown size={12} className="tool-chevron" />
    </summary>
    {argumentsText && <div><strong>Arguments</strong><pre>{argumentsText}</pre></div>}
    {tool.results && <div><strong>Result</strong><pre>{typeof tool.results === "string" ? tool.results : JSON.stringify(tool.results, null, 2)}</pre></div>}
  </details>;
}
