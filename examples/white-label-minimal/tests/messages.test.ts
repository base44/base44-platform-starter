import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getChatState } from '../client/chat-state';
import { toMessage, upsertMessage } from '../client/messages';
import type { Message } from '../types';

test('socket messages convert to the shape the chat renders', () => {
  const message = toMessage({ id: 'm1', role: 'assistant', content: 'Hi', tool_calls: [
    { id: 't1', name: 'ask', status: 'waiting_for_user_input', waiting_on: { kind: 'choice' }, arguments: { questions: [] } },
    { id: 't2', name: 'generate_video', status: 'success', results: 'https://media.example/v.mp4' },
  ] });
  assert.deepEqual(message.tool_calls, [
    { id: 't1', name: 'ask', status: 'waiting_for_user_input', waiting_on: { kind: 'choice' }, arguments_string: '{\n  "questions": []\n}', results: undefined },
    { id: 't2', name: 'generate_video', status: 'success', waiting_on: undefined, arguments_string: null, results: 'https://media.example/v.mp4' },
  ]);
});

test('upsert replaces a message by id and appends new ones', () => {
  const messages = [{ id: 'm1', content: 'old' }, { id: 'm2', content: 'two' }];
  assert.deepEqual(upsertMessage(messages, { id: 'm1', content: 'new' }).map(m => m.content), ['new', 'two']);
  assert.deepEqual(upsertMessage(messages, { id: 'm3', content: 'three' }).map(m => m.id), ['m1', 'm2', 'm3']);
});

test('an app is ready only when the latest turn wrote code and finished', () => {
  const app = { id: 'app_1', status: { state: 'ready' } };
  const state = (messages: Message[]) => getChatState(app, messages, false);
  const built: Message = { id: 'built', role: 'assistant', tool_calls: [{ name: 'write_file', status: 'success' }] };
  assert.equal(state([{ id: 'hello', role: 'assistant', content: 'Hello!' }]), 'idle');
  assert.equal(state([built]), 'ready');
  assert.equal(state([{ ...built, tool_calls: [{ name: 'write_file', status: 'error' }] }]), 'idle');
  assert.equal(state([built, { id: 'followup', role: 'user' }]), 'idle');
  assert.equal(state([built, { id: 'question', role: 'user' }, { id: 'answer', role: 'assistant', content: 'Want confetti too?' }]), 'idle');
  assert.equal(state([built, { id: 'running', role: 'assistant', tool_calls: [{ name: 'find_replace', status: 'running' }] }]), 'idle');
});
