import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReader } from '../hooks/useReader'
import { buildDocument } from '../lib/parse'
import { getDoc, getMark, saveMark, touchDoc } from '../lib/store'
import Transport from '../components/Transport'

export default function Reader({ id, onExit, onWpm }) {
  const [doc, setDoc] = useState(null)
  const [missing, setMissing] = useState(false)
  const [restore, setRestore] = useState(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([getDoc(id), getMark(id)]).then(([record, mark]) => {
      if (cancelled) return
      if (!record) {
        setMissing(true)
        return
      }
      setDoc({ ...buildDocument(record), id: record.id })
      setRestore(mark?.offset ?? 0)
      touchDoc(id)
    })

    return () => {
      cancelled = true
    }
  }, [id])

  if (missing) {
    return (
      <div className="min-h-screen bg-void px-6 py-16 text-text">
        <p className="mx-auto max-w-3xl text-sm text-text-soft">
          That document is no longer in your library.{' '}
          <button onClick={onExit} className="text-accent hover:underline">
            Back to the library
          </button>
        </p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-void px-6 py-16 text-text">
        <p className="mx-auto max-w-3xl text-sm text-text-faint">Opening…</p>
      </div>
    )
  }

  return (
    <Surface
      doc={doc}
      restoreOffset={restore}
      onExit={onExit}
      onWpm={onWpm}
    />
  )
}

