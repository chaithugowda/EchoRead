/**
 * Split text into word tokens that keep their character offsets.
 *
 * The speech engine reports progress as a character index into the string it
 * was given, not as a word number. To highlight a word we need to map that
 * index back to something we rendered, so every token carries its own span.
 */
export function tokenize(text) {
  const tokens = []
  const pattern = /\S+/g
  let match

  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return tokens
}

/**
 * Find the token containing a character index.
 *
 * Engines disagree about where a word starts — some point at the first letter,
 * some include leading whitespace, some land a character early on punctuation.
 * So we take the last token that begins at or before the index rather than
 * requiring an exact containment match.
 */
export function tokenAtIndex(tokens, charIndex) {
  if (charIndex < 0) return -1

  let found = -1
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start <= charIndex) found = i
    else break
  }
  return found
}

const MAX_CHUNK = 220

/**
 * Break text into short passages, each spoken as its own utterance.
 *
 * Three problems get solved at once by never sending the engine a long string:
 *
 *   1. Chrome stops speaking after roughly fifteen seconds. Short passages
 *      finish well inside that window.
 *   2. When word timing has to be estimated, error accumulates the longer a
 *      passage runs. Every passage boundary is a position the engine confirms
 *      by finishing, which resets the estimate before drift becomes visible.
 *   3. Skipping back and forward needs somewhere to land, and a sentence is
 *      what a reader means by "again".
 *
 * Sentence endings are preferred, then clause breaks, then any word boundary
 * for text that never punctuates.
 */
export function buildChunks(text) {
  const chunks = []
  let cursor = 0

  while (cursor < text.length) {
    if (cursor + MAX_CHUNK >= text.length) {
      chunks.push({ start: cursor, end: text.length })
      break
    }

    const window = text.slice(cursor, cursor + MAX_CHUNK)
    let cut = lastMatch(window, /[.!?]["')\]]?\s/g)
    if (cut < MAX_CHUNK * 0.4) cut = lastMatch(window, /[,;:—]\s/g)
    if (cut < MAX_CHUNK * 0.4) cut = window.lastIndexOf(' ') + 1
    if (cut <= 0) cut = MAX_CHUNK

    chunks.push({ start: cursor, end: cursor + cut })
    cursor += cut
  }

  return chunks.filter((c) => text.slice(c.start, c.end).trim().length > 0)
}

function lastMatch(haystack, pattern) {
  let end = -1
  let match
  while ((match = pattern.exec(haystack)) !== null) {
    end = match.index + match[0].length
  }
  return end
}

/**
 * How long a word should stay highlighted, relative to its neighbours.
 *
 * Longer words take longer to say, and punctuation buys a pause that belongs
 * to the word before it. Without this the highlight moves at a constant clip
 * and visibly runs ahead of the voice at every full stop.
 */
export function weighToken(token) {
  let weight = token.text.length + 1
  if (/[,;:]$/.test(token.text)) weight += 5
  if (/[.!?]["')\]]?$/.test(token.text)) weight += 10
  return weight
}
