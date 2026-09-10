import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createHandler } from '../lib/api-handler';
import { createBase44Client } from '../lib/base44-server';
import { Base44Error } from '../lib/base44-error';
let signedIn = true;
const POST = createHandler(async () => {
  if (!signedIn) throw new Base44Error('Sign in to continue.', 401);
  return { ...createBase44Client('user-token-canary'), authorize: async (id: string) => {
    if (id === 'other_app') throw new Base44Error('App not found.', 404);
  }, listApps: async () => ({ apps: [], hasMore: false, nextSkip: 0 }) };
});
import { customInstructions } from '../lib/custom-instructions';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { signedIn = true; globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
function setup(reply: unknown = { id: 'app_1' }, status = 200) {
  process.env.BASE44_ORG_ID = 'workspace_1';
  process.env.BASE44_PLATFORM_HOST = 'https://platform.example';
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(reply, { status });
  };
  return calls;
}
const request = (body: unknown, headers = {}) => POST(new Request('http://127.0.0.1:3001/api/base44', {
  method: 'POST', headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}));

test('invalid actions, paths, fields, pagination and decisions never reach Base44', async () => {
  const calls = setup();
  for (const body of [null, [], { action: 'proxy' }, { action: 'getApp', appId: '../other' },
    { action: 'getApp', appId: 'app_1', host: 'https://evil.example' },
    { action: 'getApp', appId: 'app_1', workspaceId: 'other' },
    { action: 'getApp', appId: 'app_1', api_key: 'other' },
    { action: 'getConversation', appId: 'app_1', skip: -1 },
    { action: 'getConversation', appId: 'app_1', skip: 1.5 },
    { action: 'submitToolCallInput', appId: 'app_1', toolCallId: 'tool_1', messageId: 'message_1', approve: 'false', extraUserInput: {} }]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('rejects foreign origins, nonlocal hosts, non-JSON and oversized bodies', async () => {
  const calls = setup();
  assert.equal((await request({}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request({}, { host: 'evil.example', origin: 'http://evil.example' })).status, 403);
  assert.equal((await request({}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request({ action: 'createApp', prompt: 'x'.repeat(65000) })).status, 413);
  assert.equal(calls.length, 0);
});
test('creation uses the user token without organization routing', async () => {
  const calls = setup({ id: 'app_1', custom_instructions: customInstructions, api_key: 'should-not-return' });
  delete process.env.BASE44_ORG_ID;
  const response = await request({ action: 'createApp', prompt: 'Build a reading list' });
  assert.deepEqual(await response.json(), { id: 'app_1', name: 'Reading List', user_description: 'Build a reading list' });
  const init = calls[0].init!;
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer user-token-canary');
  assert.equal(new Headers(init.headers).get('X-Active-Workspace-Id'), null);
  const body = JSON.parse(String(init.body));
  assert.equal(Object.hasOwn(body, 'organization_id'), false);
  assert.equal(body.name, 'Reading List');
  assert.equal(body.initial_message.content, 'Build a reading list');
  assert.equal(body.custom_instructions, customInstructions);
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
});
test('tool approvals, rejection and retries preserve payload and request identity', async () => {
  const calls = setup({});
  const input = { action: 'submitToolCallInput', appId: 'app_1', toolCallId: 'tool_1', messageId: 'message_1', approve: true, extraUserInput: { answers: [{ question_index: 0, selected_labels: ['Blue'], custom_text: '' }] } };
  await request(input); await request(input);
  await request({ ...input, toolCallId: 'tool_2', approve: false, extraUserInput: {} });
  assert.equal(new Headers(calls[0].init?.headers).get('X-Request-ID'), 'submit-tool_1');
  assert.equal(new Headers(calls[1].init?.headers).get('X-Request-ID'), 'submit-tool_1');
  assert.equal(calls[0].init?.body, calls[1].init?.body);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { tool_call_id: 'tool_1', message_id: 'message_1', action: 'approved', extra_user_input: input.extraUserInput });
  assert.equal(JSON.parse(String(calls[2].init?.body)).action, 'rejected');
});
test('preview response is not cached and upstream failures cannot expose tokens', async () => {
  const calls = setup({ preview_url: 'preview.example/?existing=1', preview_token: 'token-canary' });
  const result = await request({ action: 'getPreviewUrl', appId: 'app_1' });
  assert.match(result.headers.get('cache-control')!, /no-store/);
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(new URL((await result.json()).url).searchParams.get('_preview_token'), 'token-canary');
  assert.equal(calls[0].init?.cache, 'no-store');
  setup({ error: 'token-canary personal-key-canary' }, 500);
  assert.doesNotMatch(await (await request({ action: 'getPreviewUrl', appId: 'app_1' })).text(), /canary/);
});
test('network failures are uncertain, not retried, and safe to display', async () => {
  setup(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('secret-canary'); };
  const response = await request({ action: 'sendMessage', appId: 'app_1', content: 'Update' });
  assert.equal(response.status, 504); assert.equal(calls, 1);
  const text = await response.text(); assert.match(text, /may still be running/); assert.doesNotMatch(text, /canary/);
});
test('published endpoint maps 404 to no link; rejects unsafe URLs', async () => {
  const calls = setup({}, 404);
  assert.deepEqual(await (await request({ action: 'getPublishedUrl', appId: 'app_1' })).json(), { url: null });
  assert.equal(calls[0].url, 'https://platform.example/api/apps/platform/app_1/published-url');
  setup({ url: 'javascript://evil' });
  assert.equal((await request({ action: 'getPublishedUrl', appId: 'app_1' })).status, 502);
});
test('missing configuration makes no network call; conversation uses newest-relative paging', async () => {
  const calls = setup(); delete process.env.BASE44_PLATFORM_HOST;
  assert.equal((await request({ action: 'getApp', appId: 'app_1' })).status, 503);
  assert.equal(calls.length, 0);
  const reads = setup({ messages: [{ id: 'm1', content: 'Hello', hidden: true }] });
  const result = await request({ action: 'getConversation', appId: 'app_1', skip: 20 });
  assert.equal(result.status, 200); assert.match(reads[0].url, /limit=20&skip=20$/);
});

test('requires a session and exact origin before calling Base44', async () => {
  const calls = setup();
  process.env.BUILDER_ORIGIN = 'https://tiny.sunny44.com';
  const h = { host: 'tiny.sunny44.com', origin: 'https://tiny.sunny44.com' };
  signedIn = false;
  const denied = await request({ action: 'createApp', prompt: 'Hello' }, h);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).outcome, 'not_started');
  signedIn = true;
  assert.equal((await request({}, { ...h, origin: 'https://evil.example' })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request({ action: 'getApp', appId: 'app_1' }, h)).status, 200);
});

test('another owner’s apps cannot be read, edited, previewed or deployed', async () => {
  const calls = setup();
  for (const action of ['getApp', 'getConversation', 'sendMessage', 'getPreviewUrl', 'deployApp', 'getPublishedUrl']) {
    const response = await request({ action, appId: 'other_app', content: 'Update' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).outcome, 'not_started');
  }
  assert.equal(calls.length, 0);
});


test('unavailable apps do not hide valid apps or corrupt pagination', async () => {
  const { resolveAppPage } = await import('../lib/app-list');
  const rows = Array.from({ length: 13 }, (_, i) => ({ appId: `app_${i}` }));
  const page = await resolveAppPage(rows, 24, async id => {
    if (id === 'app_0') throw new Base44Error('App not found.', 404);
    return { id };
  });
  assert.equal(page.apps.length, 11);
  assert.equal(page.nextSkip, 36);
  assert.equal(page.hasMore, true);
  await assert.rejects(resolveAppPage(rows, 0, async () => { throw new Base44Error('Unavailable', 503); }));
});
