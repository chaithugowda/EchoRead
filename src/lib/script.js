/**
 * Working out what script a document is written in.
 *
 * Three separate decisions depend on the answer, and getting it wrong is
 * visible in all of them: which font can actually draw the text, how much
 * vertical room a line needs, and which voice could read it aloud. Detection
 * is by Unicode range rather than by guessing at words, because a script is a
 * property of the characters themselves and needs no dictionary.
 */

const SCRIPTS = [
  {
    id: 'kannada',
    label: 'Kannada',
    range: /[\u0C80-\u0CFF]/g,
    lang: 'kn-IN',
    tesseract: 'kan',
    // Vowel signs stack above and below the baseline, so a line occupies far
    // more vertical space than Latin at the same point size. Ordinary leading
    // clips them.
    leading: 2.25,
    font: '"Noto Serif Kannada"',
  },
  { id: 'devanagari', label: 'Hindi or Marathi', range: /[\u0900-\u097F]/g, lang: 'hi-IN', tesseract: 'hin', leading: 2.15, font: '"Noto Serif Devanagari"' },
  { id: 'tamil', label: 'Tamil', range: /[\u0B80-\u0BFF]/g, lang: 'ta-IN', tesseract: 'tam', leading: 2.15, font: '"Noto Serif Tamil"' },
  { id: 'telugu', label: 'Telugu', range: /[\u0C00-\u0C7F]/g, lang: 'te-IN', tesseract: 'tel', leading: 2.25, font: '"Noto Serif Telugu"' },
  { id: 'malayalam', label: 'Malayalam', range: /[\u0D00-\u0D7F]/g, lang: 'ml-IN', tesseract: 'mal', leading: 2.15, font: '"Noto Serif Malayalam"' },
  { id: 'bengali', label: 'Bengali', range: /[\u0980-\u09FF]/g, lang: 'bn-IN', tesseract: 'ben', leading: 2.15, font: '"Noto Serif Bengali"' },
  { id: 'gujarati', label: 'Gujarati', range: /[\u0A80-\u0AFF]/g, lang: 'gu-IN', tesseract: 'guj', leading: 2.15, font: '"Noto Serif Gujarati"' },
  { id: 'gurmukhi', label: 'Punjabi', range: /[\u0A00-\u0A7F]/g, lang: 'pa-IN', tesseract: 'pan', leading: 2.15, font: '"Noto Serif Gurmukhi"' },
  { id: 'arabic', label: 'Arabic', range: /[\u0600-\u06FF]/g, lang: 'ar-SA', tesseract: 'ara', leading: 2.1, font: '"Noto Naskh Arabic"', rtl: true },
  { id: 'cjk', label: 'Chinese or Japanese', range: /[\u4E00-\u9FFF\u3040-\u30FF]/g, lang: 'zh-CN', tesseract: 'chi_sim', leading: 1.95, font: 'inherit' },
]

export const LATIN = {
  id: 'latin',
  label: 'English',
  lang: 'en-US',
  tesseract: 'eng',
  leading: 1.85,
  font: '"Literata"',
}

export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'kan', label: 'Kannada' },
  { code: 'hin', label: 'Hindi' },
  { code: 'tam', label: 'Tamil' },
  { code: 'tel', label: 'Telugu' },
  { code: 'mal', label: 'Malayalam' },
  { code: 'ben', label: 'Bengali' },
  { code: 'guj', label: 'Gujarati' },
  { code: 'mar', label: 'Marathi' },
  { code: 'urd', label: 'Urdu' },
  { code: 'ara', label: 'Arabic' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
]

/**
 * Identify the dominant script in a passage.
 *
 * A sample is enough — the opening of a document is representative, and
 * scanning a whole book to answer a question about its alphabet is wasteful.
 * The dominant script wins rather than the first one seen, since headings,
 * numerals and stray English words appear in almost every non-Latin document.
 */
