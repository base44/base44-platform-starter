import { useState } from "react";
import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useSubmitToolInput } from "../useSubmitToolInput";

/**
 * Answers the builder's `ask_clarifying_questions` tool. Payload mirrors the
 * tool: `{ answers: [{ question_index, selected_labels, custom_text }] }`.
 * Questions the user leaves blank are simply omitted — the tool treats a short
 * answers list as partial and moves on. "Skip" rejects the whole call.
 *
 * Renders option labels only; the tool's image-design variant (type=img) is not
 * previewed here — its labels still work as plain choices.
 */
export default function ClarifyingQuestionsWidget({
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
  const questions = Array.isArray(parsedArgs?.questions) ? parsedArgs.questions : [];
  const [picks, setPicks] = useState({}); // index -> string[]
  const [custom, setCustom] = useState({}); // index -> string

  // Status is the whole gate: an answered call is `success`/`stopped` (read-only
  // in history); one still `waiting` is live wherever it sits.
  const interactive = toolCall.status === "waiting_for_user_input";

  const toggle = (qi, label, multi) =>
    setPicks((prev) => {
      const current = prev[qi] || [];
      if (multi)
        return {
          ...prev,
          [qi]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
        };
      return { ...prev, [qi]: current.includes(label) ? [] : [label] };
    });

  const answers = questions
    .map((_, qi) => ({
      question_index: qi,
      selected_labels: picks[qi] || [],
      custom_text: (custom[qi] || "").trim(),
    }))
    .filter((a) => a.selected_labels.length > 0 || a.custom_text);
  const canSubmit = answers.length > 0 && !busy;

  const form = interactive ? (
    <div className="flex flex-col gap-4">
      {questions.map((q, qi) => (
        <div key={qi} className="flex flex-col gap-1.5">
          <span className="text-foreground font-medium">{q.question}</span>
          {q.description && <span className="text-muted-foreground">{q.description}</span>}
          <div className="flex flex-wrap gap-1.5">
            {(q.options || []).map((opt, oi) => {
              const label = typeof opt === "string" ? opt : opt?.label;
              if (!label) return null;
              const selected = (picks[qi] || []).includes(label);
              return (
                <button
                  key={oi}
                  disabled={busy}
                  onClick={() => toggle(qi, label, q.multi_select)}
                  className={`px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            disabled={busy}
            value={custom[qi] || ""}
            onChange={(e) => setCustom((c) => ({ ...c, [qi]: e.target.value }))}
            className="border border-border rounded px-2 py-1.5 bg-background text-foreground text-xs disabled:opacity-50 mt-0.5"
            placeholder="Something else…"
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button
          disabled={!canSubmit}
          onClick={() => submit(true, { answers })}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Send answers
        </button>
        <button
          disabled={busy}
          onClick={() => submit(false, {})}
          className="text-xs font-medium border border-border px-3 py-1.5 rounded text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
        >
          Skip
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
      summary={describe(toolCall, questions)}
      form={form}
    />
  );
}

function describe(tc, questions) {
  switch (tc.status) {
    case "waiting_for_user_input":
      return questions.length === 1 ? questions[0].question : `${questions.length} quick questions`;
    case "running":
      return "Thinking…";
    case "success":
      return tc.results || "Thanks — got it";
    case "stopped":
      return "Skipped";
    case "error":
      return tc.results || "Couldn't record the answer";
    default:
      return "Clarifying questions";
  }
}
