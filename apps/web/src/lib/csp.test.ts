import { describe, expect, it } from "vitest"

import firebaseJson from "../../firebase.json?raw"
import indexHtml from "../../index.html?raw"

// The theme script in index.html runs before first paint and is allowed by its hash in the
// Content-Security-Policy in firebase.json. Editing the script without updating the hash
// would make production block it (and flash the light theme), so keep them in sync here.
describe("Content-Security-Policy", () => {
  it("allows every inline script in index.html by hash", async () => {
    const headers = (
      JSON.parse(firebaseJson) as {
        hosting: { headers: { headers: { key: string; value: string }[] }[] }
      }
    ).hosting.headers.flatMap((h) => h.headers)
    const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value ?? ""
    const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script))
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
      expect(csp, "update the sha256 in firebase.json").toContain(`'sha256-${hash}'`)
    }
  })
})
