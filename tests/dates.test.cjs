// Important dates and the rest of the Calendar tab, and Home's newer cards. On Calendar, under the month: "Dates to
// remember" (each kind's icon, its words and day, how long is left: "Today", "Tomorrow", "In 55 days", then the day),
// the date sheet (its words, kind, day, Every year, a note; Delete into Recently deleted), and "Everything this month"
// by day; dots under the days with open tasks, dates and savings goals due. On Home: "Coming up" (the next three dates),
// "Savings" (the open goals' bars) and, once, "New for you" (the Wish list). The clock is set by the test (page.clock),
// so every countdown is exact. Records are the dates/ of sections.test.cjs; nothing else is touched, and nothing is
// written by opening the app or looking around.
// Usage: node --test tests/dates.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// Friday, October 16 2026, 10 AM (the day of the screenshots), unless a test says otherwise.
const FRI = '2026-10-16';
const clockAt = (day, h = 10) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, h, 0); };
// A phone with `fx` on it and its clock at o.time, opened on o.tab (Calendar unless given).
async function phone(fx, o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: o.time || clockAt(fx.today) });
  fx.local['todo.tab'] = o.tab || 'calendar';
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#dock:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
const t0 = 1700000000000;
const date = (title, kind, day, yearly, more = {}) => ({ title, kind, date: day, yearly, note: '', createdAt: t0, updatedAt: t0, ...more });
const goal = (name, targetCents, more = {}) => ({ name, targetCents, due: null, closedAt: null, order: 1, createdAt: t0, updatedAt: t0, ...more });
const entry = (g, amountCents, day) => ({ goal: g, amountCents, day, note: '', createdAt: t0 + 5, updatedAt: t0 + 5 });
const inColl = (docs, c) => Object.entries(docs).filter(([k]) => k.startsWith(c + '/'));
const focused = page => page.evaluate(() => { const a = document.activeElement; return a.id || Object.entries(a.dataset).map(([k, v]) => `${k}=${v}`).join(' '); });
const settle = page => page.waitForTimeout(450);
// The rows of a list of dates: [id, kind, title, day, countdown, countdown highlighted].
const dateRows = (page, sel) => page.$$eval(sel + ' .date-row', els => els.map(b => {
  const t = s => { const x = b.querySelector(s); return x ? x.textContent : ''; };
  const id = b.dataset.dateOpen || b.dataset.homeDate;
  return [id, b.dataset.kind, t('.dr-title'), t('.dr-day'), t('.dr-count'), !!b.querySelector('.dr-count.is-today')];
}));
// The dots under a day of the month: which kinds.
const dots = (page, day) => page.$eval(`#monthGrid [data-day="${day}"]`, b => [...b.querySelectorAll('.month-dots i')].map(i => i.className));
// Everything this month: [day heading, [[kind, id, title, side], ...]] for each day.
const monthAll = page => page.$$eval('#monthAllBox .ma-day', els => els.map(d => [d.querySelector('.ma-head').textContent,
  [...d.querySelectorAll('.ma-row')].map(b => [b.dataset.maTask ? 'task' : b.dataset.maDate ? 'date' : 'goal', b.dataset.maTask || b.dataset.maDate || b.dataset.maGoal,
    b.querySelector('.ma-title').textContent, b.querySelector('.ma-side') ? b.querySelector('.ma-side').textContent : ''])]));
const longDay = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); };

