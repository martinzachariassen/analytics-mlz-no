import type { Dimension, FilterDim, FilterOp } from "@/lib/api"
import { formatCountry } from "@/lib/format"

export type DimInfo = {
  label: string
  /** Plural, for table headings and tabs. */
  plural: string
  /** How a value reads. Empty values have their own wording. */
  format?: (v: string) => string
  empty: string
  /** What `count` means for this dimension. */
  countLabel: string
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const DIMS: Record<Dimension, DimInfo> = {
  path: {
    label: "Page",
    plural: "Pages",
    empty: "(none)",
    countLabel: "Views",
  },
  entry: {
    label: "Entry page",
    plural: "Entry pages",
    empty: "(none)",
    countLabel: "Visits",
  },
  exit: {
    label: "Exit page",
    plural: "Exit pages",
    empty: "(none)",
    countLabel: "Visits",
  },
  hostname: {
    label: "Hostname",
    plural: "Hostnames",
    empty: "(none)",
    countLabel: "Views",
  },
  // No favicons: fetching them would tell a third party which sites link here.
  referrer: {
    label: "Referrer",
    plural: "Referrers",
    empty: "Direct / none",
    countLabel: "Visits",
  },
  utm_source: {
    label: "UTM source",
    plural: "UTM sources",
    empty: "(not set)",
    countLabel: "Visits",
  },
  utm_medium: {
    label: "UTM medium",
    plural: "UTM mediums",
    empty: "(not set)",
    countLabel: "Visits",
  },
  utm_campaign: {
    label: "UTM campaign",
    plural: "UTM campaigns",
    empty: "(not set)",
    countLabel: "Visits",
  },
  country: {
    label: "Country",
    plural: "Countries",
    format: formatCountry,
    empty: "Unknown",
    countLabel: "Visits",
  },
  browser: {
    label: "Browser",
    plural: "Browsers",
    empty: "Unknown",
    countLabel: "Visits",
  },
  os: {
    label: "OS",
    plural: "Operating systems",
    empty: "Unknown",
    countLabel: "Visits",
  },
  device: {
    label: "Device",
    plural: "Devices",
    format: capitalize,
    empty: "Unknown",
    countLabel: "Visits",
  },
  event: {
    label: "Event",
    plural: "Events",
    empty: "(none)",
    countLabel: "Events",
  },
  prop_key: {
    label: "Property",
    plural: "Properties",
    empty: "(none)",
    countLabel: "Events",
  },
  prop: {
    label: "Value",
    plural: "Values",
    empty: "(empty)",
    countLabel: "Events",
  },
}

export const FILTER_DIMS: FilterDim[] = [
  "path",
  "entry",
  "exit",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "country",
  "device",
  "browser",
  "os",
  "event",
  "hostname",
]

export const OPS: Record<FilterOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
}

export function isFilterDim(d: string): d is FilterDim {
  return (FILTER_DIMS as string[]).includes(d)
}

/** The value as shown to people. */
export function formatValue(dim: Dimension, v: string): string {
  const d = DIMS[dim]
  if (v === "") return d.empty
  return d.format ? d.format(v) : v
}

/** Which report view a dimension lives in. */
export const DIM_VIEW: Partial<Record<Dimension, string>> = {
  path: "pages",
  entry: "pages",
  exit: "pages",
  hostname: "pages",
  referrer: "sources",
  utm_source: "sources",
  utm_medium: "sources",
  utm_campaign: "sources",
  country: "locations",
  device: "devices",
  browser: "devices",
  os: "devices",
  event: "events",
}
