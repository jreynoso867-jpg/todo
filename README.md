# To-Do

A to-do list that runs on your phone and works with no signal.

- Your tasks and photos stay on your own device. This site only serves the app; nothing you type is sent anywhere.
- Put it on your home screen: on iPhone, tap Share, then Add to Home Screen. On Android, tap ⋮, then Add to Home screen.
- Keep a backup now and then: Settings, then Save everything.
- The passcode lock (Settings) keeps people from opening your list in the app. It isn't encryption: the list is kept on the phone as it is, protected by the phone's own passcode, and a Save everything file can be read by anyone who has it, so keep those files private.

## New: the day, easier to run

- **Home is your agenda.** What's overdue (each with a Today button, or Move all to today), today's tasks by time, the next 7 days with your important dates, and what's waiting on someone (who, for how long, and when to follow up). Nothing is out of sight: each part says how many more there are.
- **Add from Home.** The same quick add as on Tasks, right on Home: "Call the bank tomorrow 3pm !!! #home".
- **Putting off a repeating task keeps its schedule.** Move to today, Move to tomorrow, a swipe, Select or a drag in the week: done late, it comes back on its usual day.
- **Urgent and important look different.** Red means late. High priority is violet.
- **A weekly review.** Calendar, Week, Review unfinished: each late task, each one waiting on someone and each with no date, one at a time.
- **Done says when.** Each finished task says when it was checked off: "Done today at 3:10 PM", "Done yesterday".
- **Moving between Claude and the phone.** Loading a saved file no longer lists a repeating task twice, and Tasks shows any that already are, so you can keep one.
- **Easier to tap.** Every button answers a tap in an area at least 44 points tall.
- Where each copy keeps your list, and how to move it safely: [STORAGE.md](STORAGE.md).

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
