import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPTED, ParseError, documentFromText, parseCaptures, parseFile } from '../lib/parse'
import Camera from '../components/Camera'
import { OCR_LANGUAGES } from '../lib/script'
import { parseScannedPdf } from '../lib/parse'
import { deleteDoc, listDocs, listMarks, renameDoc, saveDoc, usage } from '../lib/store'
import { loadSettings } from '../hooks/useReader'

const SAMPLE = `Reading With The Ear

The first thing that strikes a reader who listens is how much of reading was never about the eyes at all. A page has a rhythm. Sentences lean on each other, clauses hold their breath, and a full stop lands like a footstep. Read aloud, that rhythm stops being decoration and becomes the thing carrying you forward.

What changes most is patience. The eye skims, doubles back, and skips ahead to the end of a paragraph to decide whether the middle is worth it. The ear cannot do any of that. It has to take the sentence in the order it was written, at the speed it is given, and that turns out to be the closest most of us get to reading a writer's work the way it was set down.`

export default function Library({ onOpen, wpm, theme, onTheme }) {
  const [docs, setDocs] = useState(null)
  const [marks, setMarks] = useState({})
  const [space, setSpace] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [language, setLanguage] = useState(
    () => localStorage.getItem('echoread.ocrLanguage') || 'eng',
  )
  // Held so a PDF whose text came out unreadable can be re-read with
  // recognition without asking for the file again.
  const [garbled, setGarbled] = useState(null)

  useEffect(() => {
    localStorage.setItem('echoread.ocrLanguage', language)
  }, [language])

  const inputRef = useRef(null)
  const dragDepth = useRef(0)

  const refresh = useCallback(async () => {
    const [documents, positions, estimate] = await Promise.all([
      listDocs(),
      listMarks(),
      usage(),
    ])
    setDocs(documents)
    setMarks(Object.fromEntries(positions.map((m) => [m.id, m])))
    setSpace(estimate)
  }, [])

  useEffect(() => {
    refresh().catch(() => setDocs([]))
  }, [refresh])

  const ingest = useCallback(
    async (file) => {
      setError(null)
      setBusy({ name: file.name, progress: 0, note: 'Opening' })
      setGarbled(null)
      try {
        const parsed = await parseFile(
          file,
          (update) => setBusy({ name: file.name, ...update }),
          { language },
        )
        setBusy(null)

        if (parsed.garbled) {
          setGarbled({ file, parsed })
          return
        }

        const record = await saveDoc(parsed)
        onOpen(record.id)
      } catch (problem) {
        setError(
          problem instanceof ParseError
            ? problem.message
            : 'Something went wrong opening that file.',
        )
        setBusy(null)
      }
    },
    [onOpen, language],
  )

  const recognizeInstead = useCallback(async () => {
    if (!garbled) return
    const { file } = garbled
    setGarbled(null)
    setError(null)
    setBusy({ name: file.name, progress: 0, note: 'Preparing the recogniser' })

    try {
      const parsed = await parseScannedPdf(
        file,
        (update) => setBusy({ name: file.name, ...update }),
        language,
      )
      const record = await saveDoc({ ...parsed, format: 'pdf' })
      setBusy(null)
      onOpen(record.id)
    } catch (problem) {
      setError(
        problem instanceof ParseError
          ? problem.message
          : 'That PDF could not be recognised either.',
      )
      setBusy(null)
    }
  }, [garbled, language, onOpen])

  const keepGarbled = useCallback(async () => {
    if (!garbled) return
    const record = await saveDoc(garbled.parsed)
    setGarbled(null)
    onOpen(record.id)
  }, [garbled, onOpen])

  // Drop anywhere. Enter and leave also fire when the pointer crosses child
  // elements, so the depth counter stops the target flickering.
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
      if (file) ingest(file)
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
  }, [ingest])

  const ingestCaptures = useCallback(
    async (canvases) => {
      setScanning(false)
      if (!canvases.length) return

      const title = `Scan · ${new Date().toLocaleDateString()}`
      setBusy({ name: title, progress: 0, note: 'Preparing the recogniser' })
      setError(null)

      try {
        const parsed = await parseCaptures(
          canvases,
          title,
          (update) => setBusy({ name: title, ...update }),
          language,
        )
        const record = await saveDoc(parsed)
        setBusy(null)
        onOpen(record.id)
      } catch (problem) {
        setError(
          problem instanceof ParseError
            ? problem.message
            : 'Those photographs could not be read.',
        )
        setBusy(null)
      }
    },
    [onOpen, language],
  )

  const startPasted = async () => {
    const text = draft.trim()
    if (!text) return
    const parsed = documentFromText(text, firstLine(text))
    const record = await saveDoc(parsed)
    onOpen(record.id)
  }

  const startSample = async () => {
    const record = await saveDoc(
      documentFromText(SAMPLE, 'Reading With The Ear'),
    )
    onOpen(record.id)
  }

  const remove = async (id) => {
    await deleteDoc(id)
    refresh()
  }

  const rename = async (id, title) => {
    await renameDoc(id, title)
    refresh()
  }

  const reading = docs?.filter((d) => {
    const f = marks[d.id]?.fraction ?? 0
    return f > 0.005 && f < 0.995
  })

  return (
    <div className="min-h-screen text-text">
      {scanning && (
        <Camera
          onDone={ingestCaptures}
          onCancel={() => setScanning(false)}
          language={language}
          onLanguage={setLanguage}
        />
      )}

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6 sm:py-14">
        <Masthead theme={theme} onTheme={onTheme} space={space} />

        <DropTarget
          dragging={dragging}
          busy={busy}
          language={language}
          onLanguage={setLanguage}
          onPick={() => inputRef.current?.click()}
          onScan={() => setScanning(true)}
        />

        {garbled && (
          <GarbledNotice
            onRecognize={recognizeInstead}
            onKeep={keepGarbled}
            language={language}
            onLanguage={setLanguage}
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) ingest(file)
            e.target.value = ''
          }}
        />

        {error && (
          <p className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm leading-relaxed text-text">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <button
            onClick={() => setComposing((v) => !v)}
            className="text-accent hover:underline"
          >
            {composing ? 'Hide the paste box' : 'Paste text instead'}
          </button>
          <button onClick={startSample} className="text-text-soft hover:text-text">
            Try a sample passage
          </button>
        </div>

        {composing && (
          <div className="mt-4">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste anything you want to listen to…"
              className="h-40 w-full resize-y rounded-xl border border-edge bg-surface p-5 font-read text-lg leading-relaxed text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
            <button
              onClick={startPasted}
              disabled={!draft.trim()}
              className="mt-3 rounded-full bg-accent px-6 py-2.5 text-sm text-void transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add to library
            </button>
          </div>
        )}

        {docs === null ? (
          <p className="mt-14 text-sm text-text-faint">Opening your library…</p>
        ) : docs.length === 0 ? (
          <Empty />
        ) : (
          <>
            {reading.length > 0 && (
              <Shelf title="Still reading">
                {reading.map((doc) => (
                  <Row
                    key={doc.id}
                    doc={doc}
                    mark={marks[doc.id]}
                    wpm={wpm}
                    onOpen={onOpen}
                    onRename={rename}
                    onDelete={remove}
                  />
                ))}
              </Shelf>
            )}

            <Shelf title={reading.length ? 'Everything' : 'Your library'}>
              {docs.map((doc) => (
                <Row
                  key={doc.id}
                  doc={doc}
                  mark={marks[doc.id]}
                  wpm={wpm}
                  onOpen={onOpen}
                  onRename={rename}
                  onDelete={remove}
                />
              ))}
            </Shelf>
          </>
        )}
      </div>
    </div>
  )
}

