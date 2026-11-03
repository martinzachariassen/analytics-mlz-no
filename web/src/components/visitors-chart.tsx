import { useState } from "react"
import { format } from "date-fns"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Interval, Stats } from "@/lib/api"
import { formatNumber } from "@/lib/format"

const config = {
  visitors: { label: "Visitors", color: "var(--chart-1)" },
  pageviews: { label: "Page views", color: "var(--chart-2)" },
} satisfies ChartConfig

type Series = keyof typeof config

const AXIS_FORMAT: Record<Interval, string> = {
  hour: "HH:mm",
  day: "d MMM",
  month: "MMM yyyy",
}
const TOOLTIP_FORMAT: Record<Interval, string> = {
  hour: "EEE d MMM, HH:mm",
  day: "EEE d MMM yyyy",
  month: "MMMM yyyy",
}

export function VisitorsChart({ stats }: { stats?: Stats }) {
  const [series, setSeries] = useState<Series>("visitors")
  const interval = stats?.period.interval ?? "day"
  const data =
    stats?.timeseries.map((b) => ({ ...b, time: new Date(b.t).getTime() })) ??
    []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic</CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={series}
            onValueChange={(v) => v && setSeries(v as Series)}
          >
            <ToggleGroupItem value="visitors">Visitors</ToggleGroupItem>
            <ToggleGroupItem value="pageviews">Page views</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient
                  id={`fill-${series}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${series})`}
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${series})`}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(t: number) => format(t, AXIS_FORMAT[interval])}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickFormatter={(n: number) => formatNumber(n)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const t = payload?.[0]?.payload?.time as
                        number | undefined
                      return t ? format(t, TOOLTIP_FORMAT[interval]) : ""
                    }}
                  />
                }
              />
              <Area
                dataKey={series}
                type="monotone"
                stroke={`var(--color-${series})`}
                strokeWidth={2}
                fill={`url(#fill-${series})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
