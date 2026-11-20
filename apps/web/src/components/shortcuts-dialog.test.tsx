// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { ShortcutsDialog, useShortcutsKey } from "@/components/shortcuts-dialog"

afterEach(cleanup)

function Host() {
  const [open, setOpen] = useState(false)
  useShortcutsKey(() => setOpen(true))
  return (
    <>
      <input aria-label="Search" />
      <ShortcutsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

describe("ShortcutsDialog", () => {
  it("opens with ? and lists every shortcut", async () => {
    render(<Host />)
    await userEvent.keyboard("?")
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    })
    expect(dialog.textContent).toContain("Toggle the comparison")
    expect(dialog.textContent).toContain("Last 12 months")
    expect(screen.getByRole("region", { name: "Period" })).toBeTruthy()
  })

  it("does not open while typing", async () => {
    render(<Host />)
    await userEvent.type(screen.getByLabelText("Search"), "?")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
