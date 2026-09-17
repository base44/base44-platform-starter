export type App = {
  id: string;
  name?: string;
  slug?: string | null;
  static_preview_url?: string;
  preview_screenshot_url?: string;
  logo_url?: string;
  user_description?: string;
  status?: { state?: string; error_source?: string };
  /* true once the app has a published URL; undefined when the lookup failed */
  published?: boolean;
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

export type AppPage = { apps: App[]; hasMore: boolean; nextSkip: number };

export interface AppClient {
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
