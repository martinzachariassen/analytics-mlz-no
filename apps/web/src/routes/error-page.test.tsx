// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ErrorPage } from "@/routes/error-page"

const stale = new TypeError(
  "Failed to fetch dynamically imported module: /assets/report-abc.js"
)
let reload: ReturnType<typeof vi.fn>

let thrown: Error
function Throw(): never {
  throw thrown
}

function renderError(err: Error) {
  thrown = err
  const router = createMemoryRouter([
    { path: "/", element: <Throw />, errorElement: <ErrorPage /> },
  ])
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  sessionStorage.clear()
  reload = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ErrorPage", () => {
  it("reloads once for a stale chunk after a deploy", () => {
    renderError(stale)
    expect(screen.getByText("Updating…")).toBeTruthy()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("offers the buttons when the reload did not help, instead of updating forever", () => {
    renderError(stale)
    cleanup()
    reload.mockClear()
    renderError(stale)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText("Something went wrong")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy()
  })

  it("reloads by itself again for a later deploy in the same tab", () => {
    vi.useFakeTimers({ now: new Date("2026-11-19T10:00:00Z") })
    renderError(stale)
    cleanup()
    vi.setSystemTime(new Date("2026-11-19T11:00:00Z"))
    reload.mockClear()
    renderError(stale)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("shows other errors with their message and does not reload", () => {
    renderError(new Error("boom"))
    expect(screen.getByText("boom")).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })
})
