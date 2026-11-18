// Generates the demo's traffic off the main thread, so the app's loading state keeps
// animating, and hands the finished tables over without copying them.

import { Generator } from "./generate"
import { HISTORY_DAYS, SPECS } from "./sites"

self.onmessage = (e: MessageEvent<{ now: number }>) => {
  const transfer: ArrayBuffer[] = []
  const tables = SPECS.map((spec) => {
    const table = new Generator({
      profile: spec.profile,
      now: e.data.now,
      days: HISTORY_DAYS,
      seed: spec.seed,
    }).run()
    const snap = table.snapshot()
    transfer.push(...snap.transfer)
    return snap.data
  })
  self.postMessage(tables, { transfer })
}
