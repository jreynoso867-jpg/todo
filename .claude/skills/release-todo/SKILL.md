---
name: release-todo
description: How to change, test and release Jose's To-Do, the single-file app in this repository that ships three ways (website / Home Screen web app on GitHub Pages, native iPhone app through TestFlight, and a Claude artifact with a synced database). Use this whenever you edit index.html or sw.js, fix a bug or add a feature to the to-do app, run its tests, rebuild or republish the Claude artifact edition, put the website live, or start an iPhone (TestFlight) build, even if the request only says "update the to-do list", "make the app better", "publish it" or "put it on my phone".
---

# Changing and releasing the to-do app

One person runs his day on this app, on his iPhone. His list is the thing that matters: losing or overwriting a task is the worst possible outcome, worse than any missing feature. Everything below exists to keep that from happening while still shipping improvements.

## The three editions, one file

`index.html` is the whole app. It ships as:

| Edition | What runs | Where the data lives | Who puts it live |
| --- | --- | --- | --- |
| Website / Home Screen web app | `index.html` + `sw.js` from the `gh-pages` branch | IndexedDB on the phone, through the shim (first `<script>`), which emulates Claude's `window.claude.use` | a push to `gh-pages`: needs the owner's OK every time |
| iPhone app | the same page inside Capacitor 8 (`ios/`), files copied by `npm run build` | the app's own IndexedDB; notifications and file copies through `window.Capacitor.Plugins` | the owner taps Run workflow (Actions, "iPhone app"); see NATIVE.md |
| Claude artifact | `tools/build-artifact.cjs` output: the shim and service worker removed | Claude's synced database, shared by every device that opens it | an Artifact publish to the existing artifact URL |

Code branches on `IS_PHONE` (website and iPhone app), `NATIVE` (iPhone app only) and neither (Claude). Text the user sees should be true for the edition showing it: no "Phone calendar" button or "saved on this phone" in Claude, no "with the app closed" promises on the website.

## Making a change

1. Work on a branch, never directly on `main` or `gh-pages`.
2. Edit `index.html`. Keep data changes additive: new fields and documents are fine; renaming, dropping or reshaping stored fields is not, because older copies of the app (another device, the website, a TestFlight build) still read and write the same records.
3. Run `node tools/release.cjs` after every edit. The page has a strict Content-Security-Policy with a sha256 hash per inline script; a stale hash makes the page blank and tests time out mysteriously.
4. Add a test for every fix and feature (Playwright, `tests/*.test.cjs`, fixtures and storage helpers in `tests/lib.cjs`). Prove the bug first when you can: a test that fails before the fix and passes after is worth more than one written afterwards.
5. Run everything: `cd tests && npm test` (upgrade, features, regression, native, artifact, fixes, sections, tabs, shopping, wishes, goals). All must pass. `upgrade.test.cjs` is the data-preservation test: an old version's storage opened by the new code must come through record for record.
6. Commit with a message that says what changed for the user and why.

Things that have bitten before: the hero card shows the first task (wait for `#board .task, #heroOpen:not([disabled])`, not just rows); time-of-day prompts differ before 9 AM; `<a download>` does nothing inside Claude or the iPhone app (use the downloads capability / share sheet); the synced Claude database means two devices can write the same record.

## Releasing the Claude artifact

The artifact is private and pinned by the owner; find it with the Artifact tool (`action: "list"`, title "Jose's To-Do List") if its URL isn't in the conversation.

1. Read the live copy first: `Artifact` with `action: "read"` and its URL. Read every line of the saved file (the tool requires it before a publish, and it's the only way to know nothing published would be lost). Its path is in the read result.
2. Note the data before publishing: `ArtifactData` `list` with `out_dir` for each collection (tasks, lists, trash, templates, clients, categories, history, settings, shopLists, shopItems, wishes, goals, goalEntries, dates, bin) into a scratch folder. After the first publish that has shopping lists, wishes, savings goals or important dates, list each of those collections again to confirm the database takes them.
3. Build: `node tools/build-artifact.cjs --live <saved live copy> --out <scratch>/todo-list.html`. The owner's own words (follow-up signature, example names) are carried over from the live copy; they are deliberately not in this public repository, so never paste them into the repo.
4. Test the built page: `node --test tests/artifact.test.cjs` (it builds its own copy with made-up words). For extra safety, seed the data you saved in step 2 into the same harness and check that nothing changes and the same tasks show as in the old page.
5. Publish with the same `url`, omitting `capabilities`, `contract` and `icon` so the stored permissions (db, assets, downloads, sample, Google Calendar) carry forward unchanged.
6. List the data again into a second folder and `diff -r` the two. Report the counts to the owner.

## The website and the iPhone app

- Website: `gh-pages` serves a commit of this repository as-is. Moving it (a fast-forward push of a tested commit) changes what the owner's phone loads next, so ask first, even if a similar push was approved before. The service worker version (`sw.js`, set by release.cjs) makes phones pick up the new page.
- iPhone app: the workflow `.github/workflows/ios.yml` builds a simulator check on pushes and sends a TestFlight build when the owner runs it by hand (he can pick the branch in the Run workflow menu). Signing uses his App Store Connect API key from repository secrets; nothing to do locally.

## Before saying it's done

Say what was verified and how (tests, counts before and after, screenshots), and what wasn't (anything needing his real iPhone, his Google Calendar, or Claude's live sampling). If a step was refused or skipped, say so plainly and what it needs.
