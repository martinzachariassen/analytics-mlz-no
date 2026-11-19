// The read API of the Go server, reimplemented over the in-memory events table, for the
// static demo build. Every handler mirrors its Go counterpart (internal/api/stats.go,
// export.go, goals.go and internal/store/stats.go, filter.go, goals.go): same parameters,
// same validation messages, same JSON, and the same rules for which rows a metric counts.
// The golden tests (golden.test.ts, internal/api/demo_golden_test.go) hold them together.

import { EVENT, PAGEVIEW, type StringCol, type Table } from "./table"
import {
  addDate,
  date,
  dateOnly,
  parseDate,
  rfc3339,
  validZone,
  wall,
} from "./tz"

// ---------------------------------------------------------------------------- state

export type DemoSite = {
  id: string
  name: string
  domain: string
  createdAt: number
  table: Table
}

export type DemoGoal = {
  id: number
  kind: "event" | "path"
  value: string
  createdAt: number
}

export type Backend = {
  sites: DemoSite[]
  goals: Map<string, DemoGoal[]>
  now: () => number
  user: { login: string; provider: string }
  nextGoalId: number
}

export type Reply = {
  status: number
  body: string
  headers: Record<string, string>
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const json = (status: number, v: unknown): Reply => ({
  status,
  body: `${JSON.stringify(v)}\n`,
  headers: { "Content-Type": "application/json" },
})

// ---------------------------------------------------------------------------- routing

const READ_ONLY = "This is a read-only demo"

/** Answers one request the way the Go server would. */
export function handle(
  b: Backend,
  method: string,
  url: string,
  body?: string
): Reply {
  const u = new URL(url, "http://demo.invalid")
  const path = u.pathname
  try {
    if (path === "/api/auth/config" && method === "GET") {
      return json(200, { providers: ["demo"] })
    }
    if (path === "/api/auth/me" && method === "GET") return json(200, b.user)
    if (path === "/api/auth/logout") {
      throw new HttpError(403, "Signing out is not part of the demo")
    }
    if (path === "/api/sites") {
      if (method === "GET") return json(200, b.sites.map(siteJSON))
      throw new HttpError(403, READ_ONLY)
    }
    const m = /^\/api\/sites\/([^/]+)(?:\/(.*))?$/.exec(path)
    if (!m) throw new HttpError(404, "not found")
    const site = b.sites.find((s) => s.id === decodeURIComponent(m[1]!))
    const rest = m[2] ?? ""
    const q = u.searchParams
    const route = `${method} ${rest}`
    const known = [
      "GET ",
      "PATCH ",
      "DELETE ",
      "GET stats",
      "GET breakdown",
      "GET heatmap",
      "GET realtime",
      "GET export",
      "GET goals",
      "POST goals",
      "GET goals/stats",
    ]
    const goalDelete = method === "DELETE" && /^goals\/[^/]+$/.test(rest)
    if (!known.includes(route) && !goalDelete) {
      throw new HttpError(404, "not found")
    }
    if (!site) throw new HttpError(404, "site not found")
    const now = b.now()
    switch (route) {
      case "GET ":
        return json(200, siteJSON(site))
      case "PATCH ":
      case "DELETE ":
        throw new HttpError(403, READ_ONLY)
      case "GET stats":
        return json(200, stats(site.table, parseQuery(q, now)))
      case "GET breakdown":
        return json(200, breakdownHandler(site.table, q, now))
      case "GET heatmap":
        return json(200, heatmap(site.table, parseQuery(q, now)))
      case "GET realtime":
        return json(200, realtime(site.table, now, q.get("detail") ?? ""))
      case "GET export":
        return exportHandler(site, q, now)
      case "GET goals":
        return json(200, goalsOf(b, site).map(goalJSON))
      case "POST goals":
        return json(201, goalJSON(createGoal(b, site, body)))
      case "GET goals/stats":
        return json(
          200,
          goalStats(site.table, parseQuery(q, now), goalsOf(b, site))
        )
    }
    if (goalDelete) {
      const id = Number(rest.slice("goals/".length))
      const list = goalsOf(b, site)
      const i = list.findIndex((g) => g.id === id)
      if (!Number.isInteger(id) || i < 0) {
        throw new HttpError(404, "goal not found")
      }
      list.splice(i, 1)
      return { status: 204, body: "", headers: {} }
    }
    throw new HttpError(404, "not found")
  } catch (err) {
    if (err instanceof HttpError)
      return json(err.status, { error: err.message })
    throw err
  }
}

function siteJSON(s: DemoSite) {
  const t = s.table
  const iso = (ms: number) => new Date(ms).toISOString()
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    created_at: iso(s.createdAt),
    pixel_enabled: false,
    first_event_at: t.n > 0 ? iso(t.ts[0]!) : null,
    last_event_at: t.n > 0 ? iso(t.ts[t.n - 1]!) : null,
  }
}

// ---------------------------------------------------------------------------- goals

function goalsOf(b: Backend, s: DemoSite): DemoGoal[] {
  let list = b.goals.get(s.id)
  if (!list) {
    list = []
    b.goals.set(s.id, list)
  }
  return list
}

const goalJSON = (g: DemoGoal) => ({
  id: g.id,
  kind: g.kind,
  value: g.value,
  created_at: new Date(g.createdAt).toISOString().replace(".000Z", "Z"),
})

