"use client";
import { useState } from "react";
import { Check, CircleHelp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalProps, ChoiceProps, InputProps, MessageComponents, StepProps, TextProps } from "../../../sdk";

// Tiny's look for the library's message parts: shadcn buttons, Tiny's theme, lucide icons.
// Every part is optional; anything left out uses the library's default.

function Text({ text, role }: TextProps) {
  return <p className={role === "user" ? "rounded-2xl bg-muted px-4 py-2 whitespace-pre-wrap" : "whitespace-pre-wrap"}>{text}</p>;
}

const stepIcons = { running: Loader2, waiting: CircleHelp, done: Check, error: X };

function Step({ label, status }: StepProps) {
  const Icon = stepIcons[status];
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`size-3.5 ${status === "running" ? "animate-spin" : ""}`} /> {label}
    </p>
  );
}

function Choice({ questions, answer, decline }: ChoiceProps) {
  const [picked, setPicked] = useState<string[][]>([]);
  function toggle(i: number, option: string, multi: boolean) {
    const current = picked[i] ?? [];
    const next = current.includes(option) ? current.filter((o) => o !== option) : multi ? [...current, option] : [option];
    setPicked(Object.assign([...picked], { [i]: next }));
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <p className="font-medium">{q.text}</p>
          <div className="flex flex-wrap gap-1">
            {q.options.map((option) => (
              <Button key={option} size="sm" variant={picked[i]?.includes(option) ? "default" : "outline"} onClick={() => toggle(i, option, q.multi)}>
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

function Input({ fields, submit, decline }: InputProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      {fields.map((field) => (
        <input key={field} type="password" placeholder={field} onChange={(e) => setValues({ ...values, [field]: e.target.value })} className="rounded-md border px-2 py-1" />
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => submit(values)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

function Approval({ action, reason, approve, decline }: ApprovalProps) {
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

export const chatParts: Partial<MessageComponents> = { Text, Step, Choice, Input, Approval };
