// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

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
})
