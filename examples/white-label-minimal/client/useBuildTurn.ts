"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Base44PlatformClient } from "@base44/platform";
import * as actions from "../server/actions";
import type { App, Message, ToolInput } from "../types";
import { getChatState } from "./chat-state";
import { mergeOptimisticMessages, toMessage, upsertMessage, type OptimisticMessage } from "./messages";
import { unwrap } from "./unwrap";

type Busy = "create" | "send" | "answer" | null;

// The browser side of "The build turn": watch the app build over live updates,
// send the builder's prompts, and answer the agent's questions. Every Base44
// call goes through Tiny's server actions. The browser holds only a
// live-updates session token.
export function useBuildTurn(initialAppId: string | null, onCreated?: (app: App) => void) {
  const [appId, setAppId] = useState(initialAppId);
  const [app, setApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const lock = useRef(false);
  const turnStarted = useRef<(() => void) | null>(null);

  // Each app and each reconnect is a new live-updates session. It is loading
  // until its first snapshot arrives or it fails.
  const [attempt, setAttempt] = useState(0);
  const session = `${appId}:${attempt}`;
  const [readySession, setReadySession] = useState("");
  const loading = !!appId && readySession !== session;

  // 2. Watch it build.
  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let builder: { close(): void } | undefined;

    async function readApp() {
      const next = await unwrap(actions.getApp(appId!));
      if (!stopped) setApp(next);
    }

    function fail() {
      if (stopped) return;
      stopped = true;
      builder?.close();
      setLiveError("Live updates paused. Reconnect to continue.");
      setReadySession(session);
    }

    async function connect() {
      // Tiny's server opens the session with the workspace key.
      const first = await unwrap(actions.openLiveUpdates(appId!));
      if (stopped) return;
      let firstToken: string | undefined = first.sessionToken;
      const client = new Base44PlatformClient({
        serverUrl: first.serverUrl,
        // The SDK asks again only when the session has ended; then open a new one.
        async getSessionToken() {
          const token = firstToken ?? (await unwrap(actions.openLiveUpdates(appId!))).sessionToken;
          firstToken = undefined;
          return token;
        },
      });

      const live = client.builder.init({ onError: fail });
      builder = live;
      live.subscribe(appId!, {
        // On every connect and reconnect: the app's status and its last 50 messages.
        onSnapshot(snapshot) {
          if (stopped) return;
          setMessages(snapshot.messages.map(toMessage));
          setApp((current) => current && { ...current, status: snapshot.status ?? undefined });
          setLiveError("");
          setReadySession(session);
        },
        onEvent(event) {
          if (stopped) return;
          if (event.type === "message.updated") {
            const message = toMessage(event.data.message);
            setMessages((current) => upsertMessage(current, message));
          }
          if (event.type === "message.removed") {
            setMessages((current) => current.filter((m) => m.id !== event.data.message_id));
          }
          if (event.type === "app.status_changed") {
            setApp((current) => current && { ...current, status: event.data.status ?? undefined });
            // A finished build can rename the app, so read it again.
            if (event.data.status?.state === "ready") readApp().catch(() => {});
          }
        },
        onError: fail,
      });
      await live.connect();
    }

    readApp().catch(fail);
    connect().catch(fail);
    return () => {
      stopped = true;
      builder?.close();
    };
  }, [appId, session]);

  const currentApp = app?.id === appId ? app : null;
  const currentMessages = loading ? [] : messages;
  const state = getChatState(currentApp, currentMessages, loading, liveError);
  const displayedMessages = useMemo(
    () => mergeOptimisticMessages(currentMessages, optimistic),
    [currentMessages, optimistic],
  );
  // Send chat message stays open until the whole turn ends; see send().
  useEffect(() => {
    if (state === "building") turnStarted.current?.();
  }, [state]);

  // Base44 ignores new prompts while a question is open or a build runs.
  const canSend = !busy && (state === "idle" || state === "ready" || state === "failed");

  async function refreshApp() {
    if (appId) setApp(await unwrap(actions.getApp(appId)));
  }

  // 1. Create the app from the first prompt; send every later prompt as a chat message.
  async function send(prompt: string) {
    if (lock.current || !canSend || !prompt.trim()) return false;
    lock.current = true;
    const optimisticId = `local:${crypto.randomUUID()}`;
    setOptimistic((current) => [...current, {
      message: { id: optimisticId, role: "user", content: prompt },
      knownIds: currentMessages.map((message) => message.id),
    }]);
    setBusy(appId ? "send" : "create");
    setError("");
    try {
      if (appId) {
        // Base44 holds this request open until the whole turn ends, which can take
        // minutes. Stop waiting once live updates show the build running; the
        // app status reports how it ends.
        const sent = unwrap(actions.sendMessage(appId, prompt));
        sent.catch(() => {});
        await Promise.race([sent, new Promise<void>((resolve) => { turnStarted.current = resolve; })]);
        await refreshApp();
      } else {
        const created = await unwrap(actions.createApp(prompt));
        setAppId(created.id);
        onCreated?.(created);
      }
      return true;
    } catch (err) {
      setOptimistic((current) => current.filter(({ message }) => message.id !== optimisticId));
      setError(err instanceof Error ? err.message : "Request failed.");
      if (appId) await refreshApp().catch(() => {});
      return false;
    } finally {
      turnStarted.current = null;
      lock.current = false;
      setBusy(null);
    }
  }

  // 4. Send the answer back.
  async function answer(input: ToolInput) {
    if (lock.current) throw new Error("Another action is still running.");
    lock.current = true;
    setBusy("answer");
    try {
      await unwrap(actions.submitToolCallInput(input));
    } finally {
      await refreshApp().catch(() => {});
      lock.current = false;
      setBusy(null);
    }
  }

  function reconnect() {
    setError("");
    setAttempt((n) => n + 1);
  }

  return {
    appId,
    app: currentApp,
    messages: displayedMessages,
    state,
    busy,
    canSend,
    error: error || liveError,
    send,
    answer,
    reconnect,
  };
}
