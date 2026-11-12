// Fails when the production build grows past its gzipped size budgets. Run after `vite build`.
// The budgets leave about 10% headroom over the build they were set on; raise them on purpose
// (and say why in the PR), not by accident.
import { readdirSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import { gzipSync } from "node:zlib"

const KB = 1024
const budgets = {
  initial: 215 * KB, // JS index.html loads before anything renders: entry plus modulepreloads
  css: 25 * KB, // all stylesheets together
  chunk: 125 * KB, // any single lazily loaded chunk (charts, map, …)
  total: 450 * KB, // all JS together
}

const dist = new URL("./dist/", import.meta.url)
const fail = (msg) => {
  console.error(`check-size: ${msg}`)
  process.exit(1)
}

let html
try {
  html = readFileSync(new URL("index.html", dist), "utf8")
} catch {
  fail("no dist/index.html; run `bun run build` first")
}

// Every file the dashboard ships, by name. Fonts and images are already compressed; skip them.
const files = new Map()
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(e.name + (e.isDirectory() ? "/" : ""), dir)
    if (e.isDirectory()) walk(url)
    else if (/\.(js|css)$/.test(e.name))
      files.set(e.name, gzipSync(readFileSync(url), { level: 9 }).length)
  }
}
walk(dist)

const sizeOf = (name) => {
  const size = files.get(name)
  if (size === undefined) fail(`index.html references ${name}, which is not in dist/`)
  return size
}

const initial = [
  ...html.matchAll(/<script type="module"[^>]*\ssrc="([^"]+\.js)"/g),
  ...html.matchAll(/<link rel="modulepreload"[^>]*\shref="([^"]+\.js)"/g),
].map((m) => basename(m[1]))
if (initial.length === 0) fail("no module script in dist/index.html")

const names = [...files.keys()]
const js = names.filter((n) => n.endsWith(".js"))
const css = names.filter((n) => n.endsWith(".css"))
const sum = (list) => list.reduce((n, name) => n + sizeOf(name), 0)

const failures = []
const check = (label, size, budget) => {
  const line = `${label}: ${(size / KB).toFixed(1)} KB gzipped (budget ${budget / KB} KB)`
  console.log(line)
  if (size > budget) failures.push(line)
}

check(`initial JS (${initial.join(", ")})`, sum(initial), budgets.initial)
check(`CSS (${css.length} files)`, sum(css), budgets.css)
const lazy = js.filter((n) => !initial.includes(n)).sort((a, b) => sizeOf(b) - sizeOf(a))
if (lazy[0]) check(`largest lazy chunk ${lazy[0]}`, sizeOf(lazy[0]), budgets.chunk)
check(`all JS (${js.length} files)`, sum(js), budgets.total)

if (failures.length) fail(`over budget:\n  ${failures.join("\n  ")}`)
