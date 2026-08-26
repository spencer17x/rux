import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  expect: { timeout: 15_000 },
  use: { trace: "retain-on-failure" },
});
