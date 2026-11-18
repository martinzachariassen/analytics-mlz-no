// Synthetic traffic for the demo: deterministic for a seed and a clock, so every visitor
// of the demo sees the same story, always ending "now". Visits are generated per UTC day
// and appended to the table in time order; visitor ids rotate at UTC midnight, as the
// server's daily salt does.

import { type RawEvent, Table } from "./table"

export type Weighted<T> = readonly (readonly [T, number])[]

// ---------------------------------------------------------------------------- randomness

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }
  /** Uniform in [0, 1) (mulberry32). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(n: number): number {
    return Math.floor(this.next() * n)
  }
  between(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  normal(): number {
    const u = 1 - this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next())
  }
  /** Poisson-ish count with mean m (normal approximation above 30). */
  count(m: number): number {
    if (m <= 0) return 0
    if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * this.normal()))
    const l = Math.exp(-m)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > l)
    return k - 1
  }
  pick<T>(items: Weighted<T>): T {
    let total = 0
    for (const [, w] of items) total += w
    let x = this.next() * total
    for (const [v, w] of items) {
      x -= w
      if (x < 0) return v
    }
    return items[items.length - 1]![0]
  }
}

/** A weighted list prepared once: cumulative weights and a binary search per pick. */
export class Picker<T> {
  private readonly values: T[]
  private readonly cum: Float64Array
  constructor(items: Weighted<T>) {
    this.values = items.map(([v]) => v)
    this.cum = new Float64Array(items.length)
    let total = 0
    items.forEach(([, w], i) => {
      total += w
      this.cum[i] = total
    })
  }
  get empty(): boolean {
    return this.values.length === 0 || this.cum[this.cum.length - 1]! <= 0
  }
  pick(r: Rng): T {
    const x = r.next() * this.cum[this.cum.length - 1]!
    let lo = 0
    let hi = this.cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cum[mid]! > x) hi = mid
      else lo = mid + 1
    }
    return this.values[lo]!
  }
}

// ---------------------------------------------------------------------------- profiles

export type Source = {
  ref?: string
  utm?: [source: string, medium: string, campaign: string]
  /** Where these visitors land; a page key from the profile. */
  land: string
  /** Multiplies the chance to continue past the first page. */
  stay?: number
  /** Multiplies the pull of /pricing and /signup. */
  intent?: number
  /** More phones (social links are opened on phones). */
  mobile?: number
}

export type Page = {
  path: string
  host?: string
  /** Which navigation table and event rules apply. */
  kind: string
  /** Seconds spent on the page, roughly [low, high]. */
  dwell: readonly [number, number]
  /** Days ago the page went live (absent: always there). */
  since?: number
  /** Weight as a landing page from search, before age effects. */
  seo?: number
  /** Popular at launch, then a long tail. */
  buzz?: number
}

/** A day with extra visits from one source, tailing off over the next days. */
export type Spike = {
  daysAgo: number
  /** Extra visits on the day, as a multiple of a normal day. */
  amp: number
  decay: number
  source: Source
  /** Countries those visitors come from, if not the usual mix. */
  countries?: Weighted<string>
}

export type Profile = {
  hostname: string
  /** Weekday visits now and two years ago. */
  visitsNow: number
  visitsThen: number
  pages: Page[]
  /** Organic and campaign sources: weight, and the days ago they started and ended. */
  sources: readonly (readonly [Source, number, number?, number?])[]
  spikes: Spike[]
  /** Next page per page kind: page keys (path, or a group name starting with @). */
  next: Record<string, Weighted<string>>
  /** Chance to continue after a page of this kind. */
  stay: Record<string, number>
  groups: Record<string, (p: Page) => boolean>
  events: (
    r: Rng,
    page: Page,
    visit: VisitCtx
  ) => [string, Record<string, string>][]
}

export type VisitCtx = { source: Source; signedUp: boolean }

// ---------------------------------------------------------------------------- audience

