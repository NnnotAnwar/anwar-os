// Copies the on-device OCR engine (tesseract.js worker, its WebAssembly core,
// English LSTM data) from node_modules into public/ocr/<version>/, where the
// document scanner loads it from this site only: nothing goes to a CDN and no
// document photo leaves the browser. Run by `pnpm dev` and `pnpm build`;
// public/ocr/ is not committed. Headers for it: next.config.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const root = dirname(require.resolve("tesseract.js/package.json"))
const coreRoot = dirname(require.resolve("tesseract.js-core/package.json", { paths: [root] }))
const engRoot = dirname(require.resolve("@tesseract.js-data/eng/package.json"))
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version

const out = join(process.cwd(), "public", "ocr", version)
const files = [
  [join(root, "dist", "worker.min.js"), "worker.min.js"],
  // LSTM-only cores (the scanner uses OEM 1): plain, SIMD and relaxed SIMD.
  ...["", "-simd", "-relaxedsimd"].map((v) => [join(coreRoot, `tesseract-core${v}-lstm.wasm.js`), `core/tesseract-core${v}-lstm.wasm.js`]),
  [join(engRoot, "4.0.0_best_int", "eng.traineddata.gz"), "lang/eng.traineddata.gz"],
]

let copied = 0
for (const [from, to] of files) {
  const target = join(out, to)
  if (existsSync(target)) continue
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(from, target)
  copied++
}
console.log(`ocr assets: public/ocr/${version} (${copied} copied, ${files.length - copied} already there)`)
