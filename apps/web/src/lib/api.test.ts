import { afterEach, describe, expect, it, vi } from "vitest"

import { api, ApiError } from "@/lib/api"

function respond(
  status: number,
  body: string,
  headers: Record<string, string> = {}
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status, headers }))
}

afterEach(() => vi.restoreAllMocks())

describe("api errors", () => {
  it("uses the server's error message", async () => {
    respond(404, '{"error":"site not found"}', {
      "Content-Type": "application/json",
    })
    await expect(api.site("x")).rejects.toMatchObject({
      status: 404,
      message: "site not found",
    })
  })
  it("falls back to the status when the body is not JSON (HTTP/2 has no status text)", async () => {
    respond(502, "<html>bad gateway</html>")
    const err = await api.site("x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toMatch(/^(HTTP 502|Bad Gateway)$/)
  })
})

describe("api requests", () => {
  it("sends JSON bodies with the content type the server requires", async () => {
    const fetch = respond(201, "{}")
    await api.createSite({ name: "A", domain: "a.example" })
    const [, init] = fetch.mock.calls[0]!
    expect(init?.method).toBe("POST")
    expect(init?.credentials).toBe("same-origin")
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    )
  })
  it("encodes the site id in the path", async () => {
    const fetch = respond(200, "{}")
    await api.site("../auth/me")
    expect(fetch.mock.calls[0]![0]).toBe("/api/sites/..%2Fauth%2Fme")
  })
  it("serialises the scope into query parameters", async () => {
    const fetch = respond(200, "[]")
    await api.breakdown(
      "s1",
      {
        from: "2026-11-01",
        to: "2026-11-04",
        tz: "Europe/Oslo",
        filters: [{ dim: "path", op: "is", value: "/a:b" }],
        compare: "year",
      },
      "referrer",
      { limit: 5, metrics: "full" }
    )
    const url = new URL(String(fetch.mock.calls[0]![0]), "http://x")
    expect(url.pathname).toBe("/api/sites/s1/breakdown")
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-04",
      tz: "Europe/Oslo",
      compare: "year",
      dim: "referrer",
      limit: "5",
      metrics: "full",
      f: "path:is:/a:b",
    })
  })
  it("returns undefined for 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    )
    await expect(api.deleteSite("s1")).resolves.toBeUndefined()
  })
})
