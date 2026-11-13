// Fails when the built tracking script exceeds its gzipped size budget. The budget is what the
// README promises ("about 1.1 KB gzipped"); raise it on purpose, not by accident.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budget = 1100;
const script = readFileSync(new URL("../server/internal/script/script.js", import.meta.url));
const gz = gzipSync(script, { level: 9 }).length;
console.log(`script.js: ${script.length} B minified, ${gz} B gzipped (budget ${budget} B)`);
if (gz > budget) {
  console.error(`script.js is ${gz - budget} B over budget`);
  process.exit(1);
}
