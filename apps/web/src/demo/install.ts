// The demo build's stand-in for the Go server: generates the sites' traffic in the
// browser, answers same-origin /api requests from it, turns CSV links into downloads, and
// keeps a trickle of new visits arriving so Realtime moves.

import { type Backend, type DemoSite, handle } from "./engine"
import { type Generator, Rng } from "./generate"
import { backendFrom, liveGenerators } from "./sites"
import { type RawEvent, type Snapshot, Table } from "./table"

/** New visits as they happen: events are written when their time comes. */
function trickle(
  sites: DemoSite[],
  generators: Map<string, Generator>,
  from: number
) {
  const r = new Rng(from)
  const queue = new Map<string, RawEvent[]>()
  let last = from
  setInterval(() => {
    const now = Date.now()
    const seconds = (now - last) / 1000
    last = now
    for (const site of sites) {
      const g = generators.get(site.id)!
      const q = queue.get(site.id) ?? []
      for (let n = r.count((g.rate(now) / 60) * seconds); n > 0; n--) {
        q.push(...g.live(now))
      }
      q.sort((a, b) => a.ts - b.ts)
      let i = 0
      while (i < q.length && q[i]!.ts <= now) site.table.append(q[i++]!)
      queue.set(site.id, q.slice(i))
    }
  }, 1000)
}

/** A short wait, so loading states look like they do against a real server. */
const latency = () =>
  new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 120))

export function installDemo(): void {
  let backend: Backend | undefined
  const ready = new Promise<Backend>((resolve) => {
    const now = Date.now()
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    })
    worker.onmessage = (e: MessageEvent<Snapshot[]>) => {
      worker.terminate()
      backend = backendFrom(e.data.map(Table.from), now)
      trickle(backend.sites, liveGenerators(now), now)
      resolve(backend)
    }
    worker.postMessage({ now })
  })

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const url = new URL(raw, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return realFetch(input, init)
    }
    const b = backend ?? (await ready)
    await latency()
    const body = typeof init?.body === "string" ? init.body : undefined
    const res = handle(
      b,
      init?.method ?? "GET",
      url.pathname + url.search,
      body
    )
    return new Response(res.status === 204 ? null : res.body, {
      status: res.status,
      headers: res.headers,
    })
  }

  // CSV exports are plain links on the real server; here the file is made in the page.
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]")
      if (!(a instanceof HTMLAnchorElement)) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
        return
      }
      e.preventDefault()
      void ready.then((b) => {
        const res = handle(b, "GET", url.pathname + url.search)
        const name =
          /filename="([^"]+)"/.exec(
            res.headers["Content-Disposition"] ?? ""
          )?.[1] ?? "export.csv"
        const blob = new Blob([res.body], {
          type: res.headers["Content-Type"] ?? "text/plain",
        })
        const link = document.createElement("a")
        link.href = URL.createObjectURL(blob)
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
      })
    },
    true
  )
}
