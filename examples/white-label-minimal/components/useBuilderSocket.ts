"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getApp } from "../lib/chat/builder-api";
import { watchApp } from "../lib/chat/live-updates";
import type { App, Message } from "../lib/types";

// The app, its chat and the connection state, kept live over the Base44 socket.
export function useBuilderSocket(appId: string | null) {
  const [app, setApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState("");
  const key = `${appId}:${attempt}`;

  const refresh = useCallback(async () => {
    if (appId) setApp(await getApp(appId));
  }, [appId]);

  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let stop: (() => void) | undefined;
    const readApp = () => getApp(appId).then((next) => { if (!stopped) setApp(next); });
    const fail = (error?: unknown) => {
      if (stopped) return;
      stopped = true;
      stop?.();
      // Our server explains configuration problems; socket errors get the generic message.
      setError(error instanceof ApiError ? error.message : "Live updates paused. Reconnect to continue.");
      setLoaded(key);
    };

    readApp().catch(fail);
    watchApp(appId, {
      onMessages(update) {
        if (stopped) return;
        setMessages(update);
        setError("");
        setLoaded(key);
      },
      onStatus(status) {
        if (stopped) return;
        setApp((current) => current && { ...current, status: status ?? undefined });
        // A finished build can rename the app, so read it again.
        if (status?.state === "ready") readApp().catch(() => {});
      },
      onError: fail,
    }).then((close) => (stopped ? close() : (stop = close)), fail);

    return () => {
      stopped = true;
      stop?.();
    };
  }, [appId, key]);

  const loading = !!appId && loaded !== key;
  return {
    app: app?.id === appId ? app : null,
    messages: loading ? [] : messages,
    error,
    loading,
    refresh,
    resume: () => setAttempt((n) => n + 1),
  };
}