/** Country, UTC offset in hours, weight. The US is split over its time zones. */
const COUNTRIES: readonly (readonly [string, number, number])[] = [
  ["US", -5, 14],
  ["US", -6, 4.5],
  ["US", -8, 6.5],
  ["GB", 0, 7],
  ["DE", 1, 7],
  ["IN", 5.5, 6],
  ["CA", -5, 3],
  ["CA", -8, 1.2],
  ["FR", 1, 4],
  ["NL", 1, 3],
  ["NO", 1, 2.6],
  ["SE", 1, 2.8],
  ["BR", -3, 3],
  ["AU", 10, 2.6],
  ["ES", 1, 2.4],
  ["PL", 1, 2.2],
  ["IT", 1, 2],
  ["CH", 1, 1.5],
  ["JP", 9, 1.4],
  ["DK", 1, 1.2],
  ["FI", 2, 1],
  ["BE", 1, 1],
  ["AT", 1, 1],
  ["IE", 0, 1],
  ["PT", 0, 0.8],
  ["CZ", 1, 0.8],
  ["IL", 2, 0.8],
  ["SG", 8, 0.8],
  ["MX", -6, 0.8],
  ["KR", 9, 0.7],
  ["UA", 2, 0.6],
  ["TR", 3, 0.6],
  ["ID", 7, 0.6],
  ["AR", -3, 0.5],
  ["ZA", 2, 0.5],
  ["NZ", 12, 0.5],
  ["RO", 2, 0.5],
  ["VN", 7, 0.5],
  ["PH", 8, 0.5],
  ["TW", 8, 0.4],
  ["NG", 1, 0.4],
  ["HK", 8, 0.3],
  ["GR", 2, 0.3],
  ["HU", 1, 0.3],
  ["CL", -3, 0.3],
  ["CO", -5, 0.3],
  ["EG", 2, 0.3],
  ["EE", 2, 0.2],
  ["LT", 2, 0.2],
  ["", 0, 0.6],
]
const COUNTRY_PICK = new Picker<number>(COUNTRIES.map((c, i) => [i, c[2]]))
const OFFSET: Record<string, number> = Object.fromEntries(
  COUNTRIES.map(([c, o]) => [c, o])
)

/** Relative traffic per local hour. */
const HOURS_WEEKDAY = [
  0.25, 0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.6, 1, 1.35, 1.5, 1.5, 1.35, 1.4,
  1.5, 1.45, 1.35, 1.15, 0.9, 0.8, 0.75, 0.65, 0.5, 0.35,
]
const HOURS_WEEKEND = [
  0.3, 0.2, 0.15, 0.1, 0.1, 0.1, 0.15, 0.25, 0.4, 0.6, 0.75, 0.85, 0.9, 0.9,
  0.85, 0.8, 0.75, 0.75, 0.8, 0.85, 0.8, 0.7, 0.55, 0.4,
]
const hourPick = (hours: number[]) =>
  new Picker<number>(hours.map((w, h) => [h, w]))
const PICK_WEEKDAY = hourPick(HOURS_WEEKDAY)
const PICK_WEEKEND = hourPick(HOURS_WEEKEND)

type Client = readonly [browser: string, os: string, device: string]
const DESKTOP = new Picker<Client>([
  [["Chrome", "macOS", "desktop"], 30],
  [["Chrome", "Windows", "desktop"], 18],
  [["Safari", "macOS", "desktop"], 12],
  [["Edge", "Windows", "desktop"], 7],
  [["Chrome", "Linux", "desktop"], 4],
  [["Firefox", "Windows", "desktop"], 3.5],
  [["Firefox", "macOS", "desktop"], 3],
  [["Firefox", "Linux", "desktop"], 3],
  [["Opera", "Windows", "desktop"], 0.8],
])
const MOBILE = new Picker<Client>([
  [["Safari", "iOS", "mobile"], 11],
  [["Chrome", "Android", "mobile"], 8],
  [["Chrome", "iOS", "mobile"], 1.5],
  [["Samsung Internet", "Android", "mobile"], 1.2],
  [["Firefox", "Android", "mobile"], 0.3],
])
const TABLET = new Picker<Client>([
  [["Safari", "iOS", "tablet"], 2.5],
  [["Chrome", "Android", "tablet"], 0.5],
])

// ---------------------------------------------------------------------------- generator

const DAY = 86_400_000

type Person = {
  id: number
  country: string
  offset: number
  client: Client
}

