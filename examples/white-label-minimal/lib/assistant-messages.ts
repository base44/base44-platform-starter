import type { ThreadMessageLike } from '@assistant-ui/react';
import type { Message } from './types';

// Base44 remains the source of truth. Tool payloads stay intact for its question
// and activity renderers, including incomplete arguments and missing tool IDs.
export function toAssistantMessage(message: Message): ThreadMessageLike {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const tools = role === 'assistant' ? message.tool_calls ?? [] : [];
  return {
    id: message.id,
    role,
    content: [
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...tools.map((tool, index) => ({
        type: 'tool-call' as const,
        toolCallId: tool.id || `${message.id}:tool:${index}`,
        toolName: tool.name || 'Agent action',
        argsText: tool.arguments_string || '',
        artifact: { tool, messageId: message.id },
        ...(tool.results != null ? { result: tool.results } : {}),
        isError: tool.status === 'error' || tool.status === 'stopped',
        ...(tool.status === 'waiting_for_user_input'
          ? { interrupt: { type: 'human' as const, payload: tool.waiting_on } }
          : {}),
      })),
    ],
  };
}
