"use client";
import { useEffect, useState } from "react";
import { Base44PlatformClient, type ChatMessage } from "@base44/platform";
import type { Base44App } from "../../../sdk";
import { createApp, openLiveSession, sendMessage } from "../../../server/base44";

// Without the headless library, every chat UI needs this: the live connection to
// Base44, message ordering, create-or-send, and the status line. Written by hand,
// straight against @base44/platform and Tiny's server.
export function useLiveChat({ app, onAppCreated }: {
  app: Base44App | null;
  onAppCreated: (app: Base44App) => void;
}) {
  const appId = app?.id ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(!!appId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Live updates: a snapshot on every connect, then events.
  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let socket: { close(): void } | undefined;
    const fail = (e: { code?: string; message?: string }) => setError(e.code || e.message || "Live updates failed");

    openLiveSession(appId)
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
  }, [appId]);

  // Events can arrive out of order, so order messages by when they were created.
  const sorted = [...messages].sort((a, b) => (a.metadata?.created_date ?? "").localeCompare(b.metadata?.created_date ?? ""));
  // The docs: lock the message box while a question is open.
  const waiting = sorted.some((m) => m.tool_calls?.some((tool) => tool.status === "waiting_for_user_input"));

  let status = error;
  if (!status && creating) status = "Creating app…";
  else if (!status && loading) status = "Loading the conversation…";
  else if (!status && waiting) status = "Waiting for your answer";
  else if (!status && building) status = "Building…";

  // The first prompt creates the app; every later one goes to it.
  async function send(prompt: string) {
    if (appId) return void sendMessage(appId, prompt).catch((e) => setError(e.message));
    setCreating(true);
    try {
      onAppCreated(await createApp(prompt));
    } catch (e) {
      setError((e as Error).message);
    }
    setCreating(false);
  }

  return { messages: sorted, status, canSend: !creating && !waiting, send };
}
