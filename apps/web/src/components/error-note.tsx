import { CircleAlert, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The one way a failed request looks, wherever it happens: a short line, never a stuck
 * skeleton. Pass the query's `refetch` as `onRetry` to offer "Try again".
 */
export function ErrorNote({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown
  onRetry?: () => unknown
  retrying?: boolean
  className?: string
}) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 py-6 text-sm text-destructive",
        className
      )}
    >
      <span className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" />
        <span>Could not load this: {message}</span>
      </span>
      {onRetry && (
        <Button
          variant="outline"
          size="xs"
          disabled={retrying}
          onClick={() => void onRetry()}
        >
          <RotateCw className={cn(retrying && "animate-spin")} />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  )
}
