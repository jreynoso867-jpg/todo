# The iPhone app

The same to-do app, installed as a real iPhone app instead of a Home Screen icon. You don't need a Mac: GitHub's Macs build it, Apple signs it, and it reaches your iPhone through **TestFlight**, Apple's app for installing your own apps before (or instead of) the App Store.

What the iPhone app adds:

- **Reminders that come with the app closed.** Tasks with a time become real iPhone notifications, with a sound, following Settings › Extras › Reminders (Off, Gentle, Standard, Intense). Tasks with only a date get one note that morning. Tap a notification to open its task.
- **Files through the share menu.** Save everything, CSV and PDF reports, and calendar events open the iPhone's share menu (Save to Files, Mail, Messages, AirDrop).
- **Taps you can feel** (the Taptic Engine), and a status bar that matches your theme.
- **A daily safety copy in Files**: Files › On My iPhone › To-Do › Safety copies. One file a day, the newest 7 kept. It's apart from the app's own storage, so it outlasts anything that happens there. (Not while the passcode lock is on: anyone holding the phone could open a file there.)

The website keeps working exactly as before. The iPhone app keeps its own copy of the list (step 8 moves it over).

## One-time setup (about 20 minutes, on any computer or your iPhone's browser)

You need your paid Apple Developer account and this GitHub repository.

### 1. Register the app's ID

