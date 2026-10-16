# To-Do

A to-do list that runs on your phone and works with no signal.

- Your tasks and photos stay on your own device. This site only serves the app; nothing you type is sent anywhere.
- Put it on your home screen: on iPhone, tap Share, then Add to Home Screen. On Android, tap ⋮, then Add to Home screen.
- Keep a backup now and then: Settings, then Save everything.

## New in 2.0

- **Themes.** Settings, then Theme: Midnight Neon, Cyberpunk, Ocean Blue, Emerald Dark, Sunset, Minimal Light, AMOLED Black, Royal Purple, and Classic. Your six original orange looks are still there. Pick System, Light or Dark, and any accent color.
- **Deadlines first.** Every task with a date shows how long is left, and Up next counts down to the second. Views for Today, Upcoming, Overdue and Done. A progress ring for the day.
- **Extras, all optional** (Settings, then Extras): a daily kickoff, a one-line pep talk, a focus timer, and reminders while the app is open (Off, Gentle, Standard, Intense). With the app closed, reminders come from your phone's calendar: open a task and tap Phone calendar.
- **Safety copies.** The app copies your whole list on the phone each day you use it and before every update. Settings, then Safety copies, puts one back. (Photos aren't in the copies; they stay where they are. Save everything still makes a file you can keep anywhere.)

## The iPhone app

The same app as a real iPhone app, with reminders that come as notifications even when it's closed. No Mac needed: GitHub builds it and it reaches your iPhone through TestFlight. Setup, step by step: [NATIVE.md](NATIVE.md).

## For whoever edits the app

- After any change to `index.html`, run `node tools/release.cjs`. The page only runs scripts whose fingerprints are in its security policy; this updates them, and gives the offline copy a new version so phones pick up the change.
- Tests and the benchmark: see [tests/README.md](tests/README.md).
