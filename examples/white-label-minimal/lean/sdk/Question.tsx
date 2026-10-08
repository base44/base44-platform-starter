"use client";
import { useState, type ComponentType } from "react";
import { Button } from "./ui/button";
import { Input as TextInput } from "./ui/input";
import type { Base44Chat, Question as QuestionData } from "./useBase44Chat";

// One component per question kind. Each gets the question and the actions that answer it.
export type ChoiceProps = { questions: { text: string; options: string[]; multi: boolean }[]; answer: (picked: string[][]) => void; decline: () => void };
export type InputProps = { fields: string[]; submit: (values: Record<string, string>) => void; decline: () => void };
export type ApprovalProps = { action: string; reason: string; approve: () => void; decline: () => void };
export type UnknownProps = { action: string; decline: () => void }; // kinds Base44 adds later: decline only

export type QuestionComponents = {
  Choice: ComponentType<ChoiceProps>;
  Input: ComponentType<InputProps>;
  Approval: ComponentType<ApprovalProps>;
  Unknown: ComponentType<UnknownProps>;
};

// Renders an open question. Pass components to replace any of the defaults.
export function Question({ question, chat, components }: { question: QuestionData; chat: Base44Chat; components?: Partial<QuestionComponents> }) {
  const { Choice, Input, Approval, Unknown } = { ...defaultQuestionComponents, ...components };
  switch (question.kind) {
    case "choice":
      return <Choice questions={question.questions} answer={chat.answerChoices} decline={chat.decline} />;
    case "input":
      return <Input fields={question.fields} submit={chat.submitInputs} decline={chat.decline} />;
    case "approval":
      return <Approval action={question.action} reason={question.reason} approve={chat.approve} decline={chat.decline} />;
    default:
      return <Unknown action={question.action} decline={chat.decline} />;
  }
}

// The defaults are built from the library's own copies of shadcn's Button and Input (./ui),
// so they match a shadcn app without importing anything from it.
const card = "flex flex-col gap-3 rounded-xl border p-3 text-sm";

function DefaultChoice({ questions, answer, decline }: ChoiceProps) {
  const [picked, setPicked] = useState<string[][]>([]);
  function toggle(i: number, option: string, multi: boolean) {
    const current = picked[i] ?? [];
    const next = current.includes(option) ? current.filter((o) => o !== option) : multi ? [...current, option] : [option];
    setPicked(Object.assign([...picked], { [i]: next }));
  }
  return (
    <div className={card}>
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

function DefaultInput({ fields, submit, decline }: InputProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className={card}>
      {fields.map((field) => (
        <TextInput key={field} type="password" placeholder={field} onChange={(e) => setValues({ ...values, [field]: e.target.value })} />
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => submit(values)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

function DefaultApproval({ action, reason, approve, decline }: ApprovalProps) {
  return (
    <div className={card}>
      <p className="font-medium">Allow {action}?</p>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={approve}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
      </div>
    </div>
  );
}

function DefaultUnknown({ action, decline }: UnknownProps) {
  return (
    <div className={`${card} flex-row items-center`}>
      <p className="flex-1">{action} is waiting for you.</p>
      <Button size="sm" variant="ghost" onClick={decline}>Decline</Button>
    </div>
  );
}

export const defaultQuestionComponents: QuestionComponents = {
  Choice: DefaultChoice,
  Input: DefaultInput,
  Approval: DefaultApproval,
  Unknown: DefaultUnknown,
};