const GOAL_INVALID = "a goal is an event name, or a path starting with /"

function createGoal(b: Backend, s: DemoSite, body = ""): DemoGoal {
  let req: { kind?: unknown; value?: unknown }
  try {
    req = JSON.parse(body) as typeof req
  } catch {
    throw new HttpError(400, "invalid request")
  }
  const kind = req.kind
  let value = typeof req.value === "string" ? req.value.trim() : ""
  if (kind === "event") {
    value = [...value].slice(0, 64).join("")
    if (value === "") throw new HttpError(400, GOAL_INVALID)
  } else if (kind === "path") {
    value = [...value].slice(0, 1024).join("")
    if (!value.startsWith("/")) throw new HttpError(400, GOAL_INVALID)
  } else {
    throw new HttpError(400, GOAL_INVALID)
  }
  const list = goalsOf(b, s)
  if (list.some((g) => g.kind === kind && g.value === value)) {
    throw new HttpError(409, "this goal already exists")
  }
  if (list.length >= 50) {
    throw new HttpError(400, "a site can have at most 50 goals")
  }
  const g: DemoGoal = { id: b.nextGoalId++, kind, value, createdAt: b.now() }
  list.push(g)
  return g
}

// ---------------------------------------------------------------------------- periods

const MAX_RANGE_DAYS = 5 * 366
const MAX_HOURLY_DAYS = 7
const MAX_DAILY_DAYS = 400
const REALTIME_WINDOW = 5 * 60_000
const MAX_BREAKDOWN_LIMIT = 1000
const MAX_FILTERS = 10
const REALTIME_MINUTES = 30
const DAY = 24 * 3600_000

type Interval = "hour" | "day" | "week" | "month"

type Period = {
  from: string
  to: string
  tz: string
  interval: Interval
  start: number
  end: number // exclusive: local midnight after `to`
}

const periodJSON = (p: Period) => ({
  from: p.from,
  to: p.to,
  tz: p.tz,
  interval: p.interval,
})

const dayCount = (p: { start: number; end: number }) =>
  Math.floor((p.end - p.start) / DAY + 0.5)

function parsePeriod(q: URLSearchParams, now: number): Period {
  const tz = q.get("tz") || "UTC"
  if (!validZone(tz)) throw new HttpError(400, `unknown time zone "${tz}"`)
  const from = q.get("from") || dateOnly(now, tz)
  const to = q.get("to") || from
  const f = parseDate(from)
  if (!f) throw new HttpError(400, "from must be YYYY-MM-DD")
  const t = parseDate(to)
  if (!t) throw new HttpError(400, "to must be YYYY-MM-DD")
  const start = date(f.y, f.m, f.d, tz)
  const toStart = date(t.y, t.m, t.d, tz)
  if (toStart < start) throw new HttpError(400, "to must not be before from")
  const end = date(t.y, t.m, t.d + 1, tz)
  const p = { from, to, tz, start, end }
  const days = dayCount(p)
  if (days > MAX_RANGE_DAYS) {
    throw new HttpError(400, `range must be at most ${MAX_RANGE_DAYS} days`)
  }
  let interval = q.get("interval") ?? ""
  switch (interval) {
    case "":
      interval = days <= 2 ? "hour" : days <= 93 ? "day" : "month"
      break
    case "hour":
      if (days > MAX_HOURLY_DAYS) {
        throw new HttpError(
          400,
          `hourly interval supports at most ${MAX_HOURLY_DAYS} days`
        )
      }
      break
    case "day":
      if (days > MAX_DAILY_DAYS) {
        throw new HttpError(
          400,
          `daily interval supports at most ${MAX_DAILY_DAYS} days`
        )
      }
      break
    case "week":
    case "month":
      break
    default:
      throw new HttpError(400, "interval must be hour, day, week or month")
  }
  return { ...p, interval: interval as Interval }
}

/** Bucket boundaries, following local midnight (DST days are 23 or 25 hours). */
function bounds(p: Period): number[] {
  const out = [p.start]
  let t = p.start
  while (t < p.end) {
    const w = wall(t, p.tz)
    switch (p.interval) {
      case "hour":
        t += 3600_000
        break
      case "day":
        t = date(w.y, w.m, w.d + 1, p.tz)
        break
      case "week":
        t = date(w.y, w.m, w.d + (((1 - w.weekday + 6) % 7) + 1), p.tz)
        break
      default:
        t = date(w.y, w.m + 1, 1, p.tz)
    }
    if (t > p.end) t = p.end
    out.push(t)
  }
  return out
}

function comparison(p: Period, mode: string): Period {
  let start: number
  let end: number
  const ws = wall(p.start, p.tz)
  const we = wall(p.end, p.tz)
  if (mode === "year") {
    start = addDate(p.start, p.tz, -1, 0, 0)
    end = addDate(p.end, p.tz, -1, 0, 0)
  } else if (ws.d === 1 && we.d === 1) {
    const months = (we.y - ws.y) * 12 + (we.m - ws.m)
    start = addDate(p.start, p.tz, 0, -months, 0)
    end = p.start
  } else {
    start = addDate(p.start, p.tz, 0, 0, -dayCount(p))
    end = p.start
  }
  return {
    ...p,
    start,
    end,
    from: dateOnly(start, p.tz),
    to: dateOnly(addDate(end, p.tz, 0, 0, -1), p.tz),
  }
}

