// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { RealtimePage } from "@/routes/site/realtime"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

describe("RealtimePage", () => {
  it("stops loading and says so when the request fails", async () => {
    mockFetch({
      "/api/sites/abc/realtime": () =>
        new Response(JSON.stringify({ error: "database is busy" }), {
          status: 400,
        }),
    })
    const { container } = renderInSite(() => (
      <TooltipProvider>
        <RealtimePage />
      </TooltipProvider>
    ))
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toContain(
      "database is busy"
    )
    expect(screen.getByText("Not available")).toBeTruthy()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
})
