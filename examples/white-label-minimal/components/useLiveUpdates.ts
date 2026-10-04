"use client";
import { useCallback, useEffect, useState } from "react";
import * as actions from "../app/actions";
import { unwrap } from "../lib/chat/unwrap";
import { watchLiveUpdates } from "../lib/chat/live-updates";
import type { App, Message } from "../lib/types";

// The app and its chat, kept current by Base44's live updates.
export function useLiveUpdates(appId: string | null) {
  const [app, setApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Each app and reconnect is a new session. It is loading until it delivers
  // its first snapshot or fails.
  const session = `${appId}:${attempt}`;
  const [readySession, setReadySession] = useState("");
  const loading = !!appId && readySession !== session;

  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let close: (() => void) | undefined;
    const readApp = () => unwrap(actions.getApp(appId)).then((next) => { if (!stopped) setApp(next); });
    const fail = () => {
      if (stopped) return;
      stopped = true;
      close?.();
      setError("Live updates paused. Reconnect to continue.");
      setReadySession(session);
    };

    readApp().catch(fail);
    watchLiveUpdates(appId, (id) => unwrap(actions.openLiveUpdates(id)), {
      onMessages(update) {
        if (stopped) return;
        setMessages(update);
        setError("");
        setReadySession(session);
      },
      onStatus(status) {
        if (stopped) return;
        setApp((current) => current && { ...current, status: status ?? undefined });
        // A finished build can rename the app, so read it again.
        if (status?.state === "ready") readApp().catch(() => {});
      },
      onError: fail,
    }).then((stop) => (stopped ? stop() : (close = stop)), fail);

    return () => {
      stopped = true;
      close?.();
    };
  }, [appId, session]);

  // After a prompt or an answer, read the app's status right away.
  const refresh = useCallback(async () => {
    if (appId) setApp(await unwrap(actions.getApp(appId)));
  }, [appId]);

  return {
    app: app?.id === appId ? app : null,
    messages: loading ? [] : messages,
    error,
    loading,
    refresh,
    reconnect: () => setAttempt((n) => n + 1),
  };
}
