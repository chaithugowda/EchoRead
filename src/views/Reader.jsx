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
    <div className="min-h-screen bg-void pb-44 text-text">
      <div className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <header className="mb-10 flex items-baseline justify-between gap-5">
          <div className="min-w-0">
            <h1 className="truncate font-read text-xl">{doc.title}</h1>
            <p className="tabular mt-1 text-sm text-text-faint">
              {doc.words.toLocaleString()} words
              {minutesLeft !== null && ` · about ${minutesLeft} min left`}
            </p>
          </div>
          <button
            onClick={leave}
            className="shrink-0 text-sm text-text-soft hover:text-text"
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
      />
    </div>
  )
}

const Block = memo(function Block({ block, tokens, active, onWord }) {
  const words = []
  for (let i = block.tokenStart; i <= block.tokenEnd; i++) {
    words.push(
      <span key={tokens[i].start}>
        <button
          data-token={i}
          onClick={() => onWord(i)}
          className={i === active ? 'spoken -mx-0.5 px-0.5 text-left' : 'text-left'}
        >
          {tokens[i].text}
        </button>{' '}
      </span>,
    )
  }

  if (block.type === 'heading') {
    return (
      <h2 className="mt-11 mb-3 font-read text-xl leading-snug sm:text-2xl">
        {words}
      </h2>
    )
  }

  return (
    <p className="mb-5 font-read text-lg leading-[1.95] text-text sm:text-xl sm:leading-[1.95]">
      {words}
    </p>
  )
})
