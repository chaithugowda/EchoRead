# echoread

Listen to any document, and follow along word by word. Runs entirely in the
browser — no server, no accounts, no API keys.

Hosted on GitHub Pages.

## Build plan

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Repo, build, automatic deploy, browser capability check | done |
| 1 | Paste text, playback controls, speed, voice picker, word highlighting | next |
| 2 | Read PDF, DOCX, EPUB and TXT files in the browser | |
| 3 | Library and reading position, stored in IndexedDB | |
| 4 | Scan printed pages with the camera and read them aloud | |
| 5 | Summaries, quizzes, and questions about the document | |
| 6 | Installable, works offline, tuned for phones | |

## Running it locally

```bash
npm install
npm run dev
```

## Publishing it

1. Push this repository to GitHub with `main` as the default branch.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the
   site and publishes it.

The site lands at `https://<user>.github.io/<repo>/`.

You do not need to set the base path by hand. `vite.config.js` reads the
repository name from the CI environment and adjusts the asset paths, so the
same code works locally at `/` and on Pages at `/<repo>/`.

## What Phase 0 tells you

Speech comes from the operating system, not from this site, so what the app can
do changes from machine to machine. The deployed page reports:

- whether a speech engine exists at all
- how many voices are installed, and how many of those work without a network
- how many languages those voices cover
- **whether the engine fires `boundary` events while it speaks**

That last one decides how Phase 1 gets built. Word highlighting normally
follows `boundary` events, which report the engine's character position in real
time. Some engines never fire them, and then the only option is to estimate
word timing from the speech rate — a fallback that drifts on long passages and
needs separate handling. Run the check on every device you intend to support
before Phase 1 starts.

## Design

The reading surface is the product, so the interface is built as a reading
environment rather than a dashboard.

- **Literata** for text being read; it was drawn for long-form screen reading.
- **IBM Plex Sans** for controls, so chrome never competes with content.
- Amber `#FFD24A` marks the spoken word and nothing else. Reserving one colour
  for one meaning keeps the highlight readable at a glance.
- Ink is a deep slate teal rather than black, which is easier on the eyes over
  a long session.

## Stack

React 19, Vite 8, Tailwind 4. No runtime dependencies beyond React.
