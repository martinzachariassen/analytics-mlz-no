// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import {
  DateRangePicker,
  useScopeShortcuts,
} from "@/components/date-range-picker"
import type { ScopeState } from "@/lib/use-scope"
import { renderInSite } from "@/test/render"

afterEach(cleanup)

function WithShortcuts({ sc }: { sc: ScopeState }) {
  useScopeShortcuts(sc)
  return <DateRangePicker sc={sc} />
}

describe("DateRangePicker", () => {
  it("labels the current period and switches presets", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite((sc) => <DateRangePicker sc={sc} />)

    await user.click(await screen.findByRole("button", { name: /Last 7 days/ }))
    await user.click(screen.getByRole("button", { name: /Last 30 days/ }))

    await waitFor(() => expect(search().get("period")).toBe("30d"))
    expect(screen.getByRole("button", { name: /Last 30 days/ })).toBeTruthy()
  })

  it("shows a custom range from the URL", async () => {
    renderInSite(
      (sc) => <DateRangePicker sc={sc} />,
      "/sites/abc?period=custom&from=2026-01-01&to=2026-01-31"
    )
    const trigger = await screen.findByRole("button")
    expect(trigger.textContent).toMatch(/Jan/)
  })

  it("resets the interval and custom dates when picking a preset", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      (sc) => <DateRangePicker sc={sc} />,
      "/sites/abc?period=custom&from=2026-01-01&to=2026-01-31&interval=week"
    )
    await user.click(await screen.findByRole("button"))
    await user.click(screen.getByRole("button", { name: /Yesterday/ }))

    await waitFor(() => expect(search().get("period")).toBe("yesterday"))
    expect(search().get("from")).toBeNull()
    expect(search().get("interval")).toBeNull()
  })
})

describe("useScopeShortcuts", () => {
  it("switches period with a single key and toggles comparison with x", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite((sc) => <WithShortcuts sc={sc} />)
    await screen.findByRole("button")

    await user.keyboard("m")
    await waitFor(() => expect(search().get("period")).toBe("month"))

    await user.keyboard("x")
    await waitFor(() => expect(search().get("compare")).toBe("off"))
    await user.keyboard("x")
    await waitFor(() => expect(search().get("compare")).toBeNull())
  })

  it("ignores keys with modifiers", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite((sc) => <WithShortcuts sc={sc} />)
    await screen.findByRole("button")

    await user.keyboard("{Meta>}m{/Meta}")
    expect(search().get("period")).toBeNull()
  })
})
