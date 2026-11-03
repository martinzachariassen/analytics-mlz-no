// Typed client for the Go API (see docs/API.md). All requests are same-origin:
// Vite proxies /api in development and Firebase Hosting rewrites it in production.

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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
    let message = res.statusText
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
}

export type Summary = {
  pageviews: number
  visitors: number
  visits: number
  bounce_rate: number
  avg_duration: number
}
export type Interval = "hour" | "day" | "month"
export type Stats = {
  period: { from: string; to: string; tz: string; interval: Interval }
  summary: Summary
  previous: Summary
  timeseries: { t: string; pageviews: number; visitors: number }[]
}

export type Dimension =
  | "path"
  | "entry"
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
export type BreakdownRow = { value: string; visitors: number; count: number }

export type RangeParams = { from: string; to: string; tz: string }

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") q.set(k, String(v))
  return q.toString()
}

export const api = {
  authConfig: () => request<{ providers: string[] }>("/api/auth/config"),
  me: () => request<User>("/api/auth/me"),
  logout: () =>
    request<void>("/api/auth/logout", { method: "POST", body: "{}" }),

  sites: () => request<Site[]>("/api/sites"),
  site: (id: string) => request<Site>(`/api/sites/${id}`),
  createSite: (body: { name: string; domain: string }) =>
    request<Site>("/api/sites", { method: "POST", body: JSON.stringify(body) }),
  updateSite: (id: string, body: { name: string; domain: string }) =>
    request<Site>(`/api/sites/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSite: (id: string) =>
    request<void>(`/api/sites/${id}`, { method: "DELETE" }),

  stats: (id: string, r: RangeParams) =>
    request<Stats>(`/api/sites/${id}/stats?${query(r)}`),
  breakdown: (
    id: string,
    r: RangeParams,
    dim: Dimension,
    opts: { limit?: number; event?: string; key?: string } = {}
  ) =>
    request<BreakdownRow[]>(
      `/api/sites/${id}/breakdown?${query({ ...r, dim, ...opts })}`
    ),
  realtime: (id: string) =>
    request<{ visitors: number }>(`/api/sites/${id}/realtime`),
}
