# echoread

Listen to any document, and follow along word by word. Runs entirely in the
browser — no server, no accounts, no API keys.

Hosted on GitHub Pages.

## Build plan

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Repo, build, automatic deploy, browser capability check | done |
| 1 | Paste text, playback controls, speed, voice picker, word highlighting | done |
| 2 | Read PDF, DOCX, EPUB and TXT files in the browser | done |
| 3 | Library and reading position, stored in IndexedDB | done |
| 4 | Scan printed pages with the camera and read them aloud | next |
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

## How word highlighting works

Highlighting normally follows `boundary` events, which report the exact
character the engine is speaking. Many voices never fire them — network voices
in particular — so the reader carries two mechanisms and picks per voice at
runtime:

- **Engine timing.** Boundary events arrive, and the highlight follows them
  exactly. Always preferred; detected on the first event of a passage.
- **Estimated timing.** No events arrive, so a timer advances the highlight,
  giving each word a share of the passage in proportion to its length and any
  trailing punctuation. Every passage that finishes reports its real duration,
  which corrects the speaking-rate estimate, so the fit tightens as it reads.

Text is spoken as short passages rather than one long utterance. That keeps
each one under Chrome's fifteen-second cutoff, gives skip controls somewhere to
land, and — since a passage ending is a position the engine confirms — stops
estimated timing from drifting over a long document.

The status line above the controls says when timing is being estimated, so the
imprecision is never a mystery.

## Reading documents

Files are parsed in the browser; nothing is uploaded anywhere.

| Format | Handled by | Notes |
|--------|-----------|-------|
| PDF | pdf.js | Text layer only. Scans need Phase 4. |
| DOCX | mammoth | Headings and lists preserved |
| EPUB | JSZip | Chapters follow the spine, not filenames |
| HTML | DOMParser | Scripts, styles and navigation removed |
| TXT, MD | — | Markdown headings recognised |

Parsers load on demand. Together they are over a megabyte, and an app most
people open to paste a paragraph should not pay for a PDF engine first.

### Getting prose out of a PDF

A PDF stores positioned glyph runs, not sentences, so extracting them in order
produces text that looks acceptable and sounds wrong. Four repairs are applied:

- **Lines are rebuilt from glyph positions**, grouped by vertical position and
  sorted horizontally, since drawing order is not always reading order.
- **Running headers, footers and page numbers are dropped.** Anything short
  that appears at the edge of most pages is furniture. Digits are masked before
  comparing so page numbers still match each other.
- **Wrapped lines are rejoined into paragraphs.** A line is only treated as
  ending a paragraph if it stops short of the right margin, or the next line is
  indented, or there is a vertical gap. Breaking on a full stop alone splits a
  paragraph every time a sentence happens to land at a line end.
- **Hyphenated words are rejoined**, because "consid-" followed by "eration"
  is unlistenable.

Scanned PDFs contain no text layer and are reported as such rather than opening
empty.

## The library

Documents are kept in IndexedDB, not localStorage: localStorage caps around
five megabytes and writes synchronously, which would stall the page while a
book is saved.

Only extracted text is stored, never the original file. A twenty megabyte PDF
reduces to a couple of hundred kilobytes, and a browser cannot re-open a file
from disk on a later visit anyway.

Documents and reading positions live in separate stores. A document runs to
hundreds of kilobytes and is written once; a position is one number written
every few seconds while reading. Keeping them apart means following along does
not rewrite the whole book each time.

**Positions are character offsets, not word numbers.** Word numbering depends
on how the parser split the text, so improving the parser later would silently
move every saved position in the library. A character offset survives that, and
lands on the right sentence even if it drifts by a word.

The app asks for persistent storage on load. Without it the browser treats the
library as disposable and may clear it when the device runs short of space.

Measured speaking rates are remembered per voice, so estimated highlighting is
accurate from the first sentence on any voice used before, rather than needing
several passages to settle each time.

## Design

The reading surface is the product, so the interface is built as a reading
environment rather than a dashboard.

The interface is built as a cold instrument holding one warm light.

Chrome is deep blue-black with thin, precise edges and a cool violet for
controls. Everything in it is dim and quiet. The spoken word is the only warm
colour anywhere in the application, and on the dark theme it genuinely glows —
so the reading position is impossible to lose on a dense page, and the app has
one memorable image rather than scattered effects.

- **Literata** for text being read; it was drawn for long-form screen reading,
  and legibility outranks style on the surface people actually read.
- **Sora** for controls — geometric and forward-looking, without competing
  with the text.
- Amber marks the spoken word and nothing else. One colour, one meaning.
- Both themes ship, dark by default. Reading long documents on a dark screen
  does not suit everyone, and forcing it would be a usability failure dressed
  up as a style decision.
- Library rows carry a filled spine down their left edge showing how far into
  each document you are — books have spines, and a shelf of part-read things
  is legible in one sweep of the eye.

## Stack

React 19, Vite 8, Tailwind 4. No runtime dependencies beyond React.
