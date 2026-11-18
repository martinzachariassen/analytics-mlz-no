/// <reference types="vitest/config" />
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { configDefaults } from "vitest/config"

// https://vite.dev/config/
// `--mode demo` builds the public demo into dist/demo, served at /demo/: the same app, with
// /api answered in the browser from generated data (src/demo, docs/development/demo.md).
export default defineConfig(({ mode }) => ({
  ...(mode === "demo"
    ? { base: "/demo/", build: { outDir: "dist/demo", emptyOutDir: true } }
    : {}),
  plugins: [react(), tailwindcss()],
  server: {
    // The OAuth callback and PUBLIC_URL name this port; silently moving to 5174 would break sign-in.
    strictPort: true,
    // The Go server runs on :8080 (`make run`). Same-origin /api keeps the session cookie simple,
    // exactly like Firebase Hosting's rewrite in production. API_PROXY points elsewhere.
    proxy: {
      "/api": {
        target: process.env.API_PROXY ?? "http://localhost:8080",
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Component tests opt into a DOM with `// @vitest-environment happy-dom`; e2e/ is Playwright.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
}))
