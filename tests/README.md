# Tests

Browser tests with Playwright (Chromium), on an iPhone-sized screen. Each test gets its own fresh storage.

```sh
cd tests && npm install          # once: installs Playwright
npx playwright install chromium  # once, if you don't have its Chromium yet
cd ..
node --test --test-concurrency=1 tests/upgrade.test.cjs tests/features.test.cjs
```

- `upgrade.test.cjs`: data preservation. Fills the phone's storage the way the previous version keeps it (every task field, lists, categories, clients, templates, trash, history, settings, a photo), opens the old version, then the new one on the same storage, and checks that every record and photo is byte-for-byte unchanged, that only new settings were added, that the upgrade safety copy holds the whole list, and that every task still shows. `OLD_REF` picks the old version (a git ref; default `fd3731e`, the last version before 2.0).
- `features.test.cjs`: the bug fixes and new features, plus restart, no connection, a save the phone refuses, an empty list, export and import, the largest text on a small iPhone, and contrast in every theme.
- `bench.cjs <app folder>`: timings with the CPU slowed 4x, on a small list and a 2000-task list (`RUNS=3` for medians).
- `profile.cjs <app folder> boot|toggle|type`: where the time goes.
- `shots.cjs <app folder> <out folder> look:mode[:screen],...`: screenshots (`screen`: full, settings, task, focus, month, overdue).
