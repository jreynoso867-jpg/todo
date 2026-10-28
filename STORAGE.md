# Where your list is kept, and how to move it safely

The app runs three ways, and each keeps its own copy of your list. **Nothing syncs between them on its own.** A change
made in one shows up in another only when you move it there with a saved file (below).

| | Claude list | Website (and its Home Screen icon) | iPhone app |
| --- | --- | --- | --- |
| Where the list is kept | Claude's database for this list, on Anthropic's servers. The same list on every device where you open it. | This browser's storage for the site, on this device only (an IndexedDB database called `jose-todo`). On iPhone, Safari and the Home Screen icon each keep their own. | The app's own storage, on this iPhone only (the same kind of database, inside the app). |
| Photos | The list's file store in Claude | The same browser storage | The app's storage |
| Safety copies | None of its own: Claude keeps the list | Inside the same storage: one a day you use it, one before each new version, one before a copy is put back, and any you make (the newest 5, 3, 3 and 3) | The same, plus a file a day in Files › On My iPhone › To-Do › Safety copies (the newest 7). None while the passcode lock is on. |
| Lost if | the list itself is deleted in Claude | the site's data is cleared (Safari settings, or iOS clearing it). Its safety copies go with it. | the app is deleted. Its Files copies go too. |
| Reminders | While the list is open | While the page is open, or the task as a calendar file (Phone calendar) | Notifications, even with the app closed (iOS keeps at most 64 waiting) |
| Google Calendar | Optional, one-way (below) | No | No |

**On each device only** (never in the list, never in a saved file): which tab, view, list filter and sort you were on,
text size and look (also saved with the list), tips you've dismissed, "Keep both" for tasks listed twice, the
passcode lock (`todo.lock`, only a salted hash of the code), changes made with no signal that are waiting to go in
(`todo.outbox`) and changes on their way in when the app was closed (`todo.saving`). These are the browser's
localStorage keys starting with `todo.`.

The website itself only serves the app: the page sends nothing you type anywhere. GitHub Pages serves whichever
branch is picked in the repository's Settings › Pages; a push to that branch changes what the website loads.

## Moving or backing up your list

**Save everything** (Settings) makes one file: every task (not the sample ones), list, category, client, template,
history day, shopping list and item, wish, savings goal and entry, and important date, your look and extras, and
the photos inside it. It leaves out Recently deleted.

**Load a saved file** (Settings) only adds:

- A record this copy doesn't have yet (by its id) is added exactly as it is in the file.
- A record this copy already has is left exactly as it is here. Nothing is written over, and nothing is deleted.
- An open repeating task this copy already has open (the same words, list and repeat, under another id) is left
  out, and the message says which. Checked off on two copies, each made its own next one, so adding it would list it
  twice. (Before this, the live list got two such pairs; Tasks now says so, and Review lets you keep one.)
- History and finished tasks come over. A Google Calendar link stays with the copy that made the event.
- Loading the same file twice adds nothing the second time.

**Save as a spreadsheet** (under the list) is a CSV for reading in Excel or Google Sheets. It can't be loaded back.

**Keep saved files private.** A Save everything file, a spreadsheet and a safety copy are plain text: anyone with the
file can read the whole list and its photos. The passcode lock doesn't change that (below).

### The safest way to work across the three

1. Pick one copy to work in day to day, and treat the others as places you move to, not places you also edit.
2. Once a week, Save everything from that copy and keep the file somewhere apart from the device (iCloud Drive,
   for example). On the iPhone app, the daily copy in Files is extra, not a replacement: deleting the app deletes it.
3. To switch copies: Save everything in the old one, Load a saved file in the new one, then check the numbers in the
   message.
4. If you did edit in two places, load the other copy's file anyway: it only adds what's missing, and leaves out
   repeating tasks you already have. Anything listed twice shows up on Tasks with a Review button.

### Why there's no automatic sync

Two-way sync is only safe with a rule for each of these, and the app doesn't have them yet:

- **Which change wins.** Tasks don't record when they were last changed (the newer kinds of record do, `updatedAt`).
  Without it, two copies that both changed a task can't tell which change is newer, and sync would write over one.
- **Deletes.** A task deleted on one copy would come back from the other unless deletions are recorded too.
- **Repeating tasks.** Checked off on two copies, each makes its own next one: the duplicates above.

Until those exist (a change time on every task, recorded deletes, and a merge that keeps the newer change per field
and asks when it can't tell), moving by file is the safe way: it never loses or overwrites anything.

## Google Calendar (Claude list only)

Settings › Google Calendar › Turn on, using your own Google Calendar connector in Claude. It's **one-way**:

- Each open task with a date and a time, due today or later, becomes an event on your primary calendar: its title,
  its time (or an hour), its list's name, and a client's address as the place. A task's notes are never sent.
- When its title, date, time or client address changes, the old event is deleted and a new one is made.
- A repeating task's event is for its current date only; the next one gets its own event once it's made.
- A task moved to Recently deleted, or whose date or time was taken off, has its event deleted. A finished or past
  task keeps its event.
- Nothing comes back from Google Calendar. An event changed or deleted there isn't seen by the list, and the next
  change to the task replaces it.
- After an error it stops until you tap Try again. Turn off leaves the events it made on your calendar.

This was checked against the code, not against a live Google Calendar: no Google Calendar connection was available
where these changes were made.

## The passcode lock

The passcode lock (website and iPhone app, Settings) keeps people from opening your list in the app: it asks for the
code when the app opens and after a minute away, and hides the list in the app switcher. **It isn't encryption.** The
list is kept on the phone as it is, protected by the phone's own passcode, and anyone with a saved file can read it.
Only a salted, slow hash of the code is kept, never the code itself.