type Options = {
  profile: Profile
  now: number
  days: number
  seed: number
  /** Multiplies the traffic (tests use a small fraction). */
  scale?: number
  /** First visitor id, so a second generator's visitors never collide with the first's. */
  visitorBase?: number
}

/** Weekday factor by UTC weekday, Sunday first. */
const WEEK = [0.62, 1, 1.06, 1.05, 1, 0.9, 0.58]

function season(ts: number): number {
  const d = new Date(ts)
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  if ((m === 11 && day >= 22) || (m === 0 && day <= 2)) return 0.55
  if (m === 6) return 0.8
  if (m === 7 && day <= 15) return 0.85
  return 1
}

export class Generator {
  readonly table = new Table()
  private readonly r: Rng
  private readonly p: Profile
  private readonly now: number
  private readonly pages = new Map<string, Page>()
  private pending: RawEvent[] = []
  private nextPerson = 1
  private noise = 0
  private readonly ids = new Map<number, number>()
  private readonly sourceCache = new Map<number, Picker<Source>>()
  private readonly groupCache = new Map<string, Picker<Page> | null>()
  private groupDay = -1
  private readonly nextCache = new Map<string, Picker<string>>()
  private nextVisitorId = 1

  private readonly o: Options

  constructor(o: Options) {
    this.o = o
    this.r = new Rng(o.seed)
    this.p = o.profile
    this.now = o.now
    this.nextVisitorId = o.visitorBase ?? 1
    for (const page of o.profile.pages) this.pages.set(pageKey(page), page)
  }

  /** Fills the table with o.days of history ending at o.now. */
  run(): Table {
    const today = Math.floor(this.now / DAY) * DAY
    for (let d = this.o.days - 1; d >= 0; d--) {
      this.day(today - d * DAY, d)
    }
    this.flush(Number.POSITIVE_INFINITY)
    this.table.compact()
    return this.table
  }

  /** Expected visits on the UTC day starting at dayStart, d days ago. */
  private volume(dayStart: number, d: number): number {
    const { visitsNow, visitsThen } = this.p
    const x = 1 - d / this.o.days
    let v = visitsThen + (visitsNow - visitsThen) * x ** 1.35
    // Launches lift the baseline for good.
    if (d < 200) v *= 1.1
    if (d < 70) v *= 1.06
    v *= WEEK[new Date(dayStart).getUTCDay()]! * season(dayStart)
    this.noise = 0.82 * this.noise + 0.05 * this.r.normal()
    return (
      v *
      Math.exp(this.noise) *
      (1 + 0.07 * this.r.normal()) *
      (this.o.scale ?? 1)
    )
  }

  private day(dayStart: number, d: number): void {
    const weekend = [0, 6].includes(new Date(dayStart).getUTCDay())
    const normal = this.volume(dayStart, d)
    const today: Person[] = []
    for (let i = this.r.count(normal); i > 0; i--) {
      const back = today.length > 0 && this.r.chance(0.2)
      const person = back
        ? today[this.r.int(today.length)]!
        : this.person(weekend)
      if (!back) today.push(person)
      const source =
        back && this.r.chance(0.6) ? this.returning() : this.source(d)
      this.visit(
        this.start(dayStart, weekend, person),
        person,
        source,
        this.now
      )
    }
    for (const s of this.p.spikes) {
      const age = s.daysAgo - d
      if (age < 0 || age > 6) continue
      const extra = this.r.count(
        (normal / (WEEK[new Date(dayStart).getUTCDay()]! || 1)) *
          s.amp *
          Math.exp(-age / s.decay)
      )
      for (let i = 0; i < extra; i++) {
        const person = this.person(weekend, s.countries, s.source.mobile)
        this.visit(
          this.start(dayStart, weekend, person),
          person,
          s.source,
          this.now
        )
      }
    }
    this.flush(dayStart + DAY)
  }