First, if [developer.apple.com/account](https://developer.apple.com/account) or App Store Connect shows an agreement to accept, accept it: Apple blocks new apps and uploads until you do.

1. Go to [developer.apple.com/account](https://developer.apple.com/account), then **Certificates, IDs & Profiles**, then **Identifiers**.
2. Tap **+**, choose **App IDs**, then **App**, and continue.
3. Description: `To-Do`. Bundle ID: **Explicit**, `com.jreynoso867.todo`.
4. Leave every capability as it is (notifications made on the phone need none). Tap **Continue**, then **Register**.

### 2. Create the app in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com), then **Apps**, then **+**, then **New App**.
2. Platform **iOS**. Name: `Jose's To-Do`. App Store names are unique, so if it's taken, add a word; the name under the icon stays "To-Do".
3. Primary language: English (U.S.). Bundle ID: pick `com.jreynoso867.todo`. SKU: `jose-todo`. User access: Full Access.
4. Tap **Create**. Nothing is published; the app stays private until you submit it for review, which you never have to do.

### 3. Make a key for GitHub

1. In App Store Connect: **Users and Access**, then **Integrations**, then **App Store Connect API**, then **Team Keys**. If it shows **Request Access**, tap it once (only the account holder can, and that's you).
2. Tap **+** (Generate API Key). Name: `GitHub`. Access: **Admin**. Only Admin keys may use Apple's cloud signing certificate, which is what lets this work without a Mac.
3. **Download API Key**. You get a file named like `AuthKey_ABC123XYZ.p8`. Apple lets you download it **only once**, so keep it somewhere safe.
4. Note the **Key ID** (in the key's row) and the **Issuer ID** (above the list of keys).

### 4. Find your Team ID

On [developer.apple.com/account](https://developer.apple.com/account), scroll to **Membership details**. The **Team ID** is 10 letters and numbers.

### 5. Give the four values to GitHub

In this repository on GitHub: **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Add each of these:

| Name | Value |
| --- | --- |
| `APPLE_TEAM_ID` | your Team ID (step 4) |
| `APPSTORE_KEY_ID` | the Key ID (step 3) |
| `APPSTORE_ISSUER_ID` | the Issuer ID (step 3) |
| `APPSTORE_KEY_P8` | everything in the `.p8` file, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`. Open it with any text editor (Notepad on Windows) and copy it all. |

Secrets stay hidden: nobody can read them back, and only a build you start yourself can use them, even though this repository is public.

### 6. Build it

On GitHub: **Actions**, then **iPhone app** on the left, then **Run workflow** (keep "Send this build to TestFlight" ticked), then **Run workflow**.

It takes about 15 to 30 minutes. A green check means it was sent to Apple. Apple then takes 5 to 30 minutes to process it; you get an email when it's ready.

### 7. Put it on your iPhone

1. In App Store Connect, open your app, then **TestFlight**.
2. Next to **Internal Testing**, tap **+** to make a group (for example `Me`). Tick **Enable automatic distribution**, so every new build reaches your iPhone by itself.
3. Tap **Invite Testers**, tick yourself, and add.
4. On your iPhone, install **TestFlight** from the App Store, open the invite email on the phone, and tap through to **Accept**, then **Install**.

A TestFlight build works for 90 days. Running step 6 again gives you a fresh one, and TestFlight updates the app in place without touching your list.

### 8. Bring your list over

The iPhone app keeps its own list, separate from the Home Screen icon and Safari. Nothing is moved or deleted until you load a file.

1. In the To-Do you use now (the Home Screen icon), open **Settings**, tap **Save everything**, then **Save to Files** (iCloud Drive is a good place).
2. Open the new **To-Do** app. On the first screen tap **Load a saved file** (or later: Settings, then Load a saved file) and pick that file.
3. Check that everything is there. Your old copy stays as it was.

### 9. Allow notifications

The first time there's a reminder to set, your iPhone asks to allow notifications for To-Do; tap **Allow**. If you said no: iPhone **Settings**, then **Notifications**, then **To-Do**. Settings › Extras › Reminders in the app says which it is.

## After a change to the app

Every change to `index.html` builds a simulator copy by itself, to check it: it opens the app on a simulated iPhone, adds a task due a minute later, closes the app, and checks that the reminder shows up on the screen. To get the change on your phone, run step 6 again. TestFlight updates the app, and your list stays.

## Where your list is kept

- In the app's own storage on the iPhone (the same kind of storage as before, now belonging to the app).
- A safety copy in Files › On My iPhone › To-Do › Safety copies, kept up to date through the day. Settings, then Load a saved file, puts one back (it adds what's missing; nothing is replaced). A copy is never written over by a different list: after Erase and start over, say, the new list's copy gets a name with the time. While the passcode lock is on, no copies are made (the ones there stay).
- **Deleting the app deletes both.** Keep a Save everything file in iCloud Drive now and then (the app reminds you in Settings).
- Your iPhone's iCloud or computer backup includes the app and its files.

## Things to check on the first install

These can only be confirmed on a real iPhone, so look once:

- Add a task with a time 3 minutes from now, close the app (swipe it away), and wait: the notification comes, with a sound.
- Tap that notification: the app opens on that task.
- Settings › Save everything › Save to Files: the file appears in Files.
- Files › On My iPhone › To-Do › Safety copies has today's copy (it appears a few seconds after the app opens).
- A task photo: tap the camera button. Take Photo and Photo Library both work.

## If the build fails

Open the failed run on GitHub (Actions, then the run, then the red step) and look at the last lines.

The run shows what went wrong as red notes at the top of its page.

- **Missing secrets**: step 5. The names must match exactly.
- **Cloud signing permission error**, **No signing certificate "iOS Distribution" found** or **No Account for Team**: the key needs **Admin** access (step 3, make a new one if needed), and the Team ID must be the one from step 4.
- **No suitable application records were found** or an error about the bundle identifier: do steps 1 and 2 first, with exactly `com.jreynoso867.todo`.
- **An agreement** must be accepted: App Store Connect, then Business (or the banner at the top).
- **Invalid Signature** (rare, reported with cloud signing): there's a second way, with a certificate file you make once on any computer. Ask whoever edits the app to switch the workflow to it.
- Apple's servers sometimes fail for a moment; running it again often fixes a failed upload (a re-run gets a new build number too).

## For whoever edits the app

- `index.html`, `sw.js`, `icons/`, `archivo.woff2` and `reminder.wav` are the app. `npm run build` copies them into `www/` and checks the page's script fingerprints. `npm run sync` also copies them into the Xcode project (`ios/`).
- `ios/` was made by `npx cap add ios` (Capacitor 8, Swift Package Manager) and is kept in git with these changes: the icon, an empty launch picture over the system color, iPhone only, portrait, version 2.0.0, camera and Files keys, export compliance (`ITSAppUsesNonExemptEncryption` false), and a privacy manifest (`PrivacyInfo.xcprivacy`, file timestamps, reason C617.1). Don't run `cap add` again: it would replace those changes. `cap sync` keeps them.
- The page talks to the iPhone through `window.Capacitor.Plugins` (put there by the app before the page loads; no script files, so the security policy stays as strict as it is). Look for "the iPhone app" in `index.html`.
- `node --test tests/native.test.cjs` runs the app with a stand-in for the iPhone side.
- The workflow is `.github/workflows/ios.yml`. The build is archived unsigned (`CODE_SIGN_IDENTITY=-`, as Xcode Cloud does) and signed by Apple's cloud certificate on upload (`-exportArchive` with the API key), so no certificate or profile is kept anywhere. Build numbers are `100 + run number` `.` `attempt`.
- The simulator check builds with `ios.appendUserAgent = TodoCIProof`, which makes the page add one task due a minute later on its second start (see "the build check" in `index.html`). Builds for TestFlight don't have it, so they never do that.
