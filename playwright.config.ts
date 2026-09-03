// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3010";
const useExternalBaseURL = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
const screenshotMode = process.env.PLAYWRIGHT_SCREENSHOT === "off" ? "off" : "on";
const videoMode = process.env.PLAYWRIGHT_VIDEO === "off" ? "off" : "on";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: screenshotMode,
    video: videoMode,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
  webServer: useExternalBaseURL
    ? undefined
    : {
        command:
          "node ./scripts/check-browser-wallet-command-preconditions.mjs --mode playwright-webserver && NEXT_PUBLIC_ENABLE_PLAYWRIGHT_WALLET=true node node_modules/next/dist/bin/next dev --webpack --port 3010",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
