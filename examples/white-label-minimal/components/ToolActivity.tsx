import { CircleAlert, FileCode2, ImageIcon, Loader2, Package, PencilLine, Terminal, ChevronDown } from "lucide-react";
import type { ToolCall } from "../lib/types";

type ToolArguments = {
  packages?: Array<{ name?: unknown; action?: unknown }>;
  updates?: Array<{ action?: unknown; section_label?: unknown; section?: unknown; text?: unknown }>;
  sections_with_enough?: unknown[];
  label?: unknown;
  aspect_ratio?: unknown;
};

function argumentsFor(tool: ToolCall): ToolArguments {
  try {
    const parsed: unknown = JSON.parse(tool.arguments_string || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ToolArguments : {};
  } catch {
    return {};
  }
}

function packagesFor(args: ToolArguments) {
  return (args.packages || []).flatMap((pkg) =>
    typeof pkg?.name === "string" && pkg.name
      ? [{ name: pkg.name, action: pkg.action === "uninstall" ? "uninstall" : "install" }]
      : [],
  );
}

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

function statusLabel(tool: ToolCall) {
  if (["error", "stopped"].includes(tool.status || "")) return "Failed";
  if (["running", "pending"].includes(tool.status || "")) return "Working";
  if (tool.auto_approved) return "Auto-approved";
  return "Done";
}

function ToolDetails({ tool }: { tool: ToolCall }) {
  const args = argumentsFor(tool);
  const packages = packagesFor(args);
  const plans = (args.updates || []).flatMap((update) => {
    const label = typeof update.section_label === "string"
      ? update.section_label
      : typeof update.section === "string"
        ? update.section
        : "Plan";
    return typeof update.text === "string" && update.text ? [{ label, text: update.text }] : [];
  });
  const media = typeof tool.results === "object" && tool.results ? tool.results : null;
  const mediaLabel = typeof args.label === "string" && args.label ? args.label : "Generated media";
  const mediaPending = media?.status === "pending" || (!media && tool.status === "running");

  if (media || typeof args.label === "string") {
    return (
      <div className="tool-widget tool-media">
        <div className="tool-widget-heading"><ImageIcon size={14} /> <strong>{mediaPending ? "Generating" : media?.status === "failed" ? "Couldn’t generate" : "Generated"} {mediaLabel}</strong></div>
        {typeof args.aspect_ratio === "string" && <small>{args.aspect_ratio}</small>}
        {media?.image_url && <img src={media.image_url} alt={mediaLabel} />}
      </div>
    );
  }
  if (packages.length) {
    return <div className="tool-widget"><div className="tool-widget-heading"><Package size={14} /> <strong>Package changes</strong></div><ul className="tool-list">{packages.map(pkg => <li key={`${pkg.action}:${pkg.name}`}>{pkg.action === "uninstall" ? "Remove" : "Install"} <code>{pkg.name}</code></li>)}</ul></div>;
  }
  if (plans.length || (args.sections_with_enough || []).some((item) => typeof item === "string")) {
    return <div className="tool-widget"><div className="tool-widget-heading"><PencilLine size={14} /> <strong>Plan update</strong></div><ul className="tool-list">{plans.map(plan => <li key={`${plan.label}:${plan.text}`}><strong>{plan.label}</strong> {plan.text}</li>)}</ul>{typeof tool.results === "string" && <small>{tool.results}</small>}</div>;
  }
  if (tool.display_projection?.file_paths?.length) {
    return <div className="tool-widget"><div className="tool-widget-heading"><FileCode2 size={14} /> <strong>Files</strong></div><ul className="tool-list">{tool.display_projection.file_paths.map(path => <li key={path}><code>{path}</code>{tool.display_projection?.content_empty ? " (empty file)" : ""}</li>)}</ul></div>;
  }
  if (tool.display_projection?.entity_name || tool.display_projection?.summary) {
    return <div className="tool-widget"><div className="tool-widget-heading"><Terminal size={14} /> <strong>{tool.display_projection.summary || "Entity activity"}</strong></div>{tool.display_projection.entity_name && <small>{tool.display_projection.record_count ?? ""} {tool.display_projection.entity_name} records</small>}{tool.display_projection.writes_entities && <small>Updated app data</small>}</div>;
  }
  if (tool.user_input?.answers?.length) {
    return <div className="tool-widget"><strong>Answer received</strong><ul className="tool-list">{tool.user_input.answers.map((answer, index) => <li key={answer.question_index ?? index}>{[...(answer.selected_labels || []), answer.custom_text].filter(Boolean).join(", ")}</li>)}</ul></div>;
  }
  return typeof tool.results === "string" ? <div className="tool-widget"><strong>{tool.results}</strong></div> : null;
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
        <span className="sr-only">{statusLabel(tool)}</span>
        <ChevronDown size={12} className="tool-chevron" />
      </summary>
      <ToolDetails tool={tool} />
    </details>
  );
}
