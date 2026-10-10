"use client";
import { useState } from "react";
import { Check, CircleHelp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalQuestion, ChatError, ChatItem, ChatPhase, ChatStep, ChoiceQuestion, InputQuestion } from "../../../sdk";

// Tiny's look: shadcn buttons, Tiny's theme, lucide icons. A question part takes the question
// itself, with its bound actions; the hook has no parts API, so Tiny calls these itself.

export function Text({ text, role }: { text: string; role: ChatItem["role"] }) {
  return <p className={role === "user" ? "ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2 whitespace-pre-wrap" : "whitespace-pre-wrap"}>{text}</p>;
}

const stepIcons = { running: Loader2, waiting: CircleHelp, done: Check, error: X };

export function Step({ label, status }: ChatStep) {
  const Icon = stepIcons[status];
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`size-3.5 ${status === "running" ? "animate-spin" : ""}`} /> {label}
    </p>
  );
}

export function Choice({ questions, answer, decline }: ChoiceQuestion) {
  // One list of picked labels per question, in the same order as `questions`.
  const [picked, setPicked] = useState<string[][]>(questions.map(() => []));
  function toggle(i: number, option: string, multi: boolean) {
    setPicked((all) =>
      all.map((labels, j) => {
        if (j !== i) return labels;
        if (labels.includes(option)) return labels.filter((o) => o !== option);
        return multi ? [...labels, option] : [option];
      }),
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <p className="font-medium">{q.text}</p>
          {q.description && <p className="text-xs text-muted-foreground">{q.description}</p>}
          <div className="flex flex-wrap gap-1">
            {q.options.map((option) => (
              <Button key={option} size="sm" variant={picked[i].includes(option) ? "default" : "outline"} onClick={() => toggle(i, option, q.multi)}>
                {option}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => answer(picked)}>Send answer</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

export function Secrets({ fields, submit, decline }: InputQuestion) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      {fields.map((field) => (
        <input
          key={field.name}
          type="password"
          placeholder={field.name}
          title={field.description}
          onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
          className="rounded-md border px-2 py-1"
        />
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => submit(values)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

export function Approval({ action, reason, approve, decline }: ApprovalQuestion) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="font-medium">Allow {action}?</p>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={approve}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

// The wording for each phase is Tiny's, not the library's.
const phaseText: Record<ChatPhase, string> = {
  idle: "",
  creating: "Creating app…",
  loading: "Loading the conversation…",
  waiting: "Waiting for your answer",
  building: "Building…",
};

export function StatusLine({ phase, error, onDismiss }: { phase: ChatPhase; error: ChatError | null; onDismiss: () => void }) {
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {error.message} <Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">{phaseText[phase]}</p>;
}
