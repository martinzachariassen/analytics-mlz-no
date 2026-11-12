import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ErrorNote } from "@/components/error-note"
import { Panel, TextTabs } from "@/components/panel"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useScope } from "@/lib/use-scope"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** One hue, light to dark: the share of the busiest cell. */
export function ramp(t: number): string {
  if (t <= 0) return "var(--surface-2)"
  const pct = Math.round(12 + Math.min(t, 1) * 88)
  return `color-mix(in oklch, var(--accent) ${pct}%, var(--surface-2))`
}

/** Traffic by weekday and hour, in the browser's time zone. */
export function ActiveHours({ className }: { className?: string }) {
  const sc = useScope()
  const [metric, setMetric] = useState<"visitors" | "pageviews">("visitors")
  const q = useQuery({
    queryKey: ["heatmap", sc.siteId, { ...sc.scope, compare: undefined }],
    queryFn: () => api.heatmap(sc.siteId, sc.scope),
  })
  const grid = q.data?.[metric]
  const max = grid ? Math.max(1, ...grid.flat()) : 1
  const label = metric === "visitors" ? "visitors" : "page views"

  return (
    <Panel
      title="Active hours"
      description="Local time"
      className={className}
      tabs={
        <TextTabs
          label="Metric"
          value={metric}
          onChange={setMetric}
          items={[
            { value: "visitors", label: "Visitors" },
            { value: "pageviews", label: "Page views" },
          ]}
        />
      }
    >
      {q.isError ? (
        <ErrorNote queries={[q]} className="h-52 py-0" />
      ) : !grid ? (
        <Skeleton className="h-52" />
      ) : (
        <div className="flex flex-col gap-3">
          <div
            className="grid gap-[3px]"
            style={{
              gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))",
            }}
          >
            {grid.map((row, d) => (
              <Row key={d} day={DAYS[d]!} row={row} max={max} label={label} />
            ))}
            <span />
            {HOURS.map((h) => (
              <span
                key={h}
                className="tnum pt-1 text-center text-[10px] text-fg-muted"
              >
                {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 text-[11px] text-fg-muted">
            Less
            <span className="flex gap-[3px]">
              {[0.05, 0.25, 0.5, 0.75, 1].map((t) => (
                <span
                  key={t}
                  className="size-3 rounded-[3px]"
                  style={{ background: ramp(t) }}
                />
              ))}
            </span>
            More
          </div>
        </div>
      )}
    </Panel>
  )
}

function Row({
  day,
  row,
  max,
  label,
}: {
  day: string
  row: number[]
  max: number
  label: string
}) {
  return (
    <>
      <span className="flex items-center text-[11px] text-fg-muted">{day}</span>
      {row.map((v, h) => (
        <Tooltip key={h} delayDuration={0}>
          <TooltipTrigger asChild>
            <span
              className="aspect-square min-h-3 rounded-[3px] transition-[outline] hover:outline hover:outline-1 hover:outline-fg/50"
              style={{ background: ramp(v / max) }}
            />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="tnum">
              {day} {String(h).padStart(2, "0")}:00–
              {String(h + 1).padStart(2, "0")}:00 · {formatNumber(v)} {label}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  )
}
