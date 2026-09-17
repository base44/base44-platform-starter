import type { BuilderSession, PlatformSocketError } from "@base44/sdk/platform/client";
import type { App, Message } from "../types";
import { getApp, getConversation } from "./builder-api";
import { createBuilderConnection } from "./builder-connection";
import { refreshConversation } from "./conversation";
import { applyMessageUpdate, resolveImage } from "./socket-messages";

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
    onError(code === "resync_required"
      ? "Live history expired. Reconnect to load the conversation again."
      : "Live updates paused. Reconnect to continue.");
    builder?.close();
  }
  function snapshot(): Promise<void> {
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
      onError: fail,
      async onJoined() {
        // Subscribe first: the SDK buffers live events while the initial snapshot loads.
        if (!loaded) await snapshot();
      },
      async onEvent(event) {
        if (flight) await flight;
        if (stopped) return;
        if (event.type === "update_model") {
          const update = event.data;
          if (state.app && "status" in update) state = {
            ...state, app: { ...state.app, status: update.status ?? undefined },
          };
          state = { ...state, messages: applyMessageUpdate(state.messages, update) };
          publish();
          if (update.status?.state === "ready") {
            const app = await dependencies.readApp(appId, controller.signal);
            state = { ...state, app };
            publish();
          }
        } else if (event.type === "directive") {
          await snapshot();
        } else if (event.type === "image_ready") {
          state = { ...state, messages: resolveImage(state.messages, event.data) };
          publish();
        }
        // Queue/task events advance the SDK cursor; this minimal UI renders progress from messages.
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
        if (!stopped) await snapshot();
      } catch (error) { fail(error); }
    },
    close() {
      stopped = true;
      controller.abort();
      builder?.close();
    },
  };
}
