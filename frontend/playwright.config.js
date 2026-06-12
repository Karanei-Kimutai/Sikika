import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function resolveChromiumExecutable() {
  const cacheDir = path.join(process.env.HOME || '', '.cache', 'ms-playwright');
  if (!cacheDir || !fs.existsSync(cacheDir)) return undefined;

  const dirs = fs.readdirSync(cacheDir)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const dirName of dirs) {
    const candidate = path.join(cacheDir, dirName, 'chrome-linux', 'chrome');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

const chromiumExecutablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
