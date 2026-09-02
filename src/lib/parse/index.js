import { ParseError, parsePdf } from './pdf'
import { parseDocx, parseEpub, parseHtml, parseText } from './formats'

export { ParseError }

const HANDLERS = [
  { extensions: ['pdf'], parse: parsePdf, label: 'PDF' },
  { extensions: ['docx'], parse: parseDocx, label: 'Word document' },
  { extensions: ['epub'], parse: parseEpub, label: 'EPUB' },
  { extensions: ['html', 'htm'], parse: parseHtml, label: 'web page' },
  { extensions: ['txt', 'md', 'markdown', 'text'], parse: parseText, label: 'text' },
]

export const ACCEPTED = '.pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm'

/**
 * Read a file into a document, choosing the parser by extension.
 *
 * Parsers are imported on demand. Together they weigh well over a megabyte,
 * and loading all of them up front would delay the first paint of an app that
 * most people open just to paste some text.
 */
export async function parseFile(file, onProgress) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const handler = HANDLERS.find((h) => h.extensions.includes(extension))

  if (!handler) {
    throw new ParseError(
      `echoread cannot read .${extension} files. Try a PDF, Word document, ` +
        'EPUB, web page, or plain text file.',
    )
  }

  try {
    const parsed = await handler.parse(file, onProgress)
    return { ...buildDocument(parsed), format: extension }
  } catch (error) {
    if (error instanceof ParseError) throw error
    throw new ParseError(
      `This ${handler.label} could not be opened. It may be damaged or ` +
        'password protected.',
    )
  }
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
 * sees continuous prose.
 *
 * Blocks are joined with a blank line so the voice takes a breath between
 * them instead of running a heading into the paragraph beneath it.
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

  return { title, text, blocks: spans, words }
}
