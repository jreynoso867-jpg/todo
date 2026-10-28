// Everything the app did before 2.0 still works. These tests only use what both versions have, so they can run on
// the old one too: NEW_DIR=<folder with the old app> node --test tests/regression.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays, ymd } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
const T = ymd(new Date());
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function phone(fx = smallFixture(), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const task = async (page, id) => (await dump(page)).docs['tasks/' + id];
const openTask = async (page, id) => { await page.click(`.task[data-id="${id}"] .task-body`); await page.waitForSelector('#taskSheet.open'); };
// A finger on a row: the board reads pointer events (touch for swipes, any pointer for holding).
async function swipe(page, id, dx, type = 'touch') {
  await page.evaluate(({ id, dx, type }) => {
    const inner = document.querySelector(`.task[data-id="${id}"] .task-inner`);
    const r = inner.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (name, x) => inner.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: 7, pointerType: type, isPrimary: true, clientX: x, clientY: y, button: 0 }));
    ev('pointerdown', x0);
    for (let i = 1; i <= 12; i++) ev('pointermove', x0 + (dx * i) / 12);
    ev('pointerup', x0 + dx);
  }, { id, dx, type });
  await page.waitForTimeout(500);
}

test('edit a task and save it', async () => {
  const { ctx, page, errors } = await phone();
  await openTask(page, 't_today_timed');
  await page.fill('#taskTitle', 'Clean Rosa’s Diner (deep)');
  await page.click('[data-prio="3"]');
  await page.click('#sheetSubmit');
  await page.waitForTimeout(400);
  const t = await task(page, 't_today_timed');
  assert.equal(t.title, 'Clean Rosa’s Diner (deep)');
  assert.equal(t.priority, 3);
  assert.equal(t.checklist.length, 2, 'the checklist is untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('delete a task, find it in Recently deleted, restore it', async () => {
  const { ctx, page } = await phone();
  await openTask(page, 't_tomorrow');
  await page.click('#sheetDelete');
  await page.waitForTimeout(500);
  assert.equal(await task(page, 't_tomorrow'), undefined);
  assert.ok((await dump(page)).docs['trash/t_tomorrow']);
  await page.click('#trashOpen');
  await page.click('[data-restore="t_tomorrow"]');
  await page.waitForTimeout(500);
  assert.equal((await task(page, 't_tomorrow')).title, 'Send invoice to Rosa');
  await ctx.close();
});

test('swipe right checks a task off; a long swipe left moves it to tomorrow', async () => {
  const { ctx, page } = await phone();
  await swipe(page, 't_today_timed', 140);
  assert.equal((await task(page, 't_today_timed')).done, true);
  await page.waitForTimeout(1200);
  await swipe(page, 't_sample', -330);
  assert.equal((await task(page, 't_sample')).due, addDays(T, 1));
  await ctx.close();
});

test('hold a task and drag it to a new place in its day', async () => {
  const { ctx, page } = await phone();
  const order = () => page.$$eval('[data-sec="today"] .task', els => els.map(e => e.dataset.id));
  const before = await order();
  assert.ok(before.length >= 2);
  const last = before[before.length - 1];
  // A finger held still until the row lifts, then moved up, a step per frame.
  await page.evaluate(async id => {
    const body = document.querySelector(`.task[data-id="${id}"] .task-body`);
    body.scrollIntoView({ block: 'center' }); // a finger is on the screen
    const r = body.getBoundingClientRect();
    const x = r.left + 40, y0 = r.top + r.height / 2;
    const ev = (target, name, y) => target.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    ev(body, 'pointerdown', y0);
    await new Promise(ok => setTimeout(ok, 650));
    const li = body.closest('.task');
    for (let i = 1; i <= 8; i++) { ev(li, 'pointermove', y0 - i * 20); await new Promise(ok => requestAnimationFrame(ok)); }
    ev(li, 'pointerup', y0 - 160);
  }, last);
  await page.waitForTimeout(600);
  const after = await order();
  assert.equal(after[0], last, 'the dragged task is first now');
  assert.ok(Number.isFinite((await task(page, last)).rank), 'its new place is saved');
  await ctx.close();
});

test('search finds tasks by their notes and checklists', async () => {
  const { ctx, page } = await phone();
  await page.click('#searchBtn');
  await page.fill('#searchInput', 'hood filters');
  await page.waitForTimeout(300);
  const shown = await page.$$eval('#board .task', els => els.map(e => e.dataset.id));
  assert.deepEqual(shown, ['t_today_timed']);
  await ctx.close();
});

test('the week strip shows one day', async () => {
  const { ctx, page } = await phone();
  await page.click(`#week [data-day="${addDays(T, 1)}"]`);
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#dayBar'));
  const shown = await page.$$eval('#board .sec:not([hidden]) .task:not(.is-done)', els => els.map(e => e.dataset.id).sort());
  assert.deepEqual(shown, ['t_tomorrow', 't_walk_next']);
  await ctx.close();
});

test('select several tasks and move them to tomorrow', async () => {
  const { ctx, page } = await phone();
  await page.click('#selectBtn');
  await page.click('.task[data-id="t_today_timed"] .ring');
  await page.click('.task[data-id="t_anytime"] .ring');
  await page.click('[data-sel="tomorrow"]');
  await page.waitForTimeout(400);
  assert.equal((await task(page, 't_today_timed')).due, addDays(T, 1));
  assert.equal((await task(page, 't_anytime')).due, addDays(T, 1));
  await ctx.close();
});

test('a new task starts from a template, smart add reads the title', async () => {
  const { ctx, page } = await phone();
  await page.click('#quickMore');
  await page.waitForSelector('#taskSheet.open');
  await page.fill('#taskTitle', 'Deep clean at Rosa’s friday 3pm');
  await page.click('[data-tpl="tp_deep"]');
  await page.click('#sheetSubmit');
  await page.waitForTimeout(400);
  const d = await dump(page);
  const t = Object.values(d.docs).find(v => v && v.title === 'Deep clean at Rosa’s');
  assert.ok(t, 'smart add took the words out of the title');
  assert.equal(t.time, '15:00');
  assert.equal(t.priority, 2, 'the template’s priority');
  assert.deepEqual(t.checklist.map(i => i.text), ['Hoods', 'Fryers', 'Floors']);
  await ctx.close();
});

test('quick add reads dates, times and priority', async () => {
  const { ctx, page } = await phone();
  await page.fill('#quickInput', 'Call Bob tomorrow 3pm !!');
  await page.press('#quickInput', 'Enter');
  await page.waitForTimeout(400);
  const t = Object.values((await dump(page)).docs).find(v => v && v.title === 'Call Bob');
  assert.equal(t.due, addDays(T, 1));
  assert.equal(t.time, '15:00');
  assert.equal(t.priority, 2);
  await ctx.close();
});

test('a client’s new job, and a PO marked received', async () => {
  const fx = smallFixture();
  fx.docs['tasks/t_today_timed'] = { ...fx.docs['tasks/t_today_timed'], due: addDays(T, 1) }; // no job for Rosa today yet
  const { ctx, page } = await phone(fx);
  await page.click('#clientsBtn');
  await page.click('[data-client="cl_rosa"] [data-client-job]');
  await page.waitForTimeout(400);
  let d = await dump(page);
  const job = Object.values(d.docs).find(v => v && v.client === 'cl_rosa' && v.title === 'Clean Rosa’s Diner' && v !== d.docs['tasks/t_today_timed']);
  assert.ok(job && job.checklist.length === 2 && job.list === 'l_jars');
  await page.click('#poBtn');
  await page.click('.card-row[data-id="t_overdue"] [data-po-received]');
  await page.waitForTimeout(400);
  d = await dump(page);
  assert.equal(d.docs['tasks/t_overdue'].done, true);
  assert.equal(d.docs['tasks/t_overdue'].po.status, 'received');
  await ctx.close();
});

test('a repeating task makes the next one, and Undo takes it back', async () => {
  const { ctx, page } = await phone();
  await page.click('.task[data-id="t_tomorrow"] .ring');
  await page.waitForTimeout(400);
  let t = await task(page, 't_tomorrow');
  assert.equal(t.done, true);
  const next = await task(page, t.spawnedId);
  assert.equal(next.due, addDays(T, 8));
  await page.click('#toastUndo');
  await page.waitForTimeout(400);
  t = await task(page, 't_tomorrow');
  assert.equal(t.done, false);
  assert.equal((await dump(page)).docs['tasks/' + next.id], undefined);
  await ctx.close();
});

test('clear done keeps the week chart counting them', async () => {
  const { ctx, page } = await phone();
  await page.click('#doneToggle');
  await page.click('#clearDone');
  await page.waitForTimeout(500);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_walk'], undefined);
  assert.equal(d.docs['tasks/t_done_old'], undefined);
  assert.ok(Object.values(d.docs).some(v => v && v.items && v.items.t_done_old), 'history kept');
  await ctx.close();
});

test('a photo added to a task is kept on the phone', async () => {
  const { ctx, page } = await phone();
  await openTask(page, 't_anytime');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwnwEI0BkAg+gB/x3B7PQAAAAASUVORK5CYII=', 'base64');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-photo-')), 'p.png');
  fs.writeFileSync(file, png);
  await page.setInputFiles('#photoInput', file);
  await page.waitForFunction(() => !document.querySelector('#sheetPhotos .is-loading') && document.querySelectorAll('#sheetPhotos .photo').length === 1);
  await page.click('#sheetSubmit');
  await page.waitForTimeout(500);
  const d = await dump(page);
  const ph = d.docs['tasks/t_anytime'].photos;
  assert.equal(ph.length, 1);
  assert.match(d.blobs[ph[0].id].type, /^image\//);
  await ctx.close();
});

