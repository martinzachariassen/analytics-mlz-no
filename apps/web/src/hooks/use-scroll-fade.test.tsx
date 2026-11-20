// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useScrollFade } from "@/hooks/use-scroll-fade"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Row() {
  const fade = useScrollFade<HTMLDivElement>()
  return <div data-testid="row" ref={fade.ref} style={fade.style} />
}

function layout(clientWidth: number, scrollWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth
  )
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(
    scrollWidth
  )
}

describe("useScrollFade", () => {
  it("leaves a row that fits alone", () => {
    layout(300, 300)
    render(<Row />)
    expect(screen.getByTestId("row").style.maskImage).toBe("")
  })

  it("fades the end, then both edges, then the start as the row scrolls", () => {
    layout(300, 500)
    render(<Row />)
    const row = screen.getByTestId("row")
    const fade = () => row.style.maskImage.match(/transparent/g)?.length ?? 0
    expect(row.style.maskImage).toMatch(/transparent 100%\)$/)
    expect(fade()).toBe(1)

    act(() => {
      row.scrollLeft = 100
      fireEvent.scroll(row)
    })
    expect(fade()).toBe(2)

    act(() => {
      row.scrollLeft = 200
      fireEvent.scroll(row)
    })
    expect(row.style.maskImage).toMatch(
      /^linear-gradient\(to right, transparent 0/
    )
    expect(fade()).toBe(1)
  })
})
