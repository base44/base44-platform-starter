import { test, expect, type Page } from '@playwright/test';
import type { ToolCall } from '../lib/types';

const liveSockets = new WeakMap<Page, (event: string, data: object) => void>();
function pushEvent(page: Page, event: string, data: object) {
  const send = liveSockets.get(page);
  if (!send) throw new Error("Builder socket has not connected");
  send(event, data);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/base44/socket-token', route => route.fulfill({
    json: { serverUrl: 'https://socket.example', token: 'fixture-browser-token' },
  }));
  await page.routeWebSocket('**/ws-whitelabel/socket.io/**', socket => {
    let room = '', seq = 0;
    socket.send('0' + JSON.stringify({ sid: 'fixture', upgrades: [], pingInterval: 3600000, pingTimeout: 3600000 }));
    socket.onMessage(raw => {
      const packet = raw.toString();
      if (packet.startsWith('40/partner,')) socket.send('40/partner,{"sid":"fixture"}');
      if (!packet.startsWith('42/partner,')) return;
      const [event, joinedRoom] = JSON.parse(packet.slice('42/partner,'.length));
      if (event !== 'join') return;
      room = joinedRoom;
      liveSockets.set(page, (name, data) => {
        const wrapped = ['update_model', 'task_update', 'image_ready'].includes(name);
        const payload = wrapped ? { room, data: JSON.stringify(data) } : { room, ...data };
        socket.send('42/partner,' + JSON.stringify([name, { ...payload, seq: String(++seq) }]));
      });
      socket.send('42/partner,' + JSON.stringify(['joined', { room, seq: String(++seq), max_entries: 2000, inactivity_expiry_seconds: 3600 }]));
    });
  });
});

async function fixture(page: Page, tool?: ToolCall, failFirst = false) {
  const submissions: Record<string, unknown>[] = [];
  let previews = 0, deployments = 0, creates = 0;
  let status = 'waiting_for_user_input';
  await page.route('https://preview.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Preview fixture</h1>' }));
  await page.route('**/api/base44', async route => {
    const p = route.request().postDataJSON();
    let json: unknown = {};
    if (p.action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    switch (p.action) {
      case 'createApp': creates++; json = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }; break;
      case 'getApp': json = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: { state: 'ready' } }; break;
      case 'getConversation': json = { messages: [{ id: 'm1', role: 'assistant', content: 'Your app is taking shape.',
        tool_calls: [{ id: "built-file", name: "write_file", status: "success" }, ...(tool ? [{ ...tool, status }] : [])] }] }; break;
      case 'submitToolCallInput':
        submissions.push(p);
        if (failFirst && submissions.length === 1) return route.abort('failed');
        status = p.approve ? 'success' : 'stopped'; break;
      case 'getPreviewUrl': json = { url: `https://preview.example/?_preview_token=fixture-${++previews}` }; break;
      case 'deployApp': deployments++; break;
      case 'getPublishedUrl': json = { url: deployments ? 'https://published.example/' : null }; break;
    }
    await route.fulfill({ json });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an app', exact: true }).click();
  await expect(page.getByLabel('What would you like to build?')).toBeFocused();
  await page.getByLabel('What would you like to build?').fill('A reading list');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByText('Your app is taking shape.')).toBeVisible();
  return { submissions, counts: () => ({ previews, deployments, creates }) };
}
const question = (kind: string, args: object): ToolCall => ({ id: 'tool_1', name: 'Agent question', waiting_on: { kind }, arguments_string: JSON.stringify(args) });

