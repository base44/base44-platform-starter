"use client";
import { useState } from "react";
import type { Question, SecretField, ToolCall } from "@base44/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitToolCallInput } from "../server/base44";

// A tool step the builder waits on: a choice, values to enter (such as API keys), or an
// approval. Declining is always an answer.
export default function ToolQuestion({ appId, messageId, tool }: { appId: string; messageId: string; tool: ToolCall }) {
  const [sent, setSent] = useState(false);
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const kind = tool.waiting_on?.kind;
  // ToolCall includes OtherToolCall, which has no arguments, so narrow with `in` after the name.
  let questions: Question[] = [];
  if (kind === "choice" && tool.name === "ask_clarifying_questions" && "arguments" in tool) questions = tool.arguments?.questions ?? [];
  // Tiny passes these values to Base44 and keeps none.
  let fields: SecretField[] = [];
  if (kind === "input" && tool.name === "set_secrets" && "arguments" in tool) fields = tool.arguments?.secrets_schema ?? [];

  function answer(approve: boolean, extraUserInput?: object) {
    setSent(true);
    submitToolCallInput(appId, { toolCallId: tool.id!, messageId, approve, extraUserInput }).catch(() => setSent(false));
  }

  function pick(index: number, label: string, multi?: boolean) {
    const current = picked[index] ?? [];
    const next = !multi ? [label] : current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    setPicked({ ...picked, [index]: next });
  }

  function submit() {
    if (kind === "choice") answer(true, { answers: questions.map((_, i) => ({ question_index: i, selected_labels: picked[i] ?? [] })) });
    else if (kind === "input") answer(true, { secrets });
    else answer(true);
  }

  return (
    <div className="question">
      {kind === "approval" && <p>Allow {tool.name}? {approvalText(tool)}</p>}
      {questions.map((q, i) => (
        <div key={i} className="question-item">
          <p className="question-title">{q.question}</p>
          <div className="question-options">
            {(q.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")).map((label) => (
              <Button key={label} size="sm" variant={picked[i]?.includes(label) ? "default" : "outline"} onClick={() => pick(i, label, q.multi_select)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {fields.map(({ secretName = "" }) => (
        <Input key={secretName} type="password" placeholder={secretName} onChange={(e) => setSecrets({ ...secrets, [secretName]: e.target.value })} />
      ))}
      <div className="question-actions">
        <Button size="sm" onClick={submit} disabled={sent}>{kind === "approval" ? "Allow" : "Submit"}</Button>
        <Button size="sm" variant="ghost" onClick={() => answer(false)} disabled={sent}>Decline</Button>
      </div>
    </div>
  );
}

// Why a guard paused the call. Some guards, such as bash_approval, give no reason.
function approvalText(tool: ToolCall) {
  const approval = tool.approval;
  if (!approval || !("reason" in approval)) return "";
  if (approval.reason) return approval.reason;
  if (approval.details && "summary" in approval.details) return approval.details.summary ?? "";
  return "";
}
