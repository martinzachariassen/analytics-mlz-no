// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider, useTheme } from "@/components/theme-provider"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** A system colour scheme, dark or light. */
function systemPrefers(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function Probe() {
  const { theme, resolvedTheme, toggleTheme } = useTheme()
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}/{resolvedTheme}
    </button>
  )
}

const html = () => document.documentElement.getAttribute("data-theme")

describe("ThemeProvider", () => {
  it("toggles between dark and light with D, and remembers it", async () => {
    systemPrefers(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByRole("button").textContent).toBe("dark/dark")
    await userEvent.keyboard("d")
    expect(screen.getByRole("button").textContent).toBe("light/light")
    expect(html()).toBe("light")
    expect(localStorage.getItem("theme")).toBe("light")
  })

  it("flips what the system shows when the theme is system", async () => {
    systemPrefers(true)
    localStorage.setItem("theme", "system")
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByRole("button").textContent).toBe("system/dark")
    await userEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("button").textContent).toBe("light/light")
  })

  it("ignores D while typing and with a modifier", async () => {
    systemPrefers(false)
    render(
      <ThemeProvider defaultTheme="light">
        <input aria-label="Search" />
        <Probe />
      </ThemeProvider>
    )
    await userEvent.type(screen.getByLabelText("Search"), "d")
    await userEvent.keyboard("{Meta>}d{/Meta}")
    expect(screen.getByRole("button").textContent).toBe("light/light")
  })

  it("follows a change made in another tab", () => {
    systemPrefers(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "theme",
          newValue: "light",
          storageArea: localStorage,
        })
      )
    })
    expect(screen.getByRole("button").textContent).toBe("light/light")
  })
})
