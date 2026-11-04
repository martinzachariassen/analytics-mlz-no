import { describe, expect, it } from "vitest"

import { encodeFilter, MAX_FILTERS, parseFilter } from "@/lib/use-scope"

describe("parseFilter", () => {
  it("parses dim:op:value and keeps colons in the value", () => {
    expect(parseFilter("path:is:/a:b")).toEqual({
      dim: "path",
      op: "is",
      value: "/a:b",
    })
  })
  it("rejects unknown operators, dimensions and malformed input", () => {
    expect(parseFilter("path:like:/a")).toBeNull()
    expect(parseFilter("nope:is:/a")).toBeNull()
    expect(parseFilter("path")).toBeNull()
  })
  it("caps the number of filters at what the API accepts", () => {
    expect(MAX_FILTERS).toBe(10)
  })
  it("round-trips with encodeFilter", () => {
    const f = { dim: "path", op: "contains", value: "blog" } as const
    expect(parseFilter(encodeFilter(f))).toEqual(f)
  })
})
