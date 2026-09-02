import {
  ParseError,
  linesToParagraphs,
  repeatedEdgeLines,
  fingerprint,
  stripExtension,
} from './layout'

// The worker runs on its own thread and is fetched as a file at runtime. The
// `?url` suffix hands the path to the bundler, which emits it as a build asset
// and rewrites the URL to include the /<repo>/ base GitHub Pages serves from.
// A hand-written path works in development and 404s once deployed.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfjs = null

export async function loadPdfjs() {
  if (pdfjs) return pdfjs
  pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

/** Thrown when a PDF has no text layer, so recognition is the only way in. */
export class NoTextLayer extends Error {}

export async function parsePdf(file, report) {
  const lib = await loadPdfjs()
  const buffer = await file.arrayBuffer()
  // Cleanup belongs to the loading task, not the document. Releasing the task
  // is what tears down the worker; the document proxy has no destroy of its
  // own, and calling one throws.
  const task = lib.getDocument({ data: buffer })
  const pdf = await task.promise

  const pages = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    pages.push(linesFromItems(content.items))
    page.cleanup()
    report?.({ progress: number / pdf.numPages, note: 'Reading text' })
  }

  const characters = pages.reduce(
    (total, lines) => total + lines.reduce((n, l) => n + l.text.length, 0),
    0,
  )

  // A scan contains images of words, not words. Rather than a blank document,
  // signal that recognition should take over — the same file then opens by a
  // different route. The threshold allows for the stray text a scanner stamps
  // on an otherwise imageless page.
  if (characters < Math.max(40, pdf.numPages * 8)) {
    await task.destroy()
    throw new NoTextLayer()
  }

  const noise = repeatedEdgeLines(pages)
  const blocks = []
  for (const lines of pages) {
    const kept = lines.filter((line) => !noise.has(fingerprint(line.text)))
    blocks.push(...linesToParagraphs(kept).map(stripSources))
  }

  await task.destroy()

  if (!blocks.length) throw new ParseError('This PDF has no readable text.')

  return { title: stripExtension(file.name), blocks }
}

/**
 * Draw PDF pages to images so recognition can read them.
 *
 * Rendered at roughly 200 dots per inch. Recognition accuracy climbs steeply
 * with resolution up to about this point and then flattens while memory keeps
 * climbing, and a phone will run out of memory long before it runs out of
 * patience.
 */
export async function rasterizePdf(file, onPage) {
  const lib = await loadPdfjs()
  const buffer = await file.arrayBuffer()
  const task = lib.getDocument({ data: buffer })
  const pdf = await task.promise

  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2.8, 1600 / base.width)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    await page.render({
      canvas,
      canvasContext: canvas.getContext('2d', { willReadFrequently: true }),
      viewport,
    }).promise

    await onPage(canvas, number, pdf.numPages)

    page.cleanup()
    canvas.width = 0
    canvas.height = 0
  }

  await task.destroy()
}

/**
 * Group positioned glyph runs into lines.
 *
 * Runs arrive in drawing order, which is usually but not always reading order.
 * Grouping by vertical position and sorting horizontally repairs the common
 * cases, including text drawn out of sequence.
 */
function linesFromItems(items) {
  const rows = new Map()

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue

    const x = item.transform[4]
    const y = item.transform[5]
    // Rounded to a tolerance, because glyphs on one visual line often sit a
    // fraction of a point apart.
    const key = Math.round(y / 3)

    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push({ x, y, right: x + (item.width || 0), str: item.str })
  }

  return [...rows.entries()]
    .sort((a, b) => b[1][0].y - a[1][0].y)
    .map(([, runs]) => {
      runs.sort((a, b) => a.x - b.x)
      return {
        y: runs[0].y,
        x: runs[0].x,
        right: Math.max(...runs.map((r) => r.right)),
        text: runs.map((r) => r.str).join('').replace(/\s+/g, ' ').trim(),
      }
    })
    .filter((line) => line.text.length > 0)
}

function stripSources({ sources: _sources, ...block }) {
  return block
}

export { stripExtension }
