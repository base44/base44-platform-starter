import { useState } from "react";
import { Loader2 } from "lucide-react";
import ToolRow from "../ToolRow";
import { useSubmitToolInput } from "../useSubmitToolInput";

/**
 * Collects the secret values the builder declared. Payload mirrors the tool's
 * own schema: `{ secrets: { SECRET_NAME: value } }`, or `{ skipped: true }` for
 * a soft decline the tool still records as success.
 *
 * The values travel over the same proxy as everything else; the platform scrubs
 * them from the persisted tool call after the run (set_secrets is on its
 * SENSITIVE_USER_INPUT_TOOLS list), so nothing here needs to.
 */
export default function SecretsWidget({
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
    onSubmitted,
  });
  const schema = Array.isArray(parsedArgs?.secrets_schema) ? parsedArgs.secrets_schema : [];
  const [values, setValues] = useState({});

  // Status is the whole gate: an answered call is `success`/`stopped` (so it
  // renders read-only in history), and one still `waiting` is genuinely live —
  // wherever it sits, including a call parked behind a newer turn.
  const interactive = toolCall.status === "waiting_for_user_input";
  const filled = schema.filter((s) => values[s?.secretName]?.trim());
  const canSubmit = filled.length > 0 && !busy;

  const save = () => {
    const secrets = {};
    for (const s of filled) secrets[s.secretName] = values[s.secretName].trim();
    submit(true, { secrets });
  };

  const form = interactive ? (
    <div className="flex flex-col gap-3">
      {schema.map((s) => (
        <label key={s.secretName} className="flex flex-col gap-1">
          <span className="font-mono text-foreground">{s.secretName}</span>
          {s.description && <span className="text-muted-foreground">{s.description}</span>}
          <input
            type="password"
            autoComplete="off"
            disabled={busy}
            value={values[s.secretName] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [s.secretName]: e.target.value }))}
            className="border border-border rounded px-2 py-1.5 bg-background text-foreground text-xs disabled:opacity-50"
            placeholder={`Enter ${s.secretName}…`}
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
          onClick={() => submit(true, { skipped: true })}
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
      summary={describe(toolCall, schema)}
      form={form}
    />
  );
}

function describe(tc, schema) {
  const names = schema
    .map((s) => s?.secretName)
    .filter(Boolean)
    .join(", ");
  switch (tc.status) {
    case "waiting_for_user_input":
      return names ? `The app needs: ${names}` : "The app needs some secrets";
    case "running":
      return "Saving…";
    case "success":
      return tc.results || "Secrets saved";
    case "stopped":
      return "Declined";
    case "error":
      return tc.results || "Couldn't save secrets";
    default:
      return names ? `Secrets: ${names}` : "Secrets";
  }
}
