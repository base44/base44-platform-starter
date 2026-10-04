"use client";
import { useRef, useState } from "react";
import type { ToolCall, ToolInput } from "../lib/types";

// "Answer the agent's questions": a waiting tool call says what it needs in
// waiting_on.kind, and there are exactly three kinds. One form for each.
// https://docs.base44.com/developers/white-label/the-build-turn

type Choice = { question: string; options: string[]; multi: boolean };
type SecretField = { name: string; description: string };
type ParsedQuestion =
  | { kind: "choice"; choices: Choice[] }
  | { kind: "input"; fields: SecretField[] }
  | { kind: "approval" }
  | { kind: "unknown" };

export default function Question({ tool, messageId, appId, disabled, onSubmit }: {
  tool: ToolCall;
  messageId: string;
  appId: string;
  disabled: boolean;
  onSubmit: (input: ToolInput) => Promise<void>;
}) {
  const question = parseQuestion(tool);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  // A failed answer is kept, and a retry sends it unchanged with the same request ID.
  const [failed, setFailed] = useState<ToolInput | null>(null);
  const lock = useRef(false);

  async function send(input: ToolInput) {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setError("");
    try {
      await onSubmit(input);
      setSent(true);
      setFailed(null);
    } catch (err) {
      setFailed(input);
      setError(err instanceof Error ? err.message : "Could not send the answer.");
    } finally {
      lock.current = false;
      setSending(false);
    }
  }

  // Declining is an answer too: the tool never runs and the agent carries on.
  function answer(approve: boolean, extraUserInput: Record<string, unknown> = {}) {
    if (!tool.id) return;
    void send({ appId, toolCallId: tool.id, messageId, approve, extraUserInput });
  }
  const reject = () => answer(false);

  const waiting = tool.status === "waiting_for_user_input" && !sent;

  return (
    <section className="question">
      <strong>{tool.name || "Agent action"}</strong> <small>{sent ? "Answer sent" : tool.status}</small>

      {question.kind === "approval" && <Details summary="Review proposed action" text={tool.arguments_string} />}
      {question.kind === "unknown" && <Details summary="Unsupported question / tool details" text={tool.arguments_string} />}

      {waiting && (
        <fieldset disabled={disabled || sending || !!failed || !tool.id}>
          {question.kind === "choice" && (
            <ChoiceForm name={tool.id ?? ""} choices={question.choices} onSend={(answers) => answer(true, { answers })} onReject={reject} />
          )}
          {question.kind === "input" && (
            <SecretsForm fields={question.fields} onSend={(secrets) => answer(true, { secrets })} onReject={reject} />
          )}
          {question.kind === "approval" && (
            <div className="actions">
              <button onClick={() => answer(true)}>Approve</button>
              <button className="secondary" onClick={reject}>Reject</button>
            </div>
          )}
          {/* An unfamiliar question is never offered for approval, only rejection. */}
          {question.kind === "unknown" && (
            <div className="actions">
              <button className="secondary" onClick={reject}>Reject</button>
            </div>
          )}
        </fieldset>
      )}

      {waiting && failed && !sending && (
        <button disabled={disabled} onClick={() => void send(failed)}>Retry original answer</button>
      )}
      {sending && <p role="status">Sending answer…</p>}
      {error && <p role="alert">{error} Reconnect live updates to check the outcome, or retry the original answer.</p>}
    </section>
  );
}

// choice: pick from the options the agent offered, or write an answer.
function ChoiceForm({ name, choices, onSend, onReject }: {
  name: string;
  choices: Choice[];
  onSend: (answers: object[]) => void;
  onReject: () => void;
}) {
  const [picked, setPicked] = useState<string[][]>(choices.map(() => []));
  const [texts, setTexts] = useState<string[]>(choices.map(() => ""));

  function pick(index: number, label: string, multi: boolean) {
    const current = picked[index];
    let next = [label];
    if (multi) {
      next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    }
    setPicked(picked.map((labels, i) => (i === index ? next : labels)));
  }

  const answers = choices
    .map((_, i) => ({ question_index: i, selected_labels: picked[i], custom_text: texts[i] }))
    .filter((answer) => answer.selected_labels.length > 0 || answer.custom_text.trim() !== "");

  return (
    <>
      {choices.map((choice, i) => (
        <div key={i}>
          <p>{choice.question}</p>
          {choice.options.map((label) => (
            <label className="option" key={label}>
              <input
                type={choice.multi ? "checkbox" : "radio"}
                name={`${name}-${i}`}
                checked={picked[i].includes(label)}
                onChange={() => pick(i, label, choice.multi)}
              />
              {label}
            </label>
          ))}
          <label>
            Additional answer
            <input value={texts[i]} onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))} />
          </label>
        </div>
      ))}
      <div className="actions">
        <button disabled={answers.length === 0} onClick={() => onSend(answers)}>Send answer</button>
        <button className="secondary" onClick={onReject}>Reject</button>
      </div>
    </>
  );
}

// input: values the agent needs, such as API keys. Tiny passes them to Base44 and keeps none.
function SecretsForm({ fields, onSend, onReject }: {
  fields: SecretField[];
  onSend: (secrets: Record<string, string>) => void;
  onReject: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = fields.filter((field) => values[field.name]?.trim());

  return (
    <>
      {fields.map((field) => (
        <label key={field.name}>
          {field.name}
          <small>{field.description}</small>
          <input
            type="password"
            autoComplete="off"
            value={values[field.name] ?? ""}
            onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
          />
        </label>
      ))}
      <div className="actions">
        <button
          disabled={filled.length === 0}
          onClick={() => onSend(Object.fromEntries(filled.map((field) => [field.name, values[field.name]])))}
        >
          Send answer
        </button>
        <button className="secondary" onClick={onReject}>Reject</button>
      </div>
    </>
  );
}

function Details({ summary, text }: { summary: string; text?: string | null }) {
  return (
    <details>
      <summary>{summary}</summary>
      <pre>{text || "No arguments provided."}</pre>
    </details>
  );
}

export function parseQuestion(tool: ToolCall): ParsedQuestion {
  const kind = tool.waiting_on?.kind;
  if (kind === "approval") return { kind: "approval" };

  const args = parseJson(tool.arguments_string);
  if (kind === "choice") {
    const choices = parseChoices(args?.questions);
    if (choices) return { kind: "choice", choices };
  }
  if (kind === "input") {
    const fields = parseSecretFields(args?.secrets_schema);
    if (fields) return { kind: "input", fields };
  }
  // An unfamiliar or incomplete question must never become a blind approval.
  return { kind: "unknown" };
}

function parseChoices(questions: unknown): Choice[] | null {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const choices: Choice[] = [];
  for (const q of questions) {
    if (typeof q?.question !== "string" || !Array.isArray(q.options)) return null;
    // Options arrive as strings or as { label } objects.
    const options = q.options.map((option: unknown) => (typeof option === "string" ? option : (option as { label?: unknown })?.label));
    if (options.some((option: unknown) => typeof option !== "string")) return null;
    choices.push({ question: q.question, options, multi: q.multi_select === true });
  }
  return choices;
}

function parseSecretFields(schema: unknown): SecretField[] | null {
  if (!Array.isArray(schema) || schema.length === 0) return null;
  const fields: SecretField[] = [];
  for (const s of schema) {
    if (typeof s?.secretName !== "string" || !s.secretName) return null;
    fields.push({ name: s.secretName, description: typeof s.description === "string" ? s.description : "" });
  }
  return fields;
}

function parseJson(text?: string | null) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}
