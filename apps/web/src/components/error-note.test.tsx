// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ErrorNote } from "@/components/error-note"
import { ApiError } from "@/lib/api"

afterEach(cleanup)

describe("ErrorNote", () => {
  it("announces the error message as an alert", () => {
    render(<ErrorNote error={new ApiError(500, "database is locked")} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "database is locked"
    )
  })
  it("renders non-Error values", () => {
    render(<ErrorNote error="boom" />)
    expect(screen.getByRole("alert").textContent).toContain("boom")
  })
  it("offers no retry without onRetry", () => {
    render(<ErrorNote error="boom" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("retries on click, and is disabled while retrying", async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorNote error="boom" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(<ErrorNote error="boom" onRetry={onRetry} retrying />)
    expect(
      (screen.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
})
