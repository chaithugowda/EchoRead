/**
 * Pull readable prose out of a PDF.
 *
 * A PDF stores positioned glyph runs, not sentences. Extracting the runs in
 * order gives text that looks fine on screen and sounds wrong when spoken:
 * every line break becomes a pause, hyphenated words split in half, and the
 * running header is read out on every page. This module reconstructs the
 * paragraphs instead.
 */

// The worker runs in a separate thread and so must be fetched as a file at
// runtime. The `?url` suffix hands the path to the bundler, which emits the
// worker as a build asset and rewrites the URL to include the /<repo>/ base
// that GitHub Pages serves from. A path written by hand works in development
// and returns 404 once deployed, which is a difficult failure to read: the
// PDF simply never opens.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfjs = null

async function loadPdfjs() {
  if (pdfjs) return pdfjs
  pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

export async function parsePdf(file, onProgress) {
  const lib = await loadPdfjs()
  const buffer = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: buffer }).promise

  const pages = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    pages.push(linesFromItems(content.items))
    page.cleanup()
    onProgress?.(number / pdf.numPages)
  }

  const noise = repeatedEdgeLines(pages)
  const blocks = []

  for (const lines of pages) {
    const kept = lines.filter((line) => !noise.has(fingerprint(line.text)))
    blocks.push(...paragraphsFromLines(kept))
  }

  if (!blocks.length) {
    throw new ParseError(
      'This PDF has no text in it. It is most likely a scan, which needs ' +
        'character recognition to read — that arrives in a later phase.',
    )
  }

  return { title: stripExtension(file.name), blocks }
}

export class ParseError extends Error {}

/**
 * Group positioned glyph runs into lines.
 *
 * Runs arrive in drawing order, which is usually but not always reading order.
 * Grouping by vertical position and then sorting horizontally repairs the
 * common cases, including text drawn out of sequence.
 */
function linesFromItems(items) {
  const rows = new Map()

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue

    const x = item.transform[4]
    const y = item.transform[5]
    const width = item.width || 0
    // Round to a tolerance so glyphs on the same visual line, which often sit
    // a fraction of a point apart, land in the same bucket.
    const key = Math.round(y / 3)

    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push({ x, y, right: x + width, str: item.str })
  }

  return [...rows.entries()]
    .sort((a, b) => b[1][0].y - a[1][0].y)
    .map(([, runs]) => {
      runs.sort((a, b) => a.x - b.x)
      return {
        y: runs[0].y,
        x: runs[0].x,
        right: Math.max(...runs.map((r) => r.right)),
        text: runs
          .map((r) => r.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
      }
    })
    .filter((line) => line.text.length > 0)
}

/**
 * Find running headers, footers and page numbers.
 *
 * Anything short that appears at the top or bottom of most pages is furniture
 * rather than content. Page numbers vary, so digits are masked before
 * comparing.
 */
function repeatedEdgeLines(pages) {
  if (pages.length < 3) return new Set()

  const counts = new Map()

  for (const lines of pages) {
    const edges = [...lines.slice(0, 2), ...lines.slice(-2)]
    for (const line of new Set(edges)) {
      if (line.text.length > 90) continue
      const key = fingerprint(line.text)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }

  const threshold = Math.max(3, Math.floor(pages.length * 0.5))
  const noise = new Set()
  for (const [key, count] of counts) {
    if (count >= threshold) noise.add(key)
  }
  return noise
}

function fingerprint(text) {
  return text.replace(/\d+/g, '#').toLowerCase().trim()
}

/**
 * Join lines back into paragraphs.
 *
 * A line ending mid-sentence continues the paragraph; a blank gap, a short
 * final line, or a sentence-ending full stop closes it. Words split across a
 * line with a hyphen are rejoined, because "consid-" followed by "eration"
 * is unlistenable.
 */
function paragraphsFromLines(lines) {
  const blocks = []
  let buffer = ''
  let previous = null

  // The right-hand margin, taken as the furthest any line reaches. A line that
  // stops well short of it ended because its paragraph ended; a line that runs
  // to the margin was merely wrapped, whatever punctuation it happens to end
  // on. Without this test every sentence that lands at a line end starts a
  // spurious paragraph.
  const margin = lines.length ? Math.max(...lines.map((l) => l.right)) : 0
  const shortOf = margin - Math.max(24, margin * 0.06)
  const indent = lines.length ? Math.min(...lines.map((l) => l.x)) : 0

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ type: headingLike(text) ? 'heading' : 'para', text })
    buffer = ''
  }

  for (const line of lines) {
    if (previous) {
      const gap = Math.abs(previous.y - line.y)
      const endedSentence = /[.!?]["')\]]?$/.test(previous.text)
      const stoppedShort = previous.right < shortOf
      const isIndented = line.x > indent + 8

      const paragraphBreak =
        gap > 18 || isIndented || (endedSentence && stoppedShort)

      if (paragraphBreak) flush()
    }

    if (/[\u2010-\u2014-]$/.test(buffer.trimEnd())) {
      buffer = buffer.trimEnd().slice(0, -1) + line.text
    } else {
      buffer += (buffer ? ' ' : '') + line.text
    }

    previous = line
  }

  flush()
  return blocks
}

function headingLike(text) {
  return (
    text.length < 70 &&
    !/[.!?:;,]$/.test(text) &&
    text.split(/\s+/).length <= 12
  )
}

export function stripExtension(name) {
  return name.replace(/\.[^.]+$/, '')
}
