import {
  ParseError,
  linesToParagraphs,
  repeatedEdgeLines,
  fingerprint,
} from './layout'

/**
 * Reading text off images.
 *
 * Two things dominate the result, and neither is a setting anyone would think
 * to look for. The first is the photograph: recognition is far more sensitive
 * to uneven lighting than to resolution. The second is what happens to the
 * image before recognition sees it, which is what this module spends most of
 * its effort on.
 */

let worker = null
let workerLanguage = null

async function getWorker(language, report) {
  if (worker && workerLanguage === language) return worker

  const { createWorker } = await import('tesseract.js')

  if (worker) {
    await worker.terminate()
    worker = null
  }

  worker = await createWorker(language, 1, {
    logger: (message) => {
      if (message.status === 'loading tesseract core') {
        report?.({ note: 'Preparing the recogniser', progress: 0.1 })
      } else if (message.status?.startsWith('loading language')) {
        report?.({
          note: 'Downloading language data',
          progress: 0.1 + (message.progress ?? 0) * 0.3,
        })
      }
    },
  })

  workerLanguage = language
  return worker
}

export async function releaseWorker() {
  if (!worker) return
  await worker.terminate()
  worker = null
  workerLanguage = null
}

/**
 * Prepare an image for recognition.
 *
 * Three steps, in order:
 *
 *   1. **Greyscale**, weighted for how the eye perceives brightness rather
 *      than by a flat average, so coloured paper and ink keep their contrast.
 *   2. **Otsu's method** picks the black-and-white threshold by finding the
 *      value that best separates the image into two groups. A fixed threshold
 *      cannot work across a bright scan and a dim phone photo; this derives
 *      the right one for each image.
 *   3. **Upscaling** small images, because recognition wants characters around
 *      thirty pixels tall and struggles badly below twenty.
 *
 * Binarising rather than merely greyscaling matters most on photographs, where
 * the page is lit unevenly and mid-grey shadow would otherwise be read as ink.
 */
export function prepareImage(source) {
  const width = source.width || source.videoWidth
  const height = source.height || source.videoHeight
  if (!width || !height) throw new ParseError('That image could not be read.')

  const scale = Math.min(2, Math.max(1, 1400 / width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)

  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0, canvas.width, canvas.height)

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data

  const histogram = new Uint32Array(256)
  const grey = new Uint8ClampedArray(pixels.length / 4)

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const value =
      (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) | 0
    grey[p] = value
    histogram[value]++
  }

  const threshold = otsu(histogram, grey.length)

  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const value = grey[p] > threshold ? 255 : 0
    pixels[i] = value
    pixels[i + 1] = value
    pixels[i + 2] = value
    pixels[i + 3] = 255
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * Otsu's threshold: the split that leaves the two halves most distinct.
 *
 * It sweeps every possible cut point and keeps the one maximising the variance
 * between the resulting groups, which for a page of text lands neatly between
 * paper and ink whatever the exposure.
 */
function otsu(histogram, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let bestVariance = -1
  let firstBest = 0
  let lastBest = 0

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue

    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]

    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const between =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) ** 2

    if (between > bestVariance) {
      bestVariance = between
      firstBest = t
      lastBest = t
    } else if (between === bestVariance) {
      lastBest = t
    }
  }

  // An image with a clean gap between ink and paper scores every threshold in
  // that gap identically. Taking the first would sit the cut right against the
  // darkest ink, where noise crosses it; the middle of the gap is furthest
  // from both and survives a grainy photograph much better.
  return Math.round((firstBest + lastBest) / 2)
}

const LOW_CONFIDENCE = 72

/**
 * Recognise one image and return its lines with geometry and doubts.
 *
 * Recognition scores every word it produces. Words scoring poorly are
 * recorded by position so the reader can mark them, because a misread word in
 * the middle of a sentence is far more confusing when it looks as certain as
 * everything around it.
 */
export async function recognizeImage(source, { language, report } = {}) {
  const chosen = language || 'eng'
  const engine = await getWorker(chosen, report)
  const prepared = prepareImage(source)

  const { data } = await engine.recognize(
    prepared,
    {},
    { text: true, blocks: true },
  )

  prepared.width = 0
  prepared.height = 0

  const lines = []

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = (line.text ?? '').replace(/\s+/g, ' ').trim()
        if (!text) continue

        const doubts = []
        let cursor = 0
        for (const word of line.words ?? []) {
          const clean = (word.text ?? '').trim()
          if (!clean) continue
          const at = text.indexOf(clean, cursor)
          if (at === -1) continue
          cursor = at + clean.length
          if ((word.confidence ?? 100) < LOW_CONFIDENCE) {
            doubts.push([at, at + clean.length])
          }
        }

        const box = line.bbox ?? {}
        lines.push({
          text,
          // Recognition measures y downward from the top; the layout code
          // expects it to increase upward, as PDFs do. Negating keeps one
          // convention across both pipelines.
          y: -(box.y0 ?? 0),
          x: box.x0 ?? 0,
          right: box.x1 ?? 0,
          doubts,
        })
      }
    }
  }

  return lines
}

/**
 * Turn recognised pages into document blocks.
 *
 * Line-relative doubts are translated into block-relative ones using the
 * source map the paragraph joiner records, since the lines themselves stop
 * existing once paragraphs are assembled.
 */
export function blocksFromPages(pages) {
  const noise = repeatedEdgeLines(pages)
  const blocks = []

  for (const lines of pages) {
    const kept = lines.filter((line) => !noise.has(fingerprint(line.text)))

    for (const block of linesToParagraphs(kept, { gapFactor: 26 })) {
      const uncertain = []

      for (const { line, at } of block.sources) {
        for (const [from, to] of line.doubts ?? []) {
          uncertain.push([at + from, at + to])
        }
      }

      blocks.push({
        type: block.type,
        text: block.text,
        ...(uncertain.length ? { uncertain } : {}),
      })
    }
  }

  return blocks
}
