"use client";
import { useState } from "react";
import type { ApprovalQuestion, ChatQuestion, ChoiceQuestion, SecretsQuestion } from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A question the AI waits on: a choice (options, or free text), secrets to enter (such as API
// keys), or an approval. Its actions are already bound to its tool call, and declining is always
// an answer.
export default function ToolQuestion({ question }: { question: ChatQuestion }) {
  if (question.kind === "choice") return <Choice question={question} />;
  if (question.kind === "secrets") return <Secrets question={question} />;
  return <Approval question={question} />;
}

function Choice({ question }: { question: ChoiceQuestion }) {
  const [picked, setPicked] = useState<string[][]>(question.questions.map(() => []));
  const [texts, setTexts] = useState<string[]>([]);

  function pick(index: number, label: string, multi: boolean) {
    const current = picked[index];
    let next = [label];
    if (multi && current.includes(label)) next = current.filter((l) => l !== label);
    else if (multi) next = [...current, label];
    setPicked(picked.map((labels, i) => (i === index ? next : labels)));
  }

  function write(index: number, text: string) {
    const next = [...texts];
    next[index] = text;
    setTexts(next);
  }

  return (
    <div className="question">
      {question.questions.map((q, i) => (
        <div key={i} className="question-item">
          <p className="question-title">{q.text}</p>
          {q.type === "text_input" ? (
            <Input onChange={(e) => write(i, e.target.value)} />
          ) : (
            <div className="question-options">
              {q.options.map((label) => (
                <Button key={label} size="sm" variant={picked[i].includes(label) ? "default" : "outline"} onClick={() => pick(i, label, q.multi)}>
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
      <Actions submitLabel="Submit" onSubmit={() => question.answer(picked, texts)} onDecline={question.decline} />
    </div>
  );
}

function Secrets({ question }: { question: SecretsQuestion }) {
  // Tiny passes these values to Base44 and keeps none.
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="question">
      {question.fields.map(({ name }) => (
        <Input key={name} type="password" placeholder={name} onChange={(e) => setValues({ ...values, [name]: e.target.value })} />
      ))}
      <Actions submitLabel="Submit" onSubmit={() => question.submit(values)} onDecline={question.decline} />
    </div>
  );
}

function Approval({ question }: { question: ApprovalQuestion }) {
  return (
    <div className="question">
      <p>Allow {question.action}? {question.reason}</p>
      <Actions submitLabel="Allow" onSubmit={question.approve} onDecline={question.decline} />
    </div>
  );
}

function Actions({ submitLabel, onSubmit, onDecline }: {
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onDecline: () => Promise<void>;
}) {
  const [sent, setSent] = useState(false);

  // A failed answer opens the question again, so the buttons come back.
  async function send(action: () => Promise<void>) {
    setSent(true);
    await action();
    setSent(false);
  }

  return (
    <div className="question-actions">
      <Button size="sm" onClick={() => send(onSubmit)} disabled={sent}>{submitLabel}</Button>
      <Button size="sm" variant="ghost" onClick={() => send(onDecline)} disabled={sent}>Decline</Button>
    </div>
  );
}
