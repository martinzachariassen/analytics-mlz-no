// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, type Mock, vi } from "vitest"

import { ErrorNote, type Retryable } from "@/components/error-note"
import { ApiError } from "@/lib/api"

afterEach(cleanup)

function query(error: Error | null = null) {
  return {
    error,
    isError: error !== null,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as Retryable & { refetch: Mock }
}

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
  it("offers no retry without queries", () => {
    render(<ErrorNote error="boom" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("shows the first failure and retries every failed query, not the healthy ones", async () => {
    const ok = query()
    const a = query(new Error("first"))
    const b = query(new Error("second"))
    render(<ErrorNote queries={[ok, a, b]} />)
    expect(screen.getByRole("alert").textContent).toContain("first")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(a.refetch).toHaveBeenCalledOnce()
    expect(b.refetch).toHaveBeenCalledOnce()
    expect(ok.refetch).not.toHaveBeenCalled()
  })
  it("is disabled and re-announces while retrying", () => {
    const q = query(new Error("boom"))
    const { rerender } = render(<ErrorNote queries={[q]} />)
    rerender(<ErrorNote queries={[{ ...q, isFetching: true }]} />)
    expect(screen.getByRole("alert").textContent).toBe("Retrying…")
    expect(
      (screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
  it("uses a custom title", () => {
    render(<ErrorNote error="down" title="Could not reach the server" />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not reach the server: down"
    )
  })
})
