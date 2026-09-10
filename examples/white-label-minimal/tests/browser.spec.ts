import { test, expect, type Page } from '@playwright/test';
import type { ToolCall } from '../lib/base44-client';

async function fixture(page: Page, tool?: ToolCall, failFirst = false) {
  const submissions: Record<string, unknown>[] = [];
  let previews = 0, deployments = 0, creates = 0;
  let status = 'waiting_for_user_input';
  await page.route('https://preview.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Preview fixture</h1>' }));
  await page.route('**/api/base44', async route => {
    const p = route.request().postDataJSON();
    let json: unknown = {};
    switch (p.action) {
      case 'createApp': creates++; json = { id: 'app_1' }; break;
      case 'getApp': json = { id: 'app_1', status: { state: 'ready' } }; break;
      case 'getConversation': json = { messages: [{ id: 'm1', role: 'assistant', content: 'Your app is taking shape.',
        tool_calls: tool ? [{ ...tool, status }] : [] }] }; break;
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
  await expect(page.locator('iframe')).toHaveAttribute('src', /fixture-1/);
  await page.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /fixture-2/);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole('button', { name: 'Deploy app', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open published app' })).toHaveAttribute('href', 'https://published.example/');
  expect(f.counts()).toEqual({ creates: 1, previews: 2, deployments: 1 });
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
  await page.route('**/api/base44', route => { creates++; return route.abort('failed'); });
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Reading list');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByLabel('Existing app ID')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create app', exact: true })).toBeDisabled();
  expect(creates).toBe(1);
});
test('read failure pauses polling, resume restores it', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await page.route('**/api/base44', async route => {
    if (route.request().postDataJSON().action === 'getApp') return route.fulfill({ status: 503, json: { error: 'Temporary read failure' } });
    return route.fallback();
  });
  await page.clock.fastForward(11_000);
  await expect(page.getByText('Temporary read failure')).toBeVisible();
  await page.unroute('**/api/base44');
  await page.route('**/api/base44', route => route.fulfill({ json: route.request().postDataJSON().action === 'getApp'
    ? { id: 'app_1', status: { state: 'ready' } } : { messages: [] } }));
  await page.getByRole('button', { name: 'Resume polling' }).click();
  await expect(page.getByText('Temporary read failure')).toHaveCount(0);
});

test('preview credential is removed before its expiry', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await page.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.clock.fastForward(241_000);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('real Next route accepts local browser origins and rejects foreign origins', async ({ page, request }) => {
  await page.goto('/');
  const status = await page.evaluate(async () => (await fetch('/api/base44', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unknown' }),
  })).status);
  expect(status).toBe(400); // Validation reached; Next may normalize request.url internally.
  const foreign = await request.post('/api/base44', {
    headers: { Origin: 'https://foreign.example' }, data: { action: 'unknown' },
  });
  expect(foreign.status()).toBe(403);
});

test('slow conversation reads do not overlap later polling intervals', async ({ page }) => {
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
  await page.clock.fastForward(11_000);
  await expect.poll(() => reads).toBe(1);
  await page.clock.fastForward(40_000);
  expect(reads).toBe(1);
  release();
  await expect(page.getByText('Your app is taking shape.')).toBeVisible();
});

test('rejected access preserves prompt and allows retry without uncertain creation warning', async ({ page }) => {
  await page.route('**/api/base44', route => route.fulfill({ status: 401, contentType: 'application/json',
    body: JSON.stringify({ error: 'Enter the builder access password.', outcome: 'not_started' }) }));
  await page.goto('/');
  await page.getByLabel('What would you like to build?').fill('Hello world');
  await page.getByRole('button', { name: 'Create app', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the builder access password.');
  await expect(page.getByRole('button', { name: 'Create app', exact: true })).toBeEnabled();
  await expect(page.getByText('Creation may have succeeded.', { exact: false })).toHaveCount(0);
});
