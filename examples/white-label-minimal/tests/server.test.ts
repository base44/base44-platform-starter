import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as buildTurn from '../server/base44/build-turn';
import { customInstructions } from '../server/base44/custom-instructions';
import { getEmbedUrl } from '../server/base44/embed';
import { Base44Error } from '../server/base44/error';
import { openLiveUpdates } from '../server/base44/live-updates';
import { resolveAppPage } from '../server/app-list';
import { requireOwner } from '../server/ownership';
import { prisma } from '../server/db';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalFindFirst = prisma.appOwnership.findFirst;
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  prisma.appOwnership.findFirst = originalFindFirst;
});

function setup(reply: unknown = { id: 'app_1' }, status = 200) {
  process.env.BASE44_PLATFORM_HOST = 'https://platform.example';
  process.env.BASE44_ACCESS_TOKEN = 'pat-canary';
  process.env.BASE44_WORKSPACE_ID = 'workspace_1';
  process.env.BASE44_SVC_KEY = 'b44k_workspace';
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(reply, { status });
  };
  return calls;
}
const headers = (init: RequestInit) => new Headers(init.headers);
const body = (init: RequestInit) => JSON.parse(String(init.body));

test('creating an app authenticates as the integration account in the configured workspace', async () => {
  const calls = setup({ id: 'app_1', name: 'Reading list', api_key: 'must-not-return' });
  const app = await buildTurn.createApp('Build a reading list');
  assert.equal(Object.hasOwn(app, 'api_key'), false);
  assert.equal(calls[0].url, 'https://platform.example/api/apps');
  assert.equal(headers(calls[0].init).get('authorization'), 'Bearer pat-canary');
  assert.equal(headers(calls[0].init).get('X-Active-Workspace-Id'), 'workspace_1');
  assert.equal(body(calls[0].init).organization_id, 'workspace_1');
  assert.equal(body(calls[0].init).initial_message.content, 'Build a reading list');
  assert.equal(body(calls[0].init).custom_instructions, customInstructions);
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.redirect, 'error');
});

test('answers keep the same request ID when retried, and a rejection is an answer', async () => {
  const calls = setup({});
  const answer = { appId: 'app_1', toolCallId: 'tool_1', messageId: 'message_1', approve: true, extraUserInput: { answers: [] } };
  await buildTurn.submitToolCallInput(answer);
  await buildTurn.submitToolCallInput(answer);
  await buildTurn.submitToolCallInput({ ...answer, toolCallId: 'tool_2', approve: false });
  assert.equal(headers(calls[0].init).get('X-Request-ID'), 'submit-tool_1');
  assert.equal(headers(calls[1].init).get('X-Request-ID'), 'submit-tool_1');
  assert.deepEqual(body(calls[0].init), { tool_call_id: 'tool_1', message_id: 'message_1', action: 'approved', extra_user_input: { answers: [] } });
  assert.equal(body(calls[2].init).action, 'rejected');
});

test('previews sign the builder in with the workspace key', async () => {
  const calls = setup({ status: 'exists', embed_url: 'https://reading.example/?ott=once', expires_in: 60 });
  assert.deepEqual(await getEmbedUrl('app_1', 'builder@example.com', 'live_preview'), { url: 'https://reading.example/?ott=once', refused: null });
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/apps/app_1/users/provisions', '/api/apps/app_1/embed-tokens']);
  for (const call of calls) {
    assert.equal(headers(call.init).get('api_key'), 'b44k_workspace');
    assert.equal(body(call.init).email, 'builder@example.com');
  }
  assert.equal(body(calls[1].init).target, 'live_preview');
});

