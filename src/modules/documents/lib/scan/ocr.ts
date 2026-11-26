// On-device OCR for the document scanner: tesseract.js in a worker, its core
// and English data served from this site (scripts/ocr-assets.mjs), so a
// document photo never leaves the browser. Browser-only; loaded on first scan.
import type { Worker } from "tesseract.js"
import { rotate180, type Pixels } from "./geometry"

/** tesseract.js's version: the folder public/ocr/<version>/ (a test keeps it in step with the package). */
export const OCR_VERSION = "7.0.0"
const BASE = `/ocr/${OCR_VERSION}`

const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"

/** "Loading the reader…" (the first time, ~4 MB) or "Reading…", 0–1. */
export type OcrProgress = { stage: "loading" | "reading"; progress: number }

let listener: ((p: OcrProgress) => void) | null = null
let worker: Promise<Worker> | null = null

function getWorker() {
  worker ??= import("tesseract.js").then(({ createWorker, OEM }) =>
    createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/core`,
      langPath: `${BASE}/lang`,
      gzip: true,
      // The site's CSP allows workers from this origin only, not blob: URLs.
      workerBlobURL: false,
      logger: (m) => {
        const loading = m.status !== "recognizing text"
        listener?.({ stage: loading ? "loading" : "reading", progress: m.progress ?? 0 })
      },
    }),
  )
  worker.catch(() => {
    worker = null
  })
  return worker
}

/** Frees the OCR worker (and its memory) until the next scan. */
export async function releaseOcr() {
  const w = worker
  worker = null
  if (w) await (await w).terminate().catch(() => {})
}

function toCanvas(img: Pixels, crop?: { top: number; bottom: number }, scale = 1) {
  const top = Math.round((crop?.top ?? 0) * img.height)
  const bottom = Math.round((crop?.bottom ?? 1) * img.height)
  const source = document.createElement("canvas")
  source.width = img.width
  source.height = img.height
  source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round((bottom - top) * scale)
  const ctx = canvas.getContext("2d")!
  // Grey and a little contrast: the MRZ's OCR-B reads better without the card's colours.
  ctx.filter = crop ? "grayscale(1) contrast(1.4)" : "none"
  ctx.drawImage(source, 0, top, img.width, bottom - top, 0, 0, canvas.width, canvas.height)
  return canvas
}

export type PhotoText = { text: string; mrzText: string; confidence: number; rotated: boolean }

async function readOnce(w: Worker, img: Pixels) {
  const { PSM } = await import("tesseract.js")
  await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, tessedit_char_whitelist: "" })
  const full = await w.recognize(toCanvas(img))
  // The MRZ sits along the bottom of an ID card's back and of a passport's data page.
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: MRZ_CHARS })
  const mrz = await w.recognize(toCanvas(img, { top: 0.55, bottom: 1 }, 1.5))
  return { text: full.data.text, mrzText: mrz.data.text, confidence: full.data.confidence }
}

const looksLikeMrz = (text: string) => /<{3,}/.test(text.replace(/\s/g, ""))

/**
 * The text on one flattened card photo, plus an MRZ-only pass over its lower
 * part. A photo that reads badly and shows no MRZ is tried upside down too;
 * `rotated` says the half-turned one read better.
 */
export async function readPhoto(img: Pixels, onProgress?: (p: OcrProgress) => void): Promise<PhotoText> {
  listener = onProgress ?? null
  try {
    const w = await getWorker()
    const upright = await readOnce(w, img)
    if (looksLikeMrz(upright.mrzText) || upright.confidence >= 60) return { ...upright, rotated: false }
    const turned = await readOnce(w, rotate180(img))
    const better = looksLikeMrz(turned.mrzText) || turned.confidence > upright.confidence + 10
    return better ? { ...turned, rotated: true } : { ...upright, rotated: false }
  } finally {
    listener = null
  }
}