test('choice retry freezes original payload, prevents duplicates, then unlocks composer', async ({ page }) => {
  const f = await fixture(page, question('choice', { questions: [{ question: 'Which color?', options: ['Blue', 'Green'] }] }), true);
  await expect(page.getByLabel('What should change?')).toBeDisabled();
  await page.getByLabel('Blue', { exact: true }).check();
  // Two synchronous clicks must not queue two billable submissions.
  await page.getByRole('button', { name: 'Send answer', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole('button', { name: 'Retry original answer' })).toBeVisible();
  expect(f.submissions).toHaveLength(1);
  await expect(page.getByLabel('Green', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry original answer' }).click();
  await expect(page.getByLabel('What should change?')).toBeEnabled();
  expect(f.submissions).toHaveLength(2);
  expect(f.submissions[0]).toEqual(f.submissions[1]);
  expect(f.submissions[0].extraUserInput).toEqual({ answers: [{ question_index: 0, selected_labels: ['Blue'], custom_text: '' }] });
});
test('input sends declared secrets; preview refreshes and clears, deploy requires a click', async ({ page }) => {
  const f = await fixture(page, question('input', { secrets_schema: [{ secretName: 'WEATHER_KEY' }] }));
  await page.getByLabel('WEATHER_KEY').fill('fixture-secret');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.getByLabel('What should change?')).toBeEnabled();
  expect(f.submissions[0].extraUserInput).toEqual({ secrets: { WEATHER_KEY: 'fixture-secret' } });
  expect(f.counts().deployments).toBe(0);
  await page.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('dialog iframe')).toHaveAttribute('src', /fixture-/);
  const initialPreview = await page.locator('dialog iframe').getAttribute('src');
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh preview' }).click();
  await expect(page.locator('dialog iframe')).not.toHaveAttribute('src', initialPreview!);
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await expect(page.locator('dialog iframe')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole('button', { name: 'Deploy app', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open published app' })).toHaveAttribute('href', 'https://published.example/');
  expect(f.counts().creates).toBe(1);
  expect(f.counts().deployments).toBe(1);
  expect(f.counts().previews).toBeGreaterThanOrEqual(2);
});
test('approval rejection is an answer and removes the waiting state', async ({ page }) => {
  const f = await fixture(page, question('approval', { packages: [{ name: 'example-package' }] }));
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByLabel('What should change?')).toBeEnabled();
  await page.screenshot({ path: 'test-results/builder.png', fullPage: true });
  expect(f.submissions[0].approve).toBe(false);
  expect(f.submissions[0].extraUserInput).toEqual({});
});
test('uncertain create never retries automatically and offers existing-app recovery', async ({ page }) => {
  let creates = 0;
  await page.route('**/api/base44', route => {
    if (route.request().postDataJSON().action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    creates++; return route.abort('failed');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an app', exact: true }).click();
  await page.getByLabel('What would you like to build?').fill('Reading list');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByLabel('Existing app ID')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create app', exact: true })).toBeDisabled();
  expect(creates).toBe(1);
});
test('snapshot failure pauses live updates, reconnect restores them', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await page.route('**/api/base44', async route => {
    if (route.request().postDataJSON().action === 'getApp') return route.fulfill({ status: 503, json: { error: 'Temporary read failure' } });
    return route.fallback();
  });
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect(page.getByText('Live updates paused. Reconnect to continue.')).toBeVisible();
  await page.unroute('**/api/base44');
  await page.route('**/api/base44', route => route.fulfill({ json: route.request().postDataJSON().action === 'getApp'
    ? { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: { state: 'ready' } } : { messages: [] } }));
  await page.getByRole('button', { name: 'Reconnect live updates' }).click();
  await expect(page.getByText('Live updates paused. Reconnect to continue.')).toHaveCount(0);
});

test('live preview stays stable and recovers only from its own expiry message', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await page.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(page.locator('dialog iframe')).toBeVisible();
  const initialUrl = await page.locator('dialog iframe').getAttribute('src');
  await page.clock.fastForward(300_000);
  await expect(page.locator('dialog iframe')).toHaveAttribute('src', initialUrl!);
  await page.evaluate(() => window.postMessage({ type: 'preview:requestRefresh' }, '*'));
  await expect(page.locator('dialog iframe')).toHaveAttribute('src', initialUrl!);
  const preview = page.frames().find(frame => frame.url() === initialUrl)!;
  await preview.evaluate(() => window.parent.postMessage({ type: 'preview:requestRefresh' }, '*'));
  await expect(page.locator('dialog iframe')).not.toHaveAttribute('src', initialUrl!);
  await expect(page.locator('dialog iframe')).toBeVisible();
  await page.getByRole('button', { name: 'Close app preview', exact: true }).click();
  await page.clock.fastForward(60_000);
  await expect(page.locator('dialog iframe')).toHaveCount(0);
});

test('real Next route requires authentication for local browser origins and rejects foreign origins', async ({ page, request }) => {
  await page.goto('/');
  const status = await page.evaluate(async () => (await fetch('/api/base44', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unknown' }),
  })).status);
  expect(status).toBe(401); // Validation reached; Next may normalize request.url internally.
  const foreign = await request.post('/api/base44', {
    headers: { Origin: 'https://foreign.example' }, data: { action: 'unknown' },
  });
  expect(foreign.status()).toBe(403);
});

test('slow snapshot reads do not overlap and no polling timer runs', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  let reads = 0;
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/base44', async route => {
    if (route.request().postDataJSON().action !== 'getConversation') return route.fallback();
    reads++;
    await pending;
    return route.fulfill({ json: { messages: [] } });
  });
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect.poll(() => reads).toBe(1);
  await page.clock.fastForward(40_000);
  expect(reads).toBe(1);
  release();
  await expect(page.getByText('Your app is taking shape.')).toBeVisible();
});

