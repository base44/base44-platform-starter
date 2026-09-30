import type { ToolCall as PublicToolCall } from "@base44/sdk/platform/client";

export type App = {
  id: string;
  name?: string;
  slug?: string | null;
  static_preview_url?: string;
  preview_screenshot_url?: string;
  logo_url?: string;
  user_description?: string;
  status?: { state?: string; error_source?: string };
};
// The socket's public tool shape; the server maps HTTP reads into it too.
export type ToolCall = Omit<PublicToolCall, "status" | "waiting_on"> & {
  status?: string | null;
  waiting_on?: { kind?: string | null } | null;
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

export type AppPage = { apps: App[]; hasMore: boolean; nextSkip: number };

export interface AppClient {
  openBuilderSession(appId: string): Promise<{ serverUrl: string; sessionToken: string; sessionHandle: string }>;
  closeBuilderSession(appId: string, sessionHandle: string): Promise<object>;
  createApp(prompt: string): Promise<App>;
  getApp(appId: string): Promise<App>;
  getConversation(appId: string, skip: number): Promise<{ messages: Message[] }>;
  sendMessage(appId: string, content: string): Promise<object>;
  submitToolCallInput(input: ToolInput): Promise<object>;
  getPreviewUrl(appId: string): Promise<{ url: string }>;
  deployApp(appId: string): Promise<object>;
  getPublishedUrl(appId: string): Promise<{ url: string | null }>;
  removeApp(appId: string): Promise<object>;
  authorize(appId: string): Promise<void>;
  listApps(skip: number): Promise<AppPage>;
}