function Masthead({ theme, onTheme, space }) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4 sm:mb-9 sm:gap-6">
      <div className="min-w-0">
        <h1 className="font-read text-2xl tracking-tight sm:text-3xl">echoread</h1>
        <p className="mt-1.5 text-sm text-text-soft">
          Everything here stays on this device.
          {space && space.used > 0 && (
            <span className="tabular text-text-faint">
              {' '}
              {formatBytes(space.used)} used.
            </span>
          )}
        </p>
      </div>

      <button
        onClick={onTheme}
        className="shrink-0 rounded-full border border-edge px-4 py-2 text-sm text-text-soft transition-colors hover:border-edge-bright hover:text-text"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </header>
  )
}

function DropTarget({ dragging, busy, language, onLanguage, onPick, onScan }) {
  const hasCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices

  return (
    <div
      className={`relative rounded-2xl border transition-colors ${
        dragging ? 'border-accent bg-accent-soft' : 'border-edge bg-surface/40'
      }`}
    >
      {/* Corner brackets rather than a dashed outline: they read as a target
          being framed, which is what the area is, and they stay quiet when
          nothing is being dragged over it. */}
      {[
        'left-0 top-0 border-l border-t rounded-tl-2xl',
        'right-0 top-0 border-r border-t rounded-tr-2xl',
        'left-0 bottom-0 border-l border-b rounded-bl-2xl',
        'right-0 bottom-0 border-r border-b rounded-br-2xl',
      ].map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={`pointer-events-none absolute h-6 w-6 transition-colors sm:h-8 sm:w-8 ${
            dragging ? 'border-accent' : 'border-edge-bright'
          } ${corner}`}
        />
      ))}

      <div className="px-6 py-9 text-center sm:px-8 sm:py-11">
        {busy ? (
          <div>
            <p className="text-sm text-text-soft">
              {busy.note ?? 'Opening'} · {busy.name}
            </p>
            <div className="mx-auto mt-4 h-px w-full max-w-56 bg-edge">
              <div
                className="h-px bg-mark transition-[width] duration-200"
                style={{ width: `${Math.max(4, (busy.progress ?? 0) * 100)}%` }}
              />
            </div>
            {busy.scanning && (
              <p className="mt-3 text-sm leading-relaxed text-text-faint">
                Recognising text takes a few seconds a page, and the first run
                downloads language data.
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-text">
              <span className="hidden sm:inline">Drop a document here, or </span>
              <button onClick={onPick} className="text-accent hover:underline">
                choose a file
              </button>
              {hasCamera && (
                <>
                  <span className="text-text-faint"> · </span>
                  <button onClick={onScan} className="text-accent hover:underline">
                    scan a page
                  </button>
                </>
              )}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-text-faint">
              PDF · Word · EPUB · Markdown · web pages · photos · plain text
            </p>
            <label className="mt-4 inline-flex items-center gap-2 text-sm text-text-faint">
              Scans and photos are in
              <LanguagePicker value={language} onChange={onLanguage} />
            </label>
          </>
        )}
      </div>
    </div>
  )
}

