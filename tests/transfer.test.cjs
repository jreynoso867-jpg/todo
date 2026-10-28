// Moving a list between copies of the app (Claude, the website, the iPhone app) without listing a task twice.
// Usage: node --test tests/transfer.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, launch, phoneContext, seed, dump, ymd, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
const T = ymd(new Date());
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const now = Date.now();
const task = (title, f = {}) => ({ title, note: '', priority: 0, done: false, due: T, time: null, repeat: null, list: 'l_work', checklist: [], createdAt: now - 1e6, doneAt: null, ...f });
async function phone(docs) {
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seed(page, srv.url, { docs: { 'lists/l_work': { name: 'Work', color: 2, order: 1 }, 'lists/l_home': { name: 'Home', color: 5, order: 2 }, ...docs }, blobs: {},
    local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1', 'todo.tab': 'tasks', 'todo.summarySeen': T } });
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task, #heroOpen:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

test('loading a saved file doesn’t list a repeating task twice when this copy already has it open', async () => {
  const mine = {
    'tasks/sheet_here': task('Timesheet', { due: addDays(T, 1), time: '16:00', repeat: 'weekly' }),
    'tasks/check_here': task('Check partly received PO', { repeat: 'daily', time: '07:30' }),
  };
  const { ctx, page, errors } = await phone(mine);
  const before = await dump(page);
  // The other copy's file: the same two repeating tasks under its own ids (each copy made its own next one), plus
  // what's new to this copy.
  const file = { app: 'jose-todo', version: 1, exportedAt: new Date().toISOString(), collections: {
    tasks: {
      sheet_there: task('Timesheet', { due: addDays(T, 1), time: '16:00', repeat: 'weekly', createdAt: now - 5e5 }),
      check_there: task('check partly received PO!', { repeat: 'daily', time: '07:30' }), // the same words, written a little differently
      sheet_done: task('Timesheet', { due: addDays(T, -6), time: '16:00', repeat: 'weekly', done: true, doneAt: now - 5e8 }), // history comes over
      home_sheet: task('Timesheet', { due: addDays(T, 1), repeat: 'weekly', list: 'l_home' }), // another list: another task
      call: task('Call the supplier', { due: addDays(T, 2) }),
      call_again: task('Call the supplier', { due: addDays(T, 2) }), // not repeating: both come over, as before
      new_daily: task('Water the plants', { repeat: 'daily' }),
      new_daily_twice: task('Water the plants', { repeat: 'daily', createdAt: now - 4e5 }), // twice in the file itself
    },
    lists: { l_work: { name: 'Work', color: 2, order: 1 } },
  }, settings: {}, photos: {} };
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-transfer-')), 'To-do everything.json');
  fs.writeFileSync(p, JSON.stringify(file));
  await page.click('#colorsBtn');
  await page.waitForTimeout(300);
  await page.setInputFiles('#importInput', p);
  await page.waitForFunction(() => /Loaded/.test(document.querySelector('#moveStatus').textContent), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  assert.match(await page.textContent('#moveStatus'), // (then a note that this copy is Safari's, on an iPhone)
    /^Loaded 5 tasks\. Left out 3 repeating tasks already on your list: Timesheet, check partly received PO!, Water the plants\./);
  const d = await dump(page);
  for (const id of ['sheet_there', 'check_there', 'new_daily_twice']) assert.equal(d.docs['tasks/' + id], undefined, `left out: ${id}`);
  for (const id of ['sheet_done', 'home_sheet', 'call', 'call_again', 'new_daily']) assert.deepEqual(d.docs['tasks/' + id], file.collections.tasks[id], `came over: ${id}`);
  for (const [k, v] of Object.entries(before.docs)) assert.deepEqual(d.docs[k], v, `unchanged: ${k}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a repeating task listed twice: Tasks says so, and keeping one moves the other to Recently deleted (Undo puts it back); Keep both stops asking', async () => {
  const { ctx, page, errors } = await phone({
    'tasks/sheet_a': task('Timesheet', { due: T, time: '16:00', repeat: 'weekly', createdAt: now - 9e8 }),
    'tasks/sheet_b': task('Timesheet', { due: T, time: '16:00', repeat: 'weekly', createdAt: now - 3e8, note: 'From the phone' }),
    'tasks/check_a': task('Check PO', { repeat: 'daily' }),
    'tasks/check_b': task('Check PO', { repeat: 'daily', createdAt: now - 2e8 }),
    'tasks/done_sheet': task('Timesheet', { due: addDays(T, -7), repeat: 'weekly', done: true, doneAt: now - 6e8 }),
    'tasks/once_a': task('Buy stamps'),
    'tasks/once_b': task('Buy stamps'), // not repeating: not something to ask about
  });
  const before = await dump(page);
  assert.ok(await page.isVisible('#dupeTip'));
  assert.equal(await page.textContent('#dupeText'), '2 repeating tasks are listed more than once.');
  await page.click('#dupeReview');
  await page.waitForSelector('#dupeSheet.open');
  const groups = () => page.$$eval('#dupeBody .dupe-group', gs => gs.map(g => [g.querySelector('h3').textContent, [...g.querySelectorAll('[data-dupe-keep]')].map(b => b.dataset.dupeKeep)]));
  assert.deepEqual(await groups(), [['Check PO', ['check_b', 'check_a']], ['Timesheet', ['sheet_a', 'sheet_b']]], 'by name, each copy oldest first');
  // Each copy says what tells it apart: its day, when it was added, its notes.
  const info = await page.$eval('[data-dupe-keep="sheet_b"]', b => b.closest('.dupe-row').querySelector('.dupe-info').textContent);
  assert.match(info, /^(Was due|Due) today at 4:00 PM, repeats weekly.*Added .* · From the phone$/);
  assert.equal(await page.textContent('[data-dupe-keep="sheet_b"]'), 'Keep this one');
  // Keep the second timesheet: the first goes to Recently deleted, exactly as it was.
  await page.click('[data-dupe-keep="sheet_b"]');
  await page.waitForTimeout(700);
  let d = await dump(page);
  assert.equal(d.docs['tasks/sheet_a'], undefined);
  assert.deepEqual(d.docs['trash/sheet_a'].task, before.docs['tasks/sheet_a']);
  assert.deepEqual(d.docs['tasks/sheet_b'], before.docs['tasks/sheet_b']);
  assert.equal(await page.textContent('#toastMsg'), 'Kept one “Timesheet”. The other is in Recently deleted.');
  assert.deepEqual(await groups(), [['Check PO', ['check_b', 'check_a']]]);
  await page.click('#toastUndo');
  await page.waitForTimeout(700);
  d = await dump(page);
  assert.deepEqual(d.docs['tasks/sheet_a'], before.docs['tasks/sheet_a'], 'Undo puts it back');
  // Keep both: not asked again about these two (on this device), and nothing changes.
  await page.click('#dupeBody [data-dupe-both="check_a+check_b"]');
  await page.waitForTimeout(400);
  assert.deepEqual((await groups()).map(g => g[0]), ['Timesheet']);
  await page.click('[data-dupe-keep="sheet_a"]');
  await page.waitForTimeout(700);
  assert.ok(await page.isHidden('#dupeSheet'), 'nothing left to settle: it closes');
  assert.ok(await page.isHidden('#dupeTip'));
  await page.reload();
  await page.waitForSelector('#board .task, #heroOpen:not([disabled])');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#dupeTip'), 'Keep both is remembered');
  d = await dump(page);
  for (const id of ['check_a', 'check_b', 'done_sheet', 'once_a', 'once_b', 'sheet_a']) assert.deepEqual(d.docs['tasks/' + id], before.docs['tasks/' + id], `unchanged: ${id}`);
  assert.equal(d.docs['tasks/sheet_b'], undefined);
  assert.ok(d.docs['trash/sheet_b']);
  assert.deepEqual(errors, []);
  await ctx.close();
});
