export type App = {
  id: string;
  name?: string;
  preview_screenshot_url?: string;
  status?: { state?: string; error_source?: string };
};

export type ToolCall = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  waiting_on?: { kind?: string } | null;
  arguments_string?: string | null;
  results?: string | null;
};

export type Message = {
  id: string;
  role?: string | null;
  content?: string | null;
  hidden?: boolean | null;
  tool_calls?: ToolCall[] | null;
};

export type ToolInput = {
  appId: string;
  toolCallId: string;
  messageId: string;
  approve: boolean;
  extraUserInput: Record<string, unknown>;
};

// What a server action returns. Next.js hides thrown errors from the browser in
// production, so an error is a value.
export type ActionResult<T> = { data: T } | { error: string; status: number };
