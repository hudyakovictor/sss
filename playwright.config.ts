import { defineConfig, devices } from "@playwright/test";

// Iteration 03 · Phase E — browser evidence.
//
// Two independent gates run against a freshly built stack:
//   1. `api`     — a pure HTTP integration gate (auth → scenario → start →
//                  seal → reveal → reward) that never opens a browser.
//   2. `browser` — the real Phase D vertical slice driven end to end.
//
// Dedicated test ports (3100 / 5100) keep this run isolated from any dev
// servers already bound to the default ports. The Vite dev server proxies
// `/api` to the API, and the API is told to trust the browser origin so the
// same-origin vertical-slice client works unchanged under test.

const API_PORT = 3100;
const WEB_PORT = 5100;
const API_ORIGIN = `http://localhost:${API_PORT}`;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: [
    {
      command: `DB_PATH=":memory:" AUTH_MODE=fixture PORT=${API_PORT} CORS_ORIGINS=${WEB_ORIGIN} node --import tsx apps/api-server/src/main.ts`,
      url: `${API_ORIGIN}/health`,
      // Always start a fresh API so the in-memory DB (and the isolated browser
      // identities it seeds) begin pristine every run — no cross-run leakage.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe"
    },
    {
      command: `VITE_API_PROXY=${API_ORIGIN} pnpm --filter @signal-arena/design-system-lab exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe"
    }
  ],
  projects: [
    {
      name: "api",
      testMatch: /api-integration\.spec\.ts/,
      use: { baseURL: API_ORIGIN }
    },
    {
      name: "browser",
      testMatch: /browser-e2e\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: WEB_ORIGIN,
        viewport: { width: 1440, height: 900 }
      }
    }
  ]
});
