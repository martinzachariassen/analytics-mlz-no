// Generates the demo's traffic off the main thread, so the app's loading state keeps
// animating, and hands the finished tables over without copying them. It takes no
// input: it reads the clock itself and reports it, so there is no message to trust.

import { Generator } from "./generate"
import { HISTORY_DAYS, SPECS } from "./sites"

const now = Date.now()
const transfer: ArrayBuffer[] = []
const tables = SPECS.map((spec) => {
  const table = new Generator({
    profile: spec.profile,
    now,
    days: HISTORY_DAYS,
    seed: spec.seed,
  }).run()
  const snap = table.snapshot()
  transfer.push(...snap.transfer)
  return snap.data
})
self.postMessage({ now, tables }, { transfer })
