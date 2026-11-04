import { useEffect } from "react"
import { isRouteErrorResponse, useRouteError } from "react-router"

import { Button } from "@/components/ui/button"

const RELOAD_KEY = "mlz_chunk_reload"

/** A lazy route whose chunk no longer exists on the server (it was redeployed). */
function isStaleChunk(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === "ChunkLoadError" ||
    /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
      err.message
    )
  )
}

/**
 * The last line of defence: whatever a view throws ends up here instead of a blank
 * page. A stale chunk after a deploy reloads once, so the user never sees it.
 */
export function ErrorPage() {
  const err = useRouteError()
  const stale = isStaleChunk(err)

  useEffect(() => {
    if (!stale) return
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return
      sessionStorage.setItem(RELOAD_KEY, "1")
    } catch {
      // storage unavailable: reload anyway, once per page life
    }
    window.location.reload()
  }, [stale])

  useEffect(() => {
    try {
      if (!stale) sessionStorage.removeItem(RELOAD_KEY)
    } catch {
      // ignore
    }
  }, [stale])

  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : "Unknown error"

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="display text-2xl">
        {stale ? "Updating…" : "Something went wrong"}
      </p>
      {!stale && (
        <>
          <p className="max-w-[48ch] text-sm text-fg-secondary">{message}</p>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" asChild>
              <a href="/sites">All sites</a>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
