// Typed client for the Go API (see docs/reference/api.md). All requests are same-origin:
// Vite proxies /api in development and Firebase Hosting rewrites it in production.

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Query retry policy: network errors, 5xx and 429 (rate limited; the limiter refills
 * within a second) are retried twice with backoff. Other 4xx are final.
 */
export function shouldRetry(count: number, err: unknown): boolean {
  if (count >= 2) return false
  if (!(err instanceof ApiError)) return true
  return err.status >= 500 || err.status === 429
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  })
  if (!res.ok) {
    // statusText is empty over HTTP/2, so the status itself is the fallback.
    let message = res.statusText || `HTTP ${res.status}`
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export type User = { login: string; provider: string }
export type Site = {
  id: string
  name: string
  domain: string
  created_at: string
  /** Oldest and newest stored events; null until the first event arrives. */
  first_event_at: string | null
  last_event_at: string | null
}

export type Summary = {
  pageviews: number
  visitors: number
  visits: number
  bounce_rate: number
  avg_duration: number
}
export type Interval = "hour" | "day" | "week" | "month"
export type Bucket = {
  t: string
  pageviews: number
  visitors: number
  visits: number
  bounce_rate: number
  avg_duration: number
}
export type PeriodInfo = {
  from: string
  to: string
  tz: string
  interval: Interval
}
export type Stats = {
  period: PeriodInfo
  summary: Summary
  /** The comparison period (the one right before, or a year earlier). */
  previous: Summary
  timeseries: Bucket[]
  /** Only with compare: aligned with timeseries by index. */
  previous_timeseries?: Bucket[]
  compare?: PeriodInfo
}

export type Dimension =
  | "path"
  | "entry"
  | "exit"
  | "hostname"
  | "referrer"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "country"
  | "browser"
  | "os"
  | "device"
  | "event"
  | "prop_key"
  | "prop"
export type BreakdownRow = {
  value: string
  visitors: number
  count: number
  /** With metrics=full. */
  visits?: number
  bounce_rate?: number
  avg_duration?: number
  /** With compare. */
  previous_visitors?: number
}

export type FilterDim = Exclude<Dimension, "prop_key" | "prop">
export type FilterOp = "is" | "is_not" | "contains"
export type Filter = { dim: FilterDim; op: FilterOp; value: string }
export type Compare = "previous" | "year"

export type RangeParams = { from: string; to: string; tz: string }
/** Everything a stats request is scoped by. */
export type Scope = RangeParams & {
  filters?: Filter[]
  compare?: Compare
}

export type Heatmap = { visitors: number[][]; pageviews: number[][] }
export type Realtime = {
  visitors: number
  minutes?: { t: string; visitors: number; pageviews: number }[]
  pages?: BreakdownRow[]
  referrers?: BreakdownRow[]
  countries?: BreakdownRow[]
}

type Params = Record<string, string | number | undefined>

function query(s: Partial<Scope>, extra: Params = {}): string {
  const q = new URLSearchParams()
  const { filters, ...rest } = s
  for (const [k, v] of Object.entries({ ...rest, ...extra }))
    if (v !== undefined && v !== "") q.set(k, String(v))
  for (const f of filters ?? []) q.append("f", `${f.dim}:${f.op}:${f.value}`)
  return q.toString()
}

/** The site's path segment. Ids are plain, but the value comes from the URL, so encode it. */
const site = (id: string) => `/api/sites/${encodeURIComponent(id)}`

export const api = {
  authConfig: () => request<{ providers: string[] }>("/api/auth/config"),
  me: () => request<User>("/api/auth/me"),
  logout: () =>
    request<void>("/api/auth/logout", { method: "POST", body: "{}" }),

  sites: () => request<Site[]>("/api/sites"),
  site: (id: string) => request<Site>(site(id)),
  createSite: (body: { name: string; domain: string }) =>
    request<Site>("/api/sites", { method: "POST", body: JSON.stringify(body) }),
  updateSite: (id: string, body: { name: string; domain: string }) =>
    request<Site>(site(id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSite: (id: string) => request<void>(site(id), { method: "DELETE" }),

  stats: (id: string, s: Scope, opts: { interval?: Interval } = {}) =>
    request<Stats>(`${site(id)}/stats?${query(s, opts)}`),
  breakdown: (
    id: string,
    s: Scope,
    dim: Dimension,
    opts: {
      limit?: number
      event?: string
      key?: string
      metrics?: "full"
    } = {}
  ) =>
    request<BreakdownRow[]>(
      `${site(id)}/breakdown?${query(s, { dim, ...opts })}`
    ),
  heatmap: (id: string, s: Scope) =>
    request<Heatmap>(
      `${site(id)}/heatmap?${query({ ...s, compare: undefined })}`
    ),
  realtime: (id: string, detail = false) =>
    request<Realtime>(`${site(id)}/realtime${detail ? "?detail=1" : ""}`),
}
