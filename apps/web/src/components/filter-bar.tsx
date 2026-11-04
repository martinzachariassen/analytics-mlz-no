import { ArrowLeft, ListFilter, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Filter, FilterDim, FilterOp } from "@/lib/api"
import { DIMS, FILTER_DIMS, formatValue, OPS } from "@/lib/dims"
import { formatNumber } from "@/lib/format"
import { useBreakdown } from "@/lib/queries"
import type { ScopeState } from "@/lib/use-scope"
import { cn } from "@/lib/utils"

/** Active filters as chips, and a button to add one. */
export function FilterBar({ sc }: { sc: ScopeState }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {sc.filters.map((f) => (
        <FilterChip key={`${f.dim}:${f.op}:${f.value}`} f={f} sc={sc} />
      ))}
      <AddFilter sc={sc} compact={sc.filters.length > 0} />
      {sc.filters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-fg-muted"
          onClick={sc.clearFilters}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

function FilterChip({ f, sc }: { f: Filter; sc: ScopeState }) {
  return (
    <span className="inline-flex h-7 max-w-72 items-center gap-1 rounded-md border border-border-strong bg-surface pl-2 text-xs">
      <span className="shrink-0 text-fg-muted">{DIMS[f.dim].label}</span>
      <span className="shrink-0 text-fg-muted">{OPS[f.op]}</span>
      <span className="truncate font-medium text-fg">
        {f.op === "contains" ? `“${f.value}”` : formatValue(f.dim, f.value)}
      </span>
      <button
        type="button"
        aria-label="Remove filter"
        onClick={() => sc.removeFilter(f)}
        className="flex h-full items-center px-1.5 text-fg-muted hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

function AddFilter({ sc, compact }: { sc: ScopeState; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const [dim, setDim] = useState<FilterDim | null>(null)
  const [op, setOp] = useState<FilterOp>("is")

  function close() {
    setOpen(false)
    setDim(null)
    setOp("is")
  }

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1.5 text-xs", !compact && "px-2.5")}
        >
          <ListFilter className="text-fg-muted" />
          {compact ? "" : "Filter"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {dim === null ? (
          <Command>
            <CommandInput placeholder="Filter by…" />
            <CommandList>
              <CommandEmpty>No such dimension</CommandEmpty>
              <CommandGroup>
                {FILTER_DIMS.map((d) => (
                  <CommandItem
                    key={d}
                    value={DIMS[d].label}
                    onSelect={() => setDim(d)}
                  >
                    {DIMS[d].label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <ValueStep
            sc={sc}
            dim={dim}
            op={op}
            setOp={setOp}
            onBack={() => setDim(null)}
            onPick={(value) => {
              sc.addFilter({ dim, op, value })
              close()
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function ValueStep({
  sc,
  dim,
  op,
  setOp,
  onBack,
  onPick,
}: {
  sc: ScopeState
  dim: FilterDim
  op: FilterOp
  setOp: (op: FilterOp) => void
  onBack: () => void
  onPick: (value: string) => void
}) {
  const [search, setSearch] = useState("")
  // Suggestions: the top values in the current period, without this dimension's own filters.
  const scope = {
    ...sc.scope,
    compare: undefined,
    filters: sc.filters.filter((f) => f.dim !== dim),
  }
  const values = useBreakdown(sc.siteId, scope, dim, { limit: 100 })

  return (
    <Command shouldFilter={op !== "contains"}>
      <div className="flex items-center gap-1 border-b p-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <span className="flex-1 truncate text-xs font-medium">
          {DIMS[dim].label}
        </span>
        <div className="flex rounded-md border p-0.5">
          {(Object.keys(OPS) as FilterOp[]).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOp(o)}
              className={cn(
                "rounded-[4px] px-1.5 py-0.5 text-[11px] transition-colors",
                op === o
                  ? "bg-surface-2 font-medium text-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {OPS[o]}
            </button>
          ))}
        </div>
      </div>
      <CommandInput
        placeholder={op === "contains" ? "Text to match…" : "Search values…"}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(e) => {
          if (e.key === "Enter" && op === "contains" && search) onPick(search)
        }}
      />
      <CommandList>
        {op === "contains" ? (
          <CommandGroup>
            <CommandItem
              value={`contains:${search}`}
              disabled={!search}
              onSelect={() => onPick(search)}
            >
              {search ? <>Contains “{search}”</> : "Type some text"}
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>
              {values.isPending ? "Loading…" : "No values in this period"}
            </CommandEmpty>
            <CommandGroup>
              {values.data?.map((r) => (
                <CommandItem
                  key={r.value}
                  value={`${formatValue(dim, r.value)} ${r.value}`}
                  onSelect={() => onPick(r.value)}
                >
                  <span className="flex-1 truncate">
                    {formatValue(dim, r.value)}
                  </span>
                  <span className="tnum text-[11px] text-fg-muted">
                    {formatNumber(r.visitors)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}
