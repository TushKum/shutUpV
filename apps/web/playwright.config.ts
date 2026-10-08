// Browser tests of the real app against a local Supabase (scripts/local-supabase.sh writes .env.e2e).
// Each spec seeds its own small rehearsal event; the Next dev server is started on port 3100 if it is not running.

import { defineConfig } from "@playwright/test";
import { e2eEnv } from "./e2e/support/env";

const env = e2eEnv();

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "./e2e/.results",
  webServer: {
    command: "pnpm exec next dev --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_TEAM_EMAIL_DOMAIN: env.NEXT_PUBLIC_TEAM_EMAIL_DOMAIN,
    },
  },
});
