import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const port = new URL(baseURL).port || "3000";

export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL,
  },
  ...(process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1"
    ? {}
    : {
        webServer: {
          command:
            process.env.PLAYWRIGHT_SERVER_COMMAND ??
            `npm run start:production:test -- --port ${port} --name chinese-chess-3d-web-release-test`,
          reuseExistingServer: false,
          timeout: 120_000,
          url: baseURL,
        },
      }),
});
