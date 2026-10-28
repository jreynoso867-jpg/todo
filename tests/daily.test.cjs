// The daily workflow on Home and Tasks: rescheduling, the agenda, adding fast, telling urgent from important.
// Usage: node --test tests/daily.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, launch, phoneContext, seed, dump, ymd, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
const T = ymd(new Date());
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with these tasks on it, opened on the tab given (Tasks unless said otherwise).
async function phone(docs, o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const now = Date.now();
  const fx = {
    docs: { 'lists/l_work': { name: 'Work', color: 2, order: 1 }, 'lists/l_home': { name: 'Home', color: 5, order: 2 }, ...docs },
    blobs: {},
    local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1', 'todo.summarySeen': T, 'todo.tab': o.tab || 'tasks', ...(o.local || {}) },
  };
  for (const v of Object.values(fx.docs)) if (v && v.title !== undefined && !v.createdAt) v.createdAt = now - 1e6;
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector(o.tab === 'home' ? '#paneHome:not([hidden])' : '#board .task, #heroOpen:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const task = (title, f = {}) => ({ title, note: '', priority: 0, done: false, due: T, time: null, repeat: null, list: 'l_work', checklist: [], doneAt: null, ...f });
const tasksOf = d => Object.entries(d.docs).filter(([k]) => k.startsWith('tasks/')).map(([k, v]) => ({ id: k.slice(6), ...v }));
const openCopies = (d, title) => tasksOf(d).filter(t => t.title === title && !t.done);
const tap = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);

test('a repeating task moved to today keeps its schedule: done, the next one is on its usual day', async () => {
  // A weekly timesheet, due six days ago (its day of the week is tomorrow's), and a daily check, due two days ago.
  const { ctx, page, errors } = await phone({
    'tasks/t_sheet': task('Timesheet', { due: addDays(T, -6), time: '16:00', repeat: 'weekly' }),
    'tasks/t_check': task('Check the PO', { due: addDays(T, -2), repeat: 'daily' }),
    'tasks/t_call': task('Call the vendor', { due: addDays(T, -1) }),
  });
  await tap(page, '#moveOverdue'); // Move all 3 to today
  await page.waitForTimeout(600);
  let d = await dump(page);
  assert.equal(d.docs['tasks/t_sheet'].due, T);
  assert.deepEqual(d.docs['tasks/t_sheet'].postponed, { from: addDays(T, -6), to: T }, 'it remembers its own day');
  assert.equal(d.docs['tasks/t_call'].postponed, undefined, 'a task that doesn’t repeat has nothing to remember');
  for (const id of ['t_sheet', 't_check']) { await tap(page, `.task[data-id="${id}"] .ring, #hero[data-id="${id}"] #heroDone`); await page.waitForTimeout(400); }
  await page.waitForTimeout(1200);
  d = await dump(page);
  const [sheet] = openCopies(d, 'Timesheet');
  assert.equal(sheet.due, addDays(T, 1), 'the next timesheet is on its usual weekday (tomorrow), not a week from today');
  assert.equal(sheet.postponed, undefined, 'the next one starts clean');
  assert.equal(openCopies(d, 'Check the PO')[0].due, addDays(T, 1), 'a daily task: tomorrow, as before');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('postponed from the Up next card or several at once (Select): the schedule holds; Undo puts it back as it was', async () => {
  const { ctx, page, errors } = await phone({
    'tasks/t_weekly': task('Weekly report', { due: T, repeat: 'weekly', priority: 3 }), // Up next
    'tasks/t_month': task('Pay the card', { due: T, repeat: 'monthly' }),
  });
  assert.equal(await page.getAttribute('#hero', 'data-id'), 't_weekly');
  await tap(page, '#heroLater'); // Move to tomorrow
  await page.waitForTimeout(500);
  let d = await dump(page);
  assert.deepEqual(d.docs['tasks/t_weekly'].postponed, { from: T, to: addDays(T, 1) });
  // Moved again, to the day after (Select, then Date): it still remembers the day it was first due.
  await page.click('#selectBtn');
  await page.click('.task[data-id="t_weekly"] .ring');
  await page.fill('#selDate', addDays(T, 2));
  await page.dispatchEvent('#selDate', 'change');
  await page.waitForTimeout(500);
  d = await dump(page);
  assert.equal(d.docs['tasks/t_weekly'].due, addDays(T, 2));
  assert.deepEqual(d.docs['tasks/t_weekly'].postponed, { from: T, to: addDays(T, 2) });
  // Undo: back to tomorrow, remembering the same.
  await page.click('#toastUndo');
  await page.waitForTimeout(500);
  d = await dump(page);
  assert.equal(d.docs['tasks/t_weekly'].due, addDays(T, 1));
  assert.deepEqual(d.docs['tasks/t_weekly'].postponed, { from: T, to: addDays(T, 1) });
  // The monthly one, several-at-once style (Select, Tomorrow), then both done.
  await page.click('#selectBtn');
  await page.click('.task[data-id="t_month"] .ring');
  await page.click('[data-sel="tomorrow"]');
  await page.waitForTimeout(500);
  for (const id of ['t_month', 't_weekly']) { await tap(page, `.task[data-id="${id}"] .ring, #hero[data-id="${id}"] #heroDone`); await page.waitForTimeout(400); }
  await page.waitForTimeout(1500);
  d = await dump(page);
  const m = parseYmdLocal(T);
  const nextMonth = ymd(new Date(m.getFullYear(), m.getMonth() + 1, Math.min(m.getDate(), new Date(m.getFullYear(), m.getMonth() + 2, 0).getDate())));
  assert.equal(openCopies(d, 'Pay the card')[0].due, nextMonth, 'monthly: the same day next month');
  assert.equal(openCopies(d, 'Weekly report')[0].due, addDays(T, 7), 'weekly: a week from the day it was due');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a date changed in the task itself moves the schedule there (as before), and a stale note from another copy is ignored', async () => {
  const { ctx, page, errors } = await phone({
    // Moved on this phone to today, then another copy of the app (which doesn't know the note) moved it to tomorrow.
    'tasks/t_old': task('Staff meeting', { due: addDays(T, 1), repeat: 'weekly', postponed: { from: addDays(T, -3), to: T } }),
    'tasks/t_edit': task('Inventory count', { due: T, repeat: 'weekly' }),
  });
  await tap(page, '#heroLater'); // Inventory count (Up next, due today): moved to tomorrow, so it's postponed
  await page.waitForTimeout(500);
  // Then its date is changed in the task sheet to the day after tomorrow: that's a new day for the schedule.
  await tap(page, '.task[data-id="t_edit"] .task-body, #hero[data-id="t_edit"] #heroOpen');
  await page.waitForSelector('#taskSheet.open');
  await page.fill('#taskDate', addDays(T, 2));
  await page.dispatchEvent('#taskDate', 'change');
  await page.click('#sheetSubmit');
  await page.waitForTimeout(600);
  for (const id of ['t_old', 't_edit']) { await tap(page, `.task[data-id="${id}"] .ring, #hero[data-id="${id}"] #heroDone`); await page.waitForTimeout(400); }
  await page.waitForTimeout(1200);
  const d = await dump(page);
  assert.equal(openCopies(d, 'Inventory count')[0].due, addDays(T, 9), 'edited in the sheet: weekly from the new day');
  assert.equal(openCopies(d, 'Staff meeting')[0].due, addDays(T, 8), 'a note that no longer matches its day is ignored');
  assert.deepEqual(errors, []);
  await ctx.close();
});

const sunday = parseYmdLocal(T).getDay() === 0;
test('dragged to another day in the week planner: postponed the same way', { skip: sunday && 'today is Sunday: no later day this week to drag to' }, async () => {
  const { ctx, page, errors } = await phone({ 'tasks/t_weekly': task('Weekly report', { due: T, repeat: 'weekly' }) }, { local: { 'todo.calMode': 'week' } });
  await page.click('#dockWeek');
  await page.waitForSelector('#weekView:not([hidden]) .wk-task[data-id="t_weekly"]');
  const from = await page.$('.wk-task[data-id="t_weekly"]');
  const to = await page.$(`#weekDays .wk-day[data-wk="${addDays(T, 1)}"]`);
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2 + 10, { steps: 3 });
  const b = await to.boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_weekly'].due, addDays(T, 1));
  assert.deepEqual(d.docs['tasks/t_weekly'].postponed, { from: T, to: addDays(T, 1) });
  assert.deepEqual(errors, []);
  await ctx.close();
});

function parseYmdLocal(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