test('Dates to remember: soonest first, each kind\'s icon, and "Today", "Tomorrow", "In N days" up to 60, then the day', async () => {
  const fx = smallFixture(FRI);
  Object.assign(fx.docs, {
    'dates/d_today': date('Pay day', 'other', FRI, false),
    'dates/d_tomorrow': date('Dentist', 'appointment', '2026-10-17', false),
    'dates/d_sam': date('Sam’s birthday', 'birthday', '1994-10-18', true, { note: 'Likes tea' }),
    'dates/d_shop': date('Shop opened', 'anniversary', '2015-12-10', true),
    'dates/d_60': date('Lease renewal', 'other', '2026-12-15', false),
    'dates/d_61': date('Holiday party', 'other', '2026-12-16', false),
    'dates/d_far': date('Conference', 'appointment', '2027-09-20', false),
    'dates/d_kim': date('Kim’s birthday', 'birthday', '1990-10-05', true), // been this month: next year
    'dates/d_old': date('Old checkup', 'appointment', '2026-10-01', false), // a one-off date gone
  });
  const { ctx, page, errors } = await phone(fx);
  assert.ok(await page.isVisible('#calDates'));
  assert.equal(await page.textContent('#calDatesTitle'), 'Dates to remember');
  assert.equal(await page.textContent('#calDatesN'), '8', 'how many are coming');
  // Under the month, like the screenshot.
  const order = await page.$$eval('#paneCalendar > *', els => els.filter(e => !e.hidden).map(e => e.id || e.className));
  assert.deepEqual(order.slice(-3), ['cal-card', 'calDates', 'monthAll']);
  assert.deepEqual(await dateRows(page, '#dateRows'), [
    ['d_today', 'other', 'Pay day', 'Oct 16', 'Today', true],
    ['d_tomorrow', 'appointment', 'Dentist', 'Oct 17', 'Tomorrow', false],
    ['d_sam', 'birthday', 'Sam’s birthday', 'Oct 18', 'In 2 days', false],
    ['d_shop', 'anniversary', 'Shop opened', 'Dec 10', 'In 55 days', false],
    ['d_60', 'other', 'Lease renewal', 'Dec 15', 'In 60 days', false],
    ['d_61', 'other', 'Holiday party', 'Dec 16', 'Dec 16', false],
  ], 'the first six, soonest first');
  // An icon for each kind: a cake, an alert, a heart, a calendar.
  assert.ok(await page.$$eval('#dateRows .date-row', els => els.every(b => b.querySelector('svg.ico[aria-hidden="true"]'))));
  const shapes = await page.$$eval('#dateRows .date-row', els => [...new Set(els.map(b => b.dataset.kind + ':' + b.querySelector('svg').innerHTML))].length);
  assert.equal(shapes, 4, 'four kinds, four icons');
  // The countdown sits at the right of its row.
  const right = await page.$$eval('#dateRows .date-row', els => els.map(b => Math.round(b.getBoundingClientRect().right - b.querySelector('.dr-count').getBoundingClientRect().right)));
  assert.ok(right.every(x => x <= 1), `countdowns at the right (${right})`);
  assert.match(await page.getAttribute('[data-date-open="d_sam"]', 'aria-label'), /^Sam’s birthday, Birthday, Oct 18, In 2 days\. Edit the date$/);
  // Show all: the ones further off, with their year when it isn't this year.
  assert.equal(await page.textContent('#dateMore'), 'Show all 8');
  await page.click('#dateMore');
  assert.equal(await page.getAttribute('#dateMore', 'aria-expanded'), 'true');
  const all = await dateRows(page, '#dateRows');
  assert.deepEqual(all.slice(6), [
    ['d_far', 'appointment', 'Conference', 'Sep 20, 2027', 'Sep 20, 2027', false],
    ['d_kim', 'birthday', 'Kim’s birthday', 'Oct 5, 2027', 'Oct 5, 2027', false],
  ]);
  await page.click('#dateMore');
  assert.equal((await dateRows(page, '#dateRows')).length, 6);
  // The one-off date that's gone, folded at the end.
  assert.equal(await page.textContent('#datePastToggle'), 'Past dates (1)');
  assert.ok(await page.isHidden('#datePastRows'));
  await page.click('#datePastToggle');
  assert.deepEqual(await dateRows(page, '#datePastRows'), [['d_old', 'appointment', 'Old checkup', 'Oct 1', '15 days ago', false]]);
  assert.equal(await page.textContent('#dateAdd'), 'Add a date');
  // Looking around wrote nothing.
  const d = await dump(page);
  assert.deepEqual(Object.keys(d.docs).sort(), Object.keys(fx.docs).sort());
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d.docs[k], v, `unchanged: ${k}`);
  assert.equal(d.local['todo.calMode'], undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a birthday just after New Year, and a Feb 29 birthday on Feb 28 in other years (on Feb 29 in a leap year)', async () => {
  const fx = smallFixture('2026-12-30');
  Object.assign(fx.docs, {
    'dates/d_alex': date('Alex’s birthday', 'birthday', '1985-01-02', true),
    'dates/d_leap': date('Sam’s birthday', 'birthday', '1992-02-29', true),
    'dates/d_eve': date('Neighbors’ party', 'other', '2026-12-31', false),
    'dates/d_ski': date('Ski trip', 'other', '2027-01-05', false),
  });
  let { ctx, page, errors } = await phone(fx);
  assert.deepEqual(await dateRows(page, '#dateRows'), [
    ['d_eve', 'other', 'Neighbors’ party', 'Dec 31', 'Tomorrow', false],
    ['d_alex', 'birthday', 'Alex’s birthday', 'Jan 2, 2027', 'In 3 days', false],
    ['d_ski', 'other', 'Ski trip', 'Jan 5, 2027', 'In 6 days', false],
    ['d_leap', 'birthday', 'Sam’s birthday', 'Feb 28, 2027', 'In 60 days', false],
  ]);
  // The month: January's dot on the 2nd, February's on the 28th (there's no 29th in 2027).
  await page.click('#monthNext');
  assert.equal(await page.textContent('#monthName'), 'January 2027');
  assert.ok((await dots(page, '2027-01-02')).includes('md-date'));
  assert.equal(await page.textContent('#monthAllTitle'), 'Everything in January 2027');
  await page.click('#monthNext');
  assert.deepEqual(await dots(page, '2027-02-28'), ['md-date']);
  assert.equal(await page.$('#monthGrid [data-day="2027-02-29"]'), null);
  assert.deepEqual(errors, []);
  await ctx.close();
  // Later, in a year with no Feb 29: Feb 28 is the day; in 2028, a leap year, it's Feb 29 again.
  const fx2 = smallFixture('2027-02-20');
  fx2.docs['dates/d_leap'] = fx.docs['dates/d_leap'];
  ({ ctx, page, errors } = await phone(fx2));
  assert.deepEqual(await dateRows(page, '#dateRows'), [['d_leap', 'birthday', 'Sam’s birthday', 'Feb 28', 'In 8 days', false]]);
  assert.deepEqual(await dots(page, '2027-02-28'), ['md-date']);
  for (let i = 0; i < 12; i++) await page.click('#monthNext');
  assert.equal(await page.textContent('#monthName'), 'February 2028');
  assert.deepEqual(await dots(page, '2028-02-29'), ['md-date']);
  assert.deepEqual(await dots(page, '2028-02-28'), [], 'not the 28th in a leap year');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the month\'s dots: open tasks, important dates (yearly ones every year) and open goals\' due dates, on the right days; a day tapped opens it in Tasks', async () => {
  const fx = smallFixture(FRI);
  Object.assign(fx.docs, {
    'tasks/t_done_later': { title: 'Done early', note: '', priority: 0, done: true, doneAt: t0, due: '2026-10-21', time: null, repeat: null,
      list: null, checklist: [], createdAt: t0 },
    'dates/d_dentist': date('Dentist', 'appointment', '2026-10-17', false),
    'dates/d_sam': date('Sam’s birthday', 'birthday', '1994-10-18', true),
    'dates/d_party': date('Block party', 'other', '2026-10-24', false),
    'dates/d_last': date('Last year’s fair', 'other', '2025-10-20', false),
    'goals/g_car': goal('New car', 3500000, { due: '2026-10-25' }),
    'goals/g_done': goal('Laptop', 120000, { due: '2026-10-26', closedAt: t0 }),
    'goals/g_open': goal('Rainy day', 50000),
  });
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.textContent('#monthName'), 'October 2026');
  const want = {
    '2026-10-14': ['md-task'], // overdue (a past day: red)
    '2026-10-16': ['md-task'], // today
    '2026-10-17': ['md-task', 'md-date'],
    '2026-10-18': ['md-task', 'md-date'],
    '2026-10-19': ['md-task'],
    '2026-10-20': [], // a one-off date from last year isn't this year
    '2026-10-21': [], // only a done task
    '2026-10-24': ['md-date'],
    '2026-10-25': ['md-task', 'md-goal'],
    '2026-10-26': [], // a closed goal
    '2026-10-31': [],
  };
  for (const [day, kinds] of Object.entries(want)) assert.deepEqual(await dots(page, day), kinds, day);
  assert.equal(await page.$eval('#monthGrid [data-day="2026-10-14"] .month-dots', e => e.classList.contains('month-late')), true);
  assert.equal(await page.$eval('#monthGrid [data-day="2026-10-16"]', e => e.classList.contains('is-today')), true, 'today circled');
  assert.match(await page.getAttribute('#monthGrid [data-day="2026-10-17"]', 'aria-label'), /^Saturday, October 17, 2 tasks, Dentist$/);
  assert.match(await page.getAttribute('#monthGrid [data-day="2026-10-25"]', 'aria-label'), /^Sunday, October 25, 1 task, New car \(savings goal\) due$/);
  // A year on: the birthday again, the one-off dates not.
  for (let i = 0; i < 12; i++) await page.click('#monthNext');
  assert.equal(await page.textContent('#monthName'), 'October 2027');
  assert.deepEqual(await dots(page, '2027-10-18'), ['md-date']);
  assert.deepEqual(await dots(page, '2027-10-17'), []);
  assert.deepEqual(await dots(page, '2027-10-24'), []);
  for (let i = 0; i < 12; i++) await page.click('#monthPrev');
  // A day ahead tapped: Tasks, showing just that day, as before.
  await page.click('#monthGrid [data-day="2026-10-19"]');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#paneTasks') && await page.isVisible('#dayBar'));
  const shown = await page.$$eval('#board .sec:not([hidden]) .task', els => els.map(e => e.dataset.id));
  assert.ok(shown.includes('t_wait') && !shown.includes('t_today_timed'), `that day's tasks (${shown})`);
  // Back on Calendar, that day is the one picked, its dots in the day's own color.
  await page.click('#dockWeek');
  assert.equal(await page.getAttribute('#monthGrid [data-day="2026-10-19"]', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Everything this month: by day, its open tasks (by time), dates and goals due; a task opens it, a date its sheet, a goal Savings goals', async () => {
  const fx = smallFixture(FRI);
  Object.assign(fx.docs, {
    'dates/d_dentist': date('Dentist', 'appointment', '2026-10-17', false),
    'dates/d_sam': date('Sam’s birthday', 'birthday', '1994-10-18', true),
    'dates/d_party': date('Block party', 'other', '2026-10-24', false),
    'dates/d_dinner': date('Family dinner', 'other', '2026-11-26', false),
    'goals/g_car': goal('New car', 3500000, { due: '2026-10-25' }),
  });
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.textContent('#monthAllTitle'), 'Everything this month');
  assert.deepEqual(await monthAll(page), [
    [longDay('2026-10-14'), [['task', 't_overdue', 'Call ABC Supply about PO 4471', 'Late']]],
    ['Today', [['task', 't_today_timed', 'Clean Rosa’s Diner', '3:00 PM'], ['task', 't_today_untimed', 'Pay electric bill', '']]],
    ['Tomorrow', [['task', 't_tomorrow', 'Send invoice to Rosa', '9:30 AM'], ['task', 't_walk_next', 'Morning walk', ''], ['date', 'd_dentist', 'Dentist', 'Appointment']]],
    [longDay('2026-10-18'), [['task', 't_gcal', 'Meet the landlord', '11:00 AM'], ['date', 'd_sam', 'Sam’s birthday', 'Birthday']]],
    [longDay('2026-10-19'), [['task', 't_wait', 'Quote from Home Depot', '']]],
    [longDay('2026-10-24'), [['date', 'd_party', 'Block party', 'Important date']]],
    [longDay('2026-10-25'), [['task', 't_unicode', '日本語タスク 🎉 émoji', ''], ['goal', 'g_car', 'New car', 'Goal due']]],
  ]);
  assert.equal(longDay('2026-10-14'), 'Wednesday, Oct 14');
  // A task tapped opens it; a date, its sheet filled in; a goal, Savings goals.
  await page.click('[data-ma-task="t_gcal"]');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskTitle'), 'Meet the landlord');
  await page.keyboard.press('Escape');
  await settle(page);
  await page.click('[data-ma-date="d_sam"]');
  await page.waitForSelector('#dateSheet.open');
  assert.equal(await page.textContent('#dateSheetTitle'), 'Edit date');
  assert.equal(await page.inputValue('#dateName'), 'Sam’s birthday');
  await page.keyboard.press('Escape');
  await settle(page);
  assert.equal(await focused(page), 'maDate=d_sam row=maDate:d_sam', 'focus back on the row');
  // The next month: its own heading and its own days.
  await page.click('#monthNext');
  assert.equal(await page.textContent('#monthAllTitle'), 'Everything in November');
  assert.deepEqual(await monthAll(page), [[longDay('2026-11-26'), [['date', 'd_dinner', 'Family dinner', 'Important date']]]]);
  await page.click('#monthNext');
  assert.ok(await page.isHidden('#monthAllBox'));
  assert.equal(await page.textContent('#monthAllEmpty'), 'Nothing due that month.');
  await page.click('#monthPrev');
  await page.click('#monthPrev');
  await page.click('[data-ma-goal="g_car"]');
  await page.waitForSelector('#goalView:not([hidden])');
  assert.ok(await page.isVisible('#paneLists'));
  // Week picked: the dates and the month's list stay under it.
  await page.click('#dockWeek');
  await page.click('[data-cal-mode="week"]');
  assert.ok(await page.isVisible('#calDates') && await page.isVisible('#monthAll'));
  const d = (await dump(page)).docs;
  assert.deepEqual(Object.keys(d).sort(), Object.keys(fx.docs).sort(), 'nothing written by looking');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a date made, changed and deleted by tapping: saved as its record, Every year follows the kind, and Restore brings it back exactly', async () => {
  const fx = smallFixture(FRI);
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.textContent('#dateEmpty'), 'No dates yet. Add birthdays, appointments and anniversaries to see how long is left.');
  assert.equal(await page.textContent('#calDatesN'), '');
  await page.click('#dateAdd');
  await page.waitForSelector('#dateSheet.open');
  assert.equal(await page.textContent('#dateSheetTitle'), 'New date');
  assert.equal(await focused(page), 'dateName');
  assert.ok(await page.isHidden('#dateDelete'), 'nothing to delete yet');
  const kinds = () => page.$$eval('#dateKinds [data-date-kind]', els => els.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.dateKind));
  const yearly = () => page.getAttribute('#dateYearly', 'aria-checked');
  assert.deepEqual(await kinds(), ['other']);
  assert.equal(await yearly(), 'false');
  // Its words, then its day, are needed.
  await page.click('#dateSave');
  assert.ok(await page.isVisible('#dateNameError'));
  assert.equal(await focused(page), 'dateName');
  await page.fill('#dateName', '  Alex’s   birthday ');
  await page.click('#dateSave');
  assert.ok(await page.isVisible('#dateWhenError') && await page.isHidden('#dateNameError'));
  assert.equal(await focused(page), 'dateWhen');
  // Every year: on for a birthday or an anniversary, off for the others, until it's set by hand.
  await page.click('[data-date-kind="birthday"]');
  assert.deepEqual([await kinds(), await yearly()], [['birthday'], 'true']);
  await page.click('[data-date-kind="appointment"]');
  assert.equal(await yearly(), 'false');
  await page.click('[data-date-kind="anniversary"]');
  assert.equal(await yearly(), 'true');
  await page.click('#dateYearly');
  assert.equal(await yearly(), 'false', 'set by hand');
  await page.click('[data-date-kind="birthday"]');
  assert.equal(await yearly(), 'false', 'and it stays as set');
  await page.click('#dateYearly');
  await page.fill('#dateWhen', '1990-11-02');
  await page.fill('#dateNote', 'Likes <b>tea</b>\nSize M');
  await page.click('#dateSave');
  await page.waitForSelector('#dateSheet', { state: 'hidden' });
  await settle(page);
  let d = (await dump(page)).docs;
  const made = inColl(d, 'dates');
  assert.equal(made.length, 1);
  const [[key, rec]] = made;
  const id = key.slice('dates/'.length);
  assert.deepEqual(Object.keys(rec).sort(), ['createdAt', 'date', 'kind', 'note', 'title', 'updatedAt', 'yearly']);
  assert.deepEqual({ ...rec, createdAt: 0, updatedAt: 0 }, { title: 'Alex’s birthday', kind: 'birthday', date: '1990-11-02', yearly: true, note: 'Likes <b>tea</b>\nSize M', createdAt: 0, updatedAt: 0 });
  assert.ok(rec.createdAt > 0 && rec.updatedAt === rec.createdAt);
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual(Object.keys(d).filter(k => !(k in fx.docs)), [key], 'only the date is new');
  assert.deepEqual(await dateRows(page, '#dateRows'), [[id, 'birthday', 'Alex’s birthday', 'Nov 2', 'In 17 days', false]]);
  assert.equal(await page.textContent('#calDatesN'), '1');
  assert.deepEqual(await dots(page, '2026-10-16'), ['md-task']);
  await page.click('#monthNext');
  assert.deepEqual(await dots(page, '2026-11-02'), ['md-date'], 'its dot in November');
  await page.click('#monthPrev');

  // Tapped: the sheet filled in; a change saves only what changed.
  await page.click(`[data-date-open="${id}"]`);
  await page.waitForSelector('#dateSheet.open');
  assert.equal(await page.textContent('#dateSheetTitle'), 'Edit date');
  assert.deepEqual(await page.evaluate(() => ['#dateName', '#dateWhen', '#dateNote'].map(s => document.querySelector(s).value)), ['Alex’s birthday', '1990-11-02', 'Likes <b>tea</b>\nSize M']);
  assert.deepEqual([await kinds(), await yearly()], [['birthday'], 'true']);
  assert.ok(await page.isVisible('#dateDelete'));
  await page.click('[data-date-kind="other"]');
  assert.equal(await yearly(), 'true', 'a date already saved keeps its Every year');
  await page.click('[data-date-kind="birthday"]');
  await page.fill('#dateName', 'Alex turns 36');
  await page.fill('#dateWhen', '1990-10-20');
  await page.click('#dateSave');
  await settle(page);
  d = (await dump(page)).docs;
  assert.deepEqual({ ...d[key], updatedAt: 0 }, { ...rec, title: 'Alex turns 36', date: '1990-10-20', updatedAt: 0 });
  assert.ok(d[key].updatedAt > rec.updatedAt);
  assert.equal(inColl(d, 'dates').length, 1, 'no second date');
  assert.deepEqual(await dateRows(page, '#dateRows'), [[id, 'birthday', 'Alex turns 36', 'Oct 20', 'In 4 days', false]]);
  const before = (await dump(page)).docs;

  // Delete: into Recently deleted (bin/, never the tasks' trash), with Undo.
  await page.click(`[data-date-open="${id}"]`);
  await page.waitForSelector('#dateSheet.open');
  await page.click('#dateDelete');
  await settle(page);
  assert.ok(await page.isHidden('#dateSheet'));
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Alex turns 36”. It stays in Recently deleted for 7 days.');
  d = (await dump(page)).docs;
  assert.equal(d[key], undefined);
  const b = d['bin/dates~' + id];
  assert.deepEqual(b, { coll: 'dates', id, doc: before[key], group: null, deletedAt: b.deletedAt });
  assert.ok(!Object.keys(d).some(k => k.startsWith('trash/') && !(k in before)), 'never in the tasks\' trash');
  assert.deepEqual(await dateRows(page, '#dateRows'), []);
  await page.click('#toastUndo');
  await settle(page);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back after Undo: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  // Deleted again, then Restore in Recently deleted (on Tasks): back exactly as it was.
  await page.click(`[data-date-open="${id}"]`);
  await page.waitForSelector('#dateSheet.open');
  await page.click('#dateDelete');
  await page.waitForTimeout(700);
  await page.click('#dockToday');
  await page.click('#trashOpen');
  await page.waitForSelector('#trashSheet.open');
  const row = await page.$eval(`[data-restore-bin="dates~${id}"]`, x => { const r = x.closest('.trash-row'); return [r.querySelector('.trash-title').textContent, r.querySelector('.trash-meta').textContent]; });
  assert.deepEqual(row, ['Alex turns 36', 'Date · Deleted today']);
  await page.click(`[data-restore-bin="dates~${id}"]`);
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `exactly as before: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  await page.keyboard.press('Escape');
  await settle(page);
  await page.click('#dockWeek');
  assert.deepEqual((await dateRows(page, '#dateRows')).map(r => r[2]), ['Alex turns 36']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the date sheet: Escape, Cancel and a tap outside close it; N stays quiet; nothing behind it can be reached', async () => {
  const fx = smallFixture(FRI);
  fx.docs['dates/d_sam'] = date('Sam’s birthday', 'birthday', '1994-10-18', true);
  const { ctx, page, errors } = await phone(fx);
  const inert = () => page.evaluate(() => ['#dock', '#newBtn', '#fab', '#app'].map(s => document.querySelector(s).inert));
  assert.deepEqual(await inert(), [false, false, false, false]);
  await page.click('[data-date-open="d_sam"]');
  await page.waitForSelector('#dateSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true]);
  await page.keyboard.press('Escape');
  await settle(page);
  assert.ok(await page.isHidden('#dateSheet'));
  assert.equal(await focused(page), 'dateOpen=d_sam row=date:d_sam kind=birthday', 'focus back on the row');
  await page.click('#dateAdd');
  await page.waitForSelector('#dateSheet.open');
  await page.keyboard.press('n');
  assert.equal(await page.inputValue('#dateName'), 'n', 'typed, not another sheet');
  assert.ok(await page.isHidden('#taskSheet'));
  await page.click('#dateCancel');
  await settle(page);
  assert.ok(await page.isHidden('#dateSheet'));
  assert.equal(await focused(page), 'dateAdd');
  await page.click('#dateAdd');
  await page.waitForSelector('#dateSheet.open');
  await page.click('#scrim', { position: { x: 5, y: 5 }, force: true });
  await settle(page);
  assert.ok(await page.isHidden('#dateSheet'), 'a tap outside closes it');
  assert.deepEqual(await inert(), [false, false, false, false]);
  // On Calendar, N is a new event (a task) for today.
  await page.keyboard.press('n');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskDate'), FRI);
  await page.keyboard.press('Escape');
  await settle(page);
  assert.deepEqual(Object.keys((await dump(page)).docs).sort(), Object.keys(fx.docs).sort(), 'nothing saved');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home: Coming up (the next three dates), Savings (the open goals\' bars) and, once, New for you (the Wish list); each hides with nothing to show', async () => {
  const fx = smallFixture(FRI);
  Object.assign(fx.docs, {
    'dates/d_dentist': date('Dentist', 'appointment', '2026-10-17', false),
    'dates/d_sam': date('Sam’s birthday', 'birthday', '1994-10-18', true),
    'dates/d_shop': date('Shop opened', 'anniversary', '2015-12-10', true),
    'dates/d_party': date('Block party', 'other', '2026-10-24', false),
    'dates/d_old': date('Old checkup', 'appointment', '2026-10-01', false),
    'goals/g_trip': goal('Holiday trip', 3500000, { due: '2027-01-04', order: 1 }),
    'goalEntries/e_trip': entry('g_trip', 1600000, '2026-10-15'),
    'goals/g_fund': goal('Emergency fund', 100000, { order: 2 }),
    'goalEntries/e_fund': entry('g_fund', 100000, '2026-10-10'),
    'goals/g_laptop': goal('Laptop', 120000, { order: 3, closedAt: t0 }),
  });
  const { ctx, page, errors } = await phone(fx, { tab: 'home' });
  // The order on Home, like the screenshot: Tasks due, then New for you, then the dates and the savings.
  const order = await page.$$eval('#paneHome > section', els => els.filter(e => !e.hidden).map(e => e.id));
  assert.deepEqual(order.filter(x => ['homeDue', 'homeNew', 'homeDates', 'homeSavings', 'stats'].includes(x)), ['homeDue', 'homeNew', 'homeDates', 'homeSavings', 'stats']);
  // Coming up: three, soonest first, with how long is left.
  assert.equal(await page.textContent('#homeDatesTitle'), 'Coming up');
  assert.equal(await page.textContent('#homeDatesN'), '4 dates');
  assert.deepEqual(await dateRows(page, '#homeDateRows'), [
    ['d_dentist', 'appointment', 'Dentist', 'Oct 17', 'Tomorrow', false],
    ['d_sam', 'birthday', 'Sam’s birthday', 'Oct 18', 'In 2 days', false],
    ['d_party', 'other', 'Block party', 'Oct 24', 'In 8 days', false],
  ]);
  // Savings: the open goals, with their bars.
  assert.equal(await page.textContent('#homeSavingsN'), '2 open');
  const goals = await page.$$eval('#homeGoalRows .home-goal', els => els.map(b => [b.dataset.homeGoal, b.querySelector('.hg-name').textContent,
    b.querySelector('.hg-amt').textContent, b.querySelector('.goal-bar').getAttribute('aria-valuenow'), b.querySelector('.goal-fill').style.width]));
  assert.deepEqual(goals, [['g_trip', 'Holiday trip', '$16,000.00 of $35,000.00', '45', '45%'], ['g_fund', 'Emergency fund', '$1,000.00 of $1,000.00', '100', '100%']]);
  assert.ok(await page.isHidden('#homeSavingsMore'));
  // New for you: the Wish list, with a star.
  assert.equal(await page.textContent('#homeNew .home-new-kicker'), 'New for you');
  assert.equal(await page.textContent('#homeNewTitle'), 'Wish list');
  assert.equal(await page.$eval('#homeNew .home-new-kicker', e => getComputedStyle(e).textTransform), 'uppercase');
  // Opening the app wrote nothing.
  let d = await dump(page);
  assert.deepEqual(Object.keys(d.docs).sort(), Object.keys(fx.docs).sort());
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d.docs[k], v, `unchanged: ${k}`);
  assert.equal(d.local['todo.newWish'], undefined);
  // The star opens the Wish list (and the card stays until it's dismissed).
  await page.click('#homeNewOpen');
  await page.waitForSelector('#wishView:not([hidden])');
  assert.equal(await focused(page), 'wishPaneTitle');
  assert.equal((await dump(page)).local['todo.newWish'], undefined, 'opening it isn\'t dismissing it');
  await page.click('#dockHome');
  assert.ok(await page.isVisible('#homeNew'));
  // A date tapped: Calendar, at its dates.
  await page.click('[data-home-date="d_sam"]');
  await settle(page);
  assert.ok(await page.isVisible('#paneCalendar'));
  assert.equal(await focused(page), 'calDatesTitle');
  assert.ok(await page.$eval('#calDates', e => { const r = e.getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight / 2; }), 'scrolled to the dates');
  assert.ok(await page.isVisible('#monthGrid'), 'on the month');
  await page.click('#dockHome');
  await page.click('#homeDatesGo');
  await settle(page);
  assert.ok(await page.isVisible('#paneCalendar'));
  // A goal tapped: Savings goals.
  await page.click('#dockHome');
  await page.click('[data-home-goal="g_fund"]');
  await page.waitForSelector('#goalView:not([hidden])');
  assert.equal(await focused(page), 'goalPaneTitle');
  // Dismiss: kept on this device the moment it's tapped, and it never shows again.
  await page.click('#dockHome');
  await page.click('#homeNewDismiss');
  assert.ok(await page.isHidden('#homeNew'));
  assert.equal(await focused(page), 'homeDatesGo', 'focus moves on to the next card');
  d = await dump(page);
  assert.equal(d.local['todo.newWish'], '1');
  assert.deepEqual(Object.keys(d.docs).sort(), Object.keys(fx.docs).sort(), 'no record written');
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#homeNew'));
  assert.ok(await page.isVisible('#homeDates') && await page.isVisible('#homeSavings'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home: with no dates coming, no Coming up; with no open goal, no Savings; more than three goals: "and N more"', async () => {
  const fx = smallFixture(FRI);
  fx.docs['dates/d_old'] = date('Old checkup', 'appointment', '2026-10-01', false); // gone
  fx.docs['goals/g_laptop'] = goal('Laptop', 120000, { closedAt: t0 });
  let { ctx, page, errors } = await phone(fx, { tab: 'home' });
  assert.ok(await page.isVisible('#homeDue'));
  assert.ok(await page.isHidden('#homeDates'), 'no Coming up');
  assert.ok(await page.isHidden('#homeSavings'), 'no Savings');
  assert.ok(await page.isVisible('#homeNew'));
  assert.deepEqual(errors, []);
  await ctx.close();
  const fx2 = smallFixture(FRI);
  for (let i = 1; i <= 5; i++) fx2.docs['goals/g' + i] = goal('Goal ' + i, 10000 * i, { order: i });
  fx2.local['todo.newWish'] = '1';
  ({ ctx, page, errors } = await phone(fx2, { tab: 'home' }));
  assert.ok(await page.isHidden('#homeNew'), 'dismissed before');
  assert.equal(await page.$$eval('#homeGoalRows .home-goal', els => els.length), 3);
  assert.equal(await page.textContent('#homeSavingsMore'), 'and 2 more');
  await page.click('#homeSavingsMore');
  await page.waitForSelector('#goalView:not([hidden])');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('words show exactly as typed: <b>, <img> and emoji are words, never page code', async () => {
  const fx = smallFixture(FRI);
  const odd = '<img src=x onerror="window.__hit=1"> 🎂 <b>Sam</b>’s day';
  fx.docs['dates/d_odd'] = date(odd, 'birthday', '1994-10-18', true, { note: '<i>not html</i> 🎉' });
  fx.docs['goals/g_odd'] = goal('<b>Trip</b> 🏖️', 100000, { due: '2026-10-18' });
  const { ctx, page, errors } = await phone(fx, { tab: 'home' });
  assert.deepEqual((await dateRows(page, '#homeDateRows'))[0].slice(2, 5), [odd, 'Oct 18', 'In 2 days']);
  assert.equal(await page.textContent('[data-home-goal="g_odd"] .hg-name'), '<b>Trip</b> 🏖️');
  await page.click('#dockWeek');
  assert.equal((await dateRows(page, '#dateRows'))[0][2], odd);
  const day = (await monthAll(page)).find(([h]) => h === longDay('2026-10-18'))[1];
  assert.deepEqual(day.filter(r => r[0] !== 'task').map(r => r[2]), [odd, '<b>Trip</b> 🏖️']);
  assert.match(await page.getAttribute('#monthGrid [data-day="2026-10-18"]', 'aria-label'), /<img src=x onerror="window\.__hit=1"> 🎂 <b>Sam<\/b>’s day/);
  await page.click('[data-date-open="d_odd"]');
  await page.waitForSelector('#dateSheet.open');
  assert.equal(await page.inputValue('#dateName'), odd);
  assert.equal(await page.inputValue('#dateNote'), '<i>not html</i> 🎉');
  await page.keyboard.press('Escape');
  await settle(page);
  const mine = ['#homeDates', '#homeSavings', '#calDates', '#monthAll'];
  assert.equal(await page.$$eval(mine.map(c => `${c} b, ${c} img, ${c} i:not(.ma-dot):not(.goal-fill)`).join(', '), els => els.length), 0, 'no markup made from what was typed');
  assert.equal(await page.evaluate(() => window.__hit), undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no sideways scrolling at 320 points with Extra large text on Calendar and Home, and in the date sheet (Classic, Midnight, Blush)', async () => {
  for (const look of ['classic', 'midnight', 'blush']) {
    const fx = smallFixture(FRI);
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    Object.assign(fx.docs, {
      'dates/d_long': date('Supercalifragilisticexpialidocious anniversary of the opening of the second shop downtown', 'anniversary', '2015-10-18', true),
      'dates/d_word': date('Extraordinarilylongwordwithoutanyspacesatallforthetest', 'appointment', '2026-10-16', false),
      'dates/d_far': date('Conference', 'other', '2027-09-20', false),
      'dates/d_old': date('An appointment from long ago that has a long name too', 'appointment', '2024-01-01', false),
      'tasks/t_long': { title: 'Averyveryverylongtaskwordwithnospacesthatmightoverflowtherow and more words after it', note: '', priority: 0,
        done: false, due: '2026-10-18', time: '23:45', repeat: null, list: 'l_home', checklist: [], createdAt: t0, doneAt: null },
      'goals/g_long': goal('Round-the-world sailing trip with the whole family and the dog', 99999999999, { due: '2026-10-30' }),
      'goalEntries/e_long': entry('g_long', 99999999998, '2026-10-01'),
    });
    const { ctx, page, errors } = await phone(fx, { viewport: { width: 320, height: 640 }, tab: 'home' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.text), 'xl');
    const check = scope => page.evaluate(scope => {
      const vw = window.innerWidth;
      const out = [];
      const over = document.scrollingElement.scrollWidth - vw;
      if (over > 0) out.push(`page ${over}px too wide`);
      for (const el of document.querySelectorAll(scope)) {
        if (el.hidden || (!el.offsetParent && getComputedStyle(el).position !== 'fixed')) continue;
        const b = el.getBoundingClientRect();
        if (b.width && (b.left < -0.5 || b.right > vw + 0.5)) out.push(`${el.id || el.className} runs off the screen`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') out.push(`${el.id || el.className} cut off`);
      }
      return out;
    }, scope);
    assert.ok(await page.isVisible('#homeNew') && await page.isVisible('#homeDates') && await page.isVisible('#homeSavings'));
    assert.deepEqual(await check('#homeNew, #homeNew *, #homeDates, .date-row, .dr-title, .dr-count, #homeSavings, .home-goal, .hg-name, .hg-amt, .goal-bar'), [], `${look}: Home`);
    await page.click('#dockWeek');
    await page.click('#datePastToggle');
    assert.deepEqual(await check('.cal-card, #calDates, .date-row, .dr-title, .dr-day, .dr-count, #dateAdd, #monthAll, .ma-row, .ma-title, .ma-side, .month-day, #newBtn'), [], `${look}: Calendar`);
    // The last of the month's list isn't hidden under "+ New event" when scrolled to the bottom.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector('#newBtn').getBoundingClientRect().top - document.querySelector('#monthAllBox').getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `${look}: the list clears "+ New event" (${gap})`);
    await page.click('[data-date-open="d_long"]');
    await page.waitForSelector('#dateSheet.open');
    await page.waitForTimeout(400);
    assert.deepEqual(await check('#dateSheet .field, #dateSheet input, #dateSheet textarea, #dateSheet button, #dateSheet .chip'), [], `${look}: the date sheet`);
    assert.ok(await page.$eval('#dateSheet', s => s.scrollWidth <= s.clientWidth + 1), `${look}: the sheet doesn't scroll sideways`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

// WCAG contrast, with a see-through color laid over the solid color under it.
const parse = c => {
  if (c.startsWith('#')) return { rgb: [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), a: 1 };
  const m = c.match(/[\d.]+/g).map(Number);
  return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 };
};
const over = (top, ground) => top.rgb.map((v, i) => v * top.a + ground[i] * (1 - top.a));
const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('in Blush (light and dark), the countdowns, the icons and the month\'s dots read clearly on the card as it really shows', async () => {
  for (const mode of ['light', 'dark']) {
    const fx = smallFixture(FRI);
    fx.docs['settings/theme'] = { look: 'blush', appearance: mode, accent: '' };
    Object.assign(fx.docs, {
      'dates/d_today': date('Pay day', 'other', FRI, false),
      'dates/d_sam': date('Sam’s birthday', 'birthday', '1994-10-18', true),
      'goals/g_car': goal('New car', 3500000, { due: '2026-10-25' }),
    });
    const { ctx, page, errors } = await phone(fx);
    const got = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const v = n => root.getPropertyValue(n).trim();
      const cs = sel => getComputedStyle(document.querySelector(sel));
      return {
        look: document.documentElement.dataset.look, mode: document.documentElement.dataset.mode,
        page: v('--page'), tint: v('--page-tint'), solid: v('--card-solid'),
        cal: cs('.cal-card').backgroundColor, dates: cs('#calDates').backgroundColor, list: cs('#monthAllBox').backgroundColor,
        count: cs('[data-date-open="d_sam"] .dr-count').color, todayText: cs('[data-date-open="d_today"] .dr-count').color,
        todayBg: cs('[data-date-open="d_today"] .dr-count').backgroundColor, icon: cs('[data-date-open="d_sam"] .ico').color,
        title: cs('[data-date-open="d_sam"] .dr-title').color, day: cs('[data-date-open="d_sam"] .dr-day').color, add: cs('#dateAdd').color,
        task: cs('[data-day="2026-10-18"] .md-task').backgroundColor, date: cs('[data-day="2026-10-18"] .md-date').backgroundColor,
        goal: cs('[data-day="2026-10-25"] .md-goal').boxShadow.match(/rgba?\([^)]+\)/)[0],
        head: cs('.ma-head').color, maSide: cs('[data-ma-date="d_sam"] .ma-side').color, maIcon: cs('[data-ma-date="d_sam"] .ico').color,
      };
    });
    assert.deepEqual([got.look, got.mode], ['blush', mode]);
    for (const k of ['page', 'tint', 'solid']) assert.match(got[k], /^#[0-9A-F]{6}$/i, `${mode}: ${k} is a solid color`);
    const bad = [];
    for (const [card, things] of [
      [got.dates, [['countdown', got.count, 4.5], ['date title', got.title, 4.5], ['its day', got.day, 4.5], ['Add a date', got.add, 4.5], ['kind icon', got.icon, 3], ['"Today" pill', got.todayBg, 3]]],
      [got.cal, [['task dot', got.task, 3], ['date dot', got.date, 3], ['goal ring', got.goal, 3]]],
      [got.list, [['day heading', got.head, 4.5], ['kind word', got.maSide, 4.5], ['kind icon', got.maIcon, 3]]],
    ]) {
      const c = parse(card);
      const grounds = { 'card over the page': over(c, parse(got.page).rgb), 'card over the deepest page': over(c, parse(got.tint).rgb), 'solid card': parse(got.solid).rgb };
      for (const [where, ground] of Object.entries(grounds)) {
        for (const [name, color, min] of things) {
          const r = ratio(over(parse(color), ground), ground);
          if (!(r >= min)) bad.push(`${mode}: ${name} ${color} on ${where}: ${r.toFixed(2)} (needs ${min})`);
        }
      }
    }
    // "Today" on its own pill.
    const pill = ratio(parse(got.todayText).rgb, parse(got.todayBg).rgb);
    if (!(pill >= 4.5)) bad.push(`${mode}: "Today" on its pill: ${pill.toFixed(2)}`);
    // The dates' raspberry is the look's --pop-ink, like the Wish list's labels.
    const popInk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pop-ink').trim());
    assert.equal(parse(got.count).rgb.join(), parse(popInk).rgb.join(), `${mode}: countdowns in --pop-ink`);
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('in Blush (light and dark), New for you reads clearly on its peach-to-lilac card', async () => {
  for (const mode of ['light', 'dark']) {
    const fx = smallFixture(FRI);
    fx.docs['settings/theme'] = { look: 'blush', appearance: mode, accent: '' };
    const { ctx, page, errors } = await phone(fx, { tab: 'home' });
    const got = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const cs = sel => getComputedStyle(document.querySelector(sel));
      const card = cs('#homeNew');
      return {
        page: root.getPropertyValue('--page').trim(), tint: root.getPropertyValue('--page-tint').trim(),
        image: card.backgroundImage, color: card.backgroundColor,
        kicker: cs('.home-new-kicker').color, title: cs('#homeNewTitle').color, text: cs('.home-new-text').color, x: cs('#homeNewDismiss').color,
        starBg: cs('#homeNewOpen').backgroundColor, star: cs('#homeNewOpen').color,
      };
    });
    // Every color stop of the card's wash, laid over what's under it (its own solid color, else the page at its lightest
    // and deepest).
    const stops = (got.image.match(/rgba?\([^)]+\)/g) || []).map(parse);
    assert.ok(stops.length >= 2, `${mode}: the card has its wash (${got.image})`);
    const base = parse(got.color);
    const unders = base.a === 1 ? [base.rgb] : [parse(got.page).rgb, parse(got.tint).rgb].map(g => over(base, g));
    const bad = [];
    for (const u of unders) {
      for (const s of stops) {
        const ground = over(s, u);
        for (const [name, color, min] of [['"New for you"', got.kicker, 4.5], ['Wish list', got.title, 4.5], ['its words', got.text, 4.5], ['Dismiss', got.x, 4.5]]) {
          const r = ratio(over(parse(color), ground), ground);
          if (!(r >= min)) bad.push(`${mode}: ${name} ${color}: ${r.toFixed(2)}`);
        }
        const sb = over(parse(got.starBg), ground);
        if (!(ratio(parse(got.star).rgb, sb) >= 3)) bad.push(`${mode}: the star ${ratio(parse(got.star).rgb, sb).toFixed(2)}`);
      }
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
