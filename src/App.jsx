import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReader, speechSupported } from './hooks/useReader'
import { ACCEPTED, ParseError, documentFromText, parseFile } from './lib/parse'

const SAMPLE = `Reading With The Ear

The first thing that strikes a reader who listens is how much of reading was never about the eyes at all. A page has a rhythm. Sentences lean on each other, clauses hold their breath, and a full stop lands like a footstep. Read aloud, that rhythm stops being decoration and becomes the thing carrying you forward.

What changes most is patience. The eye skims, doubles back, and skips ahead to the end of a paragraph to decide whether the middle is worth it. The ear cannot do any of that. It has to take the sentence in the order it was written, at the speed it is given, and that turns out to be the closest most of us get to reading a writer's work the way it was set down.`

const SPEEDS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

export default function App() {
  const [doc, setDoc] = useState(null)

  if (!speechSupported) return <Unsupported />
  if (!doc) return <Library onOpen={setDoc} />
  return <Reader doc={doc} onExit={() => setDoc(null)} />
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">{children}</div>
    </div>
  )
}

function Wordmark() {
  return <h1 className="font-read text-2xl tracking-tight">echoread</h1>
}

function Unsupported() {
  return (
    <Shell>
      <Wordmark />
      <p className="mt-6 text-sm leading-relaxed text-bad">
        This browser has no speech engine, so there is nothing to read with. Try
        Chrome, Edge, or Safari.
      </p>
    </Shell>
  )
}

function Library({ onOpen }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const dragDepth = useRef(0)

  const open = useCallback(
    async (file) => {
      setError(null)
      setBusy({ name: file.name, progress: 0 })
      try {
        const parsed = await parseFile(file, (progress) =>
          setBusy({ name: file.name, progress }),
        )
        onOpen(parsed)
      } catch (problem) {
        setError(
          problem instanceof ParseError
            ? problem.message
            : 'Something went wrong opening that file.',
        )
        setBusy(null)
      }
    },
    [onOpen],
  )

  // Dropping anywhere on the page works. Counting enter and leave events is
  // necessary because they also fire when the pointer crosses child elements,
  // which otherwise makes the highlight flicker.
  useEffect(() => {
    const over = (e) => e.preventDefault()
    const enter = (e) => {
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }
    const drop = (e) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) open(file)
    }

    window.addEventListener('dragover', over)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [open])

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0

  return (
    <Shell>
      <header className="mb-10">
        <Wordmark />
        <p className="mt-1 text-sm text-ink-soft">
          Open a document, or paste anything you want to listen to.
        </p>
      </header>

      <div
        className={`rounded-lg border-2 border-dashed p-10 text-center ${
          dragging ? 'border-accent bg-accent-weak' : 'border-rule'
        }`}
      >
        {busy ? (
          <Progress busy={busy} />
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              Drop a file here, or
              <button
                onClick={() => inputRef.current?.click()}
                className="ml-1 text-accent underline"
              >
                choose one
              </button>
            </p>
            <p className="mt-2 text-sm text-ink-faint">
              PDF, Word, EPUB, Markdown, web pages, plain text
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) open(file)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-mark-weak px-4 py-3 text-sm leading-relaxed">
          {error}
        </p>
      )}

      <div className="mt-10">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Or paste text here…"
          className="h-40 w-full resize-y rounded-lg border border-rule bg-paper-raised p-5 font-read text-lg leading-relaxed placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={() => onOpen(documentFromText(draft.trim()))}
            disabled={!words}
            className="rounded-full bg-accent px-6 py-2.5 text-sm text-paper-raised hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-faint"
          >
            Start reading
          </button>
          <button
            onClick={() => onOpen(documentFromText(SAMPLE, 'Reading With The Ear'))}
            className="text-sm text-accent underline"
          >
            Use a sample passage
          </button>
          {words > 0 && (
            <span className="ml-auto text-sm text-ink-faint">
              {words.toLocaleString()} words
            </span>
          )}
        </div>
      </div>
    </Shell>
  )
}

function Progress({ busy }) {
  const percent = Math.round(busy.progress * 100)
  return (
    <div>
      <p className="text-sm text-ink-soft">Opening {busy.name}…</p>
      <div className="mx-auto mt-3 h-1 w-48 overflow-hidden rounded-full bg-rule">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
    </div>
  )
}

