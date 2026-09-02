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
