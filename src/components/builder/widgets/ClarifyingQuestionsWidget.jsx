import { useState } from "react";
import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useAnswer } from "../useAnswer";

/**
 * Answers the builder's clarifying questions: options to pick, and a free-text
 * answer beside each. Questions the user leaves blank are skipped, and the
 * builder treats a short answer as partial and moves on. "Skip" declines the
 * whole call.
 *
 * Renders option labels only; the tool's image-design variant is not previewed
 * here, and its labels still work as plain choices.
 */
export default function ClarifyingQuestionsWidget({ step, question }) {
  const { busy, run } = useAnswer();
  const questions = question.questions;
  const [picks, setPicks] = useState({}); // index -> string[]
  const [custom, setCustom] = useState({}); // index -> string

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

  const picked = questions.map((_, qi) => picks[qi] || []);
  const texts = questions.map((_, qi) => (custom[qi] || "").trim());
  const canSubmit = !busy && questions.some((_, qi) => picked[qi].length > 0 || texts[qi]);

  const form = (
    <div className="flex flex-col gap-4">
      {questions.map((q, qi) => (
        <div key={qi} className="flex flex-col gap-1.5">
          <span className="text-foreground font-medium">{q.text}</span>
          {q.description && <span className="text-muted-foreground">{q.description}</span>}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((label) => {
                const selected = picked[qi].includes(label);
                return (
                  <button
                    key={label}
                    disabled={busy}
                    onClick={() => toggle(qi, label, q.multi)}
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
          )}
          <input
            type="text"
            disabled={busy}
            value={custom[qi] || ""}
            onChange={(e) => setCustom((c) => ({ ...c, [qi]: e.target.value }))}
            className="border border-border rounded px-2 py-1.5 bg-background text-foreground text-xs disabled:opacity-50 mt-0.5"
            placeholder={q.options.length > 0 ? "Something else…" : "Your answer…"}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button
          disabled={!canSubmit}
          onClick={() => run(() => question.answer(picked, texts))}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Send answers
        </button>
        <button
          disabled={busy}
          onClick={() => run(question.decline)}
          className="text-xs font-medium border border-border px-3 py-1.5 rounded text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );

  return (
    <ToolRow
      status={step.status}
      name={step.label}
      summary={questions.length === 1 ? questions[0].text : `${questions.length} quick questions`}
      form={form}
    />
  );
}
