"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import * as actions from "../../server/actions";
import type { App, ToolCall, ToolInput } from "../../types";
import { getChatState } from "../chat-state";
import { toAssistantMessage } from "../messages";
import { ActionError, unwrap } from "../unwrap";
import { useLiveApp } from "../useLiveApp";
import Question from "./Question";
import ReadyCard from "./ReadyCard";
import ToolActivity from "./ToolActivity";
import { Thread } from "./assistant-ui/thread";

// What ToolPart, which assistant-ui renders itself, needs to answer a question.
const AnswerContext = createContext<{ appId: string | null; disabled: boolean; answer: (input: ToolInput) => Promise<void> } | null>(null);

// The builder's chat for one app: steps 1, 3 and 4 of the build turn are the
// functions below, step 2 is useLiveApp, and assistant-ui's Thread renders it.
export default function Builder({ initialAppId, autoFocus, onCreated, onUpdated, onGoHome }: {
  initialAppId?: string;
  autoFocus?: boolean;
  onCreated?: (app: App) => void;
  onUpdated?: (app: App) => void;
  onGoHome?: () => void;
}) {
  const [appId, setAppId] = useState(initialAppId ?? null);
  const { app, messages, paused, reconnect } = useLiveApp(appId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const state = getChatState(app, messages, paused);
  // Base44 ignores new prompts while a question is open or a build runs.
  const canSend = !sending && (state === "idle" || state === "ready" || state === "failed");

  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);

  // 1. Create the app from the first prompt; send every later prompt as a chat message.
  async function send(prompt: string) {
    setSending(true);
    setError("");
    try {
      if (appId) {
        await unwrap(actions.sendMessage(appId, prompt));
      } else {
        const created = await unwrap(actions.createApp(prompt));
        setAppId(created.id);
        onCreated?.(created);
      }
      return true;
    } catch (err) {
      // Base44 holds Send message open until the whole turn ends, so a timeout
      // means the turn is still running. Live updates show how it ends.
      if (appId && err instanceof ActionError && err.status === 504) return true;
      setError(err instanceof Error ? err.message : "Request failed.");
      return false;
    } finally {
      setSending(false);
    }
  }

  // 4. Send the answer back.
  async function answer(input: ToolInput) {
    await unwrap(actions.submitToolCallInput(input));
  }

  // assistant-ui shows the messages from live updates and hands new prompts to send().
  const runtime = useExternalStoreRuntime({
    messages: messages ?? [],
    convertMessage: toAssistantMessage,
    isRunning: sending || state === "building",
    isDisabled: !canSend,
    onNew: async (message) => {
      const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      // assistant-ui clears the draft on send; put it back if sending failed.
      if (!(await send(text))) runtime.thread.composer.setText(text);
    },
  });

  return (
    <div className="builder">
      {(error || paused) && (
        <p role="alert">
          {error || "Live updates paused. Reconnect to continue."}{" "}
          {paused && <button className="secondary" onClick={reconnect}>Reconnect live updates</button>}
        </p>
      )}

      <AnswerContext.Provider value={{ appId, disabled: paused, answer }}>
        <AssistantRuntimeProvider runtime={runtime}>
          <Thread
            inputLabel={appId ? "What should change?" : "What would you like to build?"}
            placeholder={appId ? "Describe a change…" : "Describe the app you want…"}
            sendLabel={appId ? "Send prompt" : "Create app"}
            autoFocus={autoFocus}
            ToolFallback={ToolPart}
            footer={
              <>
                {state === "ready" && !sending && appId && <ReadyCard appId={appId} name={app?.name} onGoHome={onGoHome} />}
                <Status state={state} sending={sending} creating={!appId} />
              </>
            }
          />
        </AssistantRuntimeProvider>
      </AnswerContext.Provider>
    </div>
  );
}

// 3. Answer the agent's questions. assistant-ui renders each tool call with this
// component: a question while Base44 waits for the builder, activity otherwise.
const ToolPart: ToolCallMessagePartComponent = ({ toolCallId, artifact }) => {
  const { appId, disabled, answer } = useContext(AnswerContext)!;
  const { tool, messageId } = artifact as { tool: ToolCall; messageId: string };
  const asking = tool.status === "waiting_for_user_input" || tool.waiting_on?.kind;
  if (!asking || !appId) return <ToolActivity tool={tool} />;
  return (
    <Question
      key={`${toolCallId}:${tool.status}`}
      tool={tool}
      messageId={messageId}
      appId={appId}
      disabled={disabled}
      onSubmit={answer}
    />
  );
};

// The line under the chat that says where the build turn stands.
function Status({ state, sending, creating }: { state: string; sending: boolean; creating: boolean }) {
  let text = "";
  if (state === "loading") text = "Loading conversation…";
  else if (state === "paused") text = "Connection paused";
  else if (state === "question") text = "Waiting for your answer";
  else if (state === "building") text = "Building…";
  else if (sending) text = creating ? "Creating app…" : "Sending prompt…";
  else if (state === "failed") text = "The build failed. Send a follow-up prompt to try again.";
  if (!text) return null;
  return (
    <div className="build-progress" role="status">
      {(sending || state === "loading" || state === "building") && <Loader2 size={12} className="spin" />}
      {text}
    </div>
  );
}
