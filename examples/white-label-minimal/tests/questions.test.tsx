import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import Question, { parseQuestion } from '../components/Question';
import type { ToolCall } from '../lib/base44-client';
const tool = (kind: string, args: object): ToolCall => ({ id: 'tool_1', status: 'waiting_for_user_input', waiting_on: { kind }, arguments_string: JSON.stringify(args) });
const render = (t: ToolCall) => renderToStaticMarkup(<Question tool={t} appId="app_1" messageId="m1" disabled={false} onSubmit={async () => {}} />);
test('choice accepts string and object options, including multiple selection', () => {
  const t = tool('choice', { questions: [{ question: 'Colors?', multi_select: true, options: ['Blue', { label: 'Green' }] }] });
  assert.deepEqual(parseQuestion(t), { kind: 'choice', choices: [{ question: 'Colors?', options: ['Blue', 'Green'], multi: true }] });
  const html = render(t); assert.match(html, /checkbox/); assert.match(html, /Blue/); assert.match(html, /Reject/);
});
test('input displays declared secret fields as password inputs', () => {
  const t = tool('input', { secrets_schema: [{ secretName: 'WEATHER_KEY', description: 'Weather provider key' }] });
  assert.equal(parseQuestion(t).kind, 'input');
  const html = render(t); assert.match(html, /type="password"/); assert.match(html, /Weather provider key/);
});
test('approval shows arguments, approve, and reject', () => {
  const html = render(tool('approval', { packages: [{ name: 'example' }] }));
  assert.match(html, /Review proposed action/); assert.match(html, />Approve</); assert.match(html, />Reject</);
});
test('unknown or malformed questions remain visible and cannot be blindly approved', () => {
  for (const t of [tool('future', {}), tool('input', { fields: [] }), { ...tool('choice', {}), arguments_string: '{bad' }]) {
    assert.equal(parseQuestion(t).kind, 'unknown');
    const html = render(t); assert.match(html, /Unsupported/); assert.doesNotMatch(html, />Approve</); assert.match(html, />Reject</);
  }
});
test('resolved questions cannot be submitted again', () => {
  const html = render({ ...tool('approval', {}), status: 'success' });
  assert.doesNotMatch(html, /<button/);
});
