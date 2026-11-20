// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandMenu } from "@/components/command-menu"
import { DateRangePicker } from "@/components/date-range-picker"
import { useScope } from "@/lib/use-scope"
import { renderApp } from "@/test/app"
import { site } from "@/test/fixtures"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function Menu({ onShortcuts = () => {} }: { onShortcuts?: () => void }) {
  const [open, setOpen] = useState(false)
  const sc = useScope()
  return (
    <>
      <DateRangePicker sc={sc} />
      <CommandMenu
        open={open}
        onOpenChange={setOpen}
        onShortcuts={onShortcuts}
      />
    </>
  )
}

const routes = {
  "/api/sites": [
    site(),
    site({ id: "def", name: "Shop", domain: "shop.example" }),
  ],
}

async function openMenu() {
  await userEvent.keyboard("{Meta>}k{/Meta}")
  return screen.findByRole("dialog")
}

describe("CommandMenu", () => {
  it("opens with ⌘K and goes to a view, keeping the scope", async () => {
    const { router } = renderApp(<Menu />, routes, "/sites/abc?period=30d")
    await openMenu()
    await userEvent.click(screen.getByRole("option", { name: "Pages" }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/sites/abc/pages")
    )
    expect(router.state.location.search).toBe("?period=30d")
  })

  it("switches site and period", async () => {
    const { router } = renderApp(<Menu />, routes)
    await openMenu()
    await userEvent.click(await screen.findByRole("option", { name: /Shop/ }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/sites/def")
    )
    await openMenu()
    await userEvent.click(
      screen.getByRole("option", { name: "Last 12 months" })
    )
    await waitFor(() =>
      expect(router.state.location.search).toBe("?period=12m")
    )
  })

  it("offers every comparison but the current one", async () => {
    const { router } = renderApp(<Menu />, routes)
    await openMenu()
    expect(screen.queryByRole("option", { name: /previous period/ })).toBeNull()
    await userEvent.click(
      screen.getByRole("option", { name: "Compare year over year" })
    )
    await waitFor(() =>
      expect(router.state.location.search).toBe("?compare=year")
    )

    await openMenu()
    expect(screen.queryByRole("option", { name: /year over year/ })).toBeNull()
    await userEvent.click(
      screen.getByRole("option", { name: /Turn comparison off/ })
    )
    await waitFor(() =>
      expect(router.state.location.search).toBe("?compare=off")
    )
  })

  it("opens the calendar for a custom range", async () => {
    renderApp(<Menu />, routes)
    await openMenu()
    await userEvent.click(screen.getByRole("option", { name: "Custom range…" }))
    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy()
  })

  it("toggles the theme, also when it follows the system", async () => {
    localStorage.setItem("theme", "system")
    renderApp(<Menu />, routes)
    await openMenu()
    // happy-dom's system scheme is light, so the action offers dark.
    await userEvent.click(screen.getByRole("option", { name: /Dark mode/ }))
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    )
  })

  it("opens the keyboard shortcuts", async () => {
    const onShortcuts = vi.fn()
    renderApp(<Menu onShortcuts={onShortcuts} />, routes)
    await openMenu()
    await userEvent.click(
      screen.getByRole("option", { name: /Keyboard shortcuts/ })
    )
    expect(onShortcuts).toHaveBeenCalled()
  })

  it("clears filters", async () => {
    const { router } = renderApp(<Menu />, routes, "/sites/abc?f=path:is:/a")
    await openMenu()
    await userEvent.click(screen.getByRole("option", { name: "Clear filters" }))
    await waitFor(() => expect(router.state.location.search).toBe(""))
  })
})
