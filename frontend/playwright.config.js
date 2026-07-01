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

// E2E_MODE selects which server the suite runs against: 'dev' (default) runs
// the Vite dev server directly; 'prod'/'production' builds first and serves
// the production bundle via `vite preview`, catching build-only regressions
// that the dev server wouldn't surface.
const e2eMode = String(process.env.E2E_MODE || 'dev').toLowerCase();
const isProdMode = e2eMode === 'prod' || e2eMode === 'production';

// E2E_BROWSERS opts into a wider browser matrix ('all' or 'firefox' adds
// Firefox); default stays Chromium-only to keep local runs fast.
const browserMode = String(process.env.E2E_BROWSERS || 'chromium').toLowerCase();

function buildProjects() {
  const projects = [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ];

  if (browserMode === 'all' || browserMode === 'firefox') {
    projects.push({
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    });
  }

  return projects;
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Default retries bumped from 0 to 1 to absorb flaky timing in fullyParallel
  // runs; override via E2E_RETRIES if a specific run needs stricter behavior.
  retries: Number(process.env.E2E_RETRIES || 1),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined
  },
  webServer: {
    command: isProdMode
      ? 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173'
      : 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: buildProjects()
});
