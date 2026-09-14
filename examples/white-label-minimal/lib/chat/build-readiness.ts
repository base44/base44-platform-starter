import type { Message } from "../types";

const CODE_TOOLS = new Set(["write_file", "find_replace"]);
const ACTIVE_STATUSES = new Set(["pending", "running", "waiting_for_user_input"]);

export function hasCompletedBuild(messages: Message[]): boolean {
  const visible = messages.filter(message => !message.hidden);
  if (visible.at(-1)?.role !== "assistant") return false;
  const lastUser = messages.findLastIndex(message => message.role === "user");
  const activeTurn = messages.slice(lastUser + 1);
  if (activeTurn.some(message => message.tool_calls?.some(tool =>
    ACTIVE_STATUSES.has(tool.status || "")))) return false;
  return messages.some(message => message.tool_calls?.some(tool =>
    CODE_TOOLS.has(tool.name || "") && tool.status === "success"));
}
