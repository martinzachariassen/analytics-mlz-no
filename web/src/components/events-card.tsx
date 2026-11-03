import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarList } from "@/components/breakdown-card"
import { Panel } from "@/components/panel"
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
    <Panel
      title="Goals & events"
      description="Actions visitors took, such as sign-ups or outbound clicks. Conversion is the share of all visitors who did it."
      bodyClassName="grid gap-8 md:grid-cols-2"
    >
      <BarList
        rows={events.data}
        loading={events.isPending}
        tab={{ countLabel: "Events", render: humanize }}
        total={totalVisitors}
        shareLabel="Conv."
        selected={event}
        onSelect={(v) => {
          setEvent(v === event ? undefined : v)
          setKey(undefined)
        }}
      />
      {event ? (
        <div className="flex min-w-0 flex-col gap-3 md:border-l md:pl-8">
          <div className="flex items-center justify-between gap-2">
            <p className="display truncate text-2xl">{humanize(event)}</p>
            {keys.data && keys.data.length > 0 && (
              <Select value={activeKey} onValueChange={setKey}>
                <SelectTrigger size="sm" className="w-40" aria-label="Property">
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
            <p className="py-8 text-center text-xs text-fg-muted">
              This event has no properties.
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
          <div className="flex flex-col items-start justify-center gap-2 border-l pl-8 max-md:hidden">
            <p className="display text-2xl text-fg-secondary">Pick an event</p>
            <p className="max-w-[40ch] text-xs leading-relaxed text-fg-muted">
              Select one on the left to break it down by its properties, for
              example which links were clicked.
            </p>
          </div>
        )
      )}
    </Panel>
  )
}