type FilterSpec = { dim: string; op: string; value: string }

const FILTER_DIMS = [
  "path",
  "hostname",
  "entry",
  "exit",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "country",
  "browser",
  "os",
  "device",
  "event",
]
const FILTER_OPS = ["is", "is_not", "contains"]

function parseFilters(q: URLSearchParams): FilterSpec[] {
  const out: FilterSpec[] = []
  for (const raw of q.getAll("f")) {
    const a = raw.indexOf(":")
    const b = a < 0 ? -1 : raw.indexOf(":", a + 1)
    if (a < 0 || b < 0) {
      throw new HttpError(400, `filter ${goQuote(raw)} must be dim:op:value`)
    }
    out.push({
      dim: raw.slice(0, a),
      op: raw.slice(a + 1, b),
      value: raw.slice(b + 1),
    })
  }
  if (out.length > MAX_FILTERS) {
    throw new HttpError(400, `at most ${MAX_FILTERS} filters`)
  }
  for (const f of out) {
    if (!FILTER_DIMS.includes(f.dim)) {
      throw new HttpError(400, `unknown filter dimension ${goQuote(f.dim)}`)
    }
    if (!FILTER_OPS.includes(f.op)) {
      throw new HttpError(400, `unknown filter operator ${goQuote(f.op)}`)
    }
  }
  return out
}

/** Go's %q for the plain strings these messages quote. */
const goQuote = (s: string) => JSON.stringify(s)

type Query = Period & { filters: FilterSpec[]; compare: string }

function parseQuery(q: URLSearchParams, now: number): Query {
  const p = parsePeriod(q, now)
  const filters = parseFilters(q)
  const compare = q.get("compare") ?? ""
  if (compare !== "" && compare !== "previous" && compare !== "year") {
    throw new HttpError(400, "compare must be previous or year")
  }
  return { ...p, filters, compare }
}

// ---------------------------------------------------------------------------- scope

/** SQLite's LIKE: case-insensitive for ASCII letters only. */
const asciiLower = (s: string) =>
  s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))

function cond(op: string, value: string): (v: string) => boolean {
  switch (op) {
    case "is_not":
      return (v) => v !== value
    case "contains": {
      const needle = asciiLower(value)
      return (v) => asciiLower(v).includes(needle)
    }
    default:
      return (v) => v === value
  }
}

const VISITOR_DIMS: Record<string, StringCol> = {
  country: "country",
  browser: "browser",
  os: "os",
  device: "device",
}
const PAGE_DIMS: Record<string, StringCol> = {
  path: "path",
  hostname: "hostname",
}
const VISIT_DIMS: Record<string, StringCol> = {
  entry: "path",
  exit: "path",
  referrer: "referrer",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
}

/** Per dictionary id: does the value match? */
function matchIds(t: Table, col: StringCol, pred: (v: string) => boolean) {
  return Uint8Array.from(t.dicts[col].values, (v) => (pred(v) ? 1 : 0))
}

type SessionCond = { mark: Uint8Array; keep: boolean; visitsOnly: boolean }

/**
 * The rows a query looks at: one range, narrowed by filters (store's scope.rows). With
 * visits=false page filters apply to each page view; with visits=true they select whole
 * visits.
 */
class Scope {
  readonly lo: number
  readonly hi: number
  private readonly visitor: { col: Uint16Array; match: Uint8Array }[] = []
  private readonly page: { col: Uint16Array; match: Uint8Array }[] = []
  private readonly sessions: SessionCond[] = []

  readonly t: Table

  constructor(t: Table, from: number, to: number, filters: FilterSpec[]) {
    this.t = t
    this.lo = t.lowerBound(from)
    this.hi = t.lowerBound(to)
    for (const f of filters) {
      const vc = VISITOR_DIMS[f.dim]
      const pc = PAGE_DIMS[f.dim]
      const sc = VISIT_DIMS[f.dim]
      if (vc) {
        this.visitor.push({
          col: t.cols[vc],
          match: matchIds(t, vc, cond(f.op, f.value)),
        })
      } else if (pc || f.dim === "event") {
        const col: StringCol = pc ?? "name"
        const typ = pc ? PAGEVIEW : EVENT
        // "is not" means visits that contain no match.
        const keep = f.op !== "is_not"
        const match = matchIds(t, col, cond(keep ? f.op : "is", f.value))
        const mark = new Uint8Array(t.sessions)
        const c = t.cols[col]
        for (let i = this.lo; i < this.hi; i++) {
          if (t.type[i] === typ && match[c[i]!]) mark[t.session[i]!] = 1
        }
        this.sessions.push({ mark, keep, visitsOnly: !!pc })
        if (pc) {
          this.page.push({
            col: t.cols[pc],
            match: matchIds(t, pc, cond(f.op, f.value)),
          })
        }
      } else if (sc) {
        // The visit's first (for exit, last) page view in range carries the value.
        const match = matchIds(t, sc, cond(f.op, f.value))
        const mark = new Uint8Array(t.sessions)
        const seen = new Uint8Array(t.sessions)
        const c = t.cols[sc]
        if (f.dim === "exit") {
          for (let i = this.hi - 1; i >= this.lo; i--) {
            const s = t.session[i]!
            if (t.type[i] !== PAGEVIEW || seen[s]) continue
            seen[s] = 1
            mark[s] = match[c[i]!]!
          }
        } else {
          for (let i = this.lo; i < this.hi; i++) {
            const s = t.session[i]!
            if (t.type[i] !== PAGEVIEW || seen[s]) continue
            seen[s] = 1
            mark[s] = match[c[i]!]!
          }
        }
        this.sessions.push({ mark, keep: true, visitsOnly: false })
      }
    }
  }

