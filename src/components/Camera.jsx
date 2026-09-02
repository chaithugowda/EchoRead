import { useCallback, useEffect, useRef, useState } from 'react'
import { OCR_LANGUAGES } from '../lib/script'

/**
 * Photograph pages to read them.
 *
 * Recognition accuracy is decided at capture far more than at processing, and
 * the two things that ruin it — a tilted page and uneven light — are both
 * obvious while framing and invisible afterwards. So the guide is shown live,
 * before the shutter, rather than as advice in an error message once someone
 * has already photographed twenty pages badly.
 */
export default function Camera({ onDone, onCancel, language, onLanguage }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [pages, setPages] = useState([])
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch((problem) => {
        setError(
          problem.name === 'NotAllowedError'
            ? 'Camera access was declined. You can allow it in your browser settings, or add a photo as a file instead.'
            : 'No camera is available on this device.',
        )
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video?.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)

    setPages((current) => [...current, canvas])
  }, [])

  const removeLast = () => setPages((current) => current.slice(0, -1))

  const finish = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    onDone(pages)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onCancel} className="text-sm text-white/70 hover:text-white">
          Cancel
        </button>
        <div className="flex items-center gap-3">
          <p className="tabular text-sm text-white/70">
            {pages.length === 0
              ? 'No pages yet'
              : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
          </p>
          <select
            aria-label="Recognition language"
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            className="rounded-lg border border-white/25 bg-black/50 px-2 py-1 text-sm text-white/90 focus:outline-none"
          >
            {OCR_LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code} className="text-black">
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center px-8">
            <p className="max-w-sm text-center text-sm leading-relaxed text-white/80">
              {error}
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />

            {/* Corner brackets rather than a full frame: they mark the target
                without covering the page being lined up inside it. */}
            <div className="pointer-events-none absolute inset-6 sm:inset-12">
              {[
                'left-0 top-0 border-l-2 border-t-2',
                'right-0 top-0 border-r-2 border-t-2',
                'left-0 bottom-0 border-l-2 border-b-2',
                'right-0 bottom-0 border-r-2 border-b-2',
              ].map((corner) => (
                <span
                  key={corner}
                  className={`absolute h-10 w-10 border-mark/80 ${corner}`}
                />
              ))}
            </div>

            {ready && pages.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 bottom-5 px-8 text-center text-sm leading-relaxed text-white/75">
                Fill the frame with the page, hold it flat, and avoid your own
                shadow. Even light matters more than getting close.
              </p>
            )}
          </>
        )}
      </div>

      {pages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {pages.map((page, i) => (
            <Thumbnail key={i} canvas={page} index={i + 1} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          onClick={removeLast}
          disabled={!pages.length}
          className="text-sm text-white/70 hover:text-white disabled:opacity-30"
        >
          Undo
        </button>

        <button
          onClick={capture}
          disabled={!ready}
          aria-label="Capture page"
          className="h-18 w-18 rounded-full border-4 border-white/90 p-1 disabled:opacity-30"
        >
          <span className="block h-full w-full rounded-full bg-white transition-transform active:scale-90" />
        </button>

        <button
          onClick={finish}
          disabled={!pages.length}
          className="text-sm text-mark hover:opacity-80 disabled:opacity-30"
        >
          Read {pages.length || ''}
        </button>
      </div>
    </div>
  )
}

function Thumbnail({ canvas, index }) {
  const ref = useRef(null)

  useEffect(() => {
    const holder = ref.current
    if (!holder) return
    const preview = document.createElement('canvas')
    const scale = 96 / canvas.height
    preview.width = Math.round(canvas.width * scale)
    preview.height = 96
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height)
    preview.className = 'h-24 w-auto rounded-md'
    holder.replaceChildren(preview)
  }, [canvas])

  return (
    <div className="relative shrink-0">
      <div ref={ref} />
      <span className="tabular absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-xs text-white/90">
        {index}
      </span>
    </div>
  )
}
