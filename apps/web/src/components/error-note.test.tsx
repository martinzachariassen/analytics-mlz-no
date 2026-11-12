// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, type Mock, vi } from "vitest"

import { ErrorNote, type Retryable } from "@/components/error-note"
import { ApiError } from "@/lib/api"

afterEach(cleanup)

function query(error: Error | null = null) {
  return {
    error,
    isError: error !== null,
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
  it("re-announces and ignores clicks until the retry settles, keeping focus", async () => {
    const q = query(new Error("boom"))
    let settle = () => {}
    q.refetch.mockReturnValue(new Promise<void>((r) => (settle = r)))
    render(<ErrorNote queries={[q]} />)
    const button = screen.getByRole("button", { name: "Try again" })

    await userEvent.click(button)
    expect(screen.getByRole("alert").textContent).toBe("Retrying…")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(document.activeElement).toBe(button)
    await userEvent.click(button)
    expect(q.refetch).toHaveBeenCalledOnce()

    await act(async () => settle())
    expect(screen.getByRole("alert").textContent).toContain("boom")
    expect(button.getAttribute("aria-disabled")).toBe("false")
  })
  it("does not flip to retrying on background refetches", () => {
    const q = query(new Error("boom"))
    const { rerender } = render(<ErrorNote queries={[q]} />)
    rerender(<ErrorNote queries={[{ ...q, isFetching: true } as Retryable]} />)
    expect(screen.getByRole("alert").textContent).toContain("boom")
  })
  it("renders nothing when nothing failed", () => {
    const { container } = render(<ErrorNote queries={[query(), query()]} />)
    expect(container.innerHTML).toBe("")
  })
  it("uses a custom title", () => {
    render(<ErrorNote error="down" title="Could not reach the server" />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not reach the server: down"
    )
  })
})
