// Fails when the production build grows past its gzipped size budgets. Run after `vite build`.
// The budgets leave about 10% headroom over the build they were set on; raise them on purpose
// (and say why in the PR), not by accident.
import { readdirSync, readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"

const KB = 1024
const budgets = {
  entry: 160 * KB, // the JS every page load needs before anything renders
  css: 25 * KB,
  chunk: 125 * KB, // any lazily loaded chunk (charts, map, …)
  total: 450 * KB, // all JS together
}

const dir = new URL("./dist/", import.meta.url)
const html = readFileSync(new URL("index.html", dir), "utf8")
const entry = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1]
if (!entry) {
  console.error("check-size: no entry script in dist/index.html; run `bun run build` first")
  process.exit(1)
}

const gz = (name) => gzipSync(readFileSync(new URL(`assets/${name}`, dir)), { level: 9 }).length
const files = readdirSync(new URL("assets/", dir)).map((name) => ({ name, size: gz(name) }))
const js = files.filter((f) => f.name.endsWith(".js"))

const failures = []
const check = (label, size, budget) => {
  const line = `${label}: ${(size / KB).toFixed(1)} KB gzipped (budget ${budget / KB} KB)`
  console.log(line)
  if (size > budget) failures.push(line)
}

check(`entry ${entry}`, js.find((f) => f.name === entry).size, budgets.entry)
for (const f of files.filter((f) => f.name.endsWith(".css"))) check(f.name, f.size, budgets.css)
const largest = js.filter((f) => f.name !== entry).sort((a, b) => b.size - a.size)[0]
if (largest) check(`largest chunk ${largest.name}`, largest.size, budgets.chunk)
check(
  `all JS (${js.length} files)`,
  js.reduce((n, f) => n + f.size, 0),
  budgets.total
)

if (failures.length) {
  console.error(`\nOver budget:\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
