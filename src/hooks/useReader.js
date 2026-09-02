import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildChunks, tokenAtIndex, tokenize, weighToken } from '../lib/tokenize'
import { scriptById, voiceForScript } from '../lib/script'

export const speechSupported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window

// Measured on a stock Chrome install at rate 1. The engine corrects this
// figure from real timings within the first few passages.
const DEFAULT_WPM = 155

const STORE_KEY = 'echoread.settings'
const WPM_KEY = 'echoread.rates'

/**
 * Remembered speaking rates, one per voice.
 *
 * The engine takes several passages to work out how fast a voice actually
 * talks. Keeping the answer means that only happens once ever, rather than at
 * the start of every document — so estimated highlighting is accurate from
 * the first sentence on any voice used before.
 */
function loadRates() {
  try {
    return JSON.parse(localStorage.getItem(WPM_KEY)) || {}
  } catch {
    return {}
  }
}

function saveRate(voiceURI, wpm) {
  if (!voiceURI) return
  try {
    const rates = loadRates()
    rates[voiceURI] = Math.round(wpm)
    localStorage.setItem(WPM_KEY, JSON.stringify(rates))
  } catch {
    // Nothing to do; the rate is recalculated next time instead.
  }
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing refuses writes. Settings just won't persist.
  }
}

/**
 * Plays text aloud and reports which word is being spoken.
 *
 * Word position comes from one of two sources, decided per voice at runtime:
 *
 *   engine    The voice fires `boundary` events, which report the exact
 *             character being spoken. Accurate, and always preferred.
 *
 *   estimate  The voice stays silent about its position, so the highlight is
 *             driven by a timer that spends time on each word in proportion
 *             to its length and trailing punctuation. Every passage that
 *             finishes reports its true duration, which is fed back into the
 *             speaking-rate estimate, so accuracy improves as it reads.
 *
 * Network voices generally fall into the second group and local ones into the
 * first, but this is a property of the individual voice rather than of the
 * browser, so it is detected rather than assumed.
 */
