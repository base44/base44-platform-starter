import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMessage, upsertMessage } from '../client/messages';

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
