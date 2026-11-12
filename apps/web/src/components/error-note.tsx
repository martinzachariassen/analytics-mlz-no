import type { UseQueryResult } from "@tanstack/react-query"
import { CircleAlert, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type Retryable = Pick<
  UseQueryResult,
  "error" | "isError" | "isFetching" | "refetch"
>

/**
 * The one way a failed request looks, wherever it happens: a short line, never a stuck
 * skeleton. Given `queries`, it shows the first failure and "Try again" refetches every
 * query that failed; given only `error`, it just shows the message.
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
  const failed = queries.filter((q) => q.isError)
  const shown = error ?? failed[0]?.error
  const message = shown instanceof Error ? shown.message : String(shown)
  const retrying = queries.some((q) => q.isFetching)
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 py-6 text-sm text-destructive",
        className
      )}
    >
      {/* Emptied while retrying, so a retry that fails again is announced again. */}
      <p role="alert" className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" />
        <span>{retrying ? "Retrying…" : `${title}: ${message}`}</span>
      </p>
      {failed.length > 0 && (
        <Button
          variant="outline"
          size="xs"
          disabled={retrying}
          onClick={() => {
            for (const q of failed) void q.refetch()
          }}
        >
          <RotateCw className={cn(retrying && "animate-spin")} />
          Try again
        </Button>
      )}
    </div>
  )
}
