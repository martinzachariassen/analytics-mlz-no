// The demo's "events table": one row per page view or custom event, in time order, stored
// column by column in typed arrays so two years of traffic fits in a few tens of MB.
// Session ids are assigned on append exactly like store.InsertEvent: a visitor's event
// joins their previous session if that one had activity within the last 30 minutes.

export const SESSION_TIMEOUT_MS = 30 * 60_000

export type RawEvent = {
  ts: number // Unix ms
  type: "pageview" | "event"
  name?: string
  hostname: string
  path: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  country: string
  browser: string
  os: string
  device: string
  visitor: number // visitor_id: one per person per UTC day, as the daily salt makes it
  props?: Record<string, string>
}

/** Strings stored once, referenced by index. Index 0 is always "". */
export class Dict {
  readonly values: string[] = [""]
  private readonly index = new Map<string, number>([["", 0]])

  static from(values: string[]): Dict {
    const d = new Dict()
    for (const v of values) d.id(v)
    return d
  }

  id(s: string): number {
    let i = this.index.get(s)
    if (i === undefined) {
      i = this.values.length
      this.values.push(s)
      this.index.set(s, i)
    }
    return i
  }

  /** The id of s, or -1 when no row has it. */
  find(s: string): number {
    return this.index.get(s) ?? -1
  }
}

type Grow = Float64Array | Uint32Array | Uint16Array | Uint8Array

function grow<T extends Grow>(a: T, n: number): T {
  if (n <= a.length) return a
  const next = new (a.constructor as new (n: number) => T)(
    Math.max(n, a.length * 2)
  )
  next.set(a)
  return next
}

export const PAGEVIEW = 0
export const EVENT = 1

/** The visit-attributed and per-row string columns, by dimension name. */
export const STRING_COLS = [
  "name",
  "hostname",
  "path",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "country",
  "browser",
  "os",
  "device",
] as const
export type StringCol = (typeof STRING_COLS)[number]

export type Snapshot = {
  n: number
  ts: Float64Array<ArrayBuffer>
  type: Uint8Array<ArrayBuffer>
  visitor: Uint32Array<ArrayBuffer>
  session: Uint32Array<ArrayBuffer>
  cols: Record<StringCol, Uint16Array<ArrayBuffer>>
  dicts: Record<StringCol, string[]>
  propStart: Uint32Array<ArrayBuffer>
  propCount: Uint8Array<ArrayBuffer>
  propKey: Uint16Array<ArrayBuffer>
  propValue: Uint16Array<ArrayBuffer>
  propN: number
  propKeys: string[]
  propValues: string[]
  sessions: number
  visitors: number
}

export class Table {
  n = 0
  ts = new Float64Array(1024)
  type = new Uint8Array(1024)
  visitor = new Uint32Array(1024)
  session = new Uint32Array(1024)
  cols: Record<StringCol, Uint16Array<ArrayBuffer>> = Object.fromEntries(
    STRING_COLS.map((c) => [c, new Uint16Array(1024)])
  ) as Record<StringCol, Uint16Array<ArrayBuffer>>
  dicts: Record<StringCol, Dict> = Object.fromEntries(
    STRING_COLS.map((c) => [c, new Dict()])
  ) as Record<StringCol, Dict>

  // Custom event properties: row i owns props [propStart[i], propStart[i] + propCount[i]).
  propStart = new Uint32Array(1024)
  propCount = new Uint8Array(1024)
  propKey = new Uint16Array(1024)
  propValue = new Uint16Array(1024)
  propN = 0
  readonly propKeys = new Dict()
  readonly propValues = new Dict()

  sessions = 0
  private visitorCount = 0
  private visitorIds = new Map<number, number>()
  private visitorLast = new Float64Array(1024)
  private visitorSession = new Uint32Array(1024)

