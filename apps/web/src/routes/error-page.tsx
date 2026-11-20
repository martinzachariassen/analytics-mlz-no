import { useEffect, useState } from "react"
import { isRouteErrorResponse, useRouteError } from "react-router"

import { Button } from "@/components/ui/button"

const RELOAD_KEY = "mlz_chunk_reload"
/**
 * A stale chunk reloads by itself once in this window. Another one right after means the
 * reload did not help (offline, or a broken deploy), so the page offers the buttons instead;
 * a later deploy in the same tab reloads by itself again.
 */
const RELOAD_WINDOW_MS = 60_000

function reloadedRecently(): boolean {
  try {
    return (
      Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) <
      RELOAD_WINDOW_MS
    )
  } catch {
    return false
  }
}

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
  const [retried] = useState(reloadedRecently)
  const updating = stale && !retried

  useEffect(() => {
    if (!updating) return
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      // storage unavailable: reload anyway
    }
    window.location.reload()
  }, [updating])

  const message = stale
    ? "A new version of the dashboard could not be loaded. Check your connection, then reload."
    : isRouteErrorResponse(err)
      ? `${err.status} ${err.statusText}`
      : err instanceof Error
        ? err.message
        : "Unknown error"

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="display text-2xl">
        {updating ? "Updating…" : "Something went wrong"}
      </p>
      {!updating && (
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
