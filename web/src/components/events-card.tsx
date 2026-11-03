import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { MousePointerClick } from "lucide-react"

import { BarList } from "@/components/breakdown-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, type RangeParams } from "@/lib/api"
import { humanize } from "@/lib/format"

/** Custom events; selecting one shows the values of its properties. */
export function EventsCard({
  siteId,
  range,
  totalVisitors,
}: {
  siteId: string
  range: RangeParams
  totalVisitors?: number
}) {
  const [event, setEvent] = useState<string>()
  const [key, setKey] = useState<string>()

  const events = useQuery({
    queryKey: ["breakdown", siteId, range, "event"],
    queryFn: () => api.breakdown(siteId, range, "event", { limit: 50 }),
  })
  const keys = useQuery({
    queryKey: ["breakdown", siteId, range, "prop_key", event],
    queryFn: () =>
      api.breakdown(siteId, range, "prop_key", { event, limit: 50 }),
    enabled: !!event,
  })
  const activeKey =
    key && keys.data?.some((k) => k.value === key) ? key : keys.data?.[0]?.value
  const values = useQuery({
    queryKey: ["breakdown", siteId, range, "prop", event, activeKey],
    queryFn: () =>
      api.breakdown(siteId, range, "prop", {
        event,
        key: activeKey,
        limit: 50,
      }),
    enabled: !!event && !!activeKey,
  })

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Goals & events</CardTitle>
        <CardDescription>
          Actions visitors took, such as sign-ups or clicks on outbound links.
          Conversion is the share of all visitors who did it. Select an event to
          see its details.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <BarList
          rows={events.data}
          loading={events.isPending}
          tab={{
            countLabel: "Events",
            render: (v) => (
              <>
                <MousePointerClick className="size-4 shrink-0 text-muted-foreground" />
                {humanize(v)}
              </>
            ),
          }}
          total={totalVisitors}
          shareLabel="Conv."
          selected={event}
          onSelect={(v) => {
            setEvent(v === event ? undefined : v)
            setKey(undefined)
          }}
        />
        {event ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{humanize(event)}</p>
              {keys.data && keys.data.length > 0 && (
                <Select value={activeKey} onValueChange={setKey}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue placeholder="Property" />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.data.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {keys.data?.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                This event has no properties
              </p>
            ) : (
              <BarList
                rows={values.data}
                loading={keys.isPending || values.isPending}
                tab={{ countLabel: "Events" }}
              />
            )}
          </div>
        ) : (
          events.data &&
          events.data.length > 0 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground max-md:hidden">
              Select an event on the left to see a breakdown of its properties,
              for example which links were clicked.
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
