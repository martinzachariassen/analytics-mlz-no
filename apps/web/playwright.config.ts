import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig, devices } from "@playwright/test"

// End-to-end tests: the real Go server with seeded demo data, and the production build of
// the dashboard served by `vite preview` (which proxies /api like Firebase Hosting does).
// Ports differ from `make dev`, so both can run at once.
const API_PORT = 18080
const WEB_PORT = 4173
const WEB = `http://localhost:${WEB_PORT}`
// The public demo build (dist/demo), which needs no server: it answers /api itself.
const DEMO_PORT = 4174
const DEMO = `http://localhost:${DEMO_PORT}/demo/`
const dir = join(tmpdir(), "analytics-e2e")
const db = join(dir, "e2e.db")
const bin = join(dir, "analytics")

import { SESSION, SESSION_LIGHT } from "./e2e/paths.ts"

const serverEnv = `DATABASE_PATH=${db} PORT=${API_PORT} PUBLIC_URL=${WEB} DEV_LOGIN=1 GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET=`

export default defineConfig({
  testDir: "e2e",
  testIgnore: /demo\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    // Entrance animations would otherwise be caught half-faded by the contrast checks.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    // Sign in once: the auth endpoints are rate limited, so every test signing in would hit 429.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], storageState: SESSION },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: SESSION },
      dependencies: ["setup"],
    },
    {
      name: "light",
      use: { ...devices["Desktop Chrome"], storageState: SESSION_LIGHT },
      dependencies: ["setup"],
    },
    {
      name: "demo",
      testIgnore: [],
      testMatch: /demo\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: DEMO },
    },
    {
      name: "demo-mobile",
      testIgnore: [],
      testMatch: /demo\.spec\.ts/,
      use: { ...devices["Pixel 7"], baseURL: DEMO },
    },
  ],
  webServer: [
    {
      // 60 days of history keeps seeding fast; -reset starts every run from the same data.
      command: `cd ../.. && mkdir -p ${dir} && go build -o ${bin} ./apps/server/cmd/analytics && ${serverEnv} ${bin} seed -reset -days 60 && ${serverEnv} ${bin} serve`,
      url: `http://localhost:${API_PORT}/healthz`,
      // Never test against a leftover server or an old build: a busy port fails the run.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // verify.sh sets E2E_PREBUILT when its web group has just built dist/.
      command: `${process.env.E2E_PREBUILT ? "" : "bun run build && "}API_PROXY=http://localhost:${API_PORT} bunx vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Built by the server above (`bun run build` builds both), or by verify.sh's web group.
      command: `bunx vite preview --mode demo --port ${DEMO_PORT} --strictPort`,
      url: DEMO,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