  private person(
    weekend: boolean,
    countries?: Weighted<string>,
    mobile = 1
  ): Person {
    let country: string
    let offset: number
    if (countries) {
      country = this.r.pick(countries)
      offset = OFFSET[country] ?? 0
    } else {
      const c = COUNTRIES[COUNTRY_PICK.pick(this.r)]!
      country = c[0]
      offset = c[1]
    }
    const phone = 0.23 * mobile * (weekend ? 1.5 : 1)
    const x = this.r.next()
    const client =
      x < phone
        ? MOBILE.pick(this.r)
        : x < phone + 0.03
          ? TABLET.pick(this.r)
          : DESKTOP.pick(this.r)
    return { id: this.nextPerson++, country, offset, client }
  }

  private source(d: number): Source {
    let picker = this.sourceCache.get(d)
    if (!picker) {
      picker = new Picker(
        this.p.sources
          .filter(
            ([, , from, to]) =>
              (from === undefined || d <= from) && (to === undefined || d >= to)
          )
          .map(([src, w, from]) => {
            // Sources that started recently (AI assistants, new campaigns) grow into their weight.
            const ramp =
              from === undefined ? 1 : Math.min(1, (from - d) / 60 + 0.15)
            return [src, w * ramp] as const
          })
      )
      this.sourceCache.set(d, picker)
    }
    return picker.pick(this.r)
  }

  /** Someone back the same day: mostly typed in, to sign in or read the docs. */
  private returning(): Source {
    return RETURNING.pick(this.r)
  }

  private landing(key: string, dayAgo: number): Page | undefined {
    if (!key.startsWith("@")) {
      const page = this.pages.get(key)
      return page && live(page, dayAgo) ? page : undefined
    }
    if (dayAgo !== this.groupDay) {
      this.groupCache.clear()
      this.groupDay = dayAgo
    }
    let picker = this.groupCache.get(key)
    if (picker === undefined) {
      const group = this.p.groups[key]
      const pages = group
        ? this.p.pages.filter((p) => live(p, dayAgo) && group(p))
        : []
      picker =
        pages.length > 0
          ? new Picker(pages.map((p) => [p, weight(p, dayAgo)] as const))
          : null
      this.groupCache.set(key, picker)
    }
    return picker?.pick(this.r)
  }

  /** A start time on the UTC day, at an hour the person's local clock makes likely. */
  private start(dayStart: number, weekend: boolean, person: Person): number {
    const hour = (weekend ? PICK_WEEKEND : PICK_WEEKDAY).pick(this.r)
    const utc = (((hour - person.offset) % 24) + 24) % 24
    return dayStart + Math.floor((utc + this.r.next()) * 3600_000)
  }

  /** One visit from start; events after `limit` are not written. */
  private visit(start: number, person: Person, source: Source, limit: number) {
    const r = this.r
    let ts = start
    if (ts > limit) return
    const dayAgo = Math.floor((this.now - ts) / DAY)
    let page = this.landing(source.land, dayAgo) ?? this.pages.get("/")!
    const ctx: VisitCtx = { source, signedUp: false }
    const [browser, os, device] = person.client
    const country = person.country
    for (let n = 0; n < 12; n++) {
      if (ts > limit) return
      const hostname = page.host ?? this.p.hostname
      this.pending.push(
        n === 0
          ? {
              ts,
              type: "pageview",
              hostname,
              path: page.path,
              referrer: source.ref,
              utm_source: source.utm?.[0],
              utm_medium: source.utm?.[1],
              utm_campaign: source.utm?.[2],
              country,
              browser,
              os,
              device,
              visitor: this.visitorId(person, ts),
            }
          : {
              ts,
              type: "pageview",
              hostname,
              path: page.path,
              country,
              browser,
              os,
              device,
              visitor: this.visitorId(person, ts),
            }
      )
      const dwell = Math.min(
        20 * 60,
        r.between(page.dwell[0], page.dwell[1]) * Math.exp(0.4 * r.normal())
      )
      const next = ts + Math.max(4000, Math.floor(dwell * 1000))
      const events = this.p.events(r, page, ctx)
      events.forEach(([name, props], k) => {
        const at =
          ts + Math.floor(((k + 1) / (events.length + 1)) * (next - ts))
        if (at > limit) return
        this.pending.push({
          ts: at,
          type: "event",
          name,
          props,
          hostname,
          path: page.path,
          country,
          browser,
          os,
          device,
          visitor: this.visitorId(person, at),
        })
      })
      let stay =
        (this.p.stay[page.kind] ?? 0.5) * (n === 0 ? (source.stay ?? 1) : 1)
      if (n > 3) stay *= 0.8
      if (!r.chance(Math.min(0.92, stay))) return
      const key = this.nextPicker(page.kind, source.intent ?? 1).pick(r)
      const nextPage = this.landing(key, dayAgo)
      if (!nextPage || nextPage === page) return
      page = nextPage
      ts = next
    }
  }