test('before the first build there is no preview; a Base44 failure never leaks its body', async () => {
  setup({ error: { code: 'app_has_no_slug' } }, 400);
  assert.deepEqual(await getEmbedUrl('app_1', 'builder@example.com', 'latest_preview'), { url: null, refused: 'app_has_no_slug' });
  // A member of the Base44 workspace is not an end user, so Base44 says why.
  setup({ error: { code: 'privileged_user' } }, 403);
  assert.deepEqual(await getEmbedUrl('app_1', 'builder@example.com', 'latest_preview'), { url: null, refused: 'privileged_user' });

  setup({ error: 'token-canary' }, 500);
  await assert.rejects(getEmbedUrl('app_1', 'builder@example.com', 'live_preview'), (error: Base44Error) => {
    assert.equal(error.status, 500);
    assert.doesNotMatch(error.message, /canary/);
    return true;
  });
});

test('network failures are uncertain, not retried, and safe to display', async () => {
  setup();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('secret-canary'); };
  await assert.rejects(buildTurn.deployApp('app_1'), (error: Base44Error) => {
    assert.equal(error.status, 504);
    assert.match(error.message, /may still be running/);
    assert.doesNotMatch(error.message, /canary/);
    return true;
  });
  assert.equal(calls, 1);
});

test('a send that outlasts the timeout is still running, not failed', async () => {
  setup();
  globalThis.fetch = async () => { throw Error('timeout'); };
  assert.deepEqual(await buildTurn.sendMessage('app_1', 'Update'), {});
});

test('an app that was never published has no link; an unsafe link is refused', async () => {
  const calls = setup({}, 404);
  assert.deepEqual(await buildTurn.getPublishedUrl('app_1'), { url: null });
  assert.equal(calls[0].url, 'https://platform.example/api/apps/platform/app_1/published-url');
  setup({ url: 'javascript://evil' });
  await assert.rejects(buildTurn.getPublishedUrl('app_1'), { status: 502 });
});

test('missing configuration makes no network call', async () => {
  const calls = setup();
  delete process.env.BASE44_PLATFORM_HOST;
  await assert.rejects(buildTurn.getApp('app_1'), { status: 503 });
  assert.equal(calls.length, 0);
});

test('a builder can only reach apps they own', async () => {
  let query: unknown;
  prisma.appOwnership.findFirst = (async (args: { where: unknown }) => {
    query = args.where;
    return null;
  }) as unknown as typeof prisma.appOwnership.findFirst;
  await assert.rejects(requireOwner('builder@example.com', 'other_app'), { status: 404 });
  await assert.rejects(requireOwner('builder@example.com', '../other'), { status: 400 });
  assert.deepEqual(query, { createdBy: 'builder@example.com', appId: 'other_app' });
});

test('apps missing in Base44 do not hide valid apps or break pagination', async () => {
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

test('live updates open with the workspace key, and a refusal says how to fix it', async () => {
  const calls = setup({ session_id: 'session_1', session_token: 'wlst_canary', socket_url: 'https://platform.example/ws' });
  assert.deepEqual(await openLiveUpdates('app_1'), { serverUrl: 'https://platform.example', sessionToken: 'wlst_canary' });
  assert.equal(calls[0].url, 'https://platform.example/api/service/socket-sessions');
  assert.equal(headers(calls[0].init).get('authorization'), 'Bearer b44k_workspace');
  assert.deepEqual(body(calls[0].init), { app_ids: ['app_1'] });

  setup({ error: { code: 'scope_required' } }, 403);
  await assert.rejects(openLiveUpdates('app_1'), (error: Base44Error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /apps:watch/);
    return true;
  });
});

test('the sandbox preview URL gets a scheme and its one-time preview token', async () => {
  const calls = setup({ preview_url: 'preview-app1.platform.example', preview_token: 'token-canary' });
  const { url } = await buildTurn.getSandboxPreviewUrl('app_1');
  assert.equal(calls[0].url, 'https://platform.example/api/apps/app_1/sandbox/preview-url');
  assert.equal(new URL(url).origin, 'https://preview-app1.platform.example');
  assert.equal(new URL(url).searchParams.get('_preview_token'), 'token-canary');
});
