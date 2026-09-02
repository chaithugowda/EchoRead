import { NoTextLayer, parsePdf, rasterizePdf } from './pdf'
import { parseDocx, parseEpub, parseHtml, parseText } from './formats'
import { ParseError, stripExtension } from './layout'
import { detectScript, looksGarbled } from '../script'

export { ParseError }

const HANDLERS = [
  { extensions: ['pdf'], parse: parsePdf, label: 'PDF' },
  { extensions: ['docx'], parse: parseDocx, label: 'Word document' },
  { extensions: ['epub'], parse: parseEpub, label: 'EPUB' },
  { extensions: ['html', 'htm'], parse: parseHtml, label: 'web page' },
  { extensions: ['txt', 'md', 'markdown', 'text'], parse: parseText, label: 'text' },
]

const IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif']

export const ACCEPTED =
  '.pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm,' +
  IMAGES.map((e) => `.${e}`).join(',')

/**
 * Read a file into a document.
 *
 * Parsers load on demand. Together they run to several megabytes, and an app
 * most people open to paste a paragraph should not pay for a PDF engine and a
 * recognition engine before it draws anything.
 */
export async function parseFile(file, report, options = {}) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (IMAGES.includes(extension)) {
    return {
      ...(await parseImage(file, report, options.language)),
      format: extension,
    }
  }

  const handler = HANDLERS.find((h) => h.extensions.includes(extension))
  if (!handler) {
    throw new ParseError(
      `echoread cannot read .${extension} files. Try a PDF, Word document, ` +
        'EPUB, web page, photo, or plain text file.',
    )
  }

  try {
    const parsed = await handler.parse(file, report)
    const document = { ...buildDocument(parsed), format: extension }

    // Extraction can succeed and still return nothing readable, which is
    // common for Indian-language PDFs built on legacy fonts. Say so rather
    // than storing gibberish, and let the caller offer recognition instead.
    if (extension === 'pdf' && looksGarbled(document.text)) {
      document.garbled = true
    }
    return document
  } catch (error) {
    // A PDF with no text layer is a scan. Recognition can still read it, so
    // the same file opens by the other route rather than failing.
    if (error instanceof NoTextLayer) {
      return {
        ...(await parseScannedPdf(file, report, options.language)),
        format: 'pdf',
      }
    }
    if (error instanceof ParseError) throw error
    throw new ParseError(
      `This ${handler.label} could not be opened. It may be damaged or ` +
        'password protected.',
    )
  }
}

async function parseImage(file, report, language) {
  const { recognizeImage, blocksFromPages } = await import('./ocr')
  report?.({ progress: 0.05, note: 'Preparing the recogniser' })

  const bitmap = await loadImage(file)
  const lines = await recognizeImage(bitmap, {
    language,
    report: (update) => report?.(update),
  })
  bitmap.close?.()

  const blocks = blocksFromPages([lines])
  if (!blocks.length) {
    throw new ParseError(
      'No text could be read from that image. A flatter, more evenly lit ' +
        'photograph usually helps more than a closer one.',
    )
  }

  report?.({ progress: 1, note: 'Done' })
  return buildDocument({ title: stripExtension(file.name), blocks })
}

export async function parseScannedPdf(file, report, language) {
  const { recognizeImage, blocksFromPages } = await import('./ocr')
  const pages = []

  await rasterizePdf(file, async (canvas, number, total) => {
    report?.({
      progress: (number - 1) / total,
      note: `Reading page ${number} of ${total}`,
      scanning: true,
    })
    pages.push(await recognizeImage(canvas, { language }))
    report?.({
      progress: number / total,
      note: `Reading page ${number} of ${total}`,
      scanning: true,
    })
  })

  const blocks = blocksFromPages(pages)
  if (!blocks.length) {
    throw new ParseError('No text could be read from that scan.')
  }

  return buildDocument({ title: stripExtension(file.name), blocks })
}

/** Recognise images already captured by the camera. */
export async function parseCaptures(canvases, title, report, language) {
  const { recognizeImage, blocksFromPages } = await import('./ocr')
  const pages = []

  for (let i = 0; i < canvases.length; i++) {
    report?.({
      progress: i / canvases.length,
      note: `Reading page ${i + 1} of ${canvases.length}`,
      scanning: true,
    })
    pages.push(
      await recognizeImage(canvases[i], { report: (u) => report?.(u) }),
    )
  }

  const blocks = blocksFromPages(pages)
  if (!blocks.length) {
    throw new ParseError(
      'No text could be read from those photographs. Flat, evenly lit pages ' +
        'read far better than close-ups.',
    )
  }

  report?.({ progress: 1, note: 'Done' })
  return { ...buildDocument({ title, blocks }), format: 'scan' }
}

function loadImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file)

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ParseError('That image could not be opened.'))
    }
    image.src = url
  })
}

export function documentFromText(text, title = 'Pasted text') {
  const blocks = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => ({ type: 'para', text: part }))

  return buildDocument({
    title,
    blocks: blocks.length ? blocks : [{ type: 'para', text }],
  })
}

/**
 * Flatten blocks into one string, keeping each block's character range.
 *
 * The reader engine works on a single string with character offsets, because
 * that is what the speech API reports positions in. Keeping the ranges lets
 * the page render headings and paragraphs separately while the engine still
 * sees continuous prose. Blocks are joined with a blank line so the voice
 * takes a breath rather than running a heading into the paragraph beneath it.
 */
export function buildDocument({ title, blocks }) {
  let text = ''
  const spans = []

  for (const block of blocks) {
    if (text) text += '\n\n'
    const start = text.length
    text += block.text
    spans.push({ ...block, start, end: text.length })
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const script = detectScript(text)

  return { title, text, blocks: spans, words, script: script.id }
}
