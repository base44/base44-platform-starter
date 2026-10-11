export type App = { id: string; name: string };

// An answer to a question the builder waits on. Declining is approve: false.
export type ToolCallAnswer = { toolCallId: string; messageId: string; approve: boolean; extraUserInput?: object };
