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
    let sessionId: string | undefined;

    // Ends the session on Base44 too, so it does not count toward the key's
    // open-session limit until it expires.
    function endSession() {
      if (sessionId) actions.closeLiveUpdates(appId!, sessionId).catch(() => {});
      sessionId = undefined;
    }

    function pause() {
      live?.close();
      endSession();
      setPaused(true);
    }

    async function readApp() {
      setApp(await unwrap(actions.getApp(appId!)));
    }

    // Tiny's server opens each session with the workspace key. A new session
    // replaces the previous one.
    async function openSession() {
      const session = await unwrap(actions.openLiveUpdates(appId!));
      endSession();
      sessionId = session.sessionId;
      if (stopped) endSession();
      return session;
    }

    async function connect() {
      const first = await openSession();
      if (stopped) return;
      let firstToken: string | undefined = first.sessionToken;
      const client = new Base44PlatformClient({
        serverUrl: first.serverUrl,
        // The SDK asks again only when the session has ended; then open a new one.
        async getSessionToken() {
          if (firstToken) {
            const token = firstToken;
            firstToken = undefined;
            return token;
          }
          return (await openSession()).sessionToken;
        },
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
      endSession();
    };
  }, [appId, attempt]);

  function reconnect() {
    setPaused(false);
    setMessages(null);
    setAttempt((n) => n + 1);
  }

  return { app, messages, paused, reconnect };
}
