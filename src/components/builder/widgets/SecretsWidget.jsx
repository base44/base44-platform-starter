import { useState } from "react";
import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useAnswer } from "../useAnswer";

/**
 * Collects the secret values the builder declared, keyed by field name. "Skip"
 * declines, and the builder continues without them.
 *
 * The values travel over the same proxy as everything else; the platform scrubs
 * them from the persisted tool call after the run, so nothing here needs to.
 */
export default function SecretsWidget({ step, question }) {
  const { busy, run } = useAnswer();
  const [values, setValues] = useState({});

  const filled = question.fields.filter((f) => values[f.name]?.trim());
  const canSubmit = filled.length > 0 && !busy;

  const save = () => {
    const secrets = {};
    for (const f of filled) secrets[f.name] = values[f.name].trim();
    run(() => question.submit(secrets));
  };

  const names = question.fields.map((f) => f.name).join(", ");

  const form = (
    <div className="flex flex-col gap-3">
      {question.fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1">
          <span className="font-mono text-foreground">{f.name}</span>
          {f.description && <span className="text-muted-foreground">{f.description}</span>}
          <input
            type="password"
            autoComplete="off"
            disabled={busy}
            value={values[f.name] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            className="border border-border rounded px-2 py-1.5 bg-background text-foreground text-xs disabled:opacity-50"
            placeholder={`Enter ${f.name}…`}
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button
          disabled={!canSubmit}
          onClick={save}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save secrets
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
      summary={names ? `The app needs: ${names}` : "The app needs some secrets"}
      form={form}
    />
  );
}
