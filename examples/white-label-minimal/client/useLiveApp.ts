"use client";
import { useEffect, useState } from "react";
import { Base44PlatformClient } from "@base44/platform";
import * as actions from "../server/actions";
import type { App, Message } from "../types";
import { toMessage, upsertMessage } from "./messages";
import { unwrap } from "./unwrap";

// 2. Watch it build: the app and its conversation, kept current by Base44's live
// updates. messages is null until the first snapshot arrives.
export function useLiveApp(appId: string | null) {
  const [app, setApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(appId ? null : []);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let live: { close(): void } | undefined;

    function pause() {
      live?.close();
      setPaused(true);
    }

    async function readApp() {
      setApp(await unwrap(actions.getApp(appId!)));
    }

    async function connect() {
      // Tiny's server opens each session with the workspace key.
      const { serverUrl } = await unwrap(actions.openLiveUpdates(appId!));
      if (stopped) return;
      const client = new Base44PlatformClient({
        serverUrl,
        getSessionToken: async () => (await unwrap(actions.openLiveUpdates(appId!))).sessionToken,
      });
      const builder = client.builder.init({ onError: pause });
      live = builder;
      builder.subscribe(appId!, {
        // On every connect and reconnect: the app's status and its last 50 messages.
        onSnapshot(snapshot) {
          setMessages(snapshot.messages.map(toMessage));
          setApp((app) => app && { ...app, status: snapshot.status ?? undefined });
        },
        onEvent(event) {
          if (event.type === "message.updated") {
            setMessages((all) => upsertMessage(all ?? [], toMessage(event.data.message)));
          }
          if (event.type === "message.removed") {
            setMessages((all) => all && all.filter((m) => m.id !== event.data.message_id));
          }
          if (event.type === "app.status_changed") {
            setApp((app) => app && { ...app, status: event.data.status ?? undefined });
            // A finished build can rename the app, so read it again.
            if (event.data.status?.state === "ready") readApp().catch(() => {});
          }
        },
        onError: pause,
      });
      await builder.connect();
    }

    readApp().catch(pause);
    connect().catch(pause);
    return () => {
      stopped = true;
      live?.close();
    };
  }, [appId, attempt]);

  function reconnect() {
    setPaused(false);
    setMessages(null);
    setAttempt((n) => n + 1);
  }

  return { app, messages, paused, reconnect };
}
