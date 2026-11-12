import { Filter as FilterIcon } from "lucide-react"
import { Link } from "react-router"

import { Delta } from "@/components/delta"
import { ErrorNote } from "@/components/error-note"
import { Panel } from "@/components/panel"
import { Skeleton } from "@/components/ui/skeleton"
import type { GoalStat } from "@/lib/api"
import { formatNumber, formatRate } from "@/lib/format"
import { goalFilter, goalLabel } from "@/lib/goals"
import { useGoalStats } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"
import { cn } from "@/lib/utils"

/**
 * Conversions per goal: visitors who reached it, the conversion rate (share of all
 * visitors in the period) and its change. A row filters the dashboard to visits that
 * reached the goal, when a filter can express it.
 */
export function GoalsCard({ className }: { className?: string }) {
  const sc = useScope()
  const q = useGoalStats(sc.siteId, sc.scope)
  const settings = `/sites/${sc.siteId}/settings#goals`

  return (
    <Panel
      title="Goals"
      description="Conversion rate = share of all visitors"
      className={className}
      action={
        q.data && q.data.goals.length > 0 ? (
          <Link
            to={settings}
            className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Manage
          </Link>
        ) : undefined
      }
    >
      {q.isError ? (
        <ErrorNote queries={[q]} className="py-2" />
      ) : !q.data ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      ) : q.data.goals.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center text-xs text-fg-muted">
          <p>No goals yet.</p>
          <p>
            A goal is a custom event or a page, such as a sign-up.{" "}
            <Link to={settings} className="text-accent-deep underline">
              Add a goal
            </Link>
          </p>
        </div>
      ) : (
        <GoalRows goals={q.data.goals} compare={sc.compare !== undefined} />
      )}
    </Panel>
  )
}

function GoalRows({ goals, compare }: { goals: GoalStat[]; compare: boolean }) {
  const sc = useScope()
  const max = Math.max(...goals.map((g) => g.conversion_rate)) || 1
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center justify-between gap-3 px-2 text-[11px] font-medium text-fg-muted">
        <span>Goal</span>
        <span className="flex gap-4">
          <span className="w-16 text-right">Conversions</span>
          <span className="w-14 text-right">Visitors</span>
          <span className="w-14 text-right">Rate</span>
          {compare && <span className="w-14 text-right">Change</span>}
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {goals.map((g) => {
          const filter = goalFilter(g)
          const label = goalLabel(g)
          return (
            <li key={g.id}>
              <button
                type="button"
                disabled={!filter}
                onClick={filter ? () => sc.addFilter(filter) : undefined}
                title={
                  filter
                    ? "Filter by this goal"
                    : "Wildcard paths cannot be used as a filter"
                }
                className={cn(
                  "group relative flex h-7 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-xs transition-colors",
                  filter && "hover:bg-surface-2"
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0.5 left-0 rounded-[5px] bg-violet/14 transition-[width] duration-500"
                  style={{
                    width: `${Math.max((g.conversion_rate / max) * 100, 1)}%`,
                  }}
                />
                <span
                  className={cn(
                    "relative flex min-w-0 items-center gap-1.5 truncate text-fg",
                    g.kind === "path" && "font-mono"
                  )}
                >
                  <span className="truncate">{label}</span>
                  {filter && (
                    <FilterIcon
                      aria-hidden
                      className="hidden size-3 shrink-0 text-fg-muted group-hover:block"
                    />
                  )}
                </span>
                <span className="tnum relative flex shrink-0 gap-4 text-fg-secondary">
                  <span className="w-16 text-right">
                    {formatNumber(g.completions)}
                  </span>
                  <span className="w-14 text-right">
                    {formatNumber(g.visitors)}
                  </span>
                  <span className="w-14 text-right font-medium text-fg">
                    {formatRate(g.conversion_rate)}
                  </span>
                  {compare && (
                    <span className="w-14 text-right">
                      <Delta
                        plain
                        current={g.conversion_rate}
                        previous={g.previous_conversion_rate}
                      />
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
