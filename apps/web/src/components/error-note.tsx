import { CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/** The one way a failed request looks, wherever it happens: a short line, never a stuck skeleton. */
export function ErrorNote({
  error,
  className,
}: {
  error: unknown
  className?: string
}) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <p
      role="alert"
      className={cn(
        "flex items-center gap-2 py-6 text-sm text-destructive",
        className
      )}
    >
      <CircleAlert className="size-4 shrink-0" />
      <span>Could not load this: {message}</span>
    </p>
  )
}