test('back up as a spreadsheet', async () => {
  const { ctx, page } = await phone();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupBtn')]);
  const file = await dl.path();
  const csv = fs.readFileSync(file, 'utf8');
  assert.match(csv, /Clean Rosa’s Diner/);
  assert.match(csv, /Call ABC Supply about PO 4471/);
  await ctx.close();
});

test('the passcode lock turns on, asks on opening, and turns off', async () => {
  const { ctx, page } = await phone();
  const keys = async code => { for (const k of code) await page.click(`.pl-key[data-k="${k}"]`); await page.waitForTimeout(250); };
  await page.click('#colorsBtn');
  // It says plainly what it isn't: the list itself stays as it is on the phone, and a saved file can be read by anyone.
  assert.match(await page.textContent('#lockNote'), /The passcode isn’t encryption: .*kept on this phone as it is.*anyone with a Save everything file can read it/);
  await page.click('#lockOn');
  await keys('135792');
  await keys('135792');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('.pl-key');
  await keys('135792');
  await page.waitForSelector('#board .task');
  await page.click('#colorsBtn');
  await page.click('#lockOff');
  await keys('135792');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => localStorage.getItem('todo.lock')), null);
  await ctx.close();
});

test('timeline, month and week planner open', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('#tlBtn');
  await page.waitForSelector('#timeline:not([hidden]) .tl-block');
  await page.click('#tlList');
  await page.click('#monthBtn');
  // The month shows (in a sheet in older versions, on the Calendar tab now): its days can be tapped.
  await page.waitForSelector(`#monthGrid [data-day="${addDays(T, 1)}"]`, { state: 'visible' });
  await page.click(`#monthGrid [data-day="${addDays(T, 1)}"]`);
  await page.waitForTimeout(400);
  assert.ok(await page.isVisible('#dayBar'));
  // The week planner: the dock's Week button (the Calendar tab now, which opens on the month: Week is one tap there).
  await page.click('#dockWeek');
  await page.waitForTimeout(200);
  if (await page.isHidden('#weekView')) await page.click('[data-cal-mode="week"]');
  await page.waitForSelector('#weekView:not([hidden]) .wk-task');
  assert.deepEqual(errors, []);
  await ctx.close();
});
