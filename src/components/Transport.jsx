const SPEEDS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

export default function Transport({
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
  const playing = status === 'playing'

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-edge bg-surface/95 backdrop-blur">
      <div className="h-px bg-edge">
        <div
          className="h-px bg-mark transition-[width] duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2.5 px-6 py-3.5">
        <IconButton label="Previous sentence" onClick={() => onSkip(-1)}>
          <Rewind />
        </IconButton>

        <button
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-void transition-transform active:scale-95"
        >
          {playing ? <Pause /> : <Play />}
        </button>

        <IconButton label="Next sentence" onClick={() => onSkip(1)}>
          <Forward />
        </IconButton>

        {hasSections && (
          <div className="ml-1 flex items-center gap-1.5 border-l border-edge pl-3">
            <TextButton onClick={() => onSection(-1)}>Prev section</TextButton>
            <TextButton onClick={() => onSection(1)}>Next section</TextButton>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <Select
            label="Speed"
            value={rate}
            onChange={(v) => onRate(Number(v))}
            className="w-20"
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </Select>

          <Select
            label="Voice"
            value={voiceURI ?? ''}
            onChange={onVoice}
            className="max-w-[11rem]"
          >
            {local.length > 0 && (
              <optgroup label="Works offline">
                {local.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                  </option>
                ))}
              </optgroup>
            )}
            {remote.length > 0 && (
              <optgroup label="Needs internet">
                {remote.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
      </div>

      {timingSource === 'estimate' && (
        <p className="border-t border-edge px-6 py-2 text-center text-sm text-text-faint">
          This voice does not report its position, so the highlight is timed
          from its speaking rate.
        </p>
      )}
    </div>
  )
}

function IconButton({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-edge text-text-soft transition-colors hover:border-edge-bright hover:text-text"
    >
      {children}
    </button>
  )
}

function TextButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-2.5 py-1.5 text-sm text-text-soft transition-colors hover:text-text"
    >
      {children}
    </button>
  )
}

function Select({ label, value, onChange, className, children }) {
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

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Play() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5.5 3.5 14 9l-8.5 5.5z" fill="currentColor" />
    </svg>
  )
}

function Pause() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="5" y="3.5" width="2.8" height="11" rx="1" fill="currentColor" />
      <rect x="10.2" y="3.5" width="2.8" height="11" rx="1" fill="currentColor" />
    </svg>
  )
}

function Rewind() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M13 4 7 9l6 5z" fill="currentColor" />
      <path d="M5 4v10" {...stroke} />
    </svg>
  )
}

function Forward() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 4l6 5-6 5z" fill="currentColor" />
      <path d="M13 4v10" {...stroke} />
    </svg>
  )
}
