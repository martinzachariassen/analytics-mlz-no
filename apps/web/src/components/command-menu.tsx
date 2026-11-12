import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  GitCompare,
  Globe,
  LayoutGrid,
  Moon,
  X,
} from "lucide-react"
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"

import { VIEWS } from "@/components/app-sidebar"
import { useTheme } from "@/components/theme-provider"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { api } from "@/lib/api"
import { PERIODS, type Period } from "@/lib/period"
import { useScope } from "@/lib/use-scope"

/** ⌘K: jump to a view or site, change the period, toggle things. */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const navigate = useNavigate()
  const { id } = useParams()
  const sc = useScope()
  const { theme, setTheme } = useTheme()
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })

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
          {id && (
            <CommandItem
              onSelect={run(() =>
                sc.setCompare(sc.compare ? undefined : "previous")
              )}
            >
              <GitCompare />
              {sc.compare
                ? "Turn comparison off"
                : "Compare with previous period"}
              <CommandShortcut>X</CommandShortcut>
            </CommandItem>
          )}
          {sc.filters.length > 0 && (
            <CommandItem onSelect={run(sc.clearFilters)}>
              <X />
              Clear filters
            </CommandItem>
          )}
          <CommandItem
            onSelect={run(() => setTheme(theme === "light" ? "dark" : "light"))}
          >
            <Moon />
            Toggle theme
            <CommandShortcut>D</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
