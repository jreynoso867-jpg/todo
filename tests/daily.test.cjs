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

// The agenda's groups as shown: [group, count, [[id or 'date:'+id, when, late]], more].
const agenda = page => page.$$eval('#homeDueRows .ag-group', gs => gs.map(g => [g.dataset.ag, g.querySelector('.ag-n').textContent,
  [...g.querySelectorAll('.home-row, .date-row')].map(r => (r.classList.contains('date-row') ? ['date:' + r.dataset.homeDate, r.querySelector('.dr-count').textContent, false]
    : [r.querySelector('[data-home-done]').dataset.homeDone, r.querySelector('.hr-when') ? r.querySelector('.hr-when').textContent : '', !!r.querySelector('.hr-when.late')])),
  g.querySelector('.ag-more') ? g.querySelector('.ag-more').textContent : '']));
const wd = day => parseYmdLocal(day).toLocaleDateString('en-US', { weekday: 'short' });
const md = day => parseYmdLocal(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

test('Home’s agenda: late, today, the next 7 days and waiting on, with the important dates, and nothing out of sight', async () => {
  const now = Date.now();
  const date = (title, kind, on, yearly) => ({ title, kind, date: on, yearly, note: '', createdAt: now - 9e5, updatedAt: now - 9e5 });
  const docs = {
    'tasks/o_old': task('Return the samples', { due: addDays(T, -3) }),
    'tasks/o_vip': task('Sign the quote', { due: addDays(T, -1), priority: 3 }),
    ...Object.fromEntries([1, 2, 3, 4].map(i => [`tasks/o_${i}`, task(`Late thing ${i}`, { due: addDays(T, -2), createdAt: now - 8e5 + i })])),
    'tasks/o_wait': task('Quote from ABC', { due: addDays(T, -1), priority: 2, waiting: { on: 'ABC Supply', since: addDays(T, -6) } }),
    'tasks/td_9': task('Open the shop', { time: '09:00' }),
    'tasks/td_15': task('Meet the vendor', { time: '15:00' }),
    'tasks/td_any': task('Call the bank', { priority: 3 }),
    'tasks/n_1': task('Order paper', { due: addDays(T, 1), time: '10:00' }),
    'tasks/n_3': task('Count the stock', { due: addDays(T, 3) }),
    'tasks/n_far': task('Renew the lease', { due: addDays(T, 8) }),
    'tasks/w_1': task('Waiting on the gloves', { due: addDays(T, 2), waiting: { on: 'Home Depot', since: addDays(T, -2) } }),
    'tasks/a_1': task('Someday: tidy the van', { due: null }),
    'tasks/a_2': task('Someday: new sign', { due: null }),
    'tasks/x_done': task('Already done', { done: true, doneAt: now - 1e5 }),
    'tasks/x_sample': task('Sample: swipe me', { sample: true }),
    'dates/d_bday': date('Sam’s birthday', 'birthday', '1990-' + T.slice(5), true),
    'dates/d_dent': date('Dentist', 'appointment', addDays(T, 2), false),
    'dates/d_far': date('Car inspection', 'other', addDays(T, 10), false),
  };
  if (T.slice(5) === '02-29') docs['dates/d_bday'].date = '1992-02-29';
  const { ctx, page, errors } = await phone(docs, { tab: 'home' });
  const before = await dump(page);
  assert.equal(await page.textContent('#homeDueTitle'), 'Agenda');
  assert.equal(await page.textContent('#homeDueN'), '15 open', 'open tasks, not done, waiting or samples');
  const a = await agenda(page);
  assert.deepEqual(a.map(g => g[0]), ['overdue', 'today', 'next', 'waiting']);
  const [over, today, next, wait] = a;
  assert.deepEqual([over[1], over[2].map(r => r[0]), over[3]], ['7', ['o_vip', 'o_wait', 'o_old', 'o_1', 'o_2'], '2 more overdue'], 'the most important late one first, then the oldest');
  assert.deepEqual(over[2][0].slice(1), [md(addDays(T, -1)), true], 'its day, in red');
  assert.deepEqual(today[2], [['date:d_bday', 'Today', false], ['td_9', '9:00 AM', today[2][1][2]], ['td_15', '3:00 PM', today[2][2][2]], ['td_any', '', false]],
    'today: the date first, then by time, then the rest');
  assert.deepEqual(next[2].map(r => r.slice(0, 2)), [['n_1', 'Tomorrow 10 AM'], ['date:d_dent', 'In 2 days'], ['n_3', wd(addDays(T, 3))]], 'the next 7 days by day; a week off isn’t here yet');
  assert.deepEqual(wait[2].map(r => r.slice(0, 2)), [['w_1', `Follow up ${wd(addDays(T, 2))}`]]);
  assert.match(await page.textContent('#homeDueRows [data-home-open="w_1"] .hr-sub'), /^Waiting on Home Depot · 2 days$/);
  assert.match(await page.textContent('#homeDueRows [data-home-open="o_wait"] .hr-sub'), /^Follow up with ABC Supply · 6 days$/);
  assert.equal(await page.textContent('#homeDueMore'), '2 more tasks with no date');
  // Opening Home wrote nothing.
  const opened = await dump(page);
  assert.deepEqual(opened.docs, before.docs);

  // One late task to today, with one tap (Undo puts it back); then all of them.
  await page.click('[data-home-today="o_old"]');
  await page.waitForTimeout(500);
  assert.equal((await dump(page)).docs['tasks/o_old'].due, T);
  assert.equal(await page.textContent('#toastMsg'), 'Moved to today');
  assert.ok((await agenda(page))[1][2].some(r => r[0] === 'o_old'), 'it’s in Today now');
  await page.click('#toastUndo');
  await page.waitForTimeout(500);
  assert.equal((await dump(page)).docs['tasks/o_old'].due, addDays(T, -3));
  assert.equal(await page.textContent('[data-ag-act="overdue"]'), 'Move all 7 to today');
  await page.click('[data-ag-act="overdue"]');
  await page.waitForTimeout(800);
  const d = await dump(page);
  for (const id of ['o_old', 'o_vip', 'o_1', 'o_2', 'o_3', 'o_4', 'o_wait']) assert.equal(d.docs['tasks/' + id].due, T, `moved: ${id}`);
  assert.deepEqual((await agenda(page)).map(g => g[0]), ['today', 'next', 'waiting']);
  assert.equal(await page.textContent('#toastMsg'), 'Moved 7 tasks to today');
  await page.click('#toastUndo');
  await page.waitForTimeout(800);
  // "N more" opens Tasks on just that part; the tasks with no date, on All.
  await page.click('[data-ag-more="overdue"]');
  await page.waitForSelector('#paneTasks:not([hidden])');
  assert.equal(await page.getAttribute('[data-scope="overdue"]', 'aria-pressed'), 'true');
  await page.click('#dockHome');
  await page.click('#homeDueMore');
  await page.waitForSelector('#paneTasks:not([hidden])');
  assert.equal(await page.getAttribute('[data-scope="all"]', 'aria-pressed'), 'true');
  assert.ok(await page.isVisible('.task[data-id="a_1"]'));
  // A date opens the Calendar at its dates.
  await page.click('#dockHome');
  await page.click('[data-home-date="d_dent"]');
  await page.waitForSelector('#paneCalendar:not([hidden])');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home’s agenda with nothing due: says so, and still counts the tasks with no date', async () => {
  const { ctx, page, errors } = await phone({ 'tasks/a_1': task('Someday: tidy the van', { due: null }) }, { tab: 'home' });
  assert.deepEqual(await agenda(page), []);
  assert.ok(await page.isVisible('#homeDueEmpty'));
  assert.equal(await page.textContent('#homeDueEmpty'), 'Nothing due. Enjoy the day.');
  assert.equal(await page.textContent('#homeDueMore'), '1 more task with no date');
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