export function detectScript(text) {
  const sample = text.slice(0, 4000)
  let best = null
  let bestCount = 0

  for (const script of SCRIPTS) {
    const count = (sample.match(script.range) || []).length
    if (count > bestCount) {
      bestCount = count
      best = script
    }
  }

  // A handful of characters is a quotation, not the language of the document.
  if (!best || bestCount < sample.length * 0.08) return LATIN
  return best
}

export function scriptById(id) {
  return SCRIPTS.find((s) => s.id === id) ?? LATIN
}

/**
 * Does extracted PDF text look broken?
 *
 * Two failures are common and both produce text that is technically present
 * and completely unreadable.
 *
 * Private-use characters mean the PDF embedded a font with no proper Unicode
 * mapping, so extraction returns codepoints that belong to no alphabet.
 *
 * The subtler case is a legacy Indian font — Nudi, Baraha and their relatives
 * encode Kannada, Hindi and other scripts into ASCII slots, so extraction
 * returns Latin letters in combinations that occur in no language. Text of
 * that kind is detectable by how rarely it contains a vowel: real Latin prose
 * is about forty per cent vowels, and these encodings fall far below that.
 */
export function looksGarbled(text) {
  const sample = text.slice(0, 6000)
  if (sample.length < 120) return false

  const privateUse = (sample.match(/[\uE000-\uF8FF\uFFFD]/g) || []).length
  if (privateUse > sample.length * 0.02) return true

  // Nudi, Baraha and similar fonts spill across the Latin-1 supplement, so
  // extraction returns text dense with accented letters and symbols. Measured,
  // the two cases are nowhere near each other: heavily accented French prose
  // runs about eight per cent, legacy Kannada extraction about fifty-five. A
  // fifth sits in the empty space between them, well clear of both.
  const accented = (sample.match(/[\u00A1-\u00FF]/g) || []).length
  if (accented > sample.length * 0.2) return true

  const letters = sample.match(/[A-Za-z]/g) || []
  if (letters.length < sample.length * 0.5) return false

  const vowels = sample.match(/[aeiouAEIOU]/g) || []
  const ratio = vowels.length / letters.length
  return ratio < 0.22
}

/**
 * Find a voice that can pronounce this script.
 *
 * Exact locale first, then any voice for the language, and nothing otherwise.
 * There is deliberately no fallback to a different language: an English voice
 * given Kannada either says nothing or reads it as noise, and a silent failure
 * is worse than being told plainly that no voice is installed.
 */
export function voiceForScript(voices, script) {
  const wanted = script.lang
  const prefix = wanted.slice(0, 2)

  return (
    voices.find((v) => v.lang.replace('_', '-') === wanted && v.localService) ||
    voices.find((v) => v.lang.replace('_', '-') === wanted) ||
    voices.find((v) => v.lang.slice(0, 2) === prefix && v.localService) ||
    voices.find((v) => v.lang.slice(0, 2) === prefix) ||
    null
  )
}

/** Where a missing voice actually gets installed, which differs by platform. */
export function voiceInstallHelp(script) {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent

  if (/Android/i.test(agent)) {
    return `Open Settings, then Accessibility, then Text-to-speech output. Tap the gear beside Google Text-to-speech, choose Install voice data, and pick ${script.label}. Return here and reload.`
  }
  if (/iPhone|iPad|iPod/i.test(agent)) {
    return `Open Settings, then Accessibility, then Spoken Content, then Voices. Download a ${script.label} voice, return here and reload.`
  }
  if (/Windows/i.test(agent)) {
    return `Open Settings, then Time & language, then Language & region. Add ${script.label}, then open its language options and install the Speech component. Windows does not offer speech for every language.`
  }
  if (/Mac OS X/i.test(agent)) {
    return `Open System Settings, then Accessibility, then Spoken Content. Click the info button beside System voice and download a ${script.label} voice.`
  }
  return `Install a ${script.label} text-to-speech voice through your operating system's accessibility settings, then reload this page.`
}
