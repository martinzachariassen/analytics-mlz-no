import { format, parseISO } from "date-fns"
import { CalendarDays, Check, ChevronDown } from "lucide-react"
import { useEffect, useState } from "react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Kbd } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Compare, Interval } from "@/lib/api"
import { isTyping } from "@/lib/keys"
import {
  formatDay,
  formatRange,
  INTERVALS,
  PERIODS,
  type Period,
} from "@/lib/period"
import type { ScopeState } from "@/lib/use-scope"
import { cn } from "@/lib/utils"

const PRESETS: { value: Period; key: string }[] = [
  { value: "today", key: "T" },
  { value: "yesterday", key: "Y" },
  { value: "7d", key: "7" },
  { value: "30d", key: "3" },
  { value: "month", key: "M" },
  { value: "last_month", key: "L" },
  { value: "12m", key: "A" },
]

/**
 * Single-key shortcuts: periods (t, y, 7, 3, m, l, a) and x to toggle the
 * comparison. Ignored while typing or in a dialog.
 */
export function useScopeShortcuts(sc: ScopeState) {
  const { setPeriod, setCompare, compare } = sc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e)) return
      const k = e.key.toUpperCase()
      if (k === "X") {
        setCompare(compare ? undefined : "previous")
        return
      }
      const p = PRESETS.find((p) => p.key === k)
      if (p) setPeriod(p.value)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPeriod, setCompare, compare])
}

/** Presets on the left, a range calendar on the right. */
export function DateRangePicker({ sc }: { sc: ScopeState }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const label =
    sc.period === "custom" ? formatRange(sc.range) : PERIODS[sc.period]

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o)
          setDraft({ from: parseISO(sc.range.from), to: parseISO(sc.range.to) })
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-medium">
          <CalendarDays className="text-fg-muted" />
          <span className="max-w-48 truncate">{label}</span>
          <ChevronDown className="text-fg-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-auto flex-col p-0 sm:flex-row"
      >
        <div className="flex flex-col gap-px border-b p-1.5 sm:w-48 sm:border-r sm:border-b-0">
          {PRESETS.map((p) => {
            const active = sc.period === p.value
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  sc.setPeriod(p.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-surface-2",
                  active && "font-medium text-fg"
                )}
              >
                <Check
                  className={cn(
                    "size-3.5",
                    active ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="flex-1">{PERIODS[p.value]}</span>
                <Kbd>{p.key}</Kbd>
              </button>
            )
          })}
        </div>
        <div className="flex flex-col p-2">
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.to}
            disabled={{ after: new Date() }}
            weekStartsOn={1}
          />
          <div className="flex items-center justify-between gap-3 border-t px-1 pt-2">
            <span className="tnum text-xs text-fg-muted">
              {draft?.from
                ? `${format(draft.from, "d MMM yyyy")} – ${draft.to ? format(draft.to, "d MMM yyyy") : "…"}`
                : "Pick a start date"}
            </span>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return
                sc.setCustom(
                  formatDay(draft.from),
                  formatDay(draft.to ?? draft.from)
                )
                setOpen(false)
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const COMPARE_LABEL = {
  previous: "Previous period",
  year: "Year over year",
  off: "No comparison",
}

export function CompareSelect({ sc }: { sc: ScopeState }) {
  return (
    <Select
      value={sc.compare ?? "off"}
      onValueChange={(v) =>
        sc.setCompare(v === "off" ? undefined : (v as Compare))
      }
    >
      <SelectTrigger size="sm" aria-label="Compare with" className="gap-2">
        <SelectValue>
          <span className="text-fg-muted max-lg:hidden">vs</span>
          {COMPARE_LABEL[sc.compare ?? "off"]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {(["previous", "year", "off"] as const).map((c) => (
          <SelectItem key={c} value={c}>
            {COMPARE_LABEL[c]}
            {c !== "year" && <Kbd className="ml-auto">X</Kbd>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function IntervalSelect({ sc }: { sc: ScopeState }) {
  if (sc.intervals.length < 2) return null
  return (
    <Select
      value={sc.interval}
      onValueChange={(v) => sc.setInterval(v as Interval)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Interval"
        className="h-7! border-none bg-transparent! text-xs text-fg-secondary shadow-none hover:text-fg"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {sc.intervals.map((i) => (
          <SelectItem key={i} value={i}>
            {INTERVALS[i]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
