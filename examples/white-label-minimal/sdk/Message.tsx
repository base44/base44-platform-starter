"use client";
import type { ComponentType } from "react";
import { Question, defaultQuestionComponents, type QuestionComponents } from "./Question";
import type { Base44Chat, ChatItem, ChatStep } from "./useBase44Chat";

export type TextProps = { text: string; role: ChatItem["role"] };
export type StepProps = ChatStep;

// Every part of a message, in one flat set. Replace any of them; the rest stay default.
export type MessageComponents = {
  Text: ComponentType<TextProps>;
  Step: ComponentType<StepProps>;
} & QuestionComponents;

// Renders one chat item: its text, its steps, and its open question.
export function Message({ item, chat, components }: { item: ChatItem; chat: Base44Chat; components?: Partial<MessageComponents> }) {
  const parts = { ...defaultMessageComponents, ...components };
  const { Text, Step } = parts;
  return (
    <div className={item.role === "user" ? "ml-auto max-w-[80%]" : "flex flex-col gap-1"}>
      {item.text && <Text text={item.text} role={item.role} />}
      {item.steps.map((step) => (
        <Step key={step.id} {...step} />
      ))}
      {item.question && <Question question={item.question} chat={chat} components={parts} />}
    </div>
  );
}

function DefaultText({ text, role }: TextProps) {
  return <p className={role === "user" ? "rounded-2xl bg-black/5 px-4 py-2 whitespace-pre-wrap" : "whitespace-pre-wrap"}>{text}</p>;
}

const stepIcons: Record<ChatStep["status"], string> = { running: "…", waiting: "?", done: "✓", error: "✗" };

function DefaultStep({ label, status }: StepProps) {
  return (
    <p className="text-xs opacity-60">
      {stepIcons[status]} {label}
    </p>
  );
}

export const defaultMessageComponents: MessageComponents = { Text: DefaultText, Step: DefaultStep, ...defaultQuestionComponents };
