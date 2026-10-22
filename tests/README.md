# Tests

Browser tests with Playwright (Chromium), on an iPhone-sized screen. Each test gets its own fresh storage.

```sh
cd tests && npm install          # once: installs Playwright
npx playwright install chromium  # once, if you don't have its Chromium yet
cd ..
node --test --test-concurrency=1 tests/upgrade.test.cjs tests/features.test.cjs tests/regression.test.cjs tests/native.test.cjs tests/artifact.test.cjs tests/fixes.test.cjs tests/sections.test.cjs
```

- `upgrade.test.cjs`: data preservation. Fills the phone's storage the way the previous version keeps it (every task field, lists, categories, clients, templates, trash, history, settings, a photo), opens the old version, then the new one on the same storage, and checks that every record and photo is byte-for-byte unchanged, that only new settings were added, that the upgrade safety copy holds the whole list, and that every task still shows. `OLD_REF` picks the old version (a git ref; default `fd3731e`, the last version before 2.0).
- `features.test.cjs`: the bug fixes and new features, plus restart, no connection, a save the phone refuses, an empty list, export and import, the largest text on a small iPhone, and contrast in every theme.
- `native.test.cjs`: the iPhone app, with a stand-in for its native side (`fake-capacitor.cjs`, shaped like Capacitor's iOS bridge): reminders become notifications at the right moments and within iOS's limit of 64, they're taken back when a task is done or reminders are off, a tapped notification opens its task, files go through the share menu, the daily safety copy in Files, photos, haptics, the status bar, and the website without the shell.
- `artifact.test.cjs`: the Claude edition, built by `tools/build-artifact.cjs`, on a stand-in for Claude's runtime (only `window.claude.use`): the list loads and nothing in it changes, the Claude-only parts show (Google Calendar, asking Claude, Save everything through Claude's downloads), a new task survives a reload, Claude's dark switch is followed, a look saved by the old version comes through, and the owner's own words are carried over from the live copy instead of living in this repository.
- `fixes.test.cjs`: problems found by the October review, each written to fail before its fix: unchecking a repeating task (an edited next copy stays; an untouched one goes to Recently deleted), a repeating PO marked received, a repeating job keeping its client, Clear done in a day view, a delete whose Recently deleted copy can't be kept, a safety copy before each new version, and more.
- `sections.test.cjs`: the newer kinds of record (shopping lists and their items, wishes, savings goals and their entries, important dates) and their Recently deleted (`bin/`, never the tasks' `trash/`): Save everything and Load a saved file carry every one, a second load adds nothing; Recently deleted shows them by name and kind, brings a list back with its items and a goal with its entries exactly as they were, and clears them after 7 days or with Delete all now; a save cut off by closing goes back in, a save the phone can't make yet waits and goes in later; the iPhone app's Files copy holds them. The money, link and date helpers and moving records into Recently deleted (no screens yet) run in Node straight from index.html. `upgrade.test.cjs` also checks that the version before them (`PRE_SECTIONS_REF`, default `58a3ff2`) leaves them alone.
- `bench.cjs <app folder>`: timings with the CPU slowed 4x, on a small list and a 2000-task list (`RUNS=3` for medians).
- `profile.cjs <app folder> boot|toggle|type`: where the time goes.
- `shots.cjs <app folder> <out folder> look:mode[:screen],...`: screenshots (`screen`: full, settings, task, focus, month, overdue).
