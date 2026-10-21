"use client";
import { useState } from "react";
import type { ChatQuestion } from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A question the AI waits on: a choice (options, or free text), secrets to enter (such as API
// keys), or an approval. Its actions are already bound to its tool call, and declining is always
// an answer.
export default function ToolQuestion({ question }: { question: ChatQuestion }) {
  const [sent, setSent] = useState(false);
  const [picked, setPicked] = useState<string[][]>(question.kind === "choice" ? question.questions.map(() => []) : []);
  const [texts, setTexts] = useState<string[]>([]);
  // Tiny passes these values to Base44 and keeps none.
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  // A failed answer opens the question again, so the buttons come back.
  async function send(action: () => Promise<void>) {
    setSent(true);
    await action();
    setSent(false);
  }

  function pick(index: number, label: string, multi: boolean) {
    const current = picked[index];
    let next = [label];
    if (multi && current.includes(label)) next = current.filter((l) => l !== label);
    else if (multi) next = [...current, label];
    setPicked(picked.map((labels, i) => (i === index ? next : labels)));
  }

  function submit() {
    if (question.kind === "choice") return send(() => question.answer(picked, texts));
    if (question.kind === "secrets") return send(() => question.submit(secrets));
    return send(question.approve);
  }

  return (
    <div className="question">
      {question.kind === "approval" && <p>Allow {question.action}? {question.reason}</p>}
      {question.kind === "choice" &&
        question.questions.map((q, i) => (
          <div key={i} className="question-item">
            <p className="question-title">{q.text}</p>
            {q.type === "text_input" ? (
              <Input onChange={(e) => setTexts(Object.assign([...texts], { [i]: e.target.value }))} />
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
      {question.kind === "secrets" &&
        question.fields.map(({ name }) => (
          <Input key={name} type="password" placeholder={name} onChange={(e) => setSecrets({ ...secrets, [name]: e.target.value })} />
        ))}
      <div className="question-actions">
        <Button size="sm" onClick={submit} disabled={sent}>{question.kind === "approval" ? "Allow" : "Submit"}</Button>
        <Button size="sm" variant="ghost" onClick={() => send(question.decline)} disabled={sent}>Decline</Button>
      </div>
    </div>
  );
}