  ok(i: number, visits: boolean): boolean {
    const t = this.t
    for (const v of this.visitor) if (!v.match[v.col[i]!]) return false
    if (!visits) {
      for (const p of this.page) {
        if (t.type[i] !== PAGEVIEW || !p.match[p.col[i]!]) return false
      }
    }
    for (const s of this.sessions) {
      if (s.visitsOnly && !visits) continue
      if ((s.mark[t.session[i]!] === 1) !== s.keep) return false
    }
    return true
  }
}

// Scratch space reused between queries: per session and per visitor, stamped with an
// epoch instead of cleared.
let epoch = 0
let sStamp = new Uint32Array(0)
let sMin = new Float64Array(0)
let sMax = new Float64Array(0)
let sPv = new Uint32Array(0)
let sFirstPv = new Int32Array(0)
let sLastPv = new Int32Array(0)
let vStamp = new Uint32Array(0)

function scratch(t: Table) {
  if (sStamp.length < t.sessions) {
    const n = Math.max(t.sessions, sStamp.length * 2, 1024)
    sStamp = new Uint32Array(n)
    sMin = new Float64Array(n)
    sMax = new Float64Array(n)
    sPv = new Uint32Array(n)
    sFirstPv = new Int32Array(n)
    sLastPv = new Int32Array(n)
  }
  if (vStamp.length < t.visitors) {
    vStamp = new Uint32Array(Math.max(t.visitors, vStamp.length * 2, 1024))
  }
  epoch++
  if (epoch === 0xffffffff) {
    sStamp.fill(0)
    vStamp.fill(0)
    epoch = 1
  }
  return epoch
}

type Visits = {
  ids: number[] // sessions in order of their first row
  min: Float64Array
  max: Float64Array
  pv: Uint32Array
  firstPv: Int32Array
  lastPv: Int32Array
}

/** One entry per visit over the visit-level rows (visitsSQL, plus first and last page view). */
function visits(sc: Scope): Visits {
  const t = sc.t
  const e = scratch(t)
  const ids: number[] = []
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, true)) continue
    const s = t.session[i]!
    if (sStamp[s] !== e) {
      sStamp[s] = e
      ids.push(s)
      sMin[s] = t.ts[i]!
      sPv[s] = 0
      sFirstPv[s] = -1
      sLastPv[s] = -1
    }
    sMax[s] = t.ts[i]!
    if (t.type[i] === PAGEVIEW) {
      sPv[s]!++
      if (sFirstPv[s] === -1) sFirstPv[s] = i
      sLastPv[s] = i
    }
  }
  return {
    ids,
    min: sMin,
    max: sMax,
    pv: sPv,
    firstPv: sFirstPv,
    lastPv: sLastPv,
  }
}

// ---------------------------------------------------------------------------- stats

type Summary = {
  pageviews: number
  visitors: number
  visits: number
  bounce_rate: number
  avg_duration: number
}

function summary(sc: Scope): Summary {
  const t = sc.t
  let pageviews = 0
  let visitors = 0
  const e = scratch(t)
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, false)) continue
    if (t.type[i] === PAGEVIEW) pageviews++
    const v = t.visitor[i]!
    if (vStamp[v] !== e) {
      vStamp[v] = e
      visitors++
    }
  }
  const vs = visits(sc)
  let bounces = 0
  let dur = 0
  for (const s of vs.ids) {
    if (vs.pv[s]! <= 1) bounces++
    dur += vs.max[s]! - vs.min[s]!
  }
  const n = vs.ids.length
  return {
    pageviews,
    visitors,
    visits: n,
    bounce_rate: n > 0 ? bounces / n : 0,
    avg_duration: n > 0 ? dur / n / 1000 : 0,
  }
}

type Bucket = { start: number } & Summary

