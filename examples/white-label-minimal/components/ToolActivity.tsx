import { CircleAlert, Loader2, ChevronDown } from "lucide-react";
import type { ToolCall } from "../lib/types";

function activityLabel(tool: ToolCall) {
  const activity = tool.display_projection;
  if (activity?.file_paths?.length) {
    const verb = tool.name === "delete_file" ? "Deleting" : "Editing";
    return `${verb} ${activity.file_paths.join(", ")}`;
  }
  if (activity?.entity_name) {
    const count = activity.record_count == null ? "" : `${activity.record_count} `;
    return `${tool.name?.replaceAll("_", " ") || "Updating"} ${count}${activity.entity_name}`;
  }
  return activity?.summary || tool.name?.replaceAll("_", " ") || "Agent action";
}

export default function ToolActivity({ tool }: { tool: ToolCall }) {
  const pending = ["running", "pending"].includes(tool.status || "");
  const failed = ["error", "stopped"].includes(tool.status || "");
  return (
    <details className="tool-activity">
      <summary>
        {pending ? (
          <Loader2 size={14} className="spin" />
        ) : failed ? (
          <CircleAlert size={14} />
        ) : (
          <span className="tool-dot" />
        )}
        <span>{activityLabel(tool)}</span>
        <span className="sr-only">{pending ? "Working" : failed ? "Failed" : "Done"}</span>
        <ChevronDown size={12} className="tool-chevron" />
      </summary>
      {tool.results && (
        <div>
          <strong>{tool.results}</strong>
        </div>
      )}
    </details>
  );
}
