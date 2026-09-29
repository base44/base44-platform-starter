import type { BuilderSession, PlatformSocketError } from "@base44/sdk/platform/client";
import type { App, Message } from "../types";
import { getApp, getConversation } from "./builder-api";
import { createBuilderConnection } from "./builder-connection";
import { refreshConversation } from "./conversation";
import { mergeMessages, removeMessage, resolveImage } from "./socket-messages";

export interface BuildState { app: App | null; messages: Message[] }
export interface BuildStreamDependencies {
  connect: (appId: string, onError: (error: PlatformSocketError) => void, signal: AbortSignal) => Promise<BuilderSession>;
  readApp: typeof getApp;
  readConversation: typeof getConversation;
}

export function watchBuild(
  appId: string,
  onState: (state: BuildState) => void,
  onError: (message: string) => void,
  dependencies: BuildStreamDependencies = {
    connect: createBuilderConnection, readApp: getApp, readConversation: getConversation,
  },
) {
  const controller = new AbortController();
  let state: BuildState = { app: null, messages: [] };
  let builder: BuilderSession | undefined;
  let stopped = false;
  let loaded = false;
  let flight: Promise<void> | undefined;

  function publish() { if (!stopped) onState(state); }
  function fail(error: unknown) {
    if (stopped) return;
    stopped = true;
    controller.abort();
    const code = (error as { code?: string })?.code;
    onError(code === "session_replaced"
      ? "Live updates moved to another tab. Reconnect to continue here."
      : code === "access_denied" || code === "access_revoked"
        ? "Live updates for this app are no longer available."
        : "Live updates paused. Reconnect to continue.");
    builder?.close();
  }
  function reload(): Promise<void> {
    if (flight) return flight;
    flight = (async () => {
      const [app, messages] = await Promise.all([
        dependencies.readApp(appId, controller.signal),
        refreshConversation([], skip => dependencies.readConversation(appId, skip, controller.signal)),
      ]);
      if (stopped) return;
      state = { app, messages };
      loaded = true;
      publish();
    })().finally(() => { flight = undefined; });
    return flight;
  }

  async function start() {
    builder = await dependencies.connect(appId, fail, controller.signal);
    if (stopped) { builder.close(); return; }
    builder.subscribe(appId, {
      onError(error) {
        // The join held and live events still flow; only the socket snapshot is missing.
        if (error.code === "snapshot_unavailable") { if (!loaded) void reload().catch(fail); }
        else fail(error);
      },
      async onSnapshot(snapshot) {
        // The first load reads full history over HTTP; later snapshots (reconnect, rewrite)
        // cover what the socket missed while it was away.
        if (flight) await flight;
        if (!loaded) return reload();
        if (stopped) return;
        state = {
          app: state.app && { ...state.app, status: snapshot.status ?? undefined },
          messages: mergeMessages(state.messages, snapshot.messages),
        };
        publish();
      },
      async onEvent(event) {
        if (flight) await flight;
        if (stopped) return;
        switch (event.type) {
          case "message.updated":
            state = { ...state, messages: mergeMessages(state.messages, [event.data.message]) };
            return publish();
          case "message.removed":
            state = { ...state, messages: removeMessage(state.messages, event.data.message_id) };
            return publish();
          case "app.status_changed": {
            const { status } = event.data;
            if (state.app) state = { ...state, app: { ...state.app, status: status ?? undefined } };
            publish();
            if (status?.state === "ready") {
              const app = await dependencies.readApp(appId, controller.signal);
              state = { ...state, app };
              publish();
            }
            return;
          }
          case "image.resolved":
            state = { ...state, messages: resolveImage(state.messages, event.data) };
            return publish();
          case "conversation.changed": case "files.changed": case "branch.deleted":
          case "repository.changed": case "pull_request.changed":
            return reload();
        }
        // Queue, task and preview events have no UI here; progress renders from messages.
      },
    });
    await builder.connect();
  }
  void start().catch(fail);

  return {
    async refresh() {
      // Mutation-triggered reads must start after any earlier read has settled.
      try {
        if (flight) await flight;
        if (!stopped) await reload();
      } catch (error) { fail(error); }
    },
    close() {
      stopped = true;
      controller.abort();
      builder?.close();
    },
  };
}
