// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PixelSettings } from "@/components/pixel-settings"
import type { Site } from "@/lib/api"
import { mockFetch, renderInSite } from "@/test/render"

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))
afterEach(cleanup)

const site: Site = {
  id: "abc",
  name: "Blog",
  domain: "blog.example",
  created_at: "2026-11-12T10:00:00Z",
  pixel_enabled: false,
  first_event_at: null,
  last_event_at: null,
}

describe("PixelSettings", () => {
  it("hides the snippets while off and sends only pixel_enabled when switched on", async () => {
    let sent: unknown
    mockFetch({
      "/api/sites/abc": (init: RequestInit | undefined) => {
        sent = JSON.parse(String(init?.body))
        return { ...site, pixel_enabled: true }
      },
    })
    renderInSite(() => <PixelSettings site={site} />)
    expect(screen.queryByText(/pixel\.gif/)).toBeNull()

    await userEvent.click(
      screen.getByRole("switch", { name: "Accept events from the pixel" })
    )
    await waitFor(() => expect(sent).toEqual({ pixel_enabled: true }))

    cleanup()
    renderInSite(() => (
      <PixelSettings site={{ ...site, pixel_enabled: true }} />
    ))
    expect(
      screen.getByText(
        /^!\[\]\(http.*\/api\/pixel\.gif\?site=abc&p=%2Freadme\)$/
      )
    ).toBeTruthy()
    expect(screen.getByText(/e=email-open/)).toBeTruthy()
  })
})
