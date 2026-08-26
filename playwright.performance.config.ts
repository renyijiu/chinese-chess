import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  expect: { timeout: 12_000 },
  fullyParallel: false,
  outputDir: "output/playwright/performance-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "output/playwright/performance-report" }]],
  retries: 0,
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start:production -- --port 3100",
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 1080, width: 1920 } },
    },
  ],
});
