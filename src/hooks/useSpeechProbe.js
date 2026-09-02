import { useCallback, useEffect, useRef, useState } from 'react'
import { tokenAtIndex } from '../lib/tokenize'

const supported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window

/**
 * Reads what the browser's speech engine can actually do.
 *
 * Two things decide how the reader gets built, and neither can be looked up in
 * a compatibility table with any confidence — they depend on the operating
 * system's installed voices as much as on the browser:
 *
 *   1. Which voices exist, and which of them work without a network call.
 *   2. Whether the engine fires `boundary` events while speaking. Word
 *      highlighting is driven by those events. Without them the reader has to
 *      estimate word timing from speech rate instead, which is a different
 *      and much fussier implementation.
 */
export function useSpeechProbe(tokens, text) {
  const [voices, setVoices] = useState([])
  const [status, setStatus] = useState('idle')
  const [activeToken, setActiveToken] = useState(-1)
  const [boundaryCount, setBoundaryCount] = useState(0)
  const [reportsLength, setReportsLength] = useState(false)
  const [durationMs, setDurationMs] = useState(null)
  const [error, setError] = useState(null)

  const startedAt = useRef(0)

  // Voices populate asynchronously, and on some browsers the first call
  // returns an empty list until the engine warms up.
  useEffect(() => {
    if (!supported) return

    const load = () => {
      const list = window.speechSynthesis.getVoices()
      if (list.length) setVoices(list)
    }

    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    const retry = setTimeout(load, 400)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      clearTimeout(retry)
    }
  }, [])

  // Never leave the engine talking to an unmounted page.
  useEffect(() => {
    if (!supported) return
    return () => window.speechSynthesis.cancel()
  }, [])

  const run = useCallback(() => {
    if (!supported) return

    window.speechSynthesis.cancel()
    setStatus('speaking')
    setActiveToken(-1)
    setBoundaryCount(0)
    setReportsLength(false)
    setDurationMs(null)
    setError(null)
    startedAt.current = performance.now()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1

    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return
      setBoundaryCount((n) => n + 1)
      if (typeof event.charLength === 'number' && event.charLength > 0) {
        setReportsLength(true)
      }
      setActiveToken(tokenAtIndex(tokens, event.charIndex))
    }

    utterance.onend = () => {
      setDurationMs(Math.round(performance.now() - startedAt.current))
      setActiveToken(-1)
      setStatus('done')
      // Some engines only expose the full voice list once they have spoken.
      const list = window.speechSynthesis.getVoices()
      if (list.length) setVoices(list)
    }

    utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return
      setError(event.error || 'unknown')
      setActiveToken(-1)
      setStatus('error')
    }

    window.speechSynthesis.speak(utterance)
  }, [text, tokens])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setActiveToken(-1)
    setStatus('idle')
  }, [])

  return {
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
  }
}
