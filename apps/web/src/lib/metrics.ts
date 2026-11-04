import type { Bucket, Summary } from "@/lib/api"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

export type MetricKey =
  | "visitors"
  | "visits"
  | "pageviews"
  | "views_per_visit"
  | "bounce_rate"
  | "avg_duration"

export type Metric = {
  key: MetricKey
  label: string
  help: string
  value: (s: Summary | Bucket) => number
  format: (n: number) => string
  /** For bounce rate, going down is good. */
  lowerIsBetter?: boolean
  /** Rates and averages are not summed over buckets. */
  average?: boolean
}

const perVisit = (s: Summary | Bucket) =>
  s.visits ? s.pageviews / s.visits : 0

export const METRICS: Metric[] = [
  {
    key: "visitors",
    label: "Visitors",
    help: "Unique people who visited. Someone who comes back on another day is counted again, since no cookies are used.",
    value: (s) => s.visitors,
    format: formatNumber,
  },
  {
    key: "visits",
    label: "Visits",
    help: "Separate sessions. A visit ends after 30 minutes without activity, so one visitor can make several visits.",
    value: (s) => s.visits,
    format: formatNumber,
  },
  {
    key: "pageviews",
    label: "Page views",
    help: "Every page that was opened, including navigation inside single-page apps.",
    value: (s) => s.pageviews,
    format: formatNumber,
  },
  {
    key: "views_per_visit",
    label: "Views / visit",
    help: "Average number of pages viewed per visit. Higher means people explore more.",
    value: perVisit,
    format: (n) => n.toFixed(1),
    average: true,
  },
  {
    key: "bounce_rate",
    label: "Bounce rate",
    help: "Share of visits that left after viewing a single page. Lower is usually better.",
    value: (s) => s.bounce_rate,
    format: formatPercent,
    lowerIsBetter: true,
    average: true,
  },
  {
    key: "avg_duration",
    label: "Visit duration",
    help: "Average time between the first and last activity in a visit.",
    value: (s) => s.avg_duration,
    format: formatDuration,
    average: true,
  },
]

export const METRIC: Record<MetricKey, Metric> = Object.fromEntries(
  METRICS.map((m) => [m.key, m])
) as Record<MetricKey, Metric>

export function isMetric(v: string | null): v is MetricKey {
  return v !== null && Object.hasOwn(METRIC, v)
}
