import {
  CalendarDays,
  CalendarRange,
  CircleHelp,
  GitCompare,
  Globe,
  LayoutGrid,
  Moon,
  Sun,
  X,
} from "lucide-react"
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"

import { VIEWS } from "@/components/app-sidebar"
import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import type { Compare } from "@/lib/api"
import { PERIODS, type Period } from "@/lib/period"
import { useSites } from "@/lib/queries"
import { openRangePicker, useHasRangePicker, useScope } from "@/lib/use-scope"

const COMPARE_ACTIONS: { value: Compare | undefined; label: string }[] = [
  { value: "previous", label: "Compare with previous period" },
  { value: "year", label: "Compare year over year" },
  { value: undefined, label: "Turn comparison off" },
]

/** ⌘K: jump to a view or site, change the period, toggle things. */
export function CommandMenu({
  open,
  onOpenChange,
  onShortcuts,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onShortcuts: () => void
}) {
  const navigate = useNavigate()
  const { id } = useParams()
  const sc = useScope()
  const { resolvedTheme, toggleTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const sites = useSites()
  const hasRangePicker = useHasRangePicker()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search">
      {/* CommandDialog is only the dialog: cmdk needs its own root inside it. */}
      <Command>
        <CommandInput placeholder="Go to a view, site or period…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {id && (
            <CommandGroup heading="Views">
              {VIEWS.map((v) => (
                <CommandItem
                  key={v.path}
                  onSelect={run(() =>
                    navigate(
                      `/sites/${id}${v.path ? `/${v.path}` : ""}${sc.search}`
                    )
                  )}
                >
                  <v.icon />
                  {v.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {id && (
            <CommandGroup heading="Period">
              {(Object.keys(PERIODS) as Period[]).map((p) => (
                <CommandItem key={p} onSelect={run(() => sc.setPeriod(p))}>
                  <CalendarDays />
                  {PERIODS[p]}
                </CommandItem>
              ))}
              {hasRangePicker && (
                <CommandItem onSelect={run(openRangePicker)}>
                  <CalendarRange />
                  Custom range…
                </CommandItem>
              )}
            </CommandGroup>
          )}
          <CommandGroup heading="Sites">
            {sites.data?.map((s) => (
              <CommandItem
                key={s.id}
                value={`${s.name} ${s.domain}`}
                onSelect={run(() => navigate(`/sites/${s.id}${sc.search}`))}
              >
                <Globe />
                {s.name}
                <span className="text-fg-muted">{s.domain}</span>
              </CommandItem>
            ))}
            <CommandItem onSelect={run(() => navigate("/sites"))}>
              <LayoutGrid />
              All sites
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            {id &&
              COMPARE_ACTIONS.filter((c) => c.value !== sc.compare).map((c) => (
                <CommandItem
                  key={c.label}
                  onSelect={run(() => sc.setCompare(c.value))}
                >
                  <GitCompare />
                  {c.label}
                  {c.value === (sc.compare ? undefined : "previous") && (
                    <CommandShortcut>X</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            {sc.filters.length > 0 && (
              <CommandItem onSelect={run(sc.clearFilters)}>
                <X />
                Clear filters
              </CommandItem>
            )}
            <CommandItem onSelect={run(toggleTheme)}>
              {dark ? <Sun /> : <Moon />}
              {dark ? "Light mode" : "Dark mode"}
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(onShortcuts)}>
              <CircleHelp />
              Keyboard shortcuts
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
