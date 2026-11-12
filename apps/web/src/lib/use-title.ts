import { useEffect } from "react"

export const APP_TITLE = "mlz. analytics"

/** The tab title for parts like ["Pages", "mlz.no"]; empty parts are skipped. */
export function pageTitle(...parts: (string | undefined)[]): string {
  return [...parts.filter(Boolean), APP_TITLE].join(" · ")
}

/** Sets the browser tab title while the calling component is mounted. */
export function useTitle(...parts: (string | undefined)[]) {
  const title = pageTitle(...parts)
  useEffect(() => {
    document.title = title
    return () => {
      document.title = APP_TITLE
    }
  }, [title])
}
