import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101', headless: true },
  webServer: {
    command: 'npm run build && npm run start -- --port 3101', url: 'http://127.0.0.1:3101',
    reuseExistingServer: false, timeout: 120_000,
  },
});
