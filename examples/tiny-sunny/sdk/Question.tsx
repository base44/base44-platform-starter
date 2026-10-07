"use client";
import { useState, type ComponentType } from "react";
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

// The defaults: plain elements with Tailwind classes, so they fit most apps as they are.
const card = "flex flex-col gap-3 rounded-xl border p-3 text-sm";
const primary = "rounded-md bg-black px-3 py-1.5 text-white";
const secondary = "rounded-md border px-3 py-1.5";

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
              <button key={option} onClick={() => toggle(i, option, q.multi)} className={picked[i]?.includes(option) ? primary : secondary}>
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => answer(picked)} className={primary}>Send answer</button>
        <button onClick={decline} className={secondary}>Decline</button>
      </div>
    </div>
  );
}

function DefaultInput({ fields, submit, decline }: InputProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className={card}>
      {fields.map((field) => (
        <input key={field} type="password" placeholder={field} onChange={(e) => setValues({ ...values, [field]: e.target.value })} className="rounded-md border px-2 py-1" />
      ))}
      <div className="flex gap-2">
        <button onClick={() => submit(values)} className={primary}>Save</button>
        <button onClick={decline} className={secondary}>Decline</button>
      </div>
    </div>
  );
}

function DefaultApproval({ action, reason, approve, decline }: ApprovalProps) {
  return (
    <div className={card}>
      <p className="font-medium">Allow {action}?</p>
      {reason && <p className="text-xs opacity-70">{reason}</p>}
      <div className="flex gap-2">
        <button onClick={approve} className={primary}>Approve</button>
        <button onClick={decline} className={secondary}>Decline</button>
      </div>
    </div>
  );
}

function DefaultUnknown({ action, decline }: UnknownProps) {
  return (
    <div className={`${card} flex-row items-center`}>
      <p className="flex-1">{action} is waiting for you.</p>
      <button onClick={decline} className={secondary}>Decline</button>
    </div>
  );
}

export const defaultQuestionComponents: QuestionComponents = {
  Choice: DefaultChoice,
  Input: DefaultInput,
  Approval: DefaultApproval,
  Unknown: DefaultUnknown,
};
