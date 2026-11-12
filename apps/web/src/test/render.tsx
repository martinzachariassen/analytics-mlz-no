import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"

import { useScope } from "@/lib/use-scope"

type ScopedUi = (sc: ReturnType<typeof useScope>) => ReactElement

function Host({ ui }: { ui: ScopedUi }) {
  return ui(useScope())
}

/**
 * Renders a component inside a site route (/sites/:id) with a fresh query
 * client. `ui` receives the live scope, so URL changes made by the component
 * show up in `router.state.location`.
 */
export function renderInSite(ui: ScopedUi, url = "/sites/abc") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter(
    [{ path: "/sites/:id", element: <Host ui={ui} /> }],
    { initialEntries: [url] }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const search = () => new URLSearchParams(router.state.location.search)
  return { ...view, router, search }
}

/**
 * A route that answers by request, for mutations or query strings: return a body, or a
 * Response as is.
 */
export type Handler = (init: RequestInit | undefined, url: URL) => unknown

/**
 * Replaces fetch with a handler keyed on path; unknown paths answer 404. A value is the
 * JSON body, or a Handler.
 */
export function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost")
    calls.push(url.pathname + url.search)
    const route = routes[url.pathname]
    const body =
      typeof route === "function" ? (route as Handler)(init, url) : route
    if (body instanceof Response) return body
    if (body === undefined)
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  return calls
}
