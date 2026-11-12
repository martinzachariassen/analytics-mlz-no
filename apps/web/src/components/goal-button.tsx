import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Target } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api, type GoalKind } from "@/lib/api"
import { goalLabel } from "@/lib/goals"
import { useGoals } from "@/lib/queries"

/** Turns an event or a page into a goal, or says it already is one. */
export function GoalButton({
  siteId,
  kind,
  value,
}: {
  siteId: string
  kind: GoalKind
  value: string
}) {
  const queryClient = useQueryClient()
  const goals = useGoals(siteId)
  const create = useMutation({
    mutationFn: () => api.createGoal(siteId, { kind, value }),
    onSuccess: async (g) => {
      await queryClient.invalidateQueries({ queryKey: ["goals", siteId] })
      toast.success(`${goalLabel(g)} is now a goal`)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!goals.data || value === "") return null
  if (goals.data.some((g) => g.kind === kind && g.value === value))
    return (
      <Button variant="outline" size="sm" disabled>
        <Check />
        Goal
      </Button>
    )
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={create.isPending}
      onClick={() => create.mutate()}
    >
      <Target />
      Make this a goal
    </Button>
  )
}
