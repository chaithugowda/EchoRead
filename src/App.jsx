import { useMemo } from 'react'
import { tokenize } from './lib/tokenize'
import { useSpeechProbe } from './hooks/useSpeechProbe'

const PROBE_TEXT =
  'Press play and this sentence will read itself aloud, one word at a time, ' +
  'so you can see whether your browser keeps the audio and the text in step.'

export default function App() {
  const tokens = useMemo(() => tokenize(PROBE_TEXT), [])
  const {
    supported,
    voices,
    status,
    activeToken,
    boundaryCount,
    reportsLength,
    durationMs,
    error,
    run,
    stop,
  } = useSpeechProbe(tokens, PROBE_TEXT)

  const offline = voices.filter((v) => v.localService)
  const languages = new Set(voices.map((v) => v.lang.split('-')[0]))
  const tested = status === 'done' || status === 'error'

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
        <Header />

        <ReadingSurface tokens={tokens} activeToken={activeToken} />

        <Controls
          supported={supported}
          status={status}
          onRun={run}
          onStop={stop}
        />

        <Readout
          supported={supported}
          voices={voices}
          offline={offline}
          languages={languages}
          tested={tested}
          boundaryCount={boundaryCount}
          reportsLength={reportsLength}
          durationMs={durationMs}
          error={error}
        />

        {tested && <Verdict boundaryCount={boundaryCount} />}

        {voices.length > 0 && <VoiceList voices={voices} />}

        <Footer />
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="mb-14">
      <h1 className="font-read text-2xl tracking-tight">echoread</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Phase 0 — checking what this browser can do before we build on it.
      </p>
    </header>
  )
}

function ReadingSurface({ tokens, activeToken }) {
  return (
    <p className="font-read text-2xl leading-relaxed sm:text-3xl sm:leading-relaxed">
      {tokens.map((token, i) => (
        <span key={token.start}>
          <span
            className={
              i === activeToken
                ? '-mx-0.5 rounded-sm bg-mark px-0.5 py-0.5'
                : undefined
            }
          >
            {token.text}
          </span>{' '}
        </span>
      ))}
    </p>
  )
}

function Controls({ supported, status, onRun, onStop }) {
  if (!supported) {
    return (
      <p className="mt-10 text-sm text-bad">
        This browser has no speech engine, so there is nothing to test. Try
        Chrome, Edge, or Safari.
      </p>
    )
  }

  const speaking = status === 'speaking'

  return (
    <div className="mt-10 flex items-center gap-4">
      <button
        onClick={speaking ? onStop : onRun}
        className="rounded-full bg-accent px-6 py-2.5 text-sm text-paper-raised hover:bg-ink"
      >
        {speaking ? 'Stop' : status === 'idle' ? 'Run the check' : 'Run again'}
      </button>
      {speaking && (
        <span className="text-sm text-ink-soft">
          Listening for word timing…
        </span>
      )}
    </div>
  )
}

function Row({ label, value, tone }) {
  const toneClass =
    tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'

  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <dt className="shrink-0 text-sm text-ink-soft">{label}</dt>
      <div className="mb-1 flex-1 border-b border-dotted border-rule" />
      <dd className={`shrink-0 text-sm ${toneClass}`}>{value}</dd>
    </div>
  )
}

function Readout({
  supported,
  voices,
  offline,
  languages,
  tested,
  boundaryCount,
  reportsLength,
  durationMs,
  error,
}) {
  return (
    <dl className="mt-12 border-t border-rule pt-2">
      <Row
        label="Speech synthesis"
        value={supported ? 'Available' : 'Missing'}
        tone={supported ? 'good' : 'bad'}
      />
      <Row label="Voices found" value={voices.length || '—'} />
      <Row
        label="Voices that work offline"
        value={voices.length ? offline.length : '—'}
      />
      <Row label="Languages covered" value={languages.size || '—'} />
      <Row
        label="Word timing events"
        value={
          !tested
            ? 'Not tested yet'
            : boundaryCount > 0
              ? `${boundaryCount} received`
              : 'None received'
        }
        tone={!tested ? undefined : boundaryCount > 0 ? 'good' : 'bad'}
      />
      <Row
        label="Word length reported"
        value={!tested ? 'Not tested yet' : reportsLength ? 'Yes' : 'No'}
      />
      <Row
        label="Time to read 26 words"
        value={durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '—'}
      />
      {error && <Row label="Engine error" value={error} tone="bad" />}
    </dl>
  )
}

function Verdict({ boundaryCount }) {
  const good = boundaryCount > 0

  return (
    <div
      className={`mt-8 rounded-lg px-5 py-4 text-sm leading-relaxed ${
        good ? 'bg-accent-weak' : 'bg-mark-weak'
      }`}
    >
      {good
        ? 'The engine reports its position while it speaks, so the reader can highlight words straight from the audio. Phase 1 will follow the engine.'
        : 'The engine speaks but never reports its position, so highlighting has to be estimated from the speech rate. Phase 1 will need the fallback timer too — better to know now than to discover it later.'}
    </div>
  )
}

function VoiceList({ voices }) {
  const sorted = [...voices].sort((a, b) => {
    if (a.localService !== b.localService) return a.localService ? -1 : 1
    return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)
  })

  return (
    <details className="mt-10 border-t border-rule pt-6">
      <summary className="cursor-pointer text-sm text-accent">
        Show all {voices.length} voices
      </summary>
      <ul className="mt-4 space-y-1.5">
        {sorted.map((voice, i) => (
          <li
            key={`${voice.voiceURI}-${i}`}
            className="flex items-baseline gap-3 text-sm"
          >
            <span className="w-16 shrink-0 text-ink-faint">{voice.lang}</span>
            <span className="flex-1">{voice.name}</span>
            <span className="text-ink-faint">
              {voice.localService ? 'offline' : 'network'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Footer() {
  return (
    <p className="mt-16 border-t border-rule pt-6 text-sm leading-relaxed text-ink-soft">
      Voices come from your operating system, not from this site. Results differ
      between machines, so run this on every device you plan to support.
    </p>
  )
}
