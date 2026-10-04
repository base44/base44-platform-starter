import type { App, Message } from "../types";

// Where the build turn stands, from the builder's point of view.
export type ChatState =
  | "loading"   // the chat has not arrived yet
  | "paused"    // live updates stopped
  | "question"  // the agent waits for the builder's answer
  | "building"  // the agent is working
  | "failed"    // the last build failed
  | "ready"     // the app is built and can be published
  | "idle";     // waiting for a prompt

export function getChatState(app: App | null, messages: Message[], loading: boolean, liveError: string): ChatState {
  if (loading) return "loading";
  if (liveError) return "paused";
  if (hasOpenQuestion(messages)) return "question";
  if (app?.status?.state === "processing") return "building";
  if (app?.status?.state === "error") return "failed";
  if (app?.status?.state === "ready" && hasBuiltCode(messages)) return "ready";
  return "idle";
}

function hasOpenQuestion(messages: Message[]) {
  return messages.some((message) =>
    message.tool_calls?.some((tool) => tool.status === "waiting_for_user_input"));
}

// "ready" alone also follows a greeting-only reply or an answer, so the app
// counts as built only once the latest turn has written code and finished.
function hasBuiltCode(messages: Message[]) {
  if (messages.at(-1)?.role !== "assistant") return false;

  const lastPrompt = messages.findLastIndex((message) => message.role === "user");
  const latestTurn = messages.slice(lastPrompt + 1);
  const stillWorking = latestTurn.some((message) =>
    message.tool_calls?.some((tool) => tool.status === "pending" || tool.status === "running"));
  if (stillWorking) return false;

  return latestTurn.some((message) =>
    message.tool_calls?.some((tool) =>
      (tool.name === "write_file" || tool.name === "find_replace") && tool.status === "success"));
}