function timeseries(t: Table, b: number[], filters: FilterSpec[]): Bucket[] {
  if (b.length < 2) return []
  const n = b.length - 1
  const out: Bucket[] = b.slice(0, n).map((start) => ({
    start,
    pageviews: 0,
    visitors: 0,
    visits: 0,
    bounce_rate: 0,
    avg_duration: 0,
  }))
  const sc = new Scope(t, b[0]!, b[n]!, filters)
  let k = 0
  let e = scratch(t)
  for (let i = sc.lo; i < sc.hi; i++) {
    const ts = t.ts[i]!
    if (ts >= b[k + 1]!) {
      while (ts >= b[k + 1]!) k++
      e = scratch(t)
    }
    if (!sc.ok(i, false)) continue
    const o = out[k]!
    if (t.type[i] === PAGEVIEW) o.pageviews++
    const v = t.visitor[i]!
    if (vStamp[v] !== e) {
      vStamp[v] = e
      o.visitors++
    }
  }
  const vs = visits(sc)
  const bounces = new Array<number>(n).fill(0)
  const dur = new Array<number>(n).fill(0)
  let j = 0
  for (const s of vs.ids) {
    const start = vs.min[s]!
    while (j < n && b[j + 1]! <= start) j++
    if (j === n) break
    out[j]!.visits++
    dur[j]! += vs.max[s]! - start
    if (vs.pv[s]! <= 1) bounces[j]!++
  }
  for (let i = 0; i < n; i++) {
    const o = out[i]!
    if (o.visits > 0) {
      o.bounce_rate = bounces[i]! / o.visits
      o.avg_duration = dur[i]! / o.visits / 1000
    }
  }
  return out
}

const bucketJSON = (bk: Bucket | null, tz: string) => ({
  t: bk ? rfc3339(bk.start, tz) : "0001-01-01T00:00:00Z",
  pageviews: bk?.pageviews ?? 0,
  visitors: bk?.visitors ?? 0,
  visits: bk?.visits ?? 0,
  bounce_rate: bk?.bounce_rate ?? 0,
  avg_duration: bk?.avg_duration ?? 0,
})

function series(t: Table, q: Query) {
  const cur = timeseries(t, bounds(q), q.filters)
  if (q.compare === "") return { cur, prev: null }
  const raw = timeseries(t, bounds(comparison(q, q.compare)), q.filters)
  return { cur, prev: cur.map((_, i) => raw[i] ?? null) }
}

