"use client";
import { useState } from "react";
import type { ToolCall, ToolQuestionArguments, ToolSecretArguments } from "@base44/platform";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "../../assistant-ui/elements/approval-card";
import { QuestionFlow } from "../../assistant-ui/elements/question-flow";
import { submitToolCallInput } from "../../../server/base44";

// A tool step the builder waits on, shown with assistant-ui's elements. Declining is always an answer.
export default function ToolQuestion({ appId, messageId, tool }: { appId: string; messageId: string; tool: ToolCall }) {
  const [sent, setSent] = useState<"approved" | "declined" | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  function answer(approve: boolean, extraUserInput?: Record<string, unknown>) {
    setSent(approve ? "approved" : "declined");
    submitToolCallInput(appId, { toolCallId: tool.id!, messageId, approve, extraUserInput }).catch(() => setSent(null));
  }
  const decline = <Button variant="ghost" size="sm" onClick={() => answer(false)} disabled={!!sent}>Decline</Button>;

  if (tool.waiting_on?.kind === "approval") {
    return (
      <ApprovalCard
        state={sent === "declined" ? "denied" : sent ? "running" : "request"}
        title={`Allow ${tool.name}?`}
        subtitle={tool.approval?.reason ?? tool.approval?.details?.summary ?? ""}
        onAllowOnce={() => answer(true)}
        onDeny={() => answer(false)}
      />
    );
  }

  if (tool.waiting_on?.kind === "choice") {
    const questions = (tool.arguments as ToolQuestionArguments)?.questions ?? [];
    const steps = questions.map((q, i) => ({
      id: String(i),
      question: q.question ?? "",
      description: q.description,
      selectionMode: q.multi_select ? ("multiple" as const) : ("single" as const),
      options: (q.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")).map((label) => ({ id: label, label })),
    }));
    return (
      <div>
        <QuestionFlow
          steps={steps}
          onComplete={(picked) =>
            answer(true, { answers: Object.entries(picked).map(([i, labels]) => ({ question_index: Number(i), selected_labels: labels })) })
          }
        />
        {!sent && decline}
      </div>
    );
  }

  // input: values the builder needs, such as API keys. Tiny passes them to Base44 and keeps none.
  const fields = (tool.arguments as ToolSecretArguments)?.secrets_schema ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      {fields.map(({ secretName = "" }) => (
        <input key={secretName} type="password" placeholder={secretName} onChange={(e) => setSecrets({ ...secrets, [secretName]: e.target.value })} className="rounded-md border px-2 py-1" />
      ))}
      <div className="flex gap-2">
        {fields.length > 0 && <Button size="sm" onClick={() => answer(true, { secrets })} disabled={!!sent}>Save</Button>}
        {decline}
      </div>
    </div>
  );
}
