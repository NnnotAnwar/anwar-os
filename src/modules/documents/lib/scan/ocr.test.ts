import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { OCR_VERSION } from "./ocr"

describe("OCR assets", () => {
  it("point at the installed tesseract.js (scripts/ocr-assets.mjs copies that version)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "node_modules/tesseract.js/package.json"), "utf8"))
    expect(OCR_VERSION).toBe(pkg.version)
  })

  it("ship the worker, the LSTM cores and the English data", () => {
    const script = readFileSync(join(process.cwd(), "scripts/ocr-assets.mjs"), "utf8")
    for (const part of ["worker.min.js", "-lstm.wasm.js", "eng.traineddata.gz", "4.0.0_best_int"]) expect(script).toContain(part)
    expect(existsSync(join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"))).toBe(true)
  })
})
