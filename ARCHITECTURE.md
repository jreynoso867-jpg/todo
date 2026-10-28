# How the app is built

## One file, three ways

`index.html` is the whole app: about 890 KB and 15,800 lines, with no framework and nothing to install. It ships as:

- **The website** (and its Home Screen icon): `index.html`, `sw.js` (the offline copy), the font, icons and the
  reminder sound, served by GitHub Pages from the branch picked in the repository's Settings › Pages.
- **The iPhone app**: the same page inside Capacitor 8 (`ios/`). `tools/build-www.cjs` copies the files into `www/`;
  `.github/workflows/ios.yml` builds it on GitHub's Macs, and sends it to TestFlight only when run by hand.
- **The Claude list**: `tools/build-artifact.cjs` takes out the phone storage layer and the offline copy, and carries
  the owner's own words over from the published copy (they aren't kept in this public repository).

After any change to `index.html`, `node tools/release.cjs` updates the Content-Security-Policy's hash of each inline
script (a stale hash leaves the page blank), the app version, and the offline copy's version. Tests: `tests/`.

## What's in `index.html`, in order

| Part | Lines | Size | What it does |
| --- | ---: | ---: | --- |
| Font | 5 | 0.3 KB | Archivo, from the file next to the page |
| Phone storage layer (`<script>` starting `/* The phone app:`) | 741 | 42 KB | Website and iPhone app only: Claude's `window.claude.use('db')` stood in for on IndexedDB (`jose-todo`: `docs` and `blobs`), safety copies, the passcode lock, and the iPhone bridge (notifications, Files, haptics). Taken out of the Claude build at its marker. |
| Stylesheet | 2,120 | 136 KB | Layout, components, then each look's touches (Blush last) |
| Theme engine (`/* Looks:`) | 284 | 23 KB | Each look and mode worked out into color tokens, with contrast checks (`window.todoTheme`) |
| Markup | 1,188 | 87 KB | The four tabs and every sheet |
| App script | 11,459 | 578 KB | 59 sections, 539 functions, 300 event listeners, one state object `S` |
| Offline copy registration | 3 | 0.2 KB | Website only |

## How a change goes in and comes back

1. A tap calls an action (`toggleDone`, `moveTask`, `quickSubmit`…), which writes through `write(key, op)`: one write
   at a time per record, retried once if the storage is busy for a moment.
2. On the website and the iPhone app, each write is noted first (`todo.saving`) and finished on the next start if the
   app closed halfway, but only if the record is still exactly as it was. With no signal, changes wait in
   `todo.outbox`, oldest first; a delete waits for its Recently deleted copy (`after`), so nothing is deleted without it.
3. The storage's live listeners (`onSnapshot`, one per collection) put the new records in `S`, with any waiting changes
   laid over them.
4. `scheduleRender()` draws once per frame however many changes arrive together. `render()` calls each part's own
   function; each returns at once when its tab isn't showing, and redraws only what changed (Tasks keeps one element
   per task and moves it; Home's agenda and the other cards compare a signature first).

Data changes stay additive: new fields and records only (the `postponed` note on a repeating task, for example), so
an older copy of the app reading the same records keeps working.

## Splitting the file safely (not done yet)

The file is big to edit, not slow to run (see Performance). These seams already exist, from least risky to most:

1. **The theme engine and the phone storage layer**: already separate `<script>` blocks, and the Claude build already
   cuts the storage layer out by its marker.
2. **The helpers that don't touch the page**: dates and repeats (`nextOccurrence`, `stepDate`, `anchorFor`,
   `postponedFrom`), smart add (`readSmart`), money and links, the saved-file format. These could be tested in Node
   directly; `sections.test.cjs` already runs some of them straight out of `index.html`.
3. **The stylesheet**, along its section comments.
4. **The app script**, along its sections: the data layer (writes, the save notes, the outbox, live data), each tab's
   drawing, the sheets, and each feature (POs, clients, job reports and their PDF, Google Calendar, Ask Claude,
   receipts, focus, reminders).

How, without changing what ships: keep `index.html` as the built file that the website, the iPhone build, the Claude
build and the tests all use; put the parts in `src/`; add a `tools/build-html.cjs` that joins them in order and then
runs `release.cjs`; and add a test that `index.html` is exactly the build of `src/`, so the two can't drift. One seam
per change, with the whole test suite each time.

What has to hold: one HTML page at runtime (the Claude list is a single page, and the offline copy and the iPhone
build expect it), a CSP hash for every inline script, the markers `build-artifact.cjs` cuts at, no framework, and
the stored data unchanged.

## Performance

Measured with `tests/bench.cjs`: Chromium with the CPU slowed 4× to stand in for a phone, an iPhone-size screen, a
small list (6 rows showing) and a 2,000-task list (793 rows showing). Before these changes (`c4cc81d`) and after
(`f84e8f1`), one run of each in turn, five times, medians. Taking turns matters: two batches run one after the other
differed by 10–20% on everything, in both directions, from the machine alone. Times are milliseconds the page was
busy (main thread) with the slowed CPU; on a real phone's CPU, roughly a quarter. This is Chromium, not an iPhone.

| | Small: before | after | | 2,000 tasks: before | after | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening: first tasks on screen | 715 | 716 | 0% | 2,569 | 2,012 | **−22%** |
| Opening: busy until settled | 1,156 | 1,189 | +3% | 3,950 | 4,117 | +4% |
| Opening on Home | 818 | 775 | −5% | 1,525 | 1,492 | −2% |
| Checking off a task | 102 | 95 | −7% | 421 | 374 | **−11%** |
| Opening a task | 63 | 69 | +9% | 619 | 551 | **−11%** |
| Editing a task and saving | 82 | 67 | **−18%** | 706 | 655 | −7% |
| Searching (6 letters) | 255 | 237 | −7% | 2,647 | 2,622 | −1% |
| Switching tabs (median of 6) | 55 | 61 | +12% | 259 | 262 | +1% |
| Slowest tab switch | 60 | 94 | **+57%** | 335 | 362 | +8% |
| Typing 30 letters in quick add | 353 | 360 | +2% | 2,035 | 2,369 | **+16%** |
| Page size (elements) | 4,198 | 4,387 | +5% | 55,305 | 55,772 | +1% |

What these say:

- **Faster, at the median:** the first tasks show up a fifth sooner on a long list; checking off and editing a task
  are 7–18% quicker, and opening one 11% quicker on the long list. Runs spread widely, so read changes under about 10%
  as noise; the two causes are measured directly: drawing the page no longer reads the window's width (each read made the
  browser lay out the whole page mid-draw; `daily.test.cjs` now counts them), and an empty quick add isn't read on
  every redraw.
- **The same, within the spread between runs:** opening (busy until settled), Home, tab switches in general, search.
  Their run-to-run ranges overlap.
- **Slower: the first visit to Home** after opening on Tasks (about 65 → 90 on the small list, so a few milliseconds on
  a real phone): Home now draws the whole agenda and a quick add, and laying that out the first time is the cost.
  Later visits are unchanged.
- **Slower: typing in quick add on a 2,000-task list**, +16% at the median, inside a wide spread (the browser's style
  work swings 2× between runs of the same version). The part that can be pinned down: smart add's patterns now warm up
  on the first keystroke after the app opens, instead of on every redraw while it starts. After the first word, typing
  costs the same in both versions (measured).

Still the slowest things on a 2,000-task list, in both versions: searching (about 2.6 s of slowed-CPU time for six
letters) and typing in quick add, mostly the browser restyling a page of 55,000 elements. Showing fewer rows at once
is the next real gain for long lists (Done already shows 100 at a time).
