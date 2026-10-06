import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 45000,
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: process.env.TALON_UI_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1360, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
