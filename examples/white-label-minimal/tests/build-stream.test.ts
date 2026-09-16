import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SubscriptionOptions, PlatformEvent, PlatformSocketError } from '@base44/sdk/platform/client';
import { watchBuild } from '../lib/chat/build-stream';
import { applyMessageUpdate, resolveImage } from '../lib/chat/socket-messages';

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
        subscribe(_id, options) { subscription = options; order.push('subscribe'); return { appId, cursor: undefined, active: true, unsubscribe() {} }; },
        async connect() { order.push('connect'); },
        close() { closes++; },
      };
    },
    async readApp() { reads++; order.push('snapshot'); return { id: appId, status: { state: 'processing' } }; },
    async readConversation() { return { messages: [{ id: 'm', role: 'assistant', content: 'Initial' }] }; },
  });
  return { stream, states, errors, order, subscription: () => subscription, reads: () => reads, closes: () => closes };
}

test('subscribes before loading history and streamed messages require no HTTP refresh', async () => {
  const f = fixture(); await turn();
  assert.deepEqual(f.order, ['initialize', 'subscribe', 'connect']);
  await f.subscription().onJoined!({ room: `/apps/${appId}`, seq: 'one', max_entries: 2000, inactivity_expiry_seconds: 3600 });
  assert.equal(f.reads(), 1);
  await f.subscription().onEvent({ type: 'update_model', appId, seq: 'two', data: { _last_msg: { id: 'm', role: 'assistant', content: 'Streaming' } } });
  assert.equal(f.reads(), 1);
  assert.deepEqual((f.states.at(-1) as any).messages, [{ id: 'm', role: 'assistant', content: 'Streaming' }]);
  await f.subscription().onJoined!({ room: `/apps/${appId}`, seq: 'two', max_entries: 2000, inactivity_expiry_seconds: 3600 });
  assert.equal(f.reads(), 1, 'reconnect replay must not fetch a fresh snapshot');
  f.stream.close();
});

test('question and invalidation events fetch existing backend projections without polling', async () => {
  const f = fixture(); await turn();
  for (const event of [
    { type: 'update_model', data: { _last_msg: { id: 'm', tool_calls: [{ status: 'waiting_for_user_input' }] } } },
    { type: 'directive', data: { room: `/apps/${appId}`, type: 'conversation_changed' } },
  ]) await f.subscription().onEvent({ ...event, appId, seq: 'event' } as PlatformEvent);
  assert.equal(f.reads(), 2);
  f.stream.close();
});

test('resync errors stop the session and cannot silently restart a fresh cursor', async () => {
  const f = fixture(); await turn();
  f.subscription().onError({ code: 'resync_required' } as PlatformSocketError);
  assert.equal(f.closes(), 1); assert.match(f.errors[0], /expired/);
  await f.stream.refresh(); assert.equal(f.reads(), 0);
});

test('cleanup prevents an in-flight snapshot from publishing into another app', async () => {
  let release!: () => void;
  let onJoined!: SubscriptionOptions['onJoined'];
  const states: unknown[] = [];
  const stream = watchBuild(appId, state => states.push(state), () => {}, {
    async connect() { return { subscribe(_id, options) { onJoined = options.onJoined; return { appId, cursor: undefined, active: true, unsubscribe() {} }; }, async connect() {}, close() {} }; },
    async readApp() { await new Promise<void>(resolve => { release = resolve; }); return { id: appId }; },
    async readConversation() { return { messages: [] }; },
  });
  await turn();
  const pending = onJoined!({ room: `/apps/${appId}`, seq: 'start', max_entries: 2000, inactivity_expiry_seconds: 3600 });
  stream.close(); release(); await pending; assert.deepEqual(states, []);
});

test('message replacement preserves omission/null and image completion resolves placeholders', () => {
  const previous = [{ id: 'm', role: 'assistant', content: '/placeholder', tool_calls: [{ id: 'old' }] }];
  assert.deepEqual(applyMessageUpdate(previous, { _last_msg: { id: 'm', content: null } }), [{ id: 'm', content: null }]);
  assert.equal(resolveImage(previous, { placeholder_url: '/placeholder', status: 'completed', image_url: '/image' })[0].content, '/image');
  assert.equal(previous[0].content, '/placeholder');
});
