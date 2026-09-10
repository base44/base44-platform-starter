import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit opt-in command only. Never imported by tests or the application.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (existsSync('.env')) process.loadEnvFile('.env');
const configured = ['BASE44_API_KEY', 'BASE44_ORG_ID', 'BASE44_PLATFORM_HOST'].every(key => process.env[key]);
if (!configured) {
  console.log('Skipped: configure the three Base44 values in .env.local first.');
  process.exit(0);
}
const origin = 'http://127.0.0.1:3001';
async function call(action, params) {
  const response = await fetch(`${origin}/api/base44`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }), signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw new Error(`Local API returned ${response.status}; inspect the UI for safe error details.`);
  return response.json();
}
try {
  console.log('Creating one smoke-test app. This consumes Base44 credits; nothing will be deployed.');
  const app = await call('createApp', { prompt: 'Build a simple static reading list with three sample books. No external services or secrets.' });
  console.log(`Created app ${app.id}. Keep this ID to find and delete it in your Base44 workspace.`);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const current = await call('getApp', { appId: app.id });
    const { messages } = await call('getConversation', { appId: app.id, skip: 0 });
    if (messages.some(m => m.tool_calls?.some(t => t.status === 'waiting_for_user_input'))) {
      console.log('Agent question pending. Answer it in the builder; smoke stopped without approving anything.');
      process.exit(2);
    }
    if (current.status?.state === 'error') throw new Error('The build failed. Inspect the app in Base44.');
    if (current.status?.state === 'ready') {
      await call('getPreviewUrl', { appId: app.id });
      console.log('Build settled, conversation read, fresh preview obtained (credential not printed).');
      process.exit(0);
    }
    await delay(5000);
  }
  throw new Error('Build did not settle within five minutes. It may still be running.');
} catch {
  console.error('Smoke did not complete. Check the local server and Base44 workspace before repeating; creation may already have succeeded.');
  process.exit(1);
}