function stats(t: Table, q: Query) {
  const cmp = comparison(q, q.compare)
  const { cur, prev } = series(t, q)
  return {
    period: periodJSON(q),
    summary: summary(new Scope(t, q.start, q.end, q.filters)),
    previous: summary(new Scope(t, cmp.start, cmp.end, q.filters)),
    timeseries: cur.map((bk) => bucketJSON(bk, q.tz)),
    ...(prev
      ? {
          previous_timeseries: prev.map((bk) => bucketJSON(bk, q.tz)),
          compare: periodJSON(cmp),
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------- breakdowns

const DIMENSIONS = [
  "path",
  "entry",
  "exit",
  "hostname",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "country",
  "browser",
  "os",
  "device",
  "event",
  "prop_key",
  "prop",
]

type Row = {
  value: string
  visitors: number
  count: number
  visits?: number
  bounce_rate?: number
  avg_duration?: number
  previous_visitors?: number
}

type BreakdownReq = {
  dim: string
  event: string
  key: string
  limit: number
  values?: Set<string>
}

class Groups {
  private readonly m = new Map<string, { vis: Set<number>; count: number }>()
  add(value: string, visitor: number, count = 1) {
    let g = this.m.get(value)
    if (!g) {
      g = { vis: new Set(), count: 0 }
      this.m.set(value, g)
    }
    g.vis.add(visitor)
    g.count += count
  }
  rows(): Row[] {
    return [...this.m].map(([value, g]) => ({
      value,
      visitors: g.vis.size,
      count: g.count,
    }))
  }
}

function breakdown(sc: Scope, req: BreakdownReq): Row[] {
  const t = sc.t
  const g = new Groups()
  const dim = req.dim
  if (dim === "path" || dim === "hostname") {
    for (let i = sc.lo; i < sc.hi; i++) {
      if (t.type[i] === PAGEVIEW && sc.ok(i, false)) {
        g.add(t.str(dim, i), t.visitor[i]!)
      }
    }
  } else if (VISIT_DIMS[dim]) {
    const col = VISIT_DIMS[dim]!
    const vs = visits(sc)
    for (const s of vs.ids) {
      const row = dim === "exit" ? vs.lastPv[s]! : vs.firstPv[s]!
      if (row >= 0) g.add(t.str(col, row), t.visitor[row]!)
    }
  } else if (VISITOR_DIMS[dim]) {
    const col = VISITOR_DIMS[dim]!
    const sessions = new Map<string, Set<number>>()
    for (let i = sc.lo; i < sc.hi; i++) {
      if (!sc.ok(i, true)) continue
      const v = t.str(col, i)
      g.add(v, t.visitor[i]!, 0)
      let ss = sessions.get(v)
      if (!ss) {
        ss = new Set()
        sessions.set(v, ss)
      }
      ss.add(t.session[i]!)
    }
    const rows = g.rows()
    for (const r of rows) r.count = sessions.get(r.value)!.size
    return finish(rows, req)
  } else if (dim === "event") {
    for (let i = sc.lo; i < sc.hi; i++) {
      if (t.type[i] === EVENT && sc.ok(i, true)) {
        g.add(t.str("name", i), t.visitor[i]!)
      }
    }
  } else {
    const name = t.dicts.name.find(req.event)
    const key = t.propKeys.find(req.key)
    for (let i = sc.lo; i < sc.hi; i++) {
      if (t.type[i] !== EVENT || t.cols.name[i] !== name || !sc.ok(i, true)) {
        continue
      }
      const end = t.propStart[i]! + t.propCount[i]!
      for (let p = t.propStart[i]!; p < end; p++) {
        if (dim === "prop_key") {
          g.add(t.propKeys.values[t.propKey[p]!]!, t.visitor[i]!)
        } else if (t.propKey[p] === key) {
          g.add(t.propValues.values[t.propValue[p]!]!, t.visitor[i]!)
        }
      }
    }
  }
  return finish(g.rows(), req)
}

/** ORDER BY visitors DESC, count DESC, value LIMIT n (SQLite compares bytes; ASCII here). */
function finish(rows: Row[], req: BreakdownReq): Row[] {
  const kept = req.values ? rows.filter((r) => req.values!.has(r.value)) : rows
  kept.sort(
    (a, b) =>
      b.visitors - a.visitors ||
      b.count - a.count ||
      (a.value < b.value ? -1 : a.value > b.value ? 1 : 0)
  )
  // As store.Breakdown: no limit means 10, and one row past the API's maximum is allowed,
  // because the export asks for limit + 1 to detect truncation.
  const limit =
    req.limit <= 0 ? 10 : Math.min(req.limit, MAX_BREAKDOWN_LIMIT + 1)
  return kept.slice(0, limit)
}

/** Visits, bounce rate and duration of the visits that include each row's value. */
function visitMetrics(sc: Scope, dim: string, rows: Row[]) {
  if (rows.length === 0 || dim === "prop" || dim === "prop_key") return
  const t = sc.t
  const vs = visits(sc)
  const byValue = new Map(rows.map((r) => [r.value, r]))
  for (const r of rows) {
    r.visits = 0
    r.bounce_rate = 0
    r.avg_duration = 0
  }
  const acc = new Map<string, { n: number; bounces: number; dur: number }>()
  const pairs = new Set<string>()
  const col: StringCol | undefined =
    PAGE_DIMS[dim] ??
    VISIT_DIMS[dim] ??
    VISITOR_DIMS[dim] ??
    (dim === "event" ? "name" : undefined)
  if (!col) return
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, true)) continue
    const s = t.session[i]!
    let keep: boolean
    if (PAGE_DIMS[dim]) keep = t.type[i] === PAGEVIEW
    else if (VISIT_DIMS[dim]) {
      const edge = dim === "exit" ? vs.lastPv[s]! : vs.firstPv[s]!
      keep = t.type[i] === PAGEVIEW && edge >= 0 && t.ts[i] === t.ts[edge]
    } else if (dim === "event") keep = t.type[i] === EVENT
    else keep = true
    if (!keep) continue
    const value = t.str(col, i)
    if (!byValue.has(value)) continue
    const pair = `${s}\u0000${value}`
    if (pairs.has(pair)) continue
    pairs.add(pair)
    let a = acc.get(value)
    if (!a) {
      a = { n: 0, bounces: 0, dur: 0 }
      acc.set(value, a)
    }
    a.n++
    if (vs.pv[s]! <= 1) a.bounces++
    a.dur += vs.max[s]! - vs.min[s]!
  }
  for (const [value, a] of acc) {
    const r = byValue.get(value)!
    r.visits = a.n
    r.bounce_rate = a.n > 0 ? a.bounces / a.n : 0
    r.avg_duration = a.dur / a.n / 1000
  }
}

function parseBreakdown(
  q: URLSearchParams,
  defaultLimit: number
): BreakdownReq {
  const dim = q.get("dim") ?? ""
  if (!DIMENSIONS.includes(dim)) throw new HttpError(400, "unknown dim")
  const event = q.get("event") ?? ""
  const key = q.get("key") ?? ""
  if (dim === "prop" && (event === "" || key === "")) {
    throw new HttpError(400, "dim=prop requires event and key")
  }
  if (dim === "prop_key" && event === "") {
    throw new HttpError(400, "dim=prop_key requires event")
  }
  let limit = defaultLimit
  const l = q.get("limit")
  if (l !== null && l !== "") {
    const n = /^[+-]?\d+$/.test(l) ? Number(l) : Number.NaN
    if (!Number.isInteger(n) || n < 1 || n > MAX_BREAKDOWN_LIMIT) {
      throw new HttpError(400, `limit must be 1-${MAX_BREAKDOWN_LIMIT}`)
    }
    limit = n
  }
  return { dim, event, key, limit }
}

function breakdownRows(t: Table, q: Query, req: BreakdownReq, full: boolean) {
  const sc = new Scope(t, q.start, q.end, q.filters)
  const rows = breakdown(sc, req)
  if (full) visitMetrics(sc, req.dim, rows)
  if (q.compare !== "" && rows.length > 0) {
    const cmp = comparison(q, q.compare)
    const prev = breakdown(new Scope(t, cmp.start, cmp.end, q.filters), {
      ...req,
      limit: rows.length,
      values: new Set(rows.map((r) => r.value)),
    })
    const byValue = new Map(prev.map((p) => [p.value, p.visitors]))
    for (const r of rows) r.previous_visitors = byValue.get(r.value) ?? 0
  }
  return rows
}

function breakdownHandler(t: Table, q: URLSearchParams, now: number) {
  const query = parseQuery(q, now)
  const req = parseBreakdown(q, 10)
  const m = q.get("metrics") ?? ""
  if (m !== "" && m !== "full") throw new HttpError(400, "metrics must be full")
  return breakdownRows(t, query, req, m === "full").map(rowJSON)
}

/** Key order as encoding/json writes BreakdownRow, omitting unset optional fields. */
const rowJSON = (r: Row) => ({
  value: r.value,
  visitors: r.visitors,
  count: r.count,
  ...(r.visits !== undefined
    ? {
        visits: r.visits,
        bounce_rate: r.bounce_rate,
        avg_duration: r.avg_duration,
      }
    : {}),
  ...(r.previous_visitors !== undefined
    ? { previous_visitors: r.previous_visitors }
    : {}),
})

// ---------------------------------------------------------------------------- heatmap, realtime

/** Visitors (distinct per step) and page views in fixed steps from `from`. */
function histogram(sc: Scope, from: number, step: number) {
  const t = sc.t
  const out: { start: number; visitors: number; pageviews: number }[] = []
  let cur = -1
  let e = 0
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, false)) continue
    const k = Math.floor((t.ts[i]! - from) / step)
    if (k !== cur) {
      cur = k
      e = scratch(t)
      out.push({ start: from + k * step, visitors: 0, pageviews: 0 })
    }
    const o = out[out.length - 1]!
    if (t.type[i] === PAGEVIEW) o.pageviews++
    const v = t.visitor[i]!
    if (vStamp[v] !== e) {
      vStamp[v] = e
      o.visitors++
    }
  }
  return out
}

