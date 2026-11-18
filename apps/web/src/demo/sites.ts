// The demo's sites and how they are built into a backend.

import type { Backend, DemoSite } from "./engine"
import { Generator, type Profile } from "./generate"
import { LUMEN, LUMEN_GOALS, STATUS, STATUS_GOALS } from "./lumen"
import type { Table } from "./table"

const DAY = 86_400_000
export const HISTORY_DAYS = 730
/** Visitor ids of live visits start here, far above any in the history. */
export const LIVE_VISITORS = 2_000_000_000

export type Spec = {
  id: string
  name: string
  profile: Profile
  goals: [kind: "event" | "path", value: string][]
  seed: number
}

export const SPECS: Spec[] = [
  { id: "lumen", name: "Lumen", profile: LUMEN, goals: LUMEN_GOALS, seed: 7 },
  {
    id: "lumen-status",
    name: "Lumen Status",
    profile: STATUS,
    goals: STATUS_GOALS,
    seed: 11,
  },
]

/** A backend over tables generated (in SPECS order) for history ending at `now`. */
export function backendFrom(
  tables: Table[],
  now: number,
  days = HISTORY_DAYS
): Backend {
  const b: Backend = {
    sites: [],
    goals: new Map(),
    now: () => Date.now(),
    user: { login: "demo", provider: "demo" },
    nextGoalId: 1,
  }
  SPECS.forEach((spec, i) => {
    const site: DemoSite = {
      id: spec.id,
      name: spec.name,
      domain: spec.profile.hostname,
      createdAt: now - days * DAY,
      table: tables[i]!,
    }
    b.sites.push(site)
    b.goals.set(
      spec.id,
      spec.goals.map(([kind, value]) => ({
        id: b.nextGoalId++,
        kind,
        value,
        createdAt: now - 300 * DAY,
      }))
    )
  })
  // Sites are listed by name, as the server orders them.
  b.sites.sort((x, y) => (x.name < y.name ? -1 : 1))
  return b
}

/** Generates every site's history in this thread (tests, benchmarks). */
export function buildBackend(now: number, days = HISTORY_DAYS, scale = 1) {
  const tables = SPECS.map((spec) =>
    new Generator({
      profile: spec.profile,
      now,
      days,
      seed: spec.seed,
      scale,
    }).run()
  )
  return backendFrom(tables, now, days)
}

/** Generators for the live trickle, one per site, by site id. */
export function liveGenerators(now: number): Map<string, Generator> {
  return new Map(
    SPECS.map((spec) => [
      spec.id,
      new Generator({
        profile: spec.profile,
        now,
        days: 0,
        seed: spec.seed + 1000,
        visitorBase: LIVE_VISITORS,
      }),
    ])
  )
}
