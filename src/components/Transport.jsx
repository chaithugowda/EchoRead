import { useState } from 'react'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

/**
 * The transport bar.
 *
 * On a phone there is room for the transport and nothing else, so speed, voice
 * and text size move into a panel that opens above it. On a tablet or desktop
 * they sit inline, because hiding controls that fit is its own annoyance.
 */
export default function Transport({
  status,
  rate,
  voices,
  voiceURI,
  timingSource,
  progress,
  hasSections,
  readScale,
  onReadScale,
  onToggle,
  onSkip,
  onSection,
  onRate,
  onVoice,
}) {
  const [open, setOpen] = useState(false)
  const playing = status === 'playing'

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-surface/92 backdrop-blur-md">
      <div className="h-px bg-edge">
        <div
          className="h-px bg-mark transition-[width] duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {open && (
        <Settings
          className="lg:hidden"
          rate={rate}
          voices={voices}
          voiceURI={voiceURI}
          readScale={readScale}
          hasSections={hasSections}
          onRate={onRate}
          onVoice={onVoice}
          onReadScale={onReadScale}
          onSection={onSection}
        />
      )}

      <div className="safe-bottom mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <IconButton label="Previous sentence" onClick={() => onSkip(-1)}>
          <Rewind />
        </IconButton>

        <PlayButton playing={playing} progress={progress} onClick={onToggle} />

        <IconButton label="Next sentence" onClick={() => onSkip(1)}>
          <Forward />
        </IconButton>

        {hasSections && (
          <div className="ml-1 hidden items-center gap-1 border-l border-edge pl-3 lg:flex">
            <Quiet onClick={() => onSection(-1)}>Prev section</Quiet>
            <Quiet onClick={() => onSection(1)}>Next section</Quiet>
          </div>
        )}

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <SizeControl value={readScale} onChange={onReadScale} />
          <Picker label="Speed" value={rate} onChange={(v) => onRate(Number(v))} className="w-[4.5rem]">
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>{speed}×</option>
            ))}
          </Picker>
          <VoicePicker voices={voices} voiceURI={voiceURI} onVoice={onVoice} className="max-w-[10rem]" />
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto rounded-full border border-edge px-4 py-2 text-sm text-text-soft transition-colors hover:border-edge-bright hover:text-text lg:hidden"
        >
          {open ? 'Close' : `${rate}×`}
        </button>
      </div>

      {timingSource === 'estimate' && !open && (
        <p className="border-t border-edge px-5 py-2 text-center text-sm leading-snug text-text-faint">
          This voice does not report its position, so the highlight is timed
          from its speaking rate.
        </p>
      )}
    </div>
  )
}

function Settings({
  className,
  rate,
  voices,
  voiceURI,
  readScale,
  hasSections,
  onRate,
  onVoice,
  onReadScale,
  onSection,
}) {
  return (
    <div className={`border-b border-edge px-5 py-4 ${className}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Field label="Speed">
          <div className="flex flex-wrap gap-1.5">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                onClick={() => onRate(speed)}
                className={`tabular rounded-full px-3 py-1.5 text-sm transition-colors ${
                  speed === rate
                    ? 'bg-accent text-void'
                    : 'border border-edge text-text-soft hover:border-edge-bright'
                }`}
              >
                {speed}×
              </button>
            ))}
          </div>
        </Field>

        <Field label="Voice">
          <VoicePicker voices={voices} voiceURI={voiceURI} onVoice={onVoice} className="w-full" />
        </Field>

        <Field label="Text size">
          <SizeControl value={readScale} onChange={onReadScale} wide />
        </Field>

        {hasSections && (
          <Field label="Sections">
            <div className="flex gap-2">
              <Outline onClick={() => onSection(-1)}>Previous</Outline>
              <Outline onClick={() => onSection(1)}>Next</Outline>
            </div>
          </Field>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-24 shrink-0 text-sm text-text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Play, wrapped in a ring showing progress through the document.
 *
 * The bar along the top edge is exact but easy to miss; the ring sits where
 * the eye already goes to start and stop, and gives the same information at a
 * glance without adding another element to the bar.
 */
function PlayButton({ playing, progress, onClick }) {
  const radius = 25
  const circumference = 2 * Math.PI * radius

  return (
    <button
      onClick={onClick}
      aria-label={playing ? 'Pause' : 'Play'}
      className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-void transition-transform active:scale-95"
    >
      <svg
        className="absolute inset-0 -rotate-90"
        viewBox="0 0 56 56"
        aria-hidden="true"
      >
        <circle
          cx="28" cy="28" r={radius}
          fill="none" stroke="var(--mark)" strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          opacity={progress > 0.001 ? 0.95 : 0}
          style={{ transition: 'stroke-dashoffset 300ms linear' }}
        />
      </svg>
      {playing ? <Pause /> : <Play />}
    </button>
  )
}

function VoicePicker({ voices, voiceURI, onVoice, className }) {
  const local = voices.filter((v) => v.localService)
  const remote = voices.filter((v) => !v.localService)

  return (
    <Picker label="Voice" value={voiceURI ?? ''} onChange={onVoice} className={className}>
      {local.length > 0 && (
        <optgroup label="Works offline">
          {local.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </optgroup>
      )}
      {remote.length > 0 && (
        <optgroup label="Needs internet">
          {remote.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </optgroup>
      )}
    </Picker>
  )
}

function SizeControl({ value, onChange, wide }) {
  return (
    <div className={`flex items-center gap-1 ${wide ? '' : 'shrink-0'}`}>
      <button
        onClick={() => onChange(Math.max(0.85, +(value - 0.1).toFixed(2)))}
        aria-label="Smaller text"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge text-sm text-text-soft hover:border-edge-bright hover:text-text"
      >
        A
      </button>
      <button
        onClick={() => onChange(Math.min(1.6, +(value + 0.1).toFixed(2)))}
        aria-label="Larger text"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge text-lg text-text-soft hover:border-edge-bright hover:text-text"
      >
        A
      </button>
    </div>
  )
}

function IconButton({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-text-soft transition-colors hover:border-edge-bright hover:text-text"
    >
      {children}
    </button>
  )
}

function Quiet({ onClick, children }) {
  return (
    <button onClick={onClick} className="rounded-full px-2.5 py-1.5 text-sm text-text-soft transition-colors hover:text-text">
      {children}
    </button>
  )
}

function Outline({ onClick, children }) {
  return (
    <button onClick={onClick} className="rounded-full border border-edge px-4 py-1.5 text-sm text-text-soft hover:border-edge-bright hover:text-text">
      {children}
    </button>
  )
}

function Picker({ label, value, onChange, className, children }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`truncate rounded-lg border border-edge bg-surface-2 px-2.5 py-2 text-sm text-text transition-colors hover:border-edge-bright focus:border-accent focus:outline-none ${className}`}
    >
      {children}
    </select>
  )
}

function Play() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="relative ml-0.5">
      <path d="M5.5 3.5 14 9l-8.5 5.5z" fill="currentColor" />
    </svg>
  )
}

function Pause() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="relative">
      <rect x="5" y="3.5" width="2.8" height="11" rx="1" fill="currentColor" />
      <rect x="10.2" y="3.5" width="2.8" height="11" rx="1" fill="currentColor" />
    </svg>
  )
}

function Rewind() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M13 4 7 9l6 5z" fill="currentColor" />
      <path d="M5 4v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Forward() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 4l6 5-6 5z" fill="currentColor" />
      <path d="M13 4v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
