import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Several integration tests spawn real git and agent subprocesses. The 5s
    // default flakes on loaded machines; heavy cases raise it further locally.
    testTimeout: 15_000,
  },
});
