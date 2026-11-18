import { describe, expect, it } from "vitest"

import { type Backend, handle } from "./engine"
import { type RawEvent, Table } from "./table"
import events from "./testdata/events.json"
import golden from "./testdata/golden.json"
import fixture from "./testdata/requests.json"

// golden.json holds the Go API's answers to requests.json over events.json
// (apps/server/internal/api/demo_golden_test.go). The demo engine must give the same
// answers, so the demo behaves like the real dashboard.

type Answer = {
  request: string
  status: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

function backend(): Backend {
  const table = new Table()
  for (const e of events as RawEvent[]) table.append(e)
  const now = Date.parse(fixture.now)
  return {
    sites: [
      {
        id: "golden",
        name: "Lumen",
        domain: "lumen.example",
        createdAt: now,
        table,
      },
    ],
    goals: new Map([
      [
        "golden",
        (fixture.goals as ["event" | "path", string][]).map(
          ([kind, value], i) => ({
            id: i + 1,
            kind,
            value,
            createdAt: now,
          })
        ),
      ],
    ]),
    now: () => now,
    user: { login: "demo", provider: "demo" },
    nextGoalId: fixture.goals.length + 1,
  }
}

function withoutCreatedAt(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutCreatedAt)
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== "created_at")
        .map(([k, e]) => [k, withoutCreatedAt(e)])
    )
  }
  return v
}

/** Equal, allowing floating point noise in averages and rates. */
function close(got: unknown, want: unknown, path = "$"): string | null {
  if (typeof want === "number" && typeof got === "number") {
    return Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
      ? null
      : `${path}: ${got} != ${want}`
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return `${path}: not an array`
    if (got.length !== want.length) {
      return `${path}: length ${got.length} != ${want.length}`
    }
    for (let i = 0; i < want.length; i++) {
      const d = close(got[i], want[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (want && typeof want === "object") {
    if (!got || typeof got !== "object") return `${path}: not an object`
    const keys = new Set([...Object.keys(want), ...Object.keys(got)])
    for (const k of keys) {
      const d = close(
        (got as Record<string, unknown>)[k],
        (want as Record<string, unknown>)[k],
        `${path}.${k}`
      )
      if (d) return d
    }
    return null
  }
  return Object.is(got, want)
    ? null
    : `${path}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`
}

describe("demo engine matches the Go API", () => {
  const b = backend()
  it("covers every request", () => {
    expect((golden as Answer[]).map((a) => a.request)).toEqual(fixture.requests)
  })
  for (const want of golden as Answer[]) {
    it(want.request, () => {
      const res = handle(b, "GET", want.request.replaceAll("{site}", "golden"))
      expect(res.status).toBe(want.status)
      if (want.text !== undefined) {
        expect(res.body).toBe(want.text)
        for (const [k, v] of Object.entries(want.headers ?? {})) {
          expect(res.headers[k]).toBe(v)
        }
        expect(res.headers["X-Truncated"]).toBe(want.headers?.["X-Truncated"])
      } else {
        const diff = close(withoutCreatedAt(JSON.parse(res.body)), want.json)
        expect(diff).toBeNull()
      }
    })
  }
})
