"use client";
import { useEffect, useState } from "react";
import { Base44PlatformClient, type ChatMessage, type ToolCall, type ToolQuestionArguments, type ToolSecretArguments } from "@base44/platform";

// The client half of the library: one app's chat, headless. It keeps the live
// connection, turns Base44's messages into items, and gives you the actions.
// You render the items.

export type Base44App = { id: string; name: string };

// An answer to a question the builder waits on. Declining is approve: false.
export type ToolCallAnswer = { toolCallId: string; messageId: string; approve: boolean; extraUserInput?: object };

// The four calls your server provides. Each wraps one Base44 REST call with your
// credentials, in any backend language:
//   createApp           POST /api/apps
//   openLiveSession     POST /api/service/socket-sessions   (returns the socket URL and session token)
//   sendMessage         POST /api/apps/{id}/chat/message
//   submitToolCallInput POST /api/apps/{id}/chat/submit-tool-call-input
export type Base44ChatServer = {
  createApp(prompt: string): Promise<Base44App>;
  openLiveSession(appId: string): Promise<{ serverUrl: string; sessionToken: string }>;
  sendMessage(appId: string, content: string): Promise<void>;
  submitToolCallInput(appId: string, answer: ToolCallAnswer): Promise<void>;
};

export type ChatItem = {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: ChatStep[];
  question?: Question; // set while the builder waits on you
};

export type ChatStep = { id: string; label: string; status: "running" | "waiting" | "done" | "error" };

export type Question =
  | { kind: "choice"; questions: { text: string; options: string[]; multi: boolean }[] }
  | { kind: "input"; fields: string[] }
  | { kind: "approval"; action: string; reason: string }
  | { kind: "unknown"; action: string };

export function useBase44Chat({ appId, server }: {
  appId: string | null; // null: no app yet, so the first send creates one
  server: Base44ChatServer;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [answered, setAnswered] = useState<string[]>([]);

  // Live updates: a snapshot on every connect, then events.
  useEffect(() => {
    setMessages([]);
    setBuilding(false);
    setError("");
    setAnswered([]);
    setLoading(!!appId);
    if (!appId) return;
    let stopped = false;
    let socket: { close(): void } | undefined;
    const fail = (e: { code?: string; message?: string }) => setError(e.code || e.message || "Live updates failed");

    server
      .openLiveSession(appId)
      .then(({ serverUrl, sessionToken }) => {
        if (stopped) return;
        const builder = new Base44PlatformClient({ serverUrl, getSessionToken: () => sessionToken }).builder.init({ onError: fail });
        socket = builder;
        builder.subscribe(appId, {
          onSnapshot: (snapshot) => {
            setMessages(snapshot.messages);
            setLoading(false);
            setBuilding(snapshot.status?.state === "processing");
          },
          onEvent: (event) => {
            if (event.type === "message.updated") {
              const message = event.data.message;
              // Replace the message with the same id in place, or add it at the end.
              setMessages((all) => (all.some((m) => m.id === message.id) ? all.map((m) => (m.id === message.id ? message : m)) : [...all, message]));
            }
            if (event.type === "app.status_changed") setBuilding(event.data.status?.state === "processing");
          },
          onError: fail,
        });
        return builder.connect();
      })
      .catch(fail);

    return () => {
      stopped = true;
      socket?.close();
    };
  }, [appId, server]);

  // Events can arrive out of order, so order messages by when they were created.
  const sorted = [...messages].sort((a, b) => (a.metadata?.created_date ?? "").localeCompare(b.metadata?.created_date ?? ""));
  const isOpen = (tool: ToolCall) => tool.status === "waiting_for_user_input" && !answered.includes(tool.id!);

  const items: ChatItem[] = sorted.map((m) => {
    const waiting = m.tool_calls?.find(isOpen);
    return {
      id: m.id!,
      role: m.role ?? "assistant",
      text: m.content ?? "",
      steps: (m.tool_calls ?? []).map((tool) => ({
        id: tool.id!,
        label: [tool.name, ...(tool.display?.file_paths ?? [])].join(" "),
        status: stepStatus(tool),
      })),
      question: waiting && toQuestion(waiting),
    };
  });
  const pending = sorted.flatMap((m) => (m.tool_calls ?? []).filter(isOpen).map((tool) => ({ tool, messageId: m.id! })))[0];

  let status = error;
  if (!status && creating) status = "Creating app…";
  else if (!status && loading) status = "Loading the conversation…";
  else if (!status && pending) status = "Waiting for your answer";
  else if (!status && building) status = "Building…";

  // The first prompt creates the app and returns it; every later one goes to it.
  async function send(prompt: string): Promise<Base44App | undefined> {
    if (appId) {
      server.sendMessage(appId, prompt).catch(fail);
      return;
    }
    setCreating(true);
    try {
      return await server.createApp(prompt);
    } catch (e) {
      fail(e as Error);
    } finally {
      setCreating(false);
    }
  }

  // Answers the open question. Declining is always an answer.
  function reply(approve: boolean, extraUserInput?: object) {
    if (!appId || !pending) return;
    setAnswered((ids) => [...ids, pending.tool.id!]);
    server.submitToolCallInput(appId, { toolCallId: pending.tool.id!, messageId: pending.messageId, approve, extraUserInput }).catch(fail);
  }

  function fail(e: { message?: string }) {
    setError(e.message || "Something went wrong");
  }

  return {
    items,
    status,
    building,
    canSend: !creating && !pending,
    send,
    answerChoices: (picked: string[][]) =>
      reply(true, { answers: picked.map((labels, i) => ({ question_index: i, selected_labels: labels })).filter((a) => a.selected_labels.length) }),
    submitInputs: (values: Record<string, string>) => reply(true, { secrets: values }),
    approve: () => reply(true),
    decline: () => reply(false),
    messages: sorted, // Base44's raw messages, for UIs that map them themselves
  };
}

export type Base44Chat = ReturnType<typeof useBase44Chat>;

function stepStatus(tool: ToolCall): ChatStep["status"] {
  if (tool.status === "running") return "running";
  if (tool.status === "waiting_for_user_input") return "waiting";
  if (tool.status === "error") return "error";
  return "done";
}

// Base44's question formats, as one simple shape per kind.
function toQuestion(tool: ToolCall): Question {
  const kind = tool.waiting_on?.kind;
  if (kind === "choice") {
    const questions = (tool.arguments as ToolQuestionArguments)?.questions ?? [];
    return {
      kind,
      questions: questions.map((q) => ({
        text: q.question ?? "",
        options: (q.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")),
        multi: !!q.multi_select,
      })),
    };
  }
  if (kind === "input") return { kind, fields: ((tool.arguments as ToolSecretArguments)?.secrets_schema ?? []).map((f) => f.secretName ?? "") };
  if (kind === "approval") return { kind, action: tool.name ?? "", reason: tool.approval?.reason ?? tool.approval?.details?.summary ?? "" };
  return { kind: "unknown", action: tool.name ?? "" };
}
