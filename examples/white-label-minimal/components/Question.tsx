"use client";
import { useRef, useState } from "react";
import type { ToolCall, ToolInput } from "../lib/types";

type Choice = { question: string; options: string[]; multi: boolean };
type Field = { name: string; description: string };
export function parseQuestion(
  tool: ToolCall,
):
  | { kind: "choice"; choices: Choice[] }
  | { kind: "input"; fields: Field[] }
  | { kind: "approval" }
  | { kind: "unknown" } {
  try {
    const args = JSON.parse(tool.arguments_string || "{}");
    if (tool.waiting_on?.kind === "approval") return { kind: "approval" };
    if (
      tool.waiting_on?.kind === "choice" &&
      Array.isArray(args.questions) &&
      args.questions.length
    ) {
      const choices = args.questions.map((q: Record<string, unknown>) => {
        if (typeof q.question !== "string" || !Array.isArray(q.options)) throw Error();
        const options = q.options.map((o) => (typeof o === "string" ? o : o?.label));
        if (options.some((o) => typeof o !== "string")) throw Error();
        return { question: q.question, options, multi: q.multi_select === true };
      });
      return { kind: "choice", choices };
    }
    if (
      tool.waiting_on?.kind === "input" &&
      Array.isArray(args.secrets_schema) &&
      args.secrets_schema.length
    ) {
      const fields = args.secrets_schema.map((s: Record<string, unknown>) => {
        if (typeof s.secretName !== "string" || !s.secretName) throw Error();
        return {
          name: s.secretName,
          description: typeof s.description === "string" ? s.description : "",
        };
      });
      return { kind: "input", fields };
    }
  } catch {
    /* Incomplete or unfamiliar schemas must not become blind approvals. */
  }
  return { kind: "unknown" };
}

export default function Question({
  tool,
  messageId,
  appId,
  disabled,
  onSubmit,
}: {
  tool: ToolCall;
  messageId: string;
  appId: string;
  disabled: boolean;
  onSubmit: (input: ToolInput) => Promise<void>;
}) {
  const question = parseQuestion(tool);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<ToolInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const lock = useRef(false);
  const waiting = tool.status === "waiting_for_user_input";
  async function submit(approve: boolean, extraUserInput: Record<string, unknown>) {
    if (lock.current || !tool.id) return;
    lock.current = true;
    setBusy(true);
    setError("");
    // Retries must use the same payload with the same request ID.
    const input = attempt ?? { appId, toolCallId: tool.id, messageId, approve, extraUserInput };
    setAttempt(input);
    try {
      await onSubmit(input);
      setSubmitted(true);
      setAttempt(null);
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const answers =
    question.kind === "choice"
      ? question.choices
          .map((_, i) => ({
            question_index: i,
            selected_labels: selected[i] || [],
            custom_text: values[i] || "",
          }))
          .filter((a) => a.selected_labels.length || a.custom_text.trim())
      : [];
  const secrets =
    question.kind === "input"
      ? Object.fromEntries(
          question.fields
            .filter((f) => values[f.name]?.trim())
            .map((f) => [f.name, values[f.name]]),
        )
      : {};
  const payload =
    question.kind === "choice" ? { answers } : question.kind === "input" ? { secrets } : {};
  const empty =
    question.kind === "choice"
      ? !answers.length
      : question.kind === "input"
        ? !Object.keys(secrets).length
        : false;
  return (
    <section className="question">
      <strong>{tool.name || "Agent action"}</strong>{" "}
      <small>{submitted ? "Answer sent" : tool.status}</small>
      {(question.kind === "unknown" || question.kind === "approval") && (
        <details>
          <summary>
            {question.kind === "unknown"
              ? "Unsupported question / tool details"
              : "Review proposed action"}
          </summary>
          <pre>{tool.arguments_string || "No arguments provided."}</pre>
        </details>
      )}
      {waiting && !submitted && (
        <>
          <fieldset disabled={disabled || busy || !!attempt || !tool.id}>
            {question.kind === "choice" &&
              question.choices.map((q, i) => (
                <div key={i}>
                  <p>{q.question}</p>
                  {q.options.map((label) => (
                    <label className="option" key={label}>
                      <input
                        type={q.multi ? "checkbox" : "radio"}
                        name={`${tool.id}-${i}`}
                        checked={(selected[i] || []).includes(label)}
                        onChange={() =>
                          setSelected((s) => ({
                            ...s,
                            [i]: q.multi
                              ? (s[i] || []).includes(label)
                                ? s[i].filter((x) => x !== label)
                                : [...(s[i] || []), label]
                              : [label],
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <label>
                    Additional answer
                    <input
                      value={values[i] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [i]: e.target.value }))}
                    />
                  </label>
                </div>
              ))}
            {question.kind === "input" &&
              question.fields.map((f) => (
                <label key={f.name}>
                  {f.name}
                  <small>{f.description}</small>
                  <input
                    type="password"
                    autoComplete="off"
                    value={values[f.name] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                </label>
              ))}
            <div className="actions">
              {question.kind !== "unknown" && (
                <button disabled={empty} onClick={() => void submit(true, payload)}>
                  {question.kind === "approval" ? "Approve" : "Send answer"}
                </button>
              )}
              <button className="secondary" onClick={() => void submit(false, {})}>
                Reject
              </button>
            </div>
          </fieldset>
          {attempt && !busy && (
            <button
              disabled={disabled}
              onClick={() => void submit(attempt.approve, attempt.extraUserInput)}
            >
              Retry original answer
            </button>
          )}
          {busy && <p role="status">Sending answer…</p>}
          {error && (
            <p role="alert">
              {error} Resume polling to check the outcome, or retry the original answer.
            </p>
          )}
        </>
      )}
    </section>
  );
}
