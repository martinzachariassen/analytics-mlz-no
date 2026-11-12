import type { UseQueryResult } from "@tanstack/react-query"
import { CircleAlert, RotateCw } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type Retryable = Pick<UseQueryResult, "error" | "isError" | "refetch">

/**
 * The one way a failed request looks, wherever it happens: a short line, never a stuck
 * skeleton. Given `queries`, it shows the first failure and "Try again" refetches every
 * query that failed; given only `error`, it just shows the message. Renders nothing when
 * there is no error.
 */
export function ErrorNote({
  error,
  queries = [],
  title = "Could not load this",
  className,
}: {
  error?: unknown
  queries?: Retryable[]
  title?: string
  className?: string
}) {
  // Only a click counts as retrying: background polls and refreshes of healthy queries
  // must not flip the alert or re-announce it.
  const [retrying, setRetrying] = useState(false)
  const failed = queries.filter((q) => q.isError)
  const shown = error ?? failed[0]?.error
  if (shown == null) return null
  const message = shown instanceof Error ? shown.message : String(shown)
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 py-6 text-sm text-destructive",
        className
      )}
    >
      {/* The text swaps to "Retrying…" during a retry, so a retry that fails again is
          announced again. */}
      <p role="alert" className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" />
        <span>{retrying ? "Retrying…" : `${title}: ${message}`}</span>
      </p>
      {failed.length > 0 && (
        // aria-disabled instead of disabled keeps keyboard focus on the button.
        <Button
          variant="outline"
          size="xs"
          aria-disabled={retrying}
          onClick={() => {
            if (retrying) return
            setRetrying(true)
            void Promise.allSettled(failed.map((q) => q.refetch())).finally(
              () => setRetrying(false)
            )
          }}
        >
          <RotateCw className={cn(retrying && "animate-spin")} />
          Try again
        </Button>
      )}
    </div>
  )
}

/**
 * Stands in for a panel whose data failed while an ErrorNote higher up already says why
 * and offers the retry, so one failure is announced once and nothing waits forever.
 */
export function Unavailable({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-64 items-center justify-center text-xs text-fg-muted",
        className
      )}
    >
      Not available
    </div>
  )
}
