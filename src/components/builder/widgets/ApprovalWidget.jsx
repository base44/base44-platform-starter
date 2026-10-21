import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useAnswer } from "../useAnswer";

/**
 * Approve / reject for an action the builder needs permission to run, such as a
 * package install. Reject is a hard decline: the platform records the call
 * `stopped` and the tool never runs.
 */
export default function ApprovalWidget({ step, question }) {
  const { busy, run } = useAnswer();

  const form = (
    <div className="flex gap-2">
      <button
        disabled={busy}
        onClick={() => run(question.approve)}
        className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin" />} Approve
      </button>
      <button
        disabled={busy}
        onClick={() => run(question.decline)}
        className="text-xs font-medium border border-border px-3 py-1.5 rounded text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );

  return (
    <ToolRow
      status={step.status}
      name={step.label}
      summary={question.reason || `Approve ${question.action}?`}
      form={form}
    />
  );
}