function Surface({ doc, restoreOffset, onExit, onWpm }) {
  const {
    tokens,
    voices,
    voiceURI,
    rate,
    status,
    activeToken,
    timingSource,
    wpm,
    playFrom,
    seek,
    stop,
    toggle,
    skip,
    changeRate,
    changeVoice,
  } = useReader(doc.text)

  const surfaceRef = useRef(null)
  const restored = useRef(false)
  const [readScale, setReadScale] = useState(
    () => Number(localStorage.getItem('echoread.readScale')) || 1,
  )

  useEffect(() => {
    localStorage.setItem('echoread.readScale', String(readScale))
  }, [readScale])

  useEffect(() => {
    onWpm?.(wpm)
  }, [wpm, onWpm])

  // Each block owns a slice of the token list, computed once. Rendering per
  // block rather than as one flat run means a word change repaints only the
  // paragraph it falls in, which is what keeps a book-length document from
  // stuttering on every syllable.
  const blocks = useMemo(() => {
    const out = []
    let cursor = 0

    for (const block of doc.blocks) {
      const start = cursor
      while (cursor < tokens.length && tokens[cursor].start < block.end) cursor++
      out.push({ ...block, tokenStart: start, tokenEnd: cursor - 1 })
    }

    return out.filter((b) => b.tokenEnd >= b.tokenStart)
  }, [doc.blocks, tokens])

  const headings = useMemo(
    () => blocks.filter((b) => b.type === 'heading'),
    [blocks],
  )

  // Put the reader back where they stopped, once, before anything is spoken.
  useEffect(() => {
    if (restored.current || !tokens.length || !restoreOffset) return
    restored.current = true

    let index = 0
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].start <= restoreOffset) index = i
      else break
    }
    if (index > 0) seek(index)
  }, [tokens, restoreOffset, seek])

  // Save position while reading. Writing on every word would mean a database
  // transaction several times a second, so changes are collected and written
  // at a human interval instead.
  useEffect(() => {
    if (activeToken < 0 || !tokens.length) return
    const offset = tokens[activeToken].start
    const fraction = activeToken / (tokens.length - 1 || 1)

    const timer = setTimeout(() => {
      saveMark(doc.id, offset, fraction).catch(() => {})
    }, 1500)

    return () => clearTimeout(timer)
  }, [activeToken, tokens, doc.id])

  const leave = useCallback(() => {
    if (activeToken >= 0 && tokens.length) {
      saveMark(
        doc.id,
        tokens[activeToken].start,
        activeToken / (tokens.length - 1 || 1),
      ).catch(() => {})
    }
    stop()
    onExit()
  }, [activeToken, tokens, doc.id, stop, onExit])

  const jumpSection = useCallback(
    (direction) => {
      if (!headings.length) return
      const here = activeToken < 0 ? 0 : activeToken
      const target =
        direction > 0
          ? headings.find((h) => h.tokenStart > here)
          : [...headings].reverse().find((h) => h.tokenStart < here - 1)
      if (target) playFrom(target.tokenStart)
    },
    [headings, activeToken, playFrom],
  )

  useEffect(() => {
    if (activeToken < 0 || !surfaceRef.current) return
    const node = surfaceRef.current.querySelector(`[data-token="${activeToken}"]`)
    if (!node) return
    const box = node.getBoundingClientRect()
    if (box.top > 90 && box.bottom < window.innerHeight - 200) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeToken])

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.matches('input, textarea, select')) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggle()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        skip(-1)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        skip(1)
      } else if (event.code === 'Escape') {
        leave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, skip, leave])

  const position = activeToken < 0 ? 0 : activeToken
  const progress = tokens.length ? position / (tokens.length - 1 || 1) : 0
  // Words remaining divided by words per minute, with the speed multiplier
  // applied — the calibrated rate is measured at 1x.
  const minutesLeft = wpm
    ? Math.round((tokens.length - position) / (wpm * rate))
    : null

  return (
    <div
      className="min-h-screen pb-40 text-text sm:pb-44"
      style={{ '--read-scale': readScale }}
    >
      <div className="mx-auto max-w-[38rem] px-5 py-8 sm:px-6 sm:py-12 lg:max-w-[42rem]">
        <header className="mb-8 flex items-start justify-between gap-4 sm:mb-10">
          <div className="min-w-0">
            <h1 className="truncate font-read text-lg sm:text-xl">{doc.title}</h1>
            <p className="tabular mt-1 text-sm text-text-faint">
              {doc.words.toLocaleString()} words
              {minutesLeft !== null && ` · about ${minutesLeft} min left`}
            </p>
          </div>
          <button
            onClick={leave}
            className="-mr-2 shrink-0 rounded-full px-3 py-1.5 text-sm text-text-soft hover:text-text"
          >
            Library
          </button>
        </header>

        <div ref={surfaceRef}>
          {blocks.map((block) => (
            <Block
              key={block.start}
              block={block}
              tokens={tokens}
              active={
                activeToken >= block.tokenStart && activeToken <= block.tokenEnd
                  ? activeToken
                  : -1
              }
              onWord={playFrom}
            />
          ))}
        </div>
      </div>

      <Transport
        status={status}
        rate={rate}
        voices={voices}
        voiceURI={voiceURI}
        timingSource={timingSource}
        progress={progress}
        hasSections={headings.length > 1}
        onToggle={toggle}
        onSkip={skip}
        onSection={jumpSection}
        onRate={changeRate}
        onVoice={changeVoice}
        readScale={readScale}
        onReadScale={setReadScale}
      />
    </div>
  )
}

const Block = memo(function Block({ block, tokens, active, onWord }) {
  const words = []

  for (let i = block.tokenStart; i <= block.tokenEnd; i++) {
    const token = tokens[i]
    const doubted = isDoubted(block, token)

    words.push(
      <span key={token.start}>
        <button
          data-token={i}
          onClick={() => onWord(i)}
          title={doubted ? 'Recognition was unsure of this word' : undefined}
          className={[
            'text-left',
            i === active ? 'spoken -mx-0.5 px-0.5' : '',
            doubted ? 'doubt' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {token.text}
        </button>{' '}
      </span>,
    )
  }

  if (block.type === 'heading') {
    return (
      <h2 className="mt-9 mb-3 font-read text-[1.15em] leading-snug sm:mt-11">
        {words}
      </h2>
    )
  }

  return <p className="measure mb-5 font-read text-text">{words}</p>
})

/**
 * Did recognition doubt this word?
 *
 * Doubts are recorded as character ranges within the block, so they survive
 * being stored and reopened. A token counts as doubted if it overlaps one at
 * all, since a range may cover punctuation the tokeniser split differently.
 */
function isDoubted(block, token) {
  if (!block.uncertain?.length) return false
  const from = token.start - block.start
  const to = token.end - block.start
  return block.uncertain.some(([a, b]) => from < b && to > a)
}