  /** Where people go after a page of this kind; intent pulls them to pricing and sign-up. */
  private nextPicker(kind: string, intent: number): Picker<string> {
    const k = `${kind}|${intent}`
    let picker = this.nextCache.get(k)
    if (!picker) {
      const options = this.p.next[kind] ?? this.p.next["*"]!
      picker = new Picker(
        options.map(
          ([key, w]) =>
            [
              key,
              key === "/pricing" || key === "/signup" ? w * intent : w,
            ] as const
        )
      )
      this.nextCache.set(k, picker)
    }
    return picker
  }

  /** One id per person per UTC day, as the server's daily salt makes it. */
  private visitorId(person: Person, ts: number): number {
    const key = person.id * 100_000 + Math.floor(ts / DAY)
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.nextVisitorId++
      this.ids.set(key, id)
    }
    return id
  }

  /** Appends the pending events before `until`, in time order. */
  private flush(until: number): void {
    this.pending.sort((a, b) => a.ts - b.ts)
    let i = 0
    while (i < this.pending.length && this.pending[i]!.ts < until) {
      this.table.append(this.pending[i]!)
      i++
    }
    this.pending = this.pending.slice(i)
    if (this.ids.size > 50_000) {
      const today = Math.floor(until / DAY) - 2
      for (const k of this.ids.keys()) {
        if (k % 100_000 < today) this.ids.delete(k)
      }
    }
  }

  /** One visit starting now, for the live trickle behind Realtime; later page views are
   * in the future and are appended when their time comes. */
  live(now: number): RawEvent[] {
    const weekend = [0, 6].includes(new Date(now).getUTCDay())
    const person = this.person(weekend)
    const source = this.r.chance(0.15) ? this.returning() : this.source(0)
    const saved = this.pending
    this.pending = []
    this.visit(now, person, source, Number.POSITIVE_INFINITY)
    const events = this.pending.sort((a, b) => a.ts - b.ts)
    this.pending = saved
    return events
  }

  /** Visits per minute right now, for the live trickle. */
  rate(now: number): number {
    const d = new Date(now)
    const weekend = [0, 6].includes(d.getUTCDay())
    const hours = weekend ? HOURS_WEEKEND : HOURS_WEEKDAY
    const mean = hours.reduce((a, b) => a + b, 0) / 24
    let byHour = 0
    for (const [, offset, w] of COUNTRIES) {
      const local = (((d.getUTCHours() + offset) % 24) + 24) % 24
      byHour += w * hours[Math.floor(local)]!
    }
    const total = COUNTRIES.reduce((a, c) => a + c[2], 0)
    const perDay =
      this.p.visitsNow * 1.16 * WEEK[d.getUTCDay()]! * (this.o.scale ?? 1)
    return ((perDay / 1440) * (byHour / total)) / mean
  }
}

const RETURNING = new Picker<Source>([
  [{ land: "/login", stay: 0.2 }, 4],
  [{ land: "@docs", stay: 1.3 }, 3],
  [{ land: "/" }, 2],
  [{ land: "/pricing", intent: 2 }, 1],
])

export const pageKey = (p: Page) => (p.host ? `${p.host}${p.path}` : p.path)

const live = (p: Page, dayAgo: number) =>
  p.since === undefined || dayAgo <= p.since

/** A landing page's pull on a given day: launch buzz fading into search traffic. */
function weight(p: Page, dayAgo: number): number {
  const age = p.since === undefined ? 10_000 : p.since - dayAgo
  const seo = (p.seo ?? 1) * Math.min(1, 0.15 + age / 120)
  const buzz = (p.buzz ?? 0) * Math.exp(-age / 9)
  return seo + buzz
}