function Reader({ doc, onExit }) {
  const {
    tokens,
    voices,
    voiceURI,
    rate,
    status,
    activeToken,
    timingSource,
    playFrom,
    stop,
    toggle,
    skip,
    changeRate,
    changeVoice,
  } = useReader(doc.text)

  const surfaceRef = useRef(null)

  // Each block gets its own slice of the token list, computed once. Rendering
  // per block rather than as one flat run means a word change only repaints
  // the paragraph it happens in, which matters at book length.
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
    if (box.top > 80 && box.bottom < window.innerHeight - 190) return
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, skip])

  const progress = tokens.length
    ? Math.max(0, activeToken) / (tokens.length - 1)
    : 0

  return (
    <div className="min-h-screen bg-paper pb-44 text-ink">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-10 flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <Wordmark />
            <p className="mt-1 truncate text-sm text-ink-soft">
              {doc.title} · {doc.words.toLocaleString()} words
            </p>
          </div>
          <button
            onClick={() => {
              stop()
              onExit()
            }}
            className="shrink-0 text-sm text-accent underline"
          >
            Close
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
          className={`rounded-sm text-left ${
            i === active ? '-mx-0.5 bg-mark px-0.5' : ''
          }`}
        >
          {tokens[i].text}
        </button>{' '}
      </span>,
    )
  }

  if (block.type === 'heading') {
    return (
      <h2 className="mt-10 mb-3 font-read text-xl leading-snug sm:text-2xl">
        {words}
      </h2>
    )
  }

  return (
    <p className="mb-5 font-read text-lg leading-[1.9] sm:text-xl sm:leading-[1.9]">
      {words}
    </p>
  )
})

function Transport({
  status,
  rate,
  voices,
  voiceURI,
  timingSource,
  progress,
  hasSections,
  onToggle,
  onSkip,
  onSection,
  onRate,
  onVoice,
}) {
  const local = voices.filter((v) => v.localService)
  const remote = voices.filter((v) => !v.localService)

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-rule bg-paper-raised">
      <div className="h-0.5 bg-rule">
        <div
          className="h-full bg-accent"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-6 py-4">
        <button
          onClick={() => onSkip(-1)}
          aria-label="Previous sentence"
          className="rounded-full border border-rule px-3.5 py-2 text-sm hover:border-accent"
        >
          ‹‹
        </button>

        <button
          onClick={onToggle}
          className="rounded-full bg-accent px-7 py-2.5 text-sm text-paper-raised hover:bg-ink"
        >
          {status === 'playing' ? 'Pause' : 'Play'}
        </button>

        <button
          onClick={() => onSkip(1)}
          aria-label="Next sentence"
          className="rounded-full border border-rule px-3.5 py-2 text-sm hover:border-accent"
        >
          ››
        </button>

        {hasSections && (
          <div className="flex items-center gap-1.5 border-l border-rule pl-3">
            <button
              onClick={() => onSection(-1)}
              className="rounded-full border border-rule px-3 py-1.5 text-sm hover:border-accent"
            >
              ↑ Section
            </button>
            <button
              onClick={() => onSection(1)}
              className="rounded-full border border-rule px-3 py-1.5 text-sm hover:border-accent"
            >
              ↓ Section
            </button>
          </div>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-ink-soft">
          Speed
          <select
            value={rate}
            onChange={(e) => onRate(Number(e.target.value))}
            className="rounded-md border border-rule bg-paper-raised px-2 py-1.5 text-sm text-ink"
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Voice
          <select
            value={voiceURI ?? ''}
            onChange={(e) => onVoice(e.target.value)}
            className="max-w-[12rem] rounded-md border border-rule bg-paper-raised px-2 py-1.5 text-sm text-ink"
          >
            {local.length > 0 && (
              <optgroup label="Works offline">
                {local.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </optgroup>
            )}
            {remote.length > 0 && (
              <optgroup label="Needs internet">
                {remote.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      {timingSource === 'estimate' && (
        <p className="border-t border-rule px-6 py-2 text-center text-sm text-ink-soft">
          This voice does not report its position, so the highlight is timed
          from its speaking rate. Pick a voice that works offline for exact
          highlighting.
        </p>
      )}
    </div>
  )
}
