import { useEffect, useRef, useState } from 'react'
import { useReader, speechSupported } from './hooks/useReader'

const SAMPLE = `The first thing that strikes a reader who listens is how much of reading was never about the eyes at all. A page has a rhythm. Sentences lean on each other, clauses hold their breath, and a full stop lands like a footstep. Read aloud, that rhythm stops being decoration and becomes the thing carrying you forward.

What changes most is patience. The eye skims, doubles back, and skips ahead to the end of a paragraph to decide whether the middle is worth it. The ear cannot do any of that. It has to take the sentence in the order it was written, at the speed it is given, and that turns out to be the closest most of us get to reading a writer's work the way it was set down.`

const SPEEDS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

export default function App() {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState('')

  if (!speechSupported) return <Unsupported />

  return text ? (
    <Reader text={text} onExit={() => setText('')} />
  ) : (
    <Compose
      draft={draft}
      setDraft={setDraft}
      onStart={() => setText(draft.trim())}
      onSample={() => {
        setDraft(SAMPLE)
        setText(SAMPLE)
      }}
    />
  )
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
      <p className="mt-6 max-w-prose text-sm leading-relaxed text-bad">
        This browser has no speech engine, so there is nothing to read with. Try
        Chrome, Edge, or Safari.
      </p>
    </Shell>
  )
}

function Compose({ draft, setDraft, onStart, onSample }) {
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0

  return (
    <Shell>
      <header className="mb-10">
        <Wordmark />
        <p className="mt-1 text-sm text-ink-soft">
          Paste anything you want to listen to.
        </p>
      </header>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="An article, a chapter, an email you have been putting off…"
        className="h-64 w-full resize-y rounded-lg border border-rule bg-paper-raised p-5 font-read text-lg leading-relaxed placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          onClick={onStart}
          disabled={!words}
          className="rounded-full bg-accent px-6 py-2.5 text-sm text-paper-raised hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-faint"
        >
          Start reading
        </button>
        <button onClick={onSample} className="text-sm text-accent underline">
          Use a sample passage
        </button>
        {words > 0 && (
          <span className="ml-auto text-sm text-ink-faint">
            {words.toLocaleString()} words
          </span>
        )}
      </div>
    </Shell>
  )
}

function Reader({ text, onExit }) {
  const reader = useReader(text)
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
  } = reader

  const surfaceRef = useRef(null)

  // Keep the spoken word on screen without yanking the page around.
  useEffect(() => {
    if (activeToken < 0 || !surfaceRef.current) return
    const node = surfaceRef.current.querySelector(`[data-token="${activeToken}"]`)
    if (!node) return

    const box = node.getBoundingClientRect()
    const comfortable = box.top > 80 && box.bottom < window.innerHeight - 180
    if (comfortable) return

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

  return (
    <div className="min-h-screen bg-paper pb-40 text-ink">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-10 flex items-baseline justify-between gap-4">
          <Wordmark />
          <button
            onClick={() => {
              stop()
              onExit()
            }}
            className="text-sm text-accent underline"
          >
            Read something else
          </button>
        </header>

        <div
          ref={surfaceRef}
          className="font-read text-xl leading-[1.9] sm:text-2xl sm:leading-[1.9]"
        >
          {tokens.map((token, i) => (
            <span key={token.start}>
              <button
                data-token={i}
                onClick={() => playFrom(i)}
                className={`rounded-sm text-left ${
                  i === activeToken ? '-mx-0.5 bg-mark px-0.5' : ''
                }`}
              >
                {token.text}
              </button>{' '}
            </span>
          ))}
        </div>
      </div>

      <Transport
        status={status}
        rate={rate}
        voices={voices}
        voiceURI={voiceURI}
        timingSource={timingSource}
        onToggle={toggle}
        onSkip={skip}
        onRate={changeRate}
        onVoice={changeVoice}
      />
    </div>
  )
}

function Transport({
  status,
  rate,
  voices,
  voiceURI,
  timingSource,
  onToggle,
  onSkip,
  onRate,
  onVoice,
}) {
  const local = voices.filter((v) => v.localService)
  const remote = voices.filter((v) => !v.localService)

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-rule bg-paper-raised">
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
            className="max-w-[13rem] rounded-md border border-rule bg-paper-raised px-2 py-1.5 text-sm text-ink"
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
