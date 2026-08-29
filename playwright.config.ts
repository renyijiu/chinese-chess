import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const audioBrowserMatrix = process.env.AUDIO_BROWSER_MATRIX === "1";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";
const webServerCommand = process.env.PLAYWRIGHT_SERVER_COMMAND
  ?? "npm run dev";

export default defineConfig({
  expect: { timeout: 12_000 },
  fullyParallel: false,
  outputDir: "output/playwright/test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "output/playwright/report" }]],
  retries: process.env.CI ? 1 : 0,
  snapshotPathTemplate: "{testDir}/../visual/baselines/{projectName}/{testFilePath}/{arg}{ext}",
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: skipWebServer ? undefined : {
    command: webServerCommand,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1" || !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { height: 900, width: 1440 } },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { height: 844, width: 390 } },
    },
    ...(audioBrowserMatrix ? [
      {
        name: "audio-firefox",
        testMatch: /audio\.spec\.ts/,
        use: { ...devices["Desktop Firefox"], viewport: { height: 900, width: 1440 } },
      },
      {
        name: "audio-webkit",
        testMatch: /audio\.spec\.ts/,
        use: { ...devices["Desktop Safari"], viewport: { height: 900, width: 1440 } },
      },
    ] : []),
  ],
});
