import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SubscriptionOptions, PlatformEvent, PlatformSocketError } from '@base44/sdk/platform/client';
import { watchBuild } from '../lib/chat/build-stream';
import { mergeMessages, removeMessage, resolveImage } from '../lib/chat/socket-messages';

const appId = 'a'.repeat(24);
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let subscription!: SubscriptionOptions;
  let reads = 0, closes = 0;
  const states: unknown[] = [], errors: string[] = [], order: string[] = [];
  const stream = watchBuild(appId, state => states.push(state), error => errors.push(error), {
    async connect() {
      order.push('initialize');
      return {
        subscribe(_id, options) { subscription = options; order.push('subscribe'); return { appId, active: true, unsubscribe() {} }; },
        async connect() { order.push('connect'); },
        close() { closes++; },
      };
    },
    async readApp() { reads++; order.push('snapshot'); return { id: appId, status: { state: 'processing' } }; },
    async readConversation() { return { messages: [{ id: 'm', role: 'assistant', content: 'Initial' }] }; },
  });
  return { stream, states, errors, order, subscription: () => subscription, reads: () => reads, closes: () => closes };
}

const room = `/apps/${appId}`;

test('subscribes before loading history and streamed messages require no HTTP refresh', async () => {
  const f = fixture(); await turn();
  assert.deepEqual(f.order, ['initialize', 'subscribe', 'connect']);
  await f.subscription().onSnapshot({ room, status: { state: 'processing' }, messages: [] });
  assert.equal(f.reads(), 1);
  await f.subscription().onEvent({ type: 'message.updated', appId, data: { message: { id: 'm', role: 'assistant', content: 'Streaming' } } });
  assert.equal(f.reads(), 1);
  assert.deepEqual((f.states.at(-1) as any).messages, [{ id: 'm', role: 'assistant', content: 'Streaming' }]);
  f.stream.close();
});

test('a reconnect snapshot merges what the socket missed without an HTTP read', async () => {
  const f = fixture(); await turn();
  await f.subscription().onSnapshot({ room, status: { state: 'processing' }, messages: [] });
  await f.subscription().onSnapshot({ room, status: { state: 'ready' }, messages: [
    { id: 'm', role: 'assistant', content: 'Finished while away' }, { id: 'n', role: 'user', content: 'Next' },
  ] });
  assert.equal(f.reads(), 1);
  const state = f.states.at(-1) as any;
  assert.equal(state.app.status.state, 'ready');
  assert.deepEqual(state.messages.map((m: any) => m.content), ['Finished while away', 'Next']);
  f.stream.close();
});

test('a missing socket snapshot still loads history and keeps the session', async () => {
  const f = fixture(); await turn();
  f.subscription().onError({ code: 'snapshot_unavailable' } as PlatformSocketError);
  await turn();
  assert.equal(f.reads(), 1); assert.equal(f.closes(), 0); assert.deepEqual(f.errors, []);
  f.stream.close();
});

test('question updates render from the socket while invalidations refresh through the backend', async () => {
  const f = fixture(); await turn();
  for (const event of [
    { type: 'message.updated', data: { message: { id: 'm', tool_calls: [{ status: 'waiting_for_user_input' }] } } },
    { type: 'conversation.changed', data: {} },
  ]) await f.subscription().onEvent({ ...event, appId } as PlatformEvent);
  assert.equal(f.reads(), 1);
  f.stream.close();
});

test('a session claimed by another tab stops delivery until the user reconnects', async () => {
  const f = fixture(); await turn();
  f.subscription().onError({ code: 'session_replaced' } as PlatformSocketError);
  assert.equal(f.closes(), 1); assert.match(f.errors[0], /another tab/);
  await f.stream.refresh(); assert.equal(f.reads(), 0);
});

test('cleanup prevents an in-flight snapshot from publishing into another app', async () => {
  let release!: () => void;
  let onSnapshot!: SubscriptionOptions['onSnapshot'];
  const states: unknown[] = [];
  const stream = watchBuild(appId, state => states.push(state), () => {}, {
    async connect() { return { subscribe(_id, options) { onSnapshot = options.onSnapshot; return { appId, active: true, unsubscribe() {} }; }, async connect() {}, close() {} }; },
    async readApp() { await new Promise<void>(resolve => { release = resolve; }); return { id: appId }; },
    async readConversation() { return { messages: [] }; },
  });
  await turn();
  const pending = onSnapshot({ room: `/apps/${appId}`, status: null, messages: [] });
  stream.close(); release(); await pending; assert.deepEqual(states, []);
});

test('message replacement preserves omission/null and image completion resolves placeholders', () => {
  const previous = [{ id: 'm', role: 'assistant', content: '/placeholder', tool_calls: [{ id: 'old', results: { placeholder_url: '/placeholder', status: 'pending' as const, image_url: null } }] }];
  assert.deepEqual(mergeMessages(previous, [{ id: 'm', content: null }]), [{ id: 'm', content: null }]);
  assert.equal(resolveImage(previous, { placeholder_url: '/placeholder', status: 'completed', image_url: '/image' })[0].content, '/image');
  assert.deepEqual(resolveImage(previous, { placeholder_url: '/placeholder', status: 'completed', image_url: '/image' })[0].tool_calls?.[0].results, { placeholder_url: '/placeholder', status: 'completed', image_url: '/image' });
  assert.equal(previous[0].content, '/placeholder');
  assert.deepEqual(removeMessage(previous, 'm'), []);
  const game = [{ id: 'g', tool_calls: [{ id: 't', results: '/placeholder' }] }];
  assert.equal(resolveImage(game, { placeholder_url: '/placeholder', status: 'completed', image_url: '/image' })[0].tool_calls?.[0].results, '/image');
});
