import type { Dimension, Filter, Goal, GoalKind } from "@/lib/api"
import { formatValue } from "@/lib/dims"

/** How a goal reads in lists: the event's display name, or the path pattern as typed. */
export function goalLabel(g: Pick<Goal, "kind" | "value">): string {
  return g.kind === "event" ? formatValue("event", g.value) : g.value
}

/**
 * The dashboard filter that narrows to visits that reached the goal, or null for a path
 * with a wildcard, which no filter operator can express.
 */
export function goalFilter(g: Pick<Goal, "kind" | "value">): Filter | null {
  if (g.kind === "event") return { dim: "event", op: "is", value: g.value }
  if (g.value.includes("*")) return null
  return { dim: "path", op: "is", value: g.value }
}

/** The goal kind a breakdown dimension can become, if any. */
export function goalKindFor(dim: Dimension): GoalKind | null {
  if (dim === "event") return "event"
  if (dim === "path" || dim === "entry" || dim === "exit") return "path"
  return null
}
