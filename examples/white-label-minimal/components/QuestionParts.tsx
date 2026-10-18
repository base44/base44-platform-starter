"use client";
import { useState } from "react";
import type { ApprovalQuestion, ChoiceQuestion, QuestionComponents, SecretsQuestion } from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Tiny's part for each question kind the builder can wait on. The provider picks the part, and
// each one gets its question with the actions already bound to its tool call.

// A failed answer opens the question again, so the buttons come back.
function useSend() {
  const [sent, setSent] = useState(false);
  async function send(action: () => Promise<void>) {
    setSent(true);
    await action();
    setSent(false);
  }
  return { sent, send };
}

function Actions({ label, onSubmit, onDecline, sent }: { label: string; onSubmit: () => void; onDecline: () => void; sent: boolean }) {
  return (
    <div className="question-actions">
      <Button size="sm" onClick={onSubmit} disabled={sent}>{label}</Button>
      <Button size="sm" variant="ghost" onClick={onDecline} disabled={sent}>Decline</Button>
    </div>
  );
}

function Choice({ questions, answer, decline }: ChoiceQuestion) {
  const { sent, send } = useSend();
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));

  function pick(index: number, label: string, multi: boolean) {
    const current = picked[index];
    let next = [label];
    if (multi && current.includes(label)) next = current.filter((l) => l !== label);
    else if (multi) next = [...current, label];
    setPicked(picked.map((labels, i) => (i === index ? next : labels)));
  }

  return (
    <div className="question">
      {questions.map((q, i) => (
        <div key={i} className="question-item">
          <p className="question-title">{q.text}</p>
          <div className="question-options">
            {q.options.map((label) => (
              <Button key={label} size="sm" variant={picked[i].includes(label) ? "default" : "outline"} onClick={() => pick(i, label, q.multi)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <Actions label="Submit" onSubmit={() => send(() => answer(picked))} onDecline={() => send(decline)} sent={sent} />
    </div>
  );
}

// Tiny passes these values to Base44 and keeps none.
function Secrets({ fields, submit, decline }: SecretsQuestion) {
  const { sent, send } = useSend();
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="question">
      {fields.map(({ name }) => (
        <Input key={name} type="password" placeholder={name} onChange={(e) => setValues({ ...values, [name]: e.target.value })} />
      ))}
      <Actions label="Submit" onSubmit={() => send(() => submit(values))} onDecline={() => send(decline)} sent={sent} />
    </div>
  );
}

function Approval({ action, reason, approve, decline }: ApprovalQuestion) {
  const { sent, send } = useSend();
  return (
    <div className="question">
      <p>Allow {action}? {reason}</p>
      <Actions label="Allow" onSubmit={() => send(approve)} onDecline={() => send(decline)} sent={sent} />
    </div>
  );
}

export const questionParts: QuestionComponents = { Choice, Secrets, Approval };
