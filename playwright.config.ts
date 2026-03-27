import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 20_000
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: [
    {
      command: "pnpm --filter @shipyard/server dev",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer,
      timeout: 120_000,
      env: {
        PORT: "8787",
        HOST: "127.0.0.1"
      }
    },
    {
      command:
        "pnpm --filter @shipyard/client exec vite --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer,
      timeout: 120_000
    }
  ]
});
