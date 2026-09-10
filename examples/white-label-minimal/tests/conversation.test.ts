import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshConversation } from '../lib/conversation';
import type { Message } from '../lib/base44-client';
const messages = (count: number): Message[] => Array.from({ length: count }, (_, i) => ({ id: `m${i}`, content: `Message ${i}` }));
const page = (all: Message[], skip: number) => ({ messages: all.slice(Math.max(0, all.length - skip - 20), all.length - skip) });
test('initial history is chronological, hidden messages still count toward offsets', async () => {
  const all = messages(47); all[2].hidden = true;
  const skips: number[] = [];
  const result = await refreshConversation([], async skip => { skips.push(skip); return page(all, skip); });
  assert.deepEqual(result, all); assert.deepEqual(skips, [0, 20, 40]);
});
test('refresh replaces mutable messages and backfills more than one page of arrivals', async () => {
  const old = messages(25), current = messages(70);
  current[24].content = 'Updated';
  const result = await refreshConversation(old, async skip => page(current, skip));
  assert.deepEqual(result, current);
});
test('older unresolved calls are revisited until their status is updated', async () => {
  const old = messages(65);
  old[2].tool_calls = [{ id: 't1', status: 'waiting_for_user_input' }];
  const current = structuredClone(old); current[2].tool_calls![0].status = 'success';
  assert.deepEqual(await refreshConversation(old, async skip => page(current, skip)), current);
});
test('settled history only refreshes the latest page', async () => {
  const old = messages(65); const skips: number[] = [];
  await refreshConversation(old, async skip => { skips.push(skip); return page(old, skip); });
  assert.deepEqual(skips, [0]);
});
test('overlapping pages from concurrent appends are deduplicated', async () => {
  const old = messages(21); let reads = 0;
  const result = await refreshConversation([], async skip => page(reads++ ? messages(22) : old, skip));
  assert.equal(new Set(result.map(m => m.id)).size, result.length);
  assert.deepEqual(result, old);
});
