import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Widened from ./tests/a11y so the i18n suite (tests/i18n) is discovered by a
  // bare `playwright test`. The per-suite npm scripts still pass explicit paths.
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