function heatmap(t: Table, q: Query) {
  const grid = () =>
    Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const visitors = grid()
  const pageviews = grid()
  const sc = new Scope(t, q.start, q.end, q.filters)
  for (const c of histogram(sc, q.start, 3600_000)) {
    const w = wall(c.start, q.tz)
    const d = (w.weekday + 6) % 7
    visitors[d]![w.h]! += c.visitors
    pageviews[d]![w.h]! += c.pageviews
  }
  return { visitors, pageviews }
}

function realtime(t: Table, now: number, detail: string) {
  const since = now - REALTIME_WINDOW
  const e = scratch(t)
  let visitors = 0
  for (let i = t.lowerBound(since); i < t.n; i++) {
    const v = t.visitor[i]!
    if (vStamp[v] !== e) {
      vStamp[v] = e
      visitors++
    }
  }
  // Go encodes the unset slices as null.
  if (detail === "") {
    return {
      visitors,
      minutes: null,
      pages: null,
      referrers: null,
      countries: null,
    }
  }
  const end = Math.floor(now / 60_000) * 60_000 + 60_000
  const from = end - REALTIME_MINUTES * 60_000
  const sc = new Scope(t, from, end, [])
  const minutes = Array.from({ length: REALTIME_MINUTES }, (_, i) => ({
    t: rfc3339(from + i * 60_000, "UTC"),
    visitors: 0,
    pageviews: 0,
  }))
  for (const c of histogram(sc, from, 60_000)) {
    const i = Math.floor((c.start - from) / 60_000)
    if (i >= 0 && i < REALTIME_MINUTES) {
      minutes[i]!.visitors = c.visitors
      minutes[i]!.pageviews = c.pageviews
    }
  }
  const top = (dim: string) =>
    breakdown(sc, { dim, event: "", key: "", limit: 10 }).map(rowJSON)
  return {
    visitors,
    minutes,
    pages: top("path"),
    referrers: top("referrer"),
    countries: top("country"),
  }
}

// ---------------------------------------------------------------------------- goal stats

function goalMatcher(t: Table, g: DemoGoal): (i: number) => boolean {
  if (g.kind === "event") {
    const id = t.dicts.name.find(g.value)
    return (i) => t.type[i] === EVENT && t.cols.name[i] === id
  }
  let match: Uint8Array
  if (g.value.includes("*")) {
    const re = new RegExp(
      `^${g.value
        .split("*")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[\\s\\S]*")}$`
    )
    match = matchIds(t, "path", (v) => re.test(v))
  } else {
    match = matchIds(t, "path", (v) => v === g.value)
  }
  return (i) => t.type[i] === PAGEVIEW && match[t.cols.path[i]!] === 1
}

function goalCounts(
  t: Table,
  from: number,
  to: number,
  q: Query,
  goals: DemoGoal[]
) {
  const sc = new Scope(t, from, to, q.filters)
  const e = scratch(t)
  let visitors = 0
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, false)) continue
    const v = t.visitor[i]!
    if (vStamp[v] !== e) {
      vStamp[v] = e
      visitors++
    }
  }
  const matchers = goals.map((g) => goalMatcher(t, g))
  const res = goals.map(() => ({ vis: new Set<number>(), completions: 0 }))
  for (let i = sc.lo; i < sc.hi; i++) {
    if (!sc.ok(i, true)) continue
    for (let k = 0; k < matchers.length; k++) {
      if (matchers[k]!(i)) {
        res[k]!.vis.add(t.visitor[i]!)
        res[k]!.completions++
      }
    }
  }
  return { visitors, goals: res }
}