function LanguagePicker({ value, onChange, className = '' }) {
  return (
    <select
      aria-label="Recognition language"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-edge bg-surface-2 px-2 py-1.5 text-sm text-text hover:border-edge-bright focus:border-accent focus:outline-none ${className}`}
    >
      {OCR_LANGUAGES.map((entry) => (
        <option key={entry.code} value={entry.code}>
          {entry.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Offered when a PDF's text extracts into nonsense.
 *
 * Most Indian-language PDFs are built on legacy fonts that encode their script
 * into ASCII slots, so extraction returns letters that spell nothing. The file
 * is perfectly readable as an image, so recognition is the way in — but it is
 * slow enough that it should be a choice rather than a surprise.
 */
function GarbledNotice({ onRecognize, onKeep, language, onLanguage }) {
  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface/70 px-5 py-4">
      <p className="text-sm leading-relaxed text-text">
        The text in this PDF came out unreadable. That usually means it was
        made with a font that stores its script in the wrong character slots,
        which is common for Indian-language documents. Reading the pages as
        images instead normally works.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onRecognize}
          className="rounded-full bg-accent px-5 py-2 text-sm text-void hover:opacity-90"
        >
          Read the pages as images
        </button>
        <LanguagePicker value={language} onChange={onLanguage} />
        <button onClick={onKeep} className="text-sm text-text-soft hover:text-text">
          Open it as it is
        </button>
      </div>

      <p className="mt-3 text-sm text-text-faint">
        Recognition takes a few seconds a page.
      </p>
    </div>
  )
}

function Empty() {
  return (
    <div className="mt-16 border-t border-edge pt-8">
      <p className="font-read text-lg text-text-soft">
        Nothing here yet.
      </p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-faint">
        Add a document and it stays in this library, remembering where you
        stopped, until you delete it.
      </p>
    </div>
  )
}

function Shelf({ title, children }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-sm text-text-faint">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ doc, mark, wpm, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(doc.title)
  const [confirming, setConfirming] = useState(false)

  const fraction = mark?.fraction ?? 0
  const percent = Math.round(fraction * 100)
  const left = Math.max(0, doc.words * (1 - fraction))
  // Estimates must match what the reader will actually do, so the saved
  // playback speed counts as much as the voice's measured rate.
  const speed = loadSettings().rate ?? 1
  const minutes = wpm ? Math.round(left / (wpm * speed)) : null

  const commit = () => {
    setEditing(false)
    const next = title.trim()
    if (next && next !== doc.title) onRename(doc.id, next)
    else setTitle(doc.title)
  }

  const actions = confirming ? (
    <>
      <Action onClick={() => onDelete(doc.id)} tone="bad">Delete</Action>
      <Action onClick={() => setConfirming(false)}>Keep</Action>
    </>
  ) : (
    <>
      <Action onClick={() => setEditing(true)}>Rename</Action>
      <Action onClick={() => setConfirming(true)} tone="bad">Remove</Action>
    </>
  )

  return (
    <div className="group relative flex items-stretch overflow-hidden rounded-xl border border-edge bg-surface/70 transition-colors hover:border-edge-bright">
      {/*
        A spine down the left edge, filled to your position. Books have spines,
        and the fill reads as depth into the document faster than a percentage
        does — a shelf of part-read things is legible in one sweep of the eye.
      */}
      <div className="w-1 shrink-0 bg-surface-2">
        <div
          className="w-full bg-mark transition-[height] duration-300"
          style={{ height: `${Math.max(fraction * 100, fraction > 0 ? 3 : 0)}%` }}
        />
      </div>

      <div className="min-w-0 flex-1 py-3.5 pr-3 pl-3.5 sm:py-4 sm:pr-4">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setTitle(doc.title)
                setEditing(false)
              }
            }}
            className="w-full rounded-md border border-accent bg-void px-2 py-1 font-read text-base text-text focus:outline-none sm:text-lg"
          />
        ) : (
          <button
            onClick={() => onOpen(doc.id)}
            className="block w-full truncate text-left font-read text-base text-text hover:text-accent sm:text-lg"
          >
            {doc.title}
          </button>
        )}

        <p className="tabular mt-1 text-sm text-text-faint">
          {doc.format.toUpperCase()} · {doc.words.toLocaleString()} words
          {fraction > 0.005 && ` · ${percent}%`}
          {minutes !== null && fraction < 0.995 && ` · ${formatMinutes(minutes)} left`}
        </p>

        {/* Below the title on a phone, where a third column would squeeze the
            title to nothing. Beside it from tablet width up. */}
        <div className="-ml-2 mt-1 flex gap-0.5 sm:hidden">{actions}</div>
      </div>

      <div className="hidden shrink-0 items-center gap-0.5 pr-3 transition-opacity sm:flex lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover:opacity-100">
        {actions}
      </div>
    </div>
  )
}

function Action({ onClick, tone, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1.5 text-sm transition-colors sm:px-3 ${
        tone === 'bad'
          ? 'text-text-soft hover:text-bad'
          : 'text-text-soft hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function firstLine(text) {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? 'Pasted text'
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function formatMinutes(minutes) {
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
