import { useEffect } from "react"
import { Link, useLocation } from "react-router"

import { useScrollFade } from "@/hooks/use-scroll-fade"
import { cn } from "@/lib/utils"

export type NavSection = { id: string; label: string }

/**
 * Anchor links to the sections of a long page: a sticky column on wide screens, a row that
 * scrolls sideways on narrow ones. The router does not scroll to a hash, so this does.
 */
export function SectionNav({
  sections,
  label,
  ready = true,
}: {
  sections: NavSection[]
  label: string
  /** False while the sections are placeholders: scrolling then would land in the wrong place. */
  ready?: boolean
}) {
  const { hash } = useLocation()
  const active =
    sections.find((s) => `#${s.id}` === hash)?.id ?? sections[0]?.id

  const fade = useScrollFade<HTMLUListElement>()

  useEffect(() => {
    if (!hash || !ready) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" })
  }, [hash, ready])

  return (
    <nav
      aria-label={label}
      className="sticky top-12 z-10 -mx-4 min-w-0 border-b bg-bg/85 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-16 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none"
    >
      <ul
        ref={fade.ref}
        style={fade.style}
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto py-2 lg:flex-col lg:py-0"
      >
        {sections.map((s) => (
          <li key={s.id}>
            <Link
              to={{ hash: s.id }}
              replace
              aria-current={s.id === active ? "location" : undefined}
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
                s.id === active && "bg-surface-2 font-medium text-fg"
              )}
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