function goalStats(t: Table, q: Query, goals: DemoGoal[]) {
  const cmp = comparison(q, q.compare)
  const base = {
    period: periodJSON(q),
    visitors: 0,
    previous_visitors: 0,
    goals: [] as unknown[],
    ...(q.compare !== "" ? { compare: periodJSON(cmp) } : {}),
  }
  if (goals.length === 0) return base
  const cur = goalCounts(t, q.start, q.end, q, goals)
  const prev = goalCounts(t, cmp.start, cmp.end, q, goals)
  const rate = (n: number, of: number) => (of === 0 ? 0 : n / of)
  const { compare, ...rest } = base as typeof base & { compare?: unknown }
  return {
    ...rest,
    visitors: cur.visitors,
    previous_visitors: prev.visitors,
    goals: goals.map((g, i) => ({
      ...goalJSON(g),
      visitors: cur.goals[i]!.vis.size,
      completions: cur.goals[i]!.completions,
      conversion_rate: rate(cur.goals[i]!.vis.size, cur.visitors),
      previous_visitors: prev.goals[i]!.vis.size,
      previous_conversion_rate: rate(prev.goals[i]!.vis.size, prev.visitors),
    })),
    ...(compare !== undefined ? { compare } : {}),
  }
}

// ---------------------------------------------------------------------------- export

const COUNT_COLUMN: Record<string, string> = {
  path: "pageviews",
  hostname: "pageviews",
  event: "events",
  prop: "events",
  prop_key: "events",
}

/** A spreadsheet formula guard, as export.go's cell(). */
function cell(s: string): string {
  if (s === "" || !"=+-@\t\r".includes(s[0]!)) return s
  if (isGoFloat(s) && !/[xXpPiInN_]/.test(s)) return s
  return `'${s}`
}

/** strconv.ParseFloat accepts it (decimal forms; the excluded letters cover the rest). */
const isGoFloat = (s: string) =>
  /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)

const ratio = (f: number) => f.toFixed(4)
const seconds = (f: number) => f.toFixed(1)

/** unicode.IsSpace for the first character, as encoding/csv checks it. */
function leadingSpace(f: string): boolean {
  const c = f.codePointAt(0)!
  if (c === 0x85 || c === 0xa0) return true
  return c !== 0xfeff && /^\s/u.test(f)
}

/** encoding/csv's Writer: quote only when needed, \n line endings. */
function csvLine(rec: string[]): string {
  return rec
    .map((f) => {
      const needs =
        f !== "" && (f === "\\." || /[",\r\n]/.test(f) || leadingSpace(f))
      return needs ? `"${f.replaceAll('"', '""')}"` : f
    })
    .join(",")
}

function exportHandler(site: DemoSite, q: URLSearchParams, now: number): Reply {
  const format = q.get("format") ?? ""
  if (format !== "" && format !== "csv") {
    throw new HttpError(400, "format must be csv")
  }
  const query = parseQuery(q, now)
  const t = site.table
  let name: string
  let records: string[][]
  let truncated = false
  const what = q.get("what") ?? ""
  if (what === "breakdown") {
    const req = parseBreakdown(q, MAX_BREAKDOWN_LIMIT)
    const full = req.dim !== "prop" && req.dim !== "prop_key"
    const limit = req.limit
    let rows = breakdownRows(t, query, { ...req, limit: limit + 1 }, full)
    if (rows.length > limit) {
      rows = rows.slice(0, limit)
      truncated = true
    }
    const compare = query.compare !== ""
    const count = COUNT_COLUMN[req.dim] ?? ""
    const header = [req.dim, "visitors"]
    if (count) header.push(count)
    if (full) header.push("visits", "bounce_rate", "avg_duration_seconds")
    if (compare) header.push("previous_visitors")
    records = [header]
    for (const r of rows) {
      const rec = [cell(r.value), String(r.visitors)]
      if (count) rec.push(String(r.count))
      if (full) {
        rec.push(
          String(r.visits ?? 0),
          ratio(r.bounce_rate ?? 0),
          seconds(r.avg_duration ?? 0)
        )
      }
      if (compare) rec.push(String(r.previous_visitors ?? 0))
      records.push(rec)
    }
    name = req.dim
  } else if (what === "timeseries") {
    const { cur, prev } = series(t, query)
    const header = [
      "start",
      "pageviews",
      "visitors",
      "visits",
      "bounce_rate",
      "avg_duration_seconds",
    ]
    if (prev) {
      header.push(
        "previous_start",
        "previous_pageviews",
        "previous_visitors",
        "previous_visits",
        "previous_bounce_rate",
        "previous_avg_duration_seconds"
      )
    }
    const rec = (bk: Bucket | null) => [
      bk ? rfc3339(bk.start, query.tz) : "",
      String(bk?.pageviews ?? 0),
      String(bk?.visitors ?? 0),
      String(bk?.visits ?? 0),
      ratio(bk?.bounce_rate ?? 0),
      seconds(bk?.avg_duration ?? 0),
    ]
    records = [
      header,
      ...cur.map((bk, i) => [...rec(bk), ...(prev ? rec(prev[i]!) : [])]),
    ]
    name = "timeseries"
  } else {
    throw new HttpError(400, "what must be breakdown or timeseries")
  }
  const filename = `${site.domain}-${name}-${query.from}-${query.to}.csv`
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  }
  if (truncated) headers["X-Truncated"] = "true"
  return {
    status: 200,
    body: `﻿${records.map((r) => `${csvLine(r)}\n`).join("")}`,
    headers,
  }
}
