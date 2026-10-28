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

// A finger on a row (the same as in regression.test.cjs): the board reads pointer events.
async function swipe(page, id, dx) {
  await page.evaluate(({ id, dx }) => {
    const inner = document.querySelector(`.task[data-id="${id}"] .task-inner`);
    const r = inner.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (name, x) => inner.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }));
    ev('pointerdown', x0);
    for (let i = 1; i <= 12; i++) ev('pointermove', x0 + (dx * i) / 12);
    ev('pointerup', x0 + dx);
  }, { id, dx });
  await page.waitForTimeout(500);
}

test('every count of a part of the list agrees (the task on Up next counts too), and a late task swipes back to today', async () => {
  const { ctx, page, errors } = await phone({
    'tasks/o1': task('Late one', { due: addDays(T, -2), priority: 3 }), // Up next
    'tasks/o2': task('Late two', { due: addDays(T, -1) }),
    'tasks/o3': task('Late three', { due: addDays(T, -1), repeat: 'weekly' }),
    'tasks/t1': task('Today one'),
    'tasks/t2': task('Today two', { time: '23:59' }),
  });
  assert.equal(await page.getAttribute('#hero', 'data-id'), 'o1');
  const counts = () => page.evaluate(() => ({
    badge: document.querySelector('#todayBadge').textContent,
    view: document.querySelector('[data-scope="overdue"] .scope-n').textContent,
    section: document.querySelector('.sec[data-sec="overdue"] .count').textContent,
    rows: document.querySelectorAll('.sec[data-sec="overdue"] .task').length,
    move: document.querySelector('#moveOverdue').textContent,
    today: document.querySelector('.sec[data-sec="today"] .count').textContent,
    todayView: document.querySelector('[data-scope="today"] .scope-n').textContent,
  }));
  assert.deepEqual(await counts(), { badge: '3', view: '3', section: '3', rows: 2, move: 'Move all 3 to today', today: '2', todayView: '2' },
    'the Overdue heading says 3 (2 rows, and the one on Up next), the same as the badge, the view and Move all');
  // A late task, swiped left: Today is one of the choices, and it keeps a repeating one's schedule.
  await swipe(page, 'o3', -120);
  assert.ok(await page.isVisible('.task[data-id="o3"] [data-snooze="today"]'));
  await page.click('.task[data-id="o3"] [data-snooze="today"]');
  await page.waitForTimeout(500);
  const d = await dump(page);
  assert.equal(d.docs['tasks/o3'].due, T);
  assert.deepEqual(d.docs['tasks/o3'].postponed, { from: addDays(T, -1), to: T });
  assert.equal(await page.textContent('#toastMsg'), 'Moved to today');
  assert.deepEqual(await counts(), { badge: '2', view: '2', section: '2', rows: 1, move: 'Move all 2 to today', today: '3', todayView: '3' });
  // A task that isn't late doesn't offer it.
  await swipe(page, 't1', -120);
  assert.ok(await page.isVisible('.task[data-id="t1"] [data-snooze="tomorrow"]'));
  assert.ok(await page.isHidden('.task[data-id="t1"] [data-snooze="today"]'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('on a small iPhone, a late task’s four choices still leave some of the task showing', async () => {
  const { ctx, page, errors } = await phone({ 'tasks/o1': task('Up next', { due: addDays(T, -2), priority: 3 }), 'tasks/o2': task('Late two', { due: addDays(T, -1) }) },
    { viewport: { width: 320, height: 640 } });
  await swipe(page, 'o2', -120);
  const r = await page.evaluate(() => {
    const li = document.querySelector('.task[data-id="o2"]');
    const shown = [...li.querySelectorAll('.snooze-btn')].filter(b => !b.hidden).map(b => b.dataset.snooze);
    return { shown, left: Math.round(li.querySelector('.swipe-later').getBoundingClientRect().left - li.getBoundingClientRect().left) };
  });
  assert.deepEqual(r.shown, ['pick', 'nextweek', 'tomorrow', 'today']);
  assert.ok(r.left >= 60, `${r.left}px of the task still shows`);
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

test('urgent and important look different in every look and mode: red is only for late, High is a color of its own', async () => {
  const { ctx, page, errors } = await phone({ 'tasks/t1': task('Something', { due: addDays(T, 3) }) });
  const problems = await page.evaluate(() => {
    const T = window.todoTheme, out = [];
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const hue = h => { const [r, g, b] = rgb(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (!d) return null; return 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4); };
    const apart = (a, b) => { const x = hue(a), y = hue(b); if (x === null || y === null) return 0; const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
    const check = (tag, prio, red, grounds) => {
      if (apart(prio, red) < 60) out.push(`${tag}: High ${prio} is too close to the late red ${red}`);
      for (const g of grounds) if (T.contrast(prio, g) < 4.5) out.push(`${tag}: High ${prio} on ${g} is ${T.contrast(prio, g).toFixed(2)}`);
    };
    for (const t of T.themes.filter(x => x.kind === 'tokens')) for (const mode of t.modes) {
      const k = T.tokens(t.id, mode, '');
      check(`${t.id}/${mode}`, k['--prio-3'], k['--red'], [k['--card-solid'] || k['--card'], k['--page'], k['--page-tint'] || k['--page']]);
    }
    // Classic and the original looks set their colors in the stylesheet: read them as the page has them.
    const root = document.documentElement, keep = ['data-look', 'data-skin', 'data-theme'].map(a => [a, root.getAttribute(a)]);
    const css = n => getComputedStyle(root).getPropertyValue(n).trim().toUpperCase();
    const looks = [['classic', null, 'light'], ['classic', null, 'dark'], ...T.themes.filter(x => x.kind === 'skin' && x.id !== 'orange-bg').map(x => [x.id, x.id, 'light'])];
    for (const [id, skin, mode] of looks) {
      root.removeAttribute('data-look');
      if (skin) root.setAttribute('data-skin', skin); else root.removeAttribute('data-skin');
      root.setAttribute('data-theme', mode);
      check(`${id}/${mode}`, css('--prio-3'), css('--red'), [css('--card'), css('--page')]);
    }
    for (const [a, v] of keep) if (v === null) root.removeAttribute(a); else root.setAttribute(a, v);
    return out;
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a task that is late and High shows both, each its own way; a High one not due yet shows no red', async () => {
  for (const look of ['blush', 'classic', 'midnight']) {
    const { ctx, page, errors } = await phone({
      'tasks/up': task('First', { due: addDays(T, -3), priority: 3 }), // Up next (High and the oldest)
      'tasks/both': task('Late and High', { due: addDays(T, -1), priority: 3 }),
      'tasks/high': task('High, next week', { due: addDays(T, 5), priority: 3 }),
      'settings/theme': { look, appearance: 'light', accent: '', updatedAt: Date.now() },
    });
    const look2 = await page.evaluate(() => {
      const css = (el, n) => getComputedStyle(el).getPropertyValue(n).trim();
      const row = id => document.querySelector(`.task[data-id="${id}"]`);
      const inner = id => row(id).querySelector('.task-inner');
      const root = document.documentElement;
      return {
        prio: css(root, '--prio-3'), red: css(root, '--red'),
        bothStripe: css(row('both'), '--stripe'), bothBorder: getComputedStyle(inner('both')).borderTopColor, bothMark: getComputedStyle(row('both').querySelector('.prio')).color,
        highStripe: css(row('high'), '--stripe'), highBorder: getComputedStyle(inner('high')).borderTopColor, highLate: !!row('high').querySelector('.late, .cd.late'),
        rgb: c => c,
      };
    });
    const toRgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    assert.equal(look2.bothStripe, look2.prio, `${look}: the High stripe on a late task`);
    assert.equal(look2.bothBorder, toRgb(look2.red), `${look}: its late border is red`);
    assert.equal(look2.bothMark, toRgb(look2.prio), `${look}: its !!! is the High color`);
    assert.equal(look2.highStripe, look2.prio);
    assert.notEqual(look2.highBorder, toRgb(look2.red), `${look}: a High task not due yet has no red border`);
    assert.equal(look2.highLate, false);
    // Home's agenda shows the same mark.
    await page.click('#dockHome');
    await page.waitForSelector('#homeDueRows [data-home-open="both"]');
    const home = await page.evaluate(() => {
      const m = document.querySelector('#homeDueRows [data-home-open="both"] .prio-mark');
      return { text: m && m.textContent, color: m && getComputedStyle(m).color, label: document.querySelector('#homeDueRows [data-home-open="both"]').getAttribute('aria-label') };
    });
    assert.equal(home.text, '!!!');
    assert.equal(home.color, toRgb(look2.prio));
    assert.match(home.label, /^High priority: Late and High, /);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('adding from Home: one tap and the words; smart add reads the day, time, priority and list, and it shows in the agenda', async () => {
  const { ctx, page, errors } = await phone({ 'tasks/t1': task('Something already here', { due: addDays(T, 2) }) }, { tab: 'home' });
  assert.ok(await page.isVisible('#homeQuickInput'), 'the box is on Home');
  await page.click('#homeQuickInput');
  await page.keyboard.type('Call the bank tomorrow 3pm !!! #home');
  assert.match(await page.textContent('#homeQuickHint'), /Tomorrow at 3:00 PM · High priority · Home/);
  assert.match(await page.textContent('#homeQuickHint'), /Saves as “Call the bank”/);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let d = await dump(page);
  const added = tasksOf(d).find(t => t.title === 'Call the bank');
  assert.ok(added, 'saved');
  assert.deepEqual([added.due, added.time, added.priority, added.list, added.done], [addDays(T, 1), '15:00', 3, 'l_home', false]);
  assert.equal(await page.textContent('#toastMsg'), 'Task added for tomorrow (Home)');
  assert.equal(await page.inputValue('#homeQuickInput'), '', 'the box is empty again');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'homeQuickInput', 'ready for the next one');
  assert.ok(await page.isVisible(`#homeDueRows [data-home-open="${added.id}"]`), 'in the agenda at once');
  // Just words: today, in no list.
  await page.keyboard.type('Buy stamps');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  d = await dump(page);
  const plain = tasksOf(d).find(t => t.title === 'Buy stamps');
  assert.deepEqual([plain.due, plain.list, plain.priority], [T, null, 0]);
  assert.equal(await page.textContent('#toastMsg'), 'Task added for today');
  // Undo takes it back.
  await page.click('#toastUndo');
  await page.waitForTimeout(500);
  assert.equal(tasksOf(await dump(page)).find(t => t.title === 'Buy stamps'), undefined);
  // Escape clears what was typed; More opens the whole task with it.
  await page.click('#homeQuickInput');
  await page.keyboard.type('Something to forget');
  await page.keyboard.press('Escape');
  assert.equal(await page.inputValue('#homeQuickInput'), '');
  await page.keyboard.type('Plan the week friday');
  await page.click('#homeQuickMore');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskTitle'), 'Plan the week friday');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the weekly review: each late task, each waiting on someone and each with no date, one at a time, settled with a tap', async () => {
  const docs = {
    'tasks/l_old': task('Weekly order', { due: addDays(T, -5), repeat: 'weekly' }),
    'tasks/l_vip': task('Sign the quote', { due: addDays(T, -1), priority: 3 }),
    'tasks/w_1': task('Gloves from the supplier', { due: addDays(T, 2), waiting: { on: 'Home Depot', since: addDays(T, -3) } }),
    'tasks/n_1': task('Tidy the van', { due: null }),
    'tasks/f_1': task('Planned already', { due: addDays(T, 3) }),
    'tasks/d_1': task('Done already', { due: addDays(T, -2), done: true, doneAt: Date.now() - 1e5 }),
  };
  const { ctx, page, errors } = await phone(docs, { local: { 'todo.calMode': 'week' } });
  const before = await dump(page);
  await page.click('#dockWeek');
  await page.waitForSelector('#weekView:not([hidden])');
  assert.equal(await page.textContent('#reviewBtn'), 'Review unfinished4');
  await page.click('#reviewBtn');
  await page.waitForSelector('#reviewSheet.open');
  const card = () => page.evaluate(() => ({ pos: document.querySelector('#reviewPos').textContent, kind: document.querySelector('#reviewKind').textContent,
    task: document.querySelector('#reviewTask').textContent, when: document.querySelector('#reviewWhen').textContent }));
  let c = await card();
  assert.deepEqual([c.pos, c.kind, c.task], ['1 of 4', 'Overdue', 'Weekly order'], 'the oldest late one first');
  assert.match(c.when, /^Was due .*, repeats weekly · Work$/);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.review), 'done', 'ready to answer');
  await page.click('[data-review="today"]'); // to today: a repeating task keeps its schedule
  c = await card();
  assert.deepEqual([c.pos, c.kind, c.task], ['2 of 4', 'Overdue', 'Sign the quote']);
  await page.click('[data-review="done"]');
  c = await card();
  assert.deepEqual([c.pos, c.kind, c.task], ['3 of 4', 'Waiting on someone', 'Gloves from the supplier']);
  assert.match(c.when, /^Waiting on Home Depot · /);
  await page.click('[data-review="keep"]');
  c = await card();
  assert.deepEqual([c.pos, c.kind, c.task], ['4 of 4', 'No date', 'Tidy the van']);
  await page.fill('#reviewDate', addDays(T, 4));
  await page.dispatchEvent('#reviewDate', 'change');
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#reviewPos'), 'All reviewed.');
  assert.equal(await page.textContent('#reviewSum'), '1 done, 2 moved, 1 kept as it was.');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'reviewClose');
  await page.waitForTimeout(800);
  const d = await dump(page);
  assert.equal(d.docs['tasks/l_old'].due, T);
  assert.deepEqual(d.docs['tasks/l_old'].postponed, { from: addDays(T, -5), to: T });
  assert.equal(d.docs['tasks/l_vip'].done, true);
  assert.deepEqual(d.docs['tasks/w_1'], before.docs['tasks/w_1'], 'kept exactly as it was');
  assert.equal(d.docs['tasks/n_1'].due, addDays(T, 4));
  for (const id of ['f_1', 'd_1']) assert.deepEqual(d.docs['tasks/' + id], before.docs['tasks/' + id], `not part of it: ${id}`);
  await page.click('#reviewClose');
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#reviewBtn'), 'Review unfinished1', 'what’s left: the one waiting');
  // Escape closes it; one done meanwhile is passed over.
  await page.click('#reviewBtn');
  await page.waitForSelector('#reviewSheet.open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#reviewSheet'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the weekly review passes over a task done or deleted meanwhile, and Open shows the task', async () => {
  const { ctx, page, errors } = await phone({
    'tasks/a': task('First late', { due: addDays(T, -3) }),
    'tasks/b': task('Second late', { due: addDays(T, -2) }),
    'tasks/c': task('Third late', { due: addDays(T, -1) }),
  }, { local: { 'todo.calMode': 'week' } });
  await page.click('#dockWeek');
  await page.click('#reviewBtn');
  await page.waitForSelector('#reviewSheet.open');
  // Meanwhile (another device, say) the second one is done.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const ref = db.doc('tasks/b'); const snap = await ref.get(); await ref.set({ ...snap.data(), done: true, doneAt: Date.now() });
  });
  await page.waitForTimeout(400);
  await page.click('[data-review="keep"]');
  assert.equal(await page.textContent('#reviewTask'), 'Third late', 'the done one is passed over');
  await page.click('[data-review="open"]');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskTitle'), 'Third late');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('speed: drawing the page never reads the window’s width (it would lay the whole page out each time), and rows don’t carry the late-only Today choice until one is swiped', async () => {
  const docs = {};
  for (let i = 0; i < 40; i++) docs[`tasks/t${i}`] = task(`Task ${i}`, { due: addDays(T, (i % 5) - 2) });
  const { ctx, page, errors } = await phone(docs, {});
  // Count every read of the window's width from here on.
  await page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    window.__widthReads = 0;
    Object.defineProperty(window, 'innerWidth', { configurable: true, get() { window.__widthReads++; return d.get ? d.get.call(window) : d.value; } });
  });
  await page.evaluate(() => document.querySelector('#board .task:not(.is-done) .ring').click());
  await page.waitForTimeout(1300);
  for (const tab of ['#dockHome', '#dockLists', '#dockWeek', '#dockToday']) { await page.evaluate(s => document.querySelector(s).click(), tab); await page.waitForTimeout(300); }
  assert.equal(await page.evaluate(() => window.__widthReads), 0, 'no width read while checking off or switching tabs');
  assert.equal(await page.$$eval('#board .task [data-snooze="today"]', els => els.length), 0, 'no Today choice in the rows yet');
  const late = await page.$eval('.sec[data-sec="overdue"] .task', el => el.dataset.id);
  await swipe(page, late, -120);
  assert.equal(await page.$$eval(`.task[data-id="${late}"] [data-snooze="today"]`, els => els.length), 1, 'made when a late task is swiped');
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
