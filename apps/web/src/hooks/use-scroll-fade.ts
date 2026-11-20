import { type CSSProperties, useEffect, useRef, useState } from "react"

const FADE = "48px"

/**
 * Fades out the edge of a sideways-scrolling row where more is hidden, since the row has no
 * scrollbar to say so. Returns the ref for the scrolling element and the style for it.
 */
export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update)
    observer?.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      observer?.disconnect()
    }
  }, [])

  const style: CSSProperties | undefined =
    edges.start || edges.end
      ? {
          maskImage: `linear-gradient(to right, ${edges.start ? "transparent" : "#000"} 0, #000 ${FADE}, #000 calc(100% - ${FADE}), ${edges.end ? "transparent" : "#000"} 100%)`,
        }
      : undefined

  return { ref, style }
}
