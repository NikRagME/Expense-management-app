import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    reducedMotion: 'reduce',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    // Fresh local database every run; dev login enabled only for this server.
    command:
      `rm -rf .wrangler/e2e && npm run build:web && npx wrangler d1 migrations apply expense-db --local --persist-to .wrangler/e2e && ` +
      `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to .wrangler/e2e --var DEV_LOGIN:true --var ALLOWED_USERS:kid@example.com:daughter,dad@example.com:parent`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
