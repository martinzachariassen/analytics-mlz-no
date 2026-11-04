import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keeps test-only code (init().stop) in the tested build; script.js is built with MLZ_TEST=false.
  define: { MLZ_TEST: "true" },
  test: {
    environment: "happy-dom",
  },
});
