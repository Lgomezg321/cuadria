import { defineConfig, devices } from "@playwright/test";

// @playwright/test 1.64.1 expects Chromium revision 1248 (Chrome for Testing
// 156.0.8078.4), installed with `npx playwright install --with-deps chromium`.
// Where that download is impossible, point PLAYWRIGHT_CHROMIUM_EXECUTABLE at a
// local Chromium/Chrome binary; it is only applied when the variable is set.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
const chromiumLaunch = chromiumExecutable
  ? { launchOptions: { executablePath: chromiumExecutable } }
  : {};

// Optional WebKit run (PLAYWRIGHT_WEBKIT=1) after `npx playwright install --with-deps webkit`.
const webkit = process.env.PLAYWRIGHT_WEBKIT === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], ...chromiumLaunch },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        ...chromiumLaunch,
      },
    },
    ...(webkit
      ? [{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } }]
      : []),
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    },
  },
});
