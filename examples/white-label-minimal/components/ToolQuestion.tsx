"use client";
import { useState } from "react";
import type { ToolCall, ToolQuestionArguments, ToolSecretArguments } from "@base44/platform";
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
  const questions = kind === "choice" ? (tool.arguments as ToolQuestionArguments)?.questions ?? [] : [];
  // Tiny passes these values to Base44 and keeps none.
  const fields = kind === "input" ? (tool.arguments as ToolSecretArguments)?.secrets_schema ?? [] : [];

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
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      {kind === "approval" && <p>Allow {tool.name}? {tool.approval?.reason ?? tool.approval?.details?.summary}</p>}
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-2">
          <p className="font-medium">{q.question}</p>
          <div className="flex flex-wrap gap-2">
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
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={sent}>{kind === "approval" ? "Allow" : "Submit"}</Button>
        <Button size="sm" variant="ghost" onClick={() => answer(false)} disabled={sent}>Decline</Button>
      </div>
    </div>
  );
}
