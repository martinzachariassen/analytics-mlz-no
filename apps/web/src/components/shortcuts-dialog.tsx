import { useEffect } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { isTyping, SHORTCUTS } from "@/lib/keys"

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))]

/** Opens the shortcut help on "?", the way most dashboards do. */
export function useShortcutsKey(open: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e))
        return
      e.preventDefault()
      open()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
}

/** Every keyboard shortcut in one place, so they can be found without hovering. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work anywhere except while typing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g} aria-label={g} className="flex flex-col gap-1">
              <h3 className="eyebrow mb-1">{g}</h3>
              <dl className="flex flex-col gap-1.5">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <dt className="text-fg-secondary">{s.label}</dt>
                    <dd>
                      <KbdGroup>
                        {s.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