  /** Appends an event; events must arrive in time order. */
  append(e: RawEvent): void {
    const i = this.n
    if (i > 0 && e.ts < this.ts[i - 1]!) {
      throw new Error("events must be appended in time order")
    }
    const need = i + 1
    this.ts = grow(this.ts, need)
    this.type = grow(this.type, need)
    this.visitor = grow(this.visitor, need)
    this.session = grow(this.session, need)
    this.propStart = grow(this.propStart, need)
    this.propCount = grow(this.propCount, need)
    for (const c of STRING_COLS) this.cols[c] = grow(this.cols[c], need)

    let v = this.visitorIds.get(e.visitor)
    if (v === undefined) {
      v = this.visitorCount++
      this.visitorIds.set(e.visitor, v)
      this.visitorLast = grow(this.visitorLast, v + 1)
      this.visitorSession = grow(this.visitorSession, v + 1)
      this.visitorLast[v] = Number.NEGATIVE_INFINITY
    }
    if (this.visitorLast[v]! < e.ts - SESSION_TIMEOUT_MS) {
      this.visitorSession[v] = this.sessions++
    }
    this.visitorLast[v] = e.ts

    this.ts[i] = e.ts
    this.type[i] = e.type === "pageview" ? PAGEVIEW : EVENT
    this.visitor[i] = v
    this.session[i] = this.visitorSession[v]!
    const rec = e as unknown as Record<string, string | undefined>
    for (const c of STRING_COLS) {
      this.cols[c][i] = this.dicts[c].id(rec[c] ?? "")
    }
    this.propStart[i] = this.propN
    const props = e.type === "event" ? Object.entries(e.props ?? {}) : []
    this.propCount[i] = props.length
    for (const [k, val] of props) {
      this.propKey = grow(this.propKey, this.propN + 1)
      this.propValue = grow(this.propValue, this.propN + 1)
      this.propKey[this.propN] = this.propKeys.id(k)
      this.propValue[this.propN] = this.propValues.id(val)
      this.propN++
    }
    this.n++
  }

  /** Drops the spare capacity left by growing, once the history is written. */
  compact(): void {
    const keep = this.n + 4096
    const shrink = <T extends Grow>(a: T): T =>
      a.length > keep ? (a.slice(0, keep) as T) : a
    this.ts = shrink(this.ts)
    this.type = shrink(this.type)
    this.visitor = shrink(this.visitor)
    this.session = shrink(this.session)
    this.propStart = shrink(this.propStart)
    this.propCount = shrink(this.propCount)
    for (const c of STRING_COLS) this.cols[c] = shrink(this.cols[c])
    const props = this.propN + 4096
    if (this.propKey.length > props) {
      this.propKey = this.propKey.slice(0, props)
      this.propValue = this.propValue.slice(0, props)
    }
  }

  /** The string in column c of row i. */
  str(c: StringCol, i: number): string {
    return this.dicts[c].values[this.cols[c][i]!]!
  }

  /** First row with ts >= t. */
  lowerBound(t: number): number {
    let lo = 0
    let hi = this.n
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ts[mid]! < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Visitor-id space size, for per-visitor scratch arrays. */
  get visitors(): number {
    return this.visitorCount
  }

  /**
   * The table as plain data, to send from the worker that generated it; `transfer` lists
   * the buffers to move rather than copy. Visitors in it never appear again: new events
   * must come with new visitor ids.
   */
  snapshot(): { data: Snapshot; transfer: ArrayBuffer[] } {
    this.compact()
    const data: Snapshot = {
      n: this.n,
      ts: this.ts,
      type: this.type,
      visitor: this.visitor,
      session: this.session,
      cols: this.cols,
      dicts: Object.fromEntries(
        STRING_COLS.map((c) => [c, this.dicts[c].values])
      ) as Record<StringCol, string[]>,
      propStart: this.propStart,
      propCount: this.propCount,
      propKey: this.propKey,
      propValue: this.propValue,
      propN: this.propN,
      propKeys: this.propKeys.values,
      propValues: this.propValues.values,
      sessions: this.sessions,
      visitors: this.visitorCount,
    }
    const arrays: Grow[] = [
      this.ts,
      this.type,
      this.visitor,
      this.session,
      this.propStart,
      this.propCount,
      this.propKey,
      this.propValue,
      ...STRING_COLS.map((c) => this.cols[c]),
    ]
    return { data, transfer: arrays.map((a) => a.buffer as ArrayBuffer) }
  }

  static from(s: Snapshot): Table {
    const t = new Table()
    t.n = s.n
    t.ts = s.ts
    t.type = s.type
    t.visitor = s.visitor
    t.session = s.session
    t.cols = s.cols
    t.dicts = Object.fromEntries(
      STRING_COLS.map((c) => [c, Dict.from(s.dicts[c])])
    ) as Record<StringCol, Dict>
    t.propStart = s.propStart
    t.propCount = s.propCount
    t.propKey = s.propKey
    t.propValue = s.propValue
    t.propN = s.propN
    for (const k of s.propKeys) t.propKeys.id(k)
    for (const v of s.propValues) t.propValues.id(v)
    t.sessions = s.sessions
    t.visitorCount = s.visitors
    return t
  }
}
