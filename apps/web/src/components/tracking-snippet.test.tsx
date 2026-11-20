// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CodeBlock } from "@/components/tracking-snippet"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function clipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
}

describe("CodeBlock", () => {
  it("copies the code", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    clipboard(writeText)
    render(<CodeBlock code="<script></script>" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to clipboard" })
    )
    expect(writeText).toHaveBeenCalledWith("<script></script>")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("selects the code and says so when the clipboard is not available", async () => {
    clipboard(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError"))
    )
    render(<CodeBlock code="<script></script>" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to clipboard" })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(getSelection()?.toString()).toBe("<script></script>")
  })
})
