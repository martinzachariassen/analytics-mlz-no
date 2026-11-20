// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import {
  CompareSelect,
  DateRangePicker,
  IntervalSelect,
  useScopeShortcuts,
} from "@/components/date-range-picker"
import { openRangePicker, type ScopeState } from "@/lib/use-scope"
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

    // A plain shortcut afterwards proves updates have landed before asserting nothing else changed.
    await user.keyboard("{Meta>}m{/Meta}x")
    await waitFor(() => expect(search().get("compare")).toBe("off"))
    expect(search().get("period")).toBeNull()
  })
})

describe("DateRangePicker calendar", () => {
  it("applies a range picked in the calendar", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      (sc) => <DateRangePicker sc={sc} />,
      "/sites/abc?period=custom&from=2026-01-10&to=2026-01-12"
    )
    await user.click(await screen.findByRole("button"))
    // The calendar opens on January 2026; pick the 5th to the 20th.
    await user.click(screen.getByRole("button", { name: /January 5th, 2026/ }))
    await user.click(screen.getByRole("button", { name: /January 20th, 2026/ }))
    await user.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => expect(search().get("period")).toBe("custom"))
    expect(search().get("from")).toBe("2026-01-05")
    expect(search().get("to")).toBe("2026-01-20")
  })

  it("opens from the command menu's custom range event", async () => {
    renderInSite((sc) => <DateRangePicker sc={sc} />)
    await screen.findByRole("button")
    openRangePicker()
    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy()
  })
})

describe("CompareSelect", () => {
  it("switches the comparison and marks only the item x would pick", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite((sc) => <CompareSelect sc={sc} />)

    await user.click(
      await screen.findByRole("combobox", { name: "Compare with" })
    )
    const options = screen.getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      "Previous period",
      "Year over year",
      "No comparisonX",
    ])
    await user.click(screen.getByRole("option", { name: /Year over year/ }))
    await waitFor(() => expect(search().get("compare")).toBe("year"))

    await user.click(screen.getByRole("combobox", { name: "Compare with" }))
    await user.click(screen.getByRole("option", { name: /No comparison/ }))
    await waitFor(() => expect(search().get("compare")).toBe("off"))
    expect(
      screen.getByRole("combobox", { name: "Compare with" }).textContent
    ).toMatch(/No comparison/)
  })
})

describe("IntervalSelect", () => {
  it("offers the intervals the period allows", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      (sc) => <IntervalSelect sc={sc} />,
      "/sites/abc?period=30d"
    )
    await user.click(await screen.findByRole("combobox", { name: "Interval" }))
    await user.click(screen.getByRole("option", { name: "Weekly" }))
    await waitFor(() => expect(search().get("interval")).toBe("week"))
  })

  it("is hidden when only one interval fits", async () => {
    renderInSite(
      (sc) => <IntervalSelect sc={sc} />,
      // Ten days: too long for hours, too short for weeks.
      "/sites/abc?period=custom&from=2026-01-01&to=2026-01-10"
    )
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull())
  })
})