export function useReader(text, scriptId) {
  const script = scriptById(scriptId)
  const tokens = useMemo(() => tokenize(text), [text])

  const chunks = useMemo(() => {
    if (!tokens.length) return []

    return buildChunks(text)
      .map((range) => {
        let tokenStart = -1
        let tokenEnd = -1
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i].start >= range.start && tokens[i].start < range.end) {
            if (tokenStart === -1) tokenStart = i
            tokenEnd = i
          }
        }
        return { ...range, tokenStart, tokenEnd }
      })
      .filter((chunk) => chunk.tokenStart !== -1)
  }, [text, tokens])

  const [voices, setVoices] = useState([])
  const [voiceURI, setVoiceURI] = useState(() => loadSettings().voiceURI ?? null)
  const [rate, setRate] = useState(() => loadSettings().rate ?? 1)
  const [status, setStatus] = useState('idle')
  const [activeToken, setActiveToken] = useState(-1)
  const [timingSource, setTimingSource] = useState(null)
  const [wpm, setWpm] = useState(DEFAULT_WPM)

  // Refs shadow the reactive values because utterance callbacks fire outside
  // React's render cycle and would otherwise read stale state.
  const generation = useRef(0)
  const rateRef = useRef(rate)
  const voiceRef = useRef(null)
  const activeRef = useRef(-1)
  const wpmRef = useRef(DEFAULT_WPM)
  const frameRef = useRef(0)
  const sawBoundary = useRef(false)
  const startedAt = useRef(0)
  // Each passage queues the next one when it ends. Holding the function in a
  // ref keeps that chain pointing at the current version rather than the one
  // captured when the first passage started.
  const speakRef = useRef(null)

  useEffect(() => {
    rateRef.current = rate
  }, [rate])

  useEffect(() => {
    saveSettings({ voiceURI, rate })
  }, [voiceURI, rate])

  // Voices arrive asynchronously and the first read is often empty.
  useEffect(() => {
    if (!speechSupported) return

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

  /*
   * Choose a voice that can actually pronounce this document.
   *
   * The document's script decides, not the browser's locale and not what was
   * used last: a saved English voice handed Kannada produces silence or noise.
   * When nothing installed matches, `matchesScript` goes false and the reader
   * says so plainly instead of reading the text badly.
   */
  const [matchesScript, setMatchesScript] = useState(true)

  useEffect(() => {
    if (!voices.length) return

    const match = voiceForScript(voices, script)
    setMatchesScript(Boolean(match))

    const current = voices.find((v) => v.voiceURI === voiceURI)
    const currentFits =
      current && current.lang.slice(0, 2) === script.lang.slice(0, 2)

    if (currentFits) return

    const preferred = match || voices.find((v) => v.default) || voices[0]
    if (preferred) setVoiceURI(preferred.voiceURI)
  }, [voices, voiceURI, script])

  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === voiceURI) || null
    const remembered = loadRates()[voiceURI]
    wpmRef.current = remembered || DEFAULT_WPM
    setWpm(wpmRef.current)
  }, [voices, voiceURI])

  const setActive = useCallback((index) => {
    if (index === activeRef.current) return
    activeRef.current = index
    setActiveToken(index)
  }, [])

  const stopEstimator = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [])

  /**
   * Advance the highlight on a timer, for voices that report nothing.
   *
   * Each word is given a slice of the passage's estimated duration in
   * proportion to its weight, and the clock decides which slice we are in.
   */
  const runEstimator = useCallback(
    (fromToken, toToken, gen) => {
      const weights = []
      let total = 0
      for (let i = fromToken; i <= toToken; i++) {
        const weight = weighToken(tokens[i])
        weights.push(weight)
        total += weight
      }

      const words = toToken - fromToken + 1
      const durationMs = (words / (wpmRef.current * rateRef.current)) * 60000
      const startedFrame = performance.now()

      const step = () => {
        if (gen !== generation.current || sawBoundary.current) return

        const elapsed = performance.now() - startedFrame
        const progress = Math.min(elapsed / durationMs, 1)
        const target = progress * total

        let cumulative = 0
        let index = fromToken
        for (let i = 0; i < weights.length; i++) {
          cumulative += weights[i]
          if (target <= cumulative) {
            index = fromToken + i
            break
          }
          index = fromToken + i
        }

        setActive(index)
        setTimingSource('estimate')
        frameRef.current = requestAnimationFrame(step)
      }

      frameRef.current = requestAnimationFrame(step)
    },
    [tokens, setActive],
  )

  /**
   * Correct the speaking-rate estimate using a passage that just finished.
   *
   * The engine never states its rate, and the `rate` property is only a
   * multiplier over a baseline that differs between voices. Measuring a real
   * passage is the only way to know, so each one nudges the running figure.
   */
  const calibrate = useCallback((fromToken, toToken) => {
    if (sawBoundary.current) return

    const elapsed = performance.now() - startedAt.current
    if (elapsed < 400) return

    const words = toToken - fromToken + 1
    const measured = words / (elapsed / 60000) / rateRef.current
    if (!Number.isFinite(measured)) return

    const blended = wpmRef.current * 0.7 + measured * 0.3
    wpmRef.current = Math.min(600, Math.max(60, blended))
    setWpm(wpmRef.current)
    saveRate(voiceRef.current?.voiceURI, wpmRef.current)
  }, [])

  const speakFrom = useCallback(
    (tokenIndex, gen) => {
      const chunk = chunks.find(
        (c) => tokenIndex >= c.tokenStart && tokenIndex <= c.tokenEnd,
      )

      if (!chunk) {
        setStatus('idle')
        setActive(-1)
        return
      }

      const offset = tokens[tokenIndex].start
      const segment = text.slice(offset, chunk.end)

      const utterance = new SpeechSynthesisUtterance(segment)
      utterance.rate = rateRef.current
      if (voiceRef.current) {
        utterance.voice = voiceRef.current
        utterance.lang = voiceRef.current.lang
      }

      sawBoundary.current = false
      startedAt.current = performance.now()
      setActive(tokenIndex)

      utterance.onboundary = (event) => {
        if (gen !== generation.current) return
        if (event.name && event.name !== 'word') return

        if (!sawBoundary.current) {
          sawBoundary.current = true
          stopEstimator()
          setTimingSource('engine')
        }
        setActive(tokenAtIndex(tokens, offset + event.charIndex))
      }

      utterance.onend = () => {
        if (gen !== generation.current) return
        stopEstimator()
        calibrate(tokenIndex, chunk.tokenEnd)

        const next = chunk.tokenEnd + 1
        if (next < tokens.length) speakRef.current(next, gen)
        else {
          setStatus('idle')
          setActive(-1)
        }
      }

      utterance.onerror = (event) => {
        if (gen !== generation.current) return
        if (event.error === 'interrupted' || event.error === 'canceled') return
        stopEstimator()
        setStatus('idle')
      }

      window.speechSynthesis.speak(utterance)
      runEstimator(tokenIndex, chunk.tokenEnd, gen)
    },
    [chunks, tokens, text, setActive, stopEstimator, calibrate, runEstimator],
  )

  useEffect(() => {
    speakRef.current = speakFrom
  }, [speakFrom])

  const playFrom = useCallback(
    (tokenIndex) => {
      if (!speechSupported || !tokens.length) return

      const gen = ++generation.current
      stopEstimator()
      window.speechSynthesis.cancel()
      setStatus('playing')

      // Chrome drops an utterance queued in the same tick as a cancel.
      setTimeout(() => {
        if (gen !== generation.current) return
        speakFrom(Math.max(0, Math.min(tokenIndex, tokens.length - 1)), gen)
      }, 60)
    },
    [tokens.length, speakFrom, stopEstimator],
  )

  /**
   * Pause by stopping and remembering the word.
   *
   * The API has pause and resume, but they are unreliable on mobile — Android
   * frequently refuses to resume, leaving the reader stuck with no way out.
   * Re-speaking from the remembered word behaves the same everywhere, at the
   * cost of restarting the current word rather than the exact syllable.
   */
  const pause = useCallback(() => {
    generation.current++
    stopEstimator()
    window.speechSynthesis.cancel()
    setStatus('paused')
  }, [stopEstimator])

  const stop = useCallback(() => {
    generation.current++
    stopEstimator()
    window.speechSynthesis.cancel()
    setStatus('idle')
    setActive(-1)
  }, [stopEstimator, setActive])

  /** Move the highlight without speaking — used to restore a saved position. */
  const seek = useCallback(
    (tokenIndex) => {
      generation.current++
      stopEstimator()
      if (speechSupported) window.speechSynthesis.cancel()
      setActive(Math.max(0, Math.min(tokenIndex, tokens.length - 1)))
      setStatus('paused')
    },
    [tokens.length, setActive, stopEstimator],
  )

  const toggle = useCallback(() => {
    if (status === 'playing') pause()
    else playFrom(activeRef.current < 0 ? 0 : activeRef.current)
  }, [status, pause, playFrom])

  const skip = useCallback(
    (direction) => {
      if (!chunks.length) return

      const current = activeRef.current < 0 ? 0 : activeRef.current
      const index = chunks.findIndex(
        (c) => current >= c.tokenStart && current <= c.tokenEnd,
      )
      const safe = index === -1 ? 0 : index

      // Going back mid-passage restarts it, which is what a listener means by
      // "back" the first time they press it.
      const restarting =
        direction < 0 && current > chunks[safe].tokenStart + 1

      const target = restarting
        ? safe
        : Math.min(chunks.length - 1, Math.max(0, safe + direction))

      const token = chunks[target].tokenStart
      if (status === 'playing') playFrom(token)
      else {
        setActive(token)
        setStatus('paused')
      }
    },
    [chunks, status, playFrom, setActive],
  )

  const changeRate = useCallback(
    (next) => {
      setRate(next)
      rateRef.current = next
      if (status === 'playing') playFrom(activeRef.current)
    },
    [status, playFrom],
  )

  const changeVoice = useCallback(
    (uri) => {
      setVoiceURI(uri)
      voiceRef.current = voices.find((v) => v.voiceURI === uri) || null
      setTimingSource(null)
      if (status === 'playing') playFrom(activeRef.current)
    },
    [voices, status, playFrom],
  )

  useEffect(() => {
    return () => {
      generation.current++
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      if (speechSupported) window.speechSynthesis.cancel()
    }
  }, [])

  return {
    tokens,
    voices,
    voiceURI,
    rate,
    status,
    activeToken,
    timingSource,
    wpm,
    script,
    matchesScript,
    playFrom,
    seek,
    pause,
    stop,
    toggle,
    skip,
    changeRate,
    changeVoice,
  }
}
