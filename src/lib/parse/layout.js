/**
 * Turning positioned lines back into paragraphs.
 *
 * Both source pipelines hand us the same shape of problem. A PDF stores
 * positioned glyph runs; recognition returns positioned lines it read off an
 * image. Neither knows what a paragraph is, and reading their output in order
 * produces text that looks acceptable and sounds wrong — every line break
 * becomes a pause and every hyphen splits a word in half.
 *
 * A line is described by its text and its geometry: `y` for the baseline, `x`
 * for where it starts, `right` for where it ends.
 */

/**
 * Find running headers, footers and page numbers.
 *
 * Anything short that sits at the top or bottom of most pages is furniture,
 * not content, and reading it aloud on every page is maddening. Page numbers
 * differ from each other, so digits are masked before comparing.
 */
export function repeatedEdgeLines(pages) {
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

export function fingerprint(text) {
  return text.replace(/\d+/g, '#').toLowerCase().trim()
}

/**
 * Join lines into paragraphs.
 *
 * The decision that matters is when a line ends a paragraph rather than merely
 * wrapping. Punctuation alone cannot answer it: sentences end at line ends all
 * the time in justified text. Geometry can. A line ends a paragraph if it
 * stops short of the right margin, or the next line is indented, or there is a
 * vertical gap wider than the leading.
 *
 * Each returned block carries `sources`, recording where each contributing
 * line landed in the finished text. Recognition needs that to say which words
 * it was unsure of, since the words it doubted are identified by position in a
 * line, and the line no longer exists once paragraphs are assembled.
 */
export function linesToParagraphs(lines, options = {}) {
  const { looseness = 1.45 } = options
  const blocks = []

  if (!lines.length) return blocks

  const margin = Math.max(...lines.map((l) => l.right ?? 0))
  const shortOf = margin - Math.max(24, margin * 0.06)
  const indent = Math.min(...lines.map((l) => l.x ?? 0))
  const gapLimit = paragraphGap(lines, looseness)

  let buffer = ''
  let sources = []
  let previous = null

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim()
    if (text) {
      blocks.push({
        type: headingLike(text) ? 'heading' : 'para',
        text,
        sources,
      })
    }
    buffer = ''
    sources = []
  }

  for (const line of lines) {
    if (previous) {
      const gap = Math.abs((previous.y ?? 0) - (line.y ?? 0))
      const endedSentence = /[.!?]["')\]]?$/.test(previous.text)
      const stoppedShort = (previous.right ?? margin) < shortOf
      const isIndented = (line.x ?? indent) > indent + 8

      if (gap > gapLimit || isIndented || (endedSentence && stoppedShort)) {
        flush()
      }
    }

    // A word broken across a line rejoins. "consid-" followed by "eration" is
    // unlistenable, and hyphenation is common in justified print.
    const hyphenated = /[\u2010-\u2014-]$/.test(buffer.trimEnd())
    if (hyphenated) buffer = buffer.trimEnd().slice(0, -1)
    else if (buffer) buffer += ' '

    sources.push({ line, at: buffer.length })
    buffer += line.text

    previous = line
  }

  flush()
  return blocks
}

/**
 * The vertical gap that means a new paragraph.
 *
 * It cannot be a constant. Ordinary line spacing is whatever the document's
 * leading happens to be — around twenty points for twelve point text, more in
 * a double-spaced manuscript, less in a dense journal. A fixed threshold set
 * below the leading turns every single line into its own paragraph, which
 * sounds like a list being read out.
 *
 * The typical spacing in the document answers the question directly. The
 * median resists the outliers that headings and page edges introduce, and
 * anything meaningfully wider than typical is a real break.
 */
function paragraphGap(lines, looseness) {
  const gaps = []
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs((lines[i - 1].y ?? 0) - (lines[i].y ?? 0))
    if (gap > 0.5) gaps.push(gap)
  }

  // With nothing to compare against, never split on spacing alone. A wrong
  // guess here shatters the text into one-line fragments, whereas leaving the
  // decision to the short-line and indent tests merely misses the odd break.
  if (!gaps.length) return Infinity

  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return Math.max(median * looseness, median + 2.5)
}

export function headingLike(text) {
  return (
    text.length < 70 && !/[.!?:;,]$/.test(text) && text.split(/\s+/).length <= 12
  )
}

export function stripExtension(name) {
  return name.replace(/\.[^.]+$/, '')
}

export class ParseError extends Error {}
