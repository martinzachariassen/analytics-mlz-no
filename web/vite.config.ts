import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The Go server runs on :8080 (`make run`). Same-origin /api keeps the session cookie simple,
    // exactly like Firebase Hosting's rewrite in production.
    proxy: { "/api": { target: "http://localhost:8080", xfwd: true } },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
