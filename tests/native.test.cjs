// The iPhone app (the same page inside the native shell), with a stand-in for the shell (fake-capacitor.cjs):
// reminders become notifications at the right moments and are taken back when they no longer apply, a tapped
// notification opens its task, files go through the share menu, a safety copy is kept in Files, and the website
// without the shell is unchanged. Usage: node --test tests/native.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays, ymd } = require('./lib.cjs');
const { fakeCapacitor } = require('./fake-capacitor.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A moment `min` minutes from now, on a whole 5 minutes: { due, time, at }.
function soon(min) {
  const d = new Date(Date.now() + min * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return { due: ymd(d), time: hhmm(d), at: d.getTime() };
}
const task = (title, o = {}) => ({ title, note: '', priority: 0, done: false, due: null, time: null, repeat: null, list: null, checklist: [], createdAt: Date.now() - 1e6, doneAt: null, ...o });
function fixture(docs, local = {}) {
  return { today: ymd(new Date()), blobs: {}, docs: { 'lists/l_home': { name: 'Home', color: 2, order: 1 }, ...docs },
    local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1', 'todo.tab': 'tasks', ...local } }; // opens on Tasks, where the rows are
}

// The app inside the stand-in shell, with `fx` on the phone. Collects script errors.
async function app(fx, cap = {}, o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (fx) await seed(page, srv.url, fx);
  await page.addInitScript(fakeCapacitor, cap);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector(fx && Object.keys(fx.docs).some(k => k.startsWith('tasks/')) ? '#board .task, #heroOpen:not([disabled])' : '#quickForm:not([hidden]), #welcome:not([hidden])', { timeout: 20000 });
  return { ctx, page, errors };
}
// Checks a task off from its row, or from Up next when it's the one shown there.
async function checkOff(page, id) {
  const ring = await page.$(`#board .task[data-id="${id}"] .ring`);
  if (ring) await ring.click(); else await page.click('#heroDone');
}
const pending = page => page.evaluate(() => [...window.__cap.pending.values()].sort((a, b) => a.at - b.at));
const calls = (page, plugin, method) => page.evaluate(([p, m]) => window.__cap.calls.filter(c => c.plugin === p && (!m || c.method === m)).map(c => c.args), [plugin, method]);
const waitPending = (page, fn) => page.waitForFunction(fn, null, { timeout: 8000 });

test('tasks with a time become notifications at the right moments, with the app closed too', async () => {
  const a = soon(180), b = soon(60 * 24 * 3);
  const tomorrow = addDays(ymd(new Date()), 1);
  const fx = fixture({
    'tasks/t_call': task('Call the plumber', { due: a.due, time: a.time, list: 'l_home' }),
    'tasks/t_later': task('Dentist', { due: b.due, time: b.time }),
    'tasks/t_bill': task('Pay electric bill', { due: tomorrow }),
    'tasks/t_rent': task('Pay rent', { due: tomorrow }),
    'tasks/t_done': task('Already done', { due: a.due, time: a.time, done: true, doneAt: Date.now() }),
    'tasks/t_sample': task('Sample: swipe me', { due: a.due, time: a.time, sample: true }),
    'tasks/t_none': task('Someday'),
  }, { 'todo.prefs': JSON.stringify({ reminders: 'standard' }) });
  const { ctx, page, errors } = await app(fx, { notify: 'prompt' });
  await waitPending(page, () => window.__cap.pending.size >= 4);
  await page.waitForTimeout(400);
  assert.equal((await calls(page, 'LocalNotifications', 'requestPermissions')).length, 1, 'iOS asks once, when there is something to remind');
  const p = await pending(page);
  const call = p.filter(n => n.extra.taskId === 't_call');
  assert.deepEqual(call.map(n => n.at), [a.at - 15 * 60000, a.at], 'Standard: 15 minutes before, and when due');
  assert.equal(call[0].title, 'Call the plumber');
  assert.match(call[0].body, /^Due in 15 min · \d{1,2}:\d\d [AP]M · Home$/);
  assert.match(call[1].body, /^Due now · /);
  assert.equal(p.filter(n => n.extra.taskId === 't_later').length, 2);
  assert.ok(!p.some(n => ['t_done', 't_sample', 't_none'].includes(n.extra.taskId)), 'nothing for done, sample or undated tasks');
  // Tasks with only a date: one note for the day, naming them; Standard adds 6 PM the evening before.
  const nine = new Date(); nine.setDate(nine.getDate() + 1); nine.setHours(9, 0, 0, 0);
  const day = p.filter(n => n.threadIdentifier === 'todo-day');
  const morning = day.find(n => n.at === nine.getTime());
  assert.ok(morning, 'a note at 9 AM on the due day');
  assert.equal(morning.title, '2 tasks due today');
  assert.match(morning.body, /Pay electric bill|Pay rent/);
  const six = new Date(); six.setHours(18, 0, 0, 0);
  if (six.getTime() > Date.now() + 10000) assert.ok(day.some(n => n.at === six.getTime() && n.title === '2 tasks due tomorrow'), 'and 6 PM the day before');
  // Each one goes with a real Date (a string would make iOS show it right away) and a whole-number id.
  const sent = (await calls(page, 'LocalNotifications', 'schedule')).flatMap(o => o.notifications);
  assert.ok(sent.length && sent.every(n => Number.isInteger(n.id) && n.id > 0));
  assert.ok(sent.every(n => n.sound === 'reminder.wav'), 'each one with the app’s chime (with no sound named, iOS stays silent)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('checking a task off, or turning reminders off, takes its notifications back', async () => {
  const a = soon(120), b = soon(240);
  const fx = fixture({
    'tasks/t_one': task('First thing', { due: a.due, time: a.time }),
    'tasks/t_two': task('Second thing', { due: b.due, time: b.time }),
  }, { 'todo.prefs': JSON.stringify({ reminders: 'intense' }) });
  const { ctx, page, errors } = await app(fx, { notify: 'granted' });
  await waitPending(page, () => window.__cap.pending.size === 6);
  assert.equal((await calls(page, 'LocalNotifications', 'requestPermissions')).length, 0, 'already allowed: no prompt');
  assert.deepEqual((await pending(page)).filter(n => n.extra.taskId === 't_one').map(n => (a.at - n.at) / 60000), [60, 15, 0], 'Intense: 1 hour, 15 minutes, due');
  await checkOff(page, 't_one');
  await waitPending(page, () => window.__cap.pending.size === 3);
  assert.ok((await pending(page)).every(n => n.extra.taskId === 't_two'));
  // Settings › Reminders › Off
  await page.click('#colorsBtn');
  await page.click('#colorsSheet [data-rem="off"]');
  await waitPending(page, () => window.__cap.pending.size === 0);
  assert.equal(await page.textContent('#remNote'), 'No reminders.');
  await page.click('#colorsSheet [data-rem="gentle"]');
  await waitPending(page, () => window.__cap.pending.size === 1);
  assert.match(await page.textContent('#remNote'), /even with the app closed/);
  assert.ok(await page.isHidden('#remClosed'), 'no "use the phone calendar" note: the app reminds by itself');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('leaving the app right after adding a task hands its reminder to iOS at once', async () => {
  const a = soon(180);
  const { ctx, page, errors } = await app(fixture({ 'tasks/t_one': task('First thing', { due: a.due, time: a.time }) }), { notify: 'granted' });
  await waitPending(page, () => window.__cap.pending.size === 1);
  await page.fill('#quickInput', 'Dentist tomorrow 3pm');
  await page.press('#quickInput', 'Enter');
  // Straight to the home screen: iOS hides the page and pauses it moments later
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300); // well before the usual 1.2-second wait
  assert.ok((await pending(page)).some(n => n.title === 'Dentist'), 'the new reminder is already with iOS');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('never more than 60 waiting (iOS keeps 64), the nearest first', async () => {
  const docs = {};
  for (let i = 0; i < 90; i++) { const s = soon(30 + i * 45); docs[`tasks/t${pad(i)}`] = task(`Task ${i}`, { due: s.due, time: s.time }); }
  const { ctx, page, errors } = await app(fixture(docs, { 'todo.prefs': JSON.stringify({ reminders: 'standard' }) }), { notify: 'granted' });
  await waitPending(page, () => window.__cap.pending.size >= 60);
  await page.waitForTimeout(500);
  const p = await pending(page);
  assert.equal(p.length, 60);
  assert.equal(p[0].extra.taskId, 't00');
  const kept = new Set(p.map(n => n.extra.taskId));
  assert.ok(kept.has('t29') && !kept.has('t31'), 'the 30 nearest tasks, two notes each');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('with notifications turned off in iPhone Settings, Settings says how to turn them on', async () => {
  const a = soon(120);
  const { ctx, page, errors } = await app(fixture({ 'tasks/t_one': task('First thing', { due: a.due, time: a.time }) }), { notify: 'denied' });
  await page.waitForTimeout(2000);
  assert.equal((await calls(page, 'LocalNotifications', 'schedule')).length, 0);
  await page.click('#colorsBtn');
  await page.waitForFunction(() => /Notifications are off for To-Do/.test(document.querySelector('#remNote').textContent));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a tapped notification opens its task, even the one that opened the app', async () => {
  const a = soon(120);
  const fx = fixture({ 'tasks/t_call': task('Call the plumber', { due: a.due, time: a.time }), 'tasks/t_other': task('Other', { due: a.due }) });
  const { ctx, page, errors } = await app(fx, { notify: 'granted', tap: { taskId: 't_call' } });
  await page.waitForSelector('#taskSheet[open], #taskSheet.open, #taskSheet:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#taskTitle') && document.querySelector('#taskTitle').value === 'Call the plumber', null, { timeout: 8000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a focus session’s end is a notification that stays quiet while the app is open', async () => {
  const a = soon(120);
  const { ctx, page, errors } = await app(fixture({ 'tasks/t_call': task('Call the plumber', { due: a.due, time: a.time }) }, { 'todo.prefs': JSON.stringify({ reminders: 'off' }) }), { notify: 'granted' });
  await page.evaluate(() => localStorage.setItem('todo.focus', JSON.stringify({ taskId: 't_call', title: 'Call the plumber', min: 25, endAt: Date.now() + 25 * 60000, left: 0, paused: false })));
  await page.reload();
  await page.waitForSelector('#board .task, #heroOpen:not([disabled])');
  await waitPending(page, () => [...window.__cap.pending.values()].some(n => n.title === 'Focus done'));
  const f = (await pending(page)).find(n => n.title === 'Focus done');
  assert.equal(f.foreground, false);
  assert.match(f.body, /^25 min on Call the plumber$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('save everything goes through the share menu (Save to Files), and cancelling it is fine', async () => {
  const { ctx, page, errors } = await app(smallFixture(), { notify: 'granted' });
  await page.click('#colorsBtn');
  await page.click('#exportAll');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#moveStatus').textContent), null, { timeout: 15000 });
  const [w] = await calls(page, 'Filesystem', 'writeFile');
  assert.equal(w.directory, 'CACHE');
  assert.equal(w.encoding, 'utf8');
  assert.match(w.path, /^To-do everything \d{4}-\d\d-\d\d\.json$/);
  const data = JSON.parse(w.data);
  assert.equal(data.app, 'jose-todo');
  assert.ok(data.photos.pphoto000001.startsWith('data:image/png;base64,'), 'photos included');
  const [s] = await calls(page, 'Share', 'share');
  assert.deepEqual(s.files, [`file:///var/mobile/Containers/Data/Application/APP/Library/Caches/${w.path}`]);
  await page.evaluate(() => { window.__cap.shareCancels = true; });
  await page.click('#exportAll');
  await page.waitForTimeout(1500);
  assert.doesNotMatch(await page.textContent('#moveStatus'), /couldn’t|isn’t available/, 'a closed share menu is no error');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a safety copy is kept in Files, the newest 7, and loads back into an empty app', async () => {
  const fx = smallFixture();
  const old = {};
  for (let i = 1; i <= 9; i++) old[`DOCUMENTS/Safety copies/To-do safety copy ${addDays(fx.today, -i)}.json`] = { data: '{}', encoding: 'utf8' };
  old['DOCUMENTS/Safety copies/My notes.txt'] = { data: 'mine', encoding: 'utf8' };
  const { ctx, page, errors } = await app(fx, { notify: 'granted', files: old });
  const name = `DOCUMENTS/Safety copies/To-do safety copy ${fx.today}.json`;
  await page.waitForFunction(n => window.__cap.files.has(n), name, { timeout: 20000 });
  await page.waitForTimeout(500);
  const files = await page.evaluate(() => [...window.__cap.files.keys()].filter(k => k.startsWith('DOCUMENTS/')).sort());
  const copies = files.filter(f => /To-do safety copy/.test(f));
  assert.equal(copies.length, 7, 'the newest 7 copies stay');
  assert.ok(copies.includes(name) && !copies.includes(`DOCUMENTS/Safety copies/To-do safety copy ${addDays(fx.today, -9)}.json`));
  assert.ok(files.includes('DOCUMENTS/Safety copies/My notes.txt'), 'nothing else in the folder is touched');
  const text = await page.evaluate(n => window.__cap.files.get(n).data, name);
  const data = JSON.parse(text);
  const want = Object.keys(fx.docs).filter(k => k.startsWith('tasks/') && !fx.docs[k].sample).map(k => k.slice(6)).sort();
  assert.deepEqual(Object.keys(data.collections.tasks).sort(), want, 'every task (not the samples)');
  assert.deepEqual(data.photos, {});
  await ctx.close();
  // A new phone (or storage that was wiped): Load a saved file puts the list back.
  const fresh = await app(null, { notify: 'granted' });
  await fresh.page.click('#colorsBtn');
  await fresh.page.setInputFiles('#importInput', { name: `To-do safety copy ${fx.today}.json`, mimeType: 'application/json', buffer: Buffer.from(text) });
  await fresh.page.waitForFunction(() => /Added|Loaded/.test(document.querySelector('#moveStatus').textContent), null, { timeout: 15000 });
  const d = await dump(fresh.page);
  for (const id of want) assert.equal(d.docs['tasks/' + id].title, fx.docs['tasks/' + id].title);
  assert.deepEqual(errors, []);
  assert.deepEqual(fresh.errors, []);
  await fresh.ctx.close();
});

test('the very first Files copy (no folder yet) gets the plain daily name', async () => {
  const fx = smallFixture();
  const { ctx, page, errors } = await app(fx, { notify: 'granted' });
  const name = `DOCUMENTS/Safety copies/To-do safety copy ${fx.today}.json`;
  await page.waitForFunction(n => window.__cap.files.has(n), name, { timeout: 20000 });
  assert.deepEqual(await page.evaluate(() => [...window.__cap.files.keys()].filter(k => k.startsWith('DOCUMENTS/'))), [name]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a Files copy made by anything else is never written over (after an erase, or iOS clearing storage)', async () => {
  const fx = smallFixture();
  const good = JSON.stringify({ app: 'jose-todo', marker: 'the copy from before the erase' });
  const base = `DOCUMENTS/Safety copies/To-do safety copy ${fx.today}.json`;
  const files = { [base]: { data: good, encoding: 'utf8' }, 'DOCUMENTS/Safety copies/To-do safety copy 2026-01-02 KEEP.json': { data: 'mine', encoding: 'utf8' } };
  for (let i = 1; i <= 8; i++) files[`DOCUMENTS/Safety copies/To-do safety copy ${addDays(fx.today, -i)}.json`] = { data: '{}', encoding: 'utf8' };
  // A storage that never wrote a copy (no todo.copyFile), with a list in it
  const { ctx, page, errors } = await app(fx, { notify: 'granted', files });
  const newName = () => page.evaluate(b => [...window.__cap.files.keys()].find(k => k.startsWith(b.replace('.json', ' '))), base);
  await page.waitForFunction(b => [...window.__cap.files.keys()].some(k => k.startsWith(b.replace('.json', ' '))), base, { timeout: 20000 });
  const mine = await newName();
  assert.match(mine, /To-do safety copy \d{4}-\d\d-\d\d \d{6}\.json$/, 'its own copy gets a name with the time');
  assert.equal(await page.evaluate(b => window.__cap.files.get(b).data, base), good, 'the earlier copy is untouched');
  assert.ok(await page.evaluate(() => window.__cap.files.has('DOCUMENTS/Safety copies/To-do safety copy 2026-01-02 KEEP.json')), 'a renamed copy is never pruned');
  await page.waitForFunction(() => !!localStorage.getItem('todo.copyFile')); // set once the older copies are cleared away
  const copies = await page.evaluate(() => [...window.__cap.files.keys()].filter(k => /To-do safety copy \d{4}-\d\d-\d\d( \d{6})?\.json$/.test(k)));
  assert.equal(copies.length, 7, 'the newest 7 of the app’s own copies');
  assert.equal(await page.evaluate(() => localStorage.getItem('todo.copyFile')), mine.split('/').pop());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no Files copy while the passcode lock is on', async () => {
  const crypto = require('node:crypto');
  const fx = smallFixture();
  const salt = crypto.randomBytes(16), iter = 150000;
  fx.local['todo.lock'] = JSON.stringify({ v: 1, salt: salt.toString('base64'), iter, hash: crypto.pbkdf2Sync('482913', salt, iter, 32, 'sha256').toString('base64') });
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  await seed(page, srv.url, fx);
  await page.addInitScript(fakeCapacitor, { notify: 'granted' });
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('.pl');
  await page.keyboard.type('482913');
  await page.waitForSelector('#board .task, #heroOpen:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(10000); // a copy would be made 8 seconds after opening
  assert.equal(await page.evaluate(() => [...window.__cap.files.keys()].filter(k => k.startsWith('DOCUMENTS/')).length), 0);
  await page.click('#colorsBtn');
  assert.match(await page.textContent('#lockNote'), /no safety copies in Files/);
  await ctx.close();
});

test('a reminder about to fire is left alone, and a tap survives the lock’s reload', async () => {
  const a = soon(120);
  const { ctx, page, errors } = await app(fixture({ 'tasks/t_call': task('Call the plumber', { due: a.due, time: a.time }) }), { notify: 'granted' });
  await waitPending(page, () => window.__cap.pending.size >= 1);
  // One that's due in 3 seconds is already waiting in iOS; a new hand-over must not take it back.
  const kept = await page.evaluate(async () => {
    const soonAt = Date.now() + 3000;
    window.__cap.pending.set(4242, { id: 4242, title: 'x', body: 'y', at: soonAt, extra: {} });
    await window.claude.native.notify.set([{ id: 4242, title: 'x', body: 'y', at: soonAt }]);
    return window.__cap.pending.has(4242);
  });
  assert.equal(kept, true);
  // A tap noted before a reload (the lock reloads after a minute away) still opens the task afterwards.
  await page.evaluate(() => sessionStorage.setItem('todo.tap', JSON.stringify({ taskId: 't_call' })));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#taskTitle') && document.querySelector('#taskTitle').value === 'Call the plumber', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('todo.tap')), null, 'used once');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('taps you can feel, the status bar follows the theme, and the welcome says how to move the list', async () => {
  const { ctx, page, errors } = await app(null, { notify: 'prompt' }, { colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => window.claude.where), 'ios-app');
  assert.match(await page.textContent('#welcomeText'), /Save to Files/);
  const bars = await calls(page, 'SystemBars', 'setStyle');
  assert.equal(bars[bars.length - 1].style, 'DARK', 'light text on the dark theme');
  await page.waitForTimeout(1500);
  assert.equal((await calls(page, 'LocalNotifications', 'requestPermissions')).length, 0, 'no prompt with nothing to remind');
  await page.click('#welcomeSkip');
  await page.fill('#quickInput', 'Buy gloves');
  await page.press('#quickInput', 'Enter');
  await page.waitForSelector('#board .task, #heroOpen:not([disabled])');
  await page.click('#heroDone');
  await page.waitForTimeout(500);
  assert.ok((await calls(page, 'Haptics')).length > 0, 'the Taptic Engine, not navigator.vibrate');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('photos show from the phone’s storage, with no service worker in the app', async () => {
  const { ctx, page, errors } = await app(smallFixture(), { notify: 'granted' });
  const asked = [];
  page.on('request', r => { if (r.url().includes('/_blob/')) asked.push(r.url()); });
  await page.evaluate(() => (document.querySelector('.task[data-id="t_today_timed"] .task-body') || document.querySelector('#heroOpen')).click());
  const ok = await page.evaluate(async () => {
    const im = document.querySelector('#sheetPhotos img');
    if (!im) return 'no img';
    for (let i = 0; i < 40 && !(im.complete && im.naturalWidth); i++) await new Promise(r => setTimeout(r, 100));
    return im.naturalWidth === 4 && im.src.startsWith('blob:') ? true : `not loaded: ${im.src}`;
  });
  assert.equal(ok, true, 'the photo shows, from storage');
  assert.ok(asked.every(u => /\/_blob\/[^/]+\.img$/.test(u)), 'asked as a name that is no file, so it fails at once instead of loading the page');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the build check’s proof task appears only with its marker, on the second start of an empty app', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TodoCIProof' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeCapacitor, { notify: 'granted' });
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#welcome:not([hidden])');
  await page.waitForTimeout(1500);
  assert.equal((await dump(page)).local['todo.ciProof'], '1');
  assert.equal(Object.keys((await dump(page)).docs).filter(k => k.startsWith('tasks/')).length, 0, 'the first start leaves the list empty');
  await page.reload();
  await waitPending(page, () => window.__cap.pending.size === 1);
  const [n] = await pending(page);
  assert.equal(n.title, 'Proof: call the plumber');
  assert.ok(n.at > Date.now() + 30000 && n.at < Date.now() + 130000, 'due in a minute or two');
  assert.deepEqual(errors, []);
  await ctx.close();
  // Without the marker (every real build), an empty app stays empty.
  const plain = await app(null, { notify: 'granted' });
  await plain.page.reload();
  await plain.page.waitForTimeout(1500);
  assert.equal(Object.keys((await dump(plain.page)).docs).filter(k => k.startsWith('tasks/')).length, 0);
  await plain.ctx.close();
});

test('the website, without the iPhone shell, keeps its offline copy and its own reminders', async () => {
  const ctx = await phoneContext(browser, { sw: true });
  const page = await ctx.newPage();
  await page.goto(srv.url + '/index.html');
  await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then(r => r.length > 0), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.claude.native.on), false);
  assert.notEqual(await page.evaluate(() => window.claude.where), 'ios-app');
  await ctx.close();
  // And inside the shell, no service worker (the app has its files already).
  const ctx2 = await phoneContext(browser, { sw: true });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(fakeCapacitor, {});
  await page2.goto(srv.url + '/index.html');
  await page2.waitForSelector('#quickForm:not([hidden]), #welcome:not([hidden])');
  await page2.waitForTimeout(1500);
  assert.equal(await page2.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length)), 0);
  await ctx2.close();
});
