import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useSubmitToolInput } from "../useSubmitToolInput";

/**
 * Generic approve / reject widget for tools whose payload is empty — the
 * `action` carries all the meaning. Registered for `install_npm_package`; point
 * any other `{}`-payload approval tool at this same component.
 *
 * Reject is a hard decline: the platform records the call `stopped` with a
 * "do not retry" result and the tool never runs.
 */
export default function ApprovalWidget({
  toolCall,
  parsedArgs,
  isLastRunningTool,
  appId,
  messageId,
  onSubmitted,
}) {
  const { submit, busy, error } = useSubmitToolInput({
    appId,
    toolCallId: toolCall.id,
    messageId,
    kind: toolCall.waiting_on_kind ?? toolCall.waiting_on?.kind,
    onSubmitted,
  });

  const packages = Array.isArray(parsedArgs?.packages) ? parsedArgs.packages : [];
  const displaySummary = toolCall.display_projection?.summary || null;
  const summary = displaySummary || describe(toolCall, packages);
  // Status is the whole gate: an answered call is `success`/`stopped` (read-only
  // in history); one still `waiting` is live wherever it sits.
  const interactive = toolCall.status === "waiting_for_user_input";

  const form = interactive ? (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => submit(true, {})}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Approve
        </button>
        <button
          disabled={busy}
          onClick={() => submit(false, {})}
          className="text-xs font-medium border border-border px-3 py-1.5 rounded text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  ) : null;

  return (
    <ToolRow
      status={toolCall.status}
      name={toolCall.name}
      isLastRunningTool={isLastRunningTool}
      summary={summary}
      form={form}
    />
  );
}

function describe(tc, packages) {
  const list = packages
    .map((p) => (p?.action === "uninstall" ? `remove ${p.name}` : p?.name))
    .filter(Boolean)
    .join(", ");
  switch (tc.status) {
    case "waiting_for_user_input":
      return list ? `Approve package changes: ${list}` : "Approve this action?";
    case "running":
      return "Applying…";
    case "success":
      return tc.results || "Approved";
    case "stopped":
      return "Rejected";
    case "error":
      return tc.results || "Failed";
    default:
      return list ? `Packages: ${list}` : "Approval";
  }
}
