import { useCallback, useEffect, useState } from 'react'
import { speechSupported } from './hooks/useReader'
import { requestPersistence } from './lib/store'
import Library from './views/Library'
import Reader from './views/Reader'

const THEME_KEY = 'echoread.theme'

export default function App() {
  const [openId, setOpenId] = useState(null)
  const [wpm, setWpm] = useState(155)
  const [theme, setTheme] = useState(
    () => localStorage.getItem(THEME_KEY) || 'dark',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0B1220' : '#F4F6FB')
  }, [theme])

  // Ask once, on load, so a half-read book is not evicted when the device
  // runs short of space.
  useEffect(() => {
    requestPersistence().catch(() => {})
  }, [])

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  )

  if (!speechSupported) {
    return (
      <div className="min-h-screen bg-void px-6 py-16 text-text">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-read text-3xl">echoread</h1>
          <p className="mt-4 text-sm leading-relaxed text-bad">
            This browser has no speech engine, so there is nothing to read
            with. Try Chrome, Edge, or Safari.
          </p>
        </div>
      </div>
    )
  }

  return openId ? (
    <Reader id={openId} onExit={() => setOpenId(null)} onWpm={setWpm} />
  ) : (
    <Library
      onOpen={setOpenId}
      wpm={wpm}
      theme={theme}
      onTheme={toggleTheme}
    />
  )
}
