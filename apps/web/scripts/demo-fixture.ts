// Writes events.json, the fixture the golden tests load into both the Go store and the
// demo engine: a few months of Lumen traffic at a small scale, ending at a fixed time.
// Run from apps/web: bun run demo:fixture

import { writeFileSync } from "node:fs"

import { Generator } from "../src/demo/generate"
import { LUMEN } from "../src/demo/lumen"
import fixture from "../src/demo/testdata/requests.json"

const table = new Generator({
  profile: LUMEN,
  now: Date.parse(fixture.now),
  days: 100,
  seed: 3,
  scale: 0.012,
}).run()

// The table keeps visitor indexes; the fixture needs ids, which indexes serve as.
const rows: Record<string, unknown>[] = []
for (let i = 0; i < table.n; i++) {
  const e: Record<string, unknown> = {
    ts: table.ts[i],
    type: table.type[i] === 0 ? "pageview" : "event",
    visitor: table.visitor[i]! + 1,
  }
  for (const c of [
    "name",
    "hostname",
    "path",
    "referrer",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "country",
    "browser",
    "os",
    "device",
  ] as const) {
    const v = table.str(c, i)
    if (v !== "") e[c] = v
  }
  if (table.propCount[i]! > 0) {
    const props: Record<string, string> = {}
    for (
      let p = table.propStart[i]!;
      p < table.propStart[i]! + table.propCount[i]!;
      p++
    ) {
      props[table.propKeys.values[table.propKey[p]!]!] =
        table.propValues.values[table.propValue[p]!]!
    }
    e.props = props
  }
  rows.push(e)
}
writeFileSync(
  new URL("../src/demo/testdata/events.json", import.meta.url),
  `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`
)
console.log(`wrote ${rows.length} events`)
