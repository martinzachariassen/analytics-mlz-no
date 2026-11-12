import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
import { toast } from "sonner"

import { ErrorNote } from "@/components/error-note"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type GoalKind } from "@/lib/api"
import { goalLabel } from "@/lib/goals"
import { useGoals } from "@/lib/queries"

const PLACEHOLDER: Record<GoalKind, string> = {
  event: "newsletter-signup",
  path: "/thanks or /blog/*",
}

/** The site's goals: add one by event name or path, remove one. */
export function GoalsSettings({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient()
  const goals = useGoals(siteId)
  const { hash } = useLocation()
  const card = useRef<HTMLDivElement>(null)
  // The router does not scroll to a hash; the overview links here with #goals.
  useEffect(() => {
    if (hash === "#goals") card.current?.scrollIntoView({ block: "start" })
  }, [hash])
  const [kind, setKind] = useState<GoalKind>("event")
  const [value, setValue] = useState("")
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["goals", siteId] })

  const create = useMutation({
    mutationFn: () => api.createGoal(siteId, { kind, value }),
    onSuccess: async (g) => {
      setValue("")
      await refresh()
      toast.success(`Added goal ${goalLabel(g)}`)
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteGoal(siteId, id),
    onSuccess: refresh,
    onError: (err) => toast.error(err.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Card id="goals" ref={card} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Goals</CardTitle>
        <CardDescription>
          A goal is a custom event or a page a visitor should reach. The
          overview shows how many visitors reached each one. Goals count past
          traffic too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {goals.isError ? (
          <ErrorNote queries={[goals]} />
        ) : !goals.data ? (
          <Skeleton className="h-16" />
        ) : goals.data.length === 0 ? (
          <p className="text-sm text-fg-muted">No goals yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {goals.data.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-xs text-fg-muted">
                    {g.kind === "event" ? "Event" : "Page"}
                  </span>
                  <span
                    className={
                      g.kind === "path" ? "truncate font-mono" : "truncate"
                    }
                    title={g.value}
                  >
                    {goalLabel(g)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove goal ${goalLabel(g)}`}
                  disabled={remove.isPending && remove.variables === g.id}
                  onClick={() => remove.mutate(g.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="goal-value">Add a goal</Label>
          <div className="flex gap-2 max-sm:flex-col">
            <Select value={kind} onValueChange={(k) => setKind(k as GoalKind)}>
              <SelectTrigger className="sm:w-32" aria-label="Goal type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="path">Page</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="goal-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER[kind]}
              className={kind === "path" ? "font-mono" : undefined}
              required
            />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            {kind === "event"
              ? "The event name, exactly as sent (data-mlz-event or mlz.track)."
              : "A path starting with /. * matches anything, so /blog/* is every post."}
          </p>
          {create.isError && (
            <p className="text-sm text-destructive">{create.error.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
