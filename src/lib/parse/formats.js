import { ParseError, stripExtension } from './pdf'

/**
 * Word documents.
 *
 * Mammoth converts to HTML rather than raw text, which is what we want: the
 * heading levels survive, and those become the sections you can skip between.
 */
export async function parseDocx(file) {
  const mammoth = await import('mammoth/mammoth.browser.js')
  const buffer = await file.arrayBuffer()
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer })

  const blocks = blocksFromHtml(value)
  if (!blocks.length) throw new ParseError('This document has no text in it.')

  return { title: stripExtension(file.name), blocks }
}

/**
 * EPUB books.
 *
 * An EPUB is a zip. The manifest at META-INF/container.xml points to a package
 * file, whose spine lists the chapters in reading order — which is not the
 * same as the order the files happen to sit in the archive, so the spine has
 * to be followed rather than the file listing.
 */
export async function parseEpub(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new ParseError('This file is not a readable EPUB.')

  const container = parseXml(await containerFile.async('string'))
  const opfPath = container
    .querySelector('rootfile')
    ?.getAttribute('full-path')
  if (!opfPath) throw new ParseError('This EPUB has no package file.')

  const opf = parseXml(await zip.file(opfPath).async('string'))
  const root = opfPath.includes('/')
    ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
    : ''

  const hrefById = new Map()
  for (const item of opf.querySelectorAll('manifest > item')) {
    hrefById.set(item.getAttribute('id'), item.getAttribute('href'))
  }

  const blocks = []
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = hrefById.get(ref.getAttribute('idref'))
    if (!href) continue

    const entry = zip.file(resolvePath(root + href))
    if (!entry) continue

    blocks.push(...blocksFromHtml(await entry.async('string')))
  }

  if (!blocks.length) throw new ParseError('This EPUB has no readable text.')

  const title =
    opf.querySelector('title')?.textContent?.trim() || stripExtension(file.name)

  return { title, blocks }
}

export async function parseText(file) {
  const raw = await file.text()
  const blocks = raw
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => {
      const heading = text.match(/^#{1,6}\s+(.*)$/)
      return heading
        ? { type: 'heading', text: heading[1] }
        : { type: 'para', text }
    })

  if (!blocks.length) throw new ParseError('This file is empty.')

  return { title: stripExtension(file.name), blocks }
}

export async function parseHtml(file) {
  const blocks = blocksFromHtml(await file.text())
  if (!blocks.length) throw new ParseError('This page has no readable text.')
  return { title: stripExtension(file.name), blocks }
}

function parseXml(source) {
  return new DOMParser().parseFromString(source, 'application/xml')
}

/**
 * Turn markup into speakable blocks.
 *
 * Scripts, styles and navigation are removed first — a table of contents read
 * aloud is fifty link labels in a row, which is why chapter files get their
 * nav elements stripped rather than flattened.
 */
function blocksFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const node of doc.querySelectorAll('script, style, nav, header, footer'))
    node.remove()

  const blocks = []
  const selector = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td'

  for (const node of doc.body?.querySelectorAll(selector) ?? []) {
    // Skip containers whose text will be captured by a nested match.
    if (node.querySelector(selector)) continue

    const text = node.textContent.replace(/\s+/g, ' ').trim()
    if (!text) continue

    blocks.push({
      type: /^H[1-6]$/.test(node.tagName) ? 'heading' : 'para',
      text,
    })
  }

  return blocks
}

function resolvePath(path) {
  const parts = []
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