test('rejected access preserves prompt and allows retry without uncertain creation warning', async ({ page }) => {
  await page.route('**/api/base44', route => route.fulfill({ status: 401, contentType: 'application/json',
    body: JSON.stringify({ error: 'Sign in to continue.', outcome: 'not_started' }) }));
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Hello world');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.locator('aside[role=alert]')).toContainText('Sign in to continue.');
  await expect(page.getByRole('button', { name: 'Create app', exact: true })).toBeEnabled();
  await expect(page.getByLabel('What would you like to build?')).toHaveValue('Hello world');
  await expect(page.getByText('Creation may have succeeded.', { exact: false })).toHaveCount(0);
});

test('rejected Base44 token reconnects before reloading apps', async ({ page }) => {
  let connected = false;
  let connections = 0;
  await page.route('**/api/base44', route => route.fulfill(connected
    ? { json: { apps: [], hasMore: false } }
    : { status: 401, json: { error: 'Base44 returned 401. Reconnect your workspace.', outcome: 'unknown' } }));
  await page.route('**/api/base44/connection', route => {
    expect(route.request().postDataJSON()).toEqual({ action: 'connect' });
    connections++;
    connected = true;
    return route.fulfill({ json: { linked: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Reconnect your workspace.');
  await page.getByRole('button', { name: 'Reconnect workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your first idea' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(connections).toBe(1);
});

test('My apps shows owned cards and opens the editor without marketplace features', async ({ page }) => {
  await page.route('**/api/base44', route => {
    const { action, appId } = route.request().postDataJSON();
    if (action === 'listApps') return route.fulfill({ json: { apps: [
      { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Reading list', user_description: 'A home for your next great read' },
      { id: 'habits', name: 'Daily habits', user_description: 'Small steps, every day' },
      { id: 'recipes', name: 'Recipe book', user_description: 'Keep your favorites close' },
    ], hasMore: false } });
    return route.fulfill({ json: action === 'getConversation' ? { messages: [] } : { id: appId, name: 'Reading list', status: { state: 'ready' } } });
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My apps', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'App editor' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const grid = await page.locator('.apps-page').boundingBox();
  const assistant = await page.getByRole('region', { name: 'App editor' }).boundingBox();
  expect(assistant!.x).toBeGreaterThanOrEqual(grid!.x + grid!.width);
  await expect(page.getByRole('button', { name: 'Edit Reading list', exact: true })).toBeVisible();
  await expect(page.getByText(/market|install/i)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/my-apps-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Edit Reading list', exact: true }).click();
  await expect(page.getByLabel('What should change?')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'New app', exact: true }).click();
  await expect(page.getByLabel('What would you like to build?')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Close assistant' })).toBeVisible();
  const panel = await page.getByRole('region', { name: 'App editor' }).boundingBox();
  expect(panel!.y).toBe(64);
  expect(panel!.x + panel!.width).toBe(390);
  await page.screenshot({ path: 'test-results/assistant-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.getByRole('region', { name: 'App editor' })).not.toBeVisible();
  await page.screenshot({ path: 'test-results/my-apps-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.getByLabel('What would you like to build?')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

 test('ordinary tool activity is collapsed and assistant messages render Markdown', async ({ page }) => {
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: action === 'listApps' ? { apps: [], hasMore: false, nextSkip: 0 } : action === 'getConversation' ? { messages: [{ id: 'm1', role: 'assistant', content: '## Your app is ready\n- **Hello world**', tool_calls: [{ id: 't1', name: 'find_replace', status: 'success', display_projection: { file_paths: ['src/index.css'] } }] }] } : { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Hello World', status: { state: 'ready' } } });
  });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Hello world app');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your app is ready' })).toBeVisible();
  await expect(page.getByText('Unsupported question / tool details')).toHaveCount(0);
  await expect(page.getByText('Editing src/index.css')).toBeVisible();
  await page.locator('.tool-activity summary').click();
  await expect(page.getByText('Editing src/index.css')).toBeVisible();
  await page.screenshot({ path: 'test-results/chat-desktop.png', fullPage: true });
});

test('assistant-ui preserves inline tools across live invalidation and hides internal messages', async ({ page }) => {
  await page.clock.install();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const sent: string[] = [];
  let complete = false;
  await page.route('**/api/base44', route => {
    const p = route.request().postDataJSON();
    if (p.action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    if (p.action === 'sendMessage') { sent.push(p.content); return route.fulfill({ json: {} }); }
    if (p.action === 'getConversation') return route.fulfill({ json: { messages: [
      { id: 'hidden', hidden: true, role: 'assistant', content: 'Internal instructions' },
      { id: 'm1', role: 'assistant', content: '**Working on your app**', tool_calls: [
        { id: 't1', name: 'write_file', status: complete ? 'success' : 'running', display_projection: { file_paths: ['app.tsx'] }, results: complete ? 'Plan updated.' : null },
        { name: 'unknown_question', status: 'waiting_for_user_input', waiting_on: { kind: 'choice' }, arguments_string: '{' },
      ] },
    ] } });
    return route.fulfill({ json: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: { state: 'ready' } } });
  });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Build a notes app');
  await page.getByLabel('What would you like to build?').press('Enter');
  await expect(page.getByText('Working on your app')).toBeVisible();
  await expect(page.getByText('Internal instructions')).toHaveCount(0);
  await expect(page.getByLabel('What should change?')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send prompt', exact: true })).toBeDisabled();
  await expect(page.getByText('Unsupported question / tool details')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await page.locator('.tool-activity summary').click();
  await expect(page.locator('.tool-activity')).toContainText('Working');
  complete = true;
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect(page.locator('.tool-activity')).toContainText('Plan updated.');
  await expect(page.locator('.tool-activity')).toHaveAttribute('open', '');
  expect(sent).toEqual([]);
  expect(errors).toEqual([]);
});

test('assistant-ui composer sends a follow-up once and Shift+Enter inserts a newline', async ({ page }) => {
  const f = await fixture(page);
  const sent: string[] = [];
  await page.route('**/api/base44', route => {
    const p = route.request().postDataJSON();
    if (p.action !== 'sendMessage') return route.fallback();
    sent.push(p.content);
    return route.fulfill({ json: {} });
  });
  const input = page.getByLabel('What should change?');
  await input.fill('Add dark mode');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('Add dark mode\n');
  expect(sent).toEqual([]);
  await input.press('Enter');
  await expect.poll(() => sent).toEqual(['Add dark mode\n']);
  await expect(input).toHaveValue('');
  expect(f.counts().creates).toBe(1);
});

test('preview card waits for build completion and hides during follow-up submission', async ({ page }) => {
  await page.clock.install();
  let state = 'processing';
  let releaseSend: (() => void) | undefined;
  await page.route('**/api/base44', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    if (action === 'sendMessage') {
      await new Promise<void>(resolve => { releaseSend = resolve; });
      state = 'processing';
      return route.fulfill({ json: {} });
    }
    if (action === 'getConversation') return route.fulfill({ json: { messages: [
      { id: 'm1', role: 'assistant', content: 'Your scoreboard is live.', tool_calls: [{ id: 'write', name: 'write_file', status: 'success' }] },
    ] } });
    return route.fulfill({ json: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Scoreboard', status: { state } } });
  });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Build a scoreboard');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByText('Your scoreboard is live.')).toBeVisible();
  await expect(page.getByText('Building…', { exact: true })).toBeVisible();
  const card = page.getByRole('region', { name: 'Preview and publish' });
  await expect(card).toHaveCount(0);

  state = 'ready';
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect(card).toBeVisible();
  await page.getByLabel('What should change?').fill('Add a reset button');
  await page.getByRole('button', { name: 'Send prompt', exact: true }).click();
  await expect.poll(() => !!releaseSend).toBe(true);
  await expect(card).toHaveCount(0);
  releaseSend!();
  await expect(page.getByText('Building…', { exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);

  state = 'ready';
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect(card).toBeVisible();
});

test('first prompt stays visible through creation and an empty snapshot, then merges once', async ({ page }) => {
  await page.clock.install();
  let releaseCreate: (() => void) | undefined;
  let includeMessage = false;
  const prompt = 'Build a four-player scoreboard';
  await page.route('**/api/base44', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    if (action === 'createApp') await new Promise<void>(resolve => { releaseCreate = resolve; });
    if (action === 'getConversation') return route.fulfill({ json: { messages: includeMessage
      ? [{ id: 'server-user', role: 'user', content: prompt }] : [] } });
    return route.fulfill({ json: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: { state: 'processing' } } });
  });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill(prompt);
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.locator('.from-assistant')).toHaveCount(0);
  await expect.poll(() => !!releaseCreate).toBe(true);
  releaseCreate!();
  await expect(page.getByText('Building…', { exact: true })).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByText('No messages yet.', { exact: true })).toHaveCount(0);
  includeMessage = true;
  pushEvent(page, "directive", { type: "conversation_changed" });
  await expect(page.locator('.from-user')).toHaveCount(1);
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
});

test('failed creation removes the optimistic bubble and restores the draft', async ({ page }) => {
  let failCreate: (() => void) | undefined;
  await page.route('**/api/base44', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'listApps') return route.fulfill({ json: { apps: [], hasMore: false } });
    await new Promise<void>(resolve => { failCreate = resolve; });
    return route.fulfill({ status: 400, json: { error: 'Creation rejected' } });
  });
  await page.goto('/');
  const input = page.getByLabel('What would you like to build?');
  await input.fill('Build a scoreboard');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.locator('.from-user')).toHaveCount(1);
  await expect.poll(() => !!failCreate).toBe(true);
  failCreate!();
  await expect(input).toHaveValue('Build a scoreboard');
  await expect(page.locator('.from-user')).toHaveCount(0);
  await expect(page.locator('aside[role=alert]')).toBeVisible();
});

 test('a greeting-only reply never offers preview or publish', async ({ page }) => {
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: action === 'listApps' ? { apps: [], hasMore: false } : action === 'getConversation'
      ? { messages: [{ id: 'u1', role: 'user', content: 'say hello world' }, { id: 'a1', role: 'assistant', content: 'Hello world! What would you like to build?' }] }
      : { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'say hello world', status: { state: 'ready' } } });
  });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('say hello world');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByText('Hello world! What would you like to build?')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview and publish' })).toHaveCount(0);
  await expect(page.getByLabel('What should change?')).toBeEnabled();
});


test('empty state has one creation CTA and app cards render fresh previews', async ({ page }) => {
  let populated = false;
  let previews = 0;
  await page.route('https://preview.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Working app</h1>' }));
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: action === 'listApps'
      ? { apps: populated ? [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Reading list', static_preview_url: 'https://preview.example/static' }] : [], hasMore: false }
      : { url: `https://preview.example/?token=${++previews}` } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create an app', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New app', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Create an app', exact: true }).click();
  await expect(page.getByLabel('What would you like to build?')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  populated = true;
  await page.reload();
  const open = page.getByRole('button', { name: 'Open Reading list', exact: true });
  await open.click();
  await expect(page.frameLocator('dialog iframe').getByRole('heading', { name: 'Working app' })).toBeVisible();
  const firstUrl = await page.locator('dialog iframe').getAttribute('src');
  await page.screenshot({ path: 'test-results/app-preview-desktop.png' });
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.locator('dialog iframe')).toHaveAttribute('src', /static/);
  await expect(page.locator('dialog iframe')).toHaveAttribute('src', firstUrl!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/app-preview-mobile.png' });
  await page.getByRole('button', { name: 'Close app preview' }).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});


test('list thumbnails and ready widget open the same app preview', async ({ page }) => {
  const screenshot = 'https://preview.example/thumbnail.svg';
  const app = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Reading list', static_preview_url: 'https://preview.example/static', preview_screenshot_url: screenshot, status: { state: 'ready' } };
  await page.route('https://preview.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Reading app</h1>' }));
  await page.route(screenshot, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="skyblue"/></svg>' }));
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: action === 'listApps' ? { apps: [app], hasMore: false }
      : action === 'getConversation' ? { messages: [{ id: 'built', role: 'assistant', content: 'Ready', tool_calls: [{ id: 'file', name: 'write_file', status: 'success' }] }] }
      : action === 'getPreviewUrl' ? { url: 'https://preview.example/app' } : app });
  });
  await page.goto('/');
  await expect(page.frameLocator('.app-widget iframe').getByRole('heading', { name: 'Reading app' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Reading list', exact: true }).click();
  await expect(page.frameLocator('dialog iframe').getByRole('heading', { name: 'Reading app' })).toBeVisible();
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await page.getByRole('button', { name: 'Edit Reading list', exact: true }).click();
  await expect(page.locator('.delivery img')).toHaveAttribute('src', screenshot);
  await page.getByRole('button', { name: 'Open app thumbnail preview' }).click();
  await expect(page.frameLocator('dialog iframe').getByRole('heading', { name: 'Reading app' })).toBeVisible();
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await page.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(page.frameLocator('dialog iframe').getByRole('heading', { name: 'Reading app' })).toBeVisible();
  await expect(page.locator('.delivery iframe')).toHaveCount(0);
});

test('remove persists, handles failures, and New app lives in the chat header', async ({ page }) => {
  let apps = [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Reading list', status: { state: 'ready' } }];
  let fail = true;
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    if (action === 'getPreviewUrl') return route.fulfill({ json: { url: 'https://preview.example/static' } });
    if (action === 'removeApp') {
      if (fail) return route.fulfill({ status: 500, json: { error: 'Removal failed' } });
      apps = [];
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: action === 'listApps' ? { apps, hasMore: false, nextSkip: apps.length }
      : action === 'getConversation' ? { messages: [] } : apps[0] });
  });
  await page.goto('/');
  await expect(page.locator('.editor-heading').getByRole('button', { name: 'New app', exact: true })).toBeVisible();
  await expect(page.locator('.page-heading button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Reading list', exact: true }).click();
  await expect(page.getByLabel('What should change?')).toBeVisible();
  const remove = page.getByRole('button', { name: 'Remove Reading list from My apps', exact: true });
  await remove.click();
  await expect(page.locator('.apps-content [role=alert]')).toContainText('Removal failed');
  await expect(remove).toBeVisible();
  fail = false;
  await remove.click();
  await expect(page.locator('.app-widget')).toHaveCount(0);
  await expect(page.getByLabel('What would you like to build?')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create an app', exact: true })).toBeVisible();
  await expect(page.locator('.app-widget')).toHaveCount(0);
});

 test('all owned apps render as interactive widgets across pages and on mobile', async ({ page }) => {
  const skips: number[] = [];
  await page.route('https://widgets.example/**', route => route.fulfill({ contentType: 'text/html', body: `<button onclick="this.textContent='Clicked'">Try widget</button>` }));
  await page.route('**/api/base44', route => {
    const { action, skip, appId } = route.request().postDataJSON();
    if (action === 'listApps') {
      skips.push(skip);
      return route.fulfill({ json: { apps: [{ id: skip ? 'second' : 'first', name: skip ? 'Second app' : 'First app', static_preview_url: `https://widgets.example/${skip}` }], hasMore: !skip, nextSkip: skip + 12 } });
    }
    return route.fulfill({ json: { url: `https://widgets.example/${appId}` } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.app-widget iframe')).toHaveCount(2);
  expect([...new Set(skips)]).toEqual([0, 12]);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await page.frameLocator('iframe[title="First app widget preview"]').getByRole('button', { name: 'Try widget' }).click();
  await expect(page.frameLocator('iframe[title="First app widget preview"]').getByRole('button', { name: 'Clicked' })).toBeVisible();
  await page.screenshot({ path: 'test-results/widgets-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/widgets-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

 test('browsing never starts sandboxes; editing keeps static until live loads', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  await page.route('https://static.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Static build</h1>' }));
  await page.route('https://live.example/**', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ contentType: 'text/html', body: '<h1>Live build</h1>' });
  });
  const app = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Reading list', static_preview_url: 'https://static.example/app', status: { state: 'ready' } };
  await page.route('**/api/base44', route => {
    const { action } = route.request().postDataJSON();
    if (action === 'getPreviewUrl') { requests++; return route.fulfill({ json: { url: 'https://live.example/app' } }); }
    return route.fulfill({ json: action === 'listApps' ? { apps: [app], hasMore: false } : action === 'getConversation' ? { messages: [] } : app });
  });
  await page.goto('/');
  await expect(page.frameLocator('.app-widget iframe').getByRole('heading', { name: 'Static build' })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Edit Reading list', exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await expect(page.frameLocator('.app-widget iframe:not(.preview-loading-frame)').getByRole('heading', { name: 'Static build' })).toBeVisible();
  expect(requests).toBe(1);
  release!();
  await expect(page.locator('.app-widget iframe')).toHaveCount(1);
  await expect(page.frameLocator('.app-widget iframe').getByRole('heading', { name: 'Live build' })).toBeVisible();
  await page.screenshot({ path: 'test-results/static-live-preview.png' });
});

test('editing shows a loader until the conversation arrives', async ({ page }) => {
  let release!: () => void;
  const conversationReady = new Promise<void>(resolve => { release = resolve; });
  const app = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Reading list', status: { state: 'ready' } };
  await page.route('**/api/base44', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'getConversation') {
      await conversationReady;
      return route.fulfill({ json: { messages: [{ id: 'm1', role: 'assistant', content: 'Your reading list is ready.' }] } });
    }
    return route.fulfill({ json: action === 'listApps' ? { apps: [app], hasMore: false } : app });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Reading list', exact: true }).click();
  await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible();
  await expect(page.getByText('No messages yet.', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('What should change?')).toBeDisabled();
  release();
  await expect(page.getByText('Your reading list is ready.', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('What should change?')).toBeEnabled();
});

test('streamed chat replaces a message without periodic HTTP reads', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  let reads = 0;
  await page.route('**/api/base44', route => {
    if (['getApp', 'getConversation'].includes(route.request().postDataJSON().action)) reads++;
    return route.fallback();
  });
  pushEvent(page, 'update_model', { _last_msg: { id: 'm1', role: 'assistant', content: 'This text arrived through the socket.' } });
  await expect(page.getByText('This text arrived through the socket.')).toBeVisible();
  await expect(page.getByText('Your app is taking shape.')).toHaveCount(0);
  await page.clock.fastForward(45_000);
  expect(reads).toBe(0);
});
