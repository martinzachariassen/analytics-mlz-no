import { describe, expect, it } from "vitest"

import type { Site } from "@/lib/api"
import { IDLE_POLL_MS, WAITING_POLL_MS, waitingPoll } from "@/lib/queries"

const site: Site = {
  id: "abc",
  name: "Blog",
  domain: "blog.example",
  created_at: "2026-11-12T10:00:00Z",
  pixel_enabled: false,
  first_event_at: null,
  last_event_at: null,
}
const at = (iso: string) => Date.parse(iso)

describe("waitingPoll", () => {
  it("polls fast in the first hour after a site was added", () => {
    expect(waitingPoll(site, at("2026-11-12T10:00:30Z"))).toBe(WAITING_POLL_MS)
    expect(waitingPoll(site, at("2026-11-12T10:59:59Z"))).toBe(WAITING_POLL_MS)
  })

  it("backs off to once a minute after that", () => {
    expect(waitingPoll(site, at("2026-11-12T11:00:00Z"))).toBe(IDLE_POLL_MS)
    expect(waitingPoll(site, at("2026-12-01T00:00:00Z"))).toBe(IDLE_POLL_MS)
  })

  it("stops once the site has data", () => {
    const live = {
      ...site,
      first_event_at: "2026-11-12T10:05:00Z",
      last_event_at: "2026-11-12T10:05:00Z",
    }
    expect(waitingPoll(live, at("2026-11-12T10:06:00Z"))).toBe(false)
  })
})
