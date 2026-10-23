// The tab bar: Home, Tasks, Lists, Calendar and Settings. One place shows at a time, the pick is kept on the phone
// (only when a tab is tapped, never on opening), every place the app had before is still two taps or less away, the bar
// can't be reached behind a sheet, and nothing scrolls sideways on a small iPhone with the largest text.
// Usage: node --test tests/tabs.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const TABS = [ // [name, tab button, panel]
  ['home', '#dockHome', '#paneHome'],
  ['tasks', '#dockToday', '#paneTasks'],
  ['lists', '#dockLists', '#paneLists'],
  ['calendar', '#dockWeek', '#paneCalendar'],
];
// A phone with the fixture list on it, opened on `tab` (or on whatever the app picks when fx.local has no tab).
async function phone(fx = smallFixture(), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (o.tab === null) delete fx.local['todo.tab']; else fx.local['todo.tab'] = o.tab || 'home';
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#dock:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const shownPanels = page => page.$$eval('main .pane', els => els.filter(e => !e.hidden && e.offsetParent).map(e => e.id));
const current = page => page.$$eval('#dock [aria-current="page"]', els => els.map(e => e.id));

test('five tabs, one place showing at a time, and the one picked comes back after a reload', async () => {
  const fx = smallFixture();
  const { ctx, page, errors } = await phone(fx, { tab: null });
  // Opening writes nothing: a phone with no tab kept opens on Home and keeps no tab.
  await page.waitForTimeout(1500);
  let d = await dump(page);
  assert.equal(d.local['todo.tab'], undefined, 'no tab kept just for opening');
  assert.deepEqual(await shownPanels(page), ['paneHome']);
  const buttons = await page.$$eval('#dock .dock-btn', els => els.filter(e => !e.hidden).map(e => [e.id, e.querySelector('.dock-label').textContent]));
  assert.deepEqual(buttons, [['dockHome', 'Home'], ['dockToday', 'Tasks'], ['dockLists', 'Lists'], ['dockWeek', 'Calendar'], ['colorsBtn', 'Settings']]);
  assert.deepEqual(await current(page), ['dockHome'], 'one tab is the current one');
  for (const [name, btn, pane] of TABS) {
    await page.click(btn);
    await page.waitForTimeout(150);
    assert.deepEqual(await shownPanels(page), [pane.slice(1)], `${name}: its panel alone`);
    assert.deepEqual(await current(page), [btn.slice(1)], `${name}: its button alone is current`);
    const label = await page.$eval(btn, b => [getComputedStyle(b.querySelector('.dock-label')).fontWeight, getComputedStyle(b.querySelector('.fl, .fo')).fill]);
    assert.ok(Number(label[0]) >= 700 && label[1] !== 'none', `${name}: a bold label and a filled icon (${label})`);
    assert.equal(await page.evaluate(p => document.activeElement === document.querySelector(p + ' .pane-title'), pane), true, `${name}: focus goes to its title`);
    assert.equal((await dump(page)).local['todo.tab'], name, 'the tab tapped is kept');
  }
  const off = await page.$eval('#dockHome', b => [getComputedStyle(b.querySelector('.dock-label')).fontWeight, getComputedStyle(b.querySelector('.fl')).fill]);
  assert.ok(Number(off[0]) < 700 && off[1] === 'none', 'a tab not showing: plain label, outline icon');
  await page.click('#dockLists');
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  assert.deepEqual(await shownPanels(page), ['paneLists'], 'back on Lists after a reload');
  d = await dump(page);
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d.docs[k], v, `record unchanged: ${k}`);
  // Settings is the fifth button: it opens the Settings sheet, over whatever tab is showing.
  await page.click('#colorsBtn');
  await page.waitForSelector('#colorsSheet.open');
  assert.deepEqual(await current(page), ['dockLists']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Every place the app had before the tabs, and the taps from Home that reach it (two at most).
const PLACES = [
  ['purchase orders, from Tasks', ['#dockToday', '#poBtn'], '#poSheet.open'],
  ['purchase orders, from Lists', ['#dockLists', '#listsPo'], '#poSheet.open'],
  ['clients, from Tasks', ['#dockToday', '#clientsBtn'], '#clientsSheet.open'],
  ['clients, from Lists', ['#dockLists', '#listsClients'], '#clientsSheet.open'],
  ['the week planner', ['#dockWeek', '[data-cal-mode="week"]'], '#weekView:not([hidden]) .wk-task'],
  ['the month, from Calendar', ['#dockWeek'], '#monthView:not([hidden]) #monthGrid [data-day]'],
  ['the month', ['#dockToday', '#monthBtn'], '#monthView:not([hidden]) #monthGrid [data-day]'],
  ['the timeline', ['#dockToday', '#tlBtn'], '#timeline:not([hidden]) .tl-block'],
  ['Settings', ['#colorsBtn'], '#colorsSheet.open'],
  ['Recently deleted', ['#dockToday', '#trashOpen'], '#trashSheet.open'],
  ['Save as a spreadsheet', ['#dockToday', '#backupBtn'], 'download'],
  ['Save everything', ['#colorsBtn', '#exportAll'], 'download'],
  ['Focus', ['#dockToday', '#heroFocus'], '#focus:not([hidden])'],
  ['search', ['#dockToday', '#searchBtn'], '#searchInput:focus'],
  ['select several', ['#dockToday', '#selectBtn'], 'html.selecting'],
  ['the list editor', ['#dockLists', '#listsEdit'], '#listsSheet.open'],
];
test('everything the app had is two taps or less from Home', async () => {
  const { ctx, page, errors } = await phone();
  for (const [what, taps, want] of PLACES) {
    assert.ok(taps.length <= 2, `${what}: ${taps.length} taps`);
    // From Home each time, with the list as it opened (the timeline row leaves Tasks on the timeline, which hides the list;
    // the week planner's row leaves Week picked on Calendar).
    await page.evaluate(() => { localStorage.setItem('todo.tab', 'home'); localStorage.removeItem('todo.view'); localStorage.removeItem('todo.calMode'); });
    await page.reload();
    await page.waitForSelector('#paneHome:not([hidden])');
    await page.waitForSelector('#dock:not([hidden])');
    for (const [i, sel] of taps.entries()) {
      if (i === taps.length - 1 && want === 'download') {
        await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(sel, { timeout: 5000 })]);
      } else {
        await page.click(sel, { timeout: 5000 }); // a tap only works on something showing
        await page.waitForTimeout(250);
      }
    }
    if (want !== 'download') await page.waitForSelector(want, { state: 'attached', timeout: 5000 }).catch(() => assert.fail(`${what}: ${want} after ${taps.join(', ')}`));
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the tab bar and "+ New" can\'t be reached behind a sheet', async () => {
  const { ctx, page, errors } = await phone(smallFixture(), { tab: 'tasks' });
  const inert = () => page.evaluate(() => ['#dock', '#fab', '#newBtn', '#app'].map(s => document.querySelector(s).inert));
  assert.deepEqual(await inert(), [false, false, false, false]);
  await page.click('#colorsBtn');
  await page.waitForSelector('#colorsSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true], 'Settings open');
  await page.click('#colorsDone');
  await page.waitForTimeout(400);
  assert.deepEqual(await inert(), [false, false, false, false]);
  assert.equal(await page.textContent('#fab'), 'New task');
  await page.click('#fab');
  await page.waitForSelector('#taskSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true], 'a new task being written');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // Lists has its own "+ New": a new shopping list (the task lists keep their Edit lists button).
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#fab'));
  assert.equal(await page.textContent('#newBtn'), 'New list');
  await page.click('#newBtn');
  await page.waitForSelector('#shopSheet.open');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'shopNameInput');
  assert.deepEqual(await inert(), [true, true, true, true]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Tasks button counts what\'s overdue and says so', async () => {
  const { ctx, page, errors } = await phone();
  assert.equal(await page.textContent('#todayBadge'), '1');
  assert.equal(await page.getAttribute('#dockToday', 'aria-label'), 'Tasks, 1 task overdue');
  // Moved to today, nothing is overdue: no badge, and the label is just the tab's name.
  await page.click('#dockToday');
  await page.click('#moveOverdue');
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#todayBadge'), '');
  assert.ok(await page.isHidden('#todayBadge'));
  assert.equal(await page.getAttribute('#dockToday', 'aria-label'), 'Tasks');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the tab bar\'s words and "+ New" read clearly in every look, mode and accent', async () => {
  const { ctx, page, errors } = await phone(smallFixture(), { tab: 'tasks' });
  const bad = await page.evaluate(async () => {
    // WCAG contrast of two computed colors; both are solid here (the bar and the pill have no see-through fill).
    const rgb = c => { const m = c.match(/[\d.]+/g).map(Number); return m.length > 3 && m[3] < 1 ? null : m.slice(0, 3); };
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const x = rgb(a), y = rgb(b); if (!x || !y) return NaN; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
    const out = [];
    for (const t of window.todoTheme.themes.filter(x => x.kind !== 'skin')) {
      for (const mode of t.modes) {
        for (const accent of ['', '#FFC53D', '#B8FF3C', '#2563FF', '#7C3AED']) {
          window.todoTheme.set({ look: t.id, appearance: mode, accent });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const tag = `${t.id}/${mode}/${accent || 'own'}`;
          const bar = getComputedStyle(document.querySelector('#dock')).backgroundColor;
          for (const l of document.querySelectorAll('#dock .dock-btn:not([hidden]) .dock-label')) {
            const c = contrast(getComputedStyle(l).color, bar);
            if (!(c >= 4.5)) out.push(`${tag} "${l.textContent}" ${c.toFixed(2)}`);
          }
          const pill = getComputedStyle(document.querySelector('#fab'));
          const c = contrast(pill.color, pill.backgroundColor);
          if (!(c >= 4.5)) out.push(`${tag} "+ New task" ${c.toFixed(2)}`);
        }
      }
    }
    return out;
  });
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no sideways scrolling on any tab at 320 points with Extra large text (Classic, Midnight, Blush)', async () => {
  for (const look of ['classic', 'midnight', 'blush']) {
    const fx = smallFixture();
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    const { ctx, page, errors } = await phone(fx, { viewport: { width: 320, height: 640 } });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.look || 'classic'), look);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.text), 'xl');
    for (const [name, btn] of TABS) {
      await page.click(btn);
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const out = [];
        const over = document.scrollingElement.scrollWidth - vw;
        if (over > 0) out.push(`page ${over}px too wide`);
        // The tab bar and "+ New" are fixed, so they'd be cut off rather than scroll: check them one by one.
        for (const el of document.querySelectorAll('#dock, #dock .dock-btn, #fab, #newBtn')) {
          if (el.hidden || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
          const b = el.getBoundingClientRect();
          if (b.width && (b.left < 0 || b.right > vw + 0.5)) out.push(`${el.id || el.className} runs off the screen`);
        }
        for (const l of document.querySelectorAll('#dock .dock-btn:not([hidden]) .dock-label')) {
          if (l.scrollWidth > l.clientWidth + 0.5) out.push(`"${l.textContent}" is cut off`);
        }
        return out;
      });
      assert.deepEqual(r, [], `${look}, ${name}`);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('Home: the day, a greeting, and the three most urgent tasks with a circle to tick', async () => {
  const fx = smallFixture();
  const { ctx, page, errors } = await phone(fx);
  assert.match(await page.textContent('#briefTitle'), /^Good (morning|afternoon|evening), Jose$/);
  assert.match(await page.textContent('#dateKicker'), /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/);
  assert.ok(await page.isVisible('#dayProg'), 'today\'s ring');
  assert.ok(await page.isVisible('#stats'), 'Your week');
  assert.equal(await page.textContent('#homeDueN'), '9 open', 'open tasks, not done, waiting or samples');
  const rows = () => page.$$eval('#homeDueRows .home-row', els => els.map(e => [e.querySelector('[data-home-done]').dataset.homeDone,
    e.querySelector('.hr-when') ? e.querySelector('.hr-when').textContent : '', !!e.querySelector('.hr-when.late')]));
  const r = await rows();
  assert.deepEqual(r.map(x => x[0]), ['t_overdue', 't_today_timed', 't_today_untimed'], 'late first, then today');
  const [y, m, dd] = addDays(fx.today, -2).split('-').map(Number);
  const lateDay = new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // like "Oct 20"
  assert.deepEqual(r.map(x => x[1]), [lateDay, '3:00 PM', 'Today']);
  assert.equal(r[0][2], true, 'the late one in red');
  // The date sits at the right of each row.
  const right = await page.$$eval('#homeDueRows .home-row', els => els.map(e => Math.round(e.getBoundingClientRect().right - e.querySelector('.hr-when').getBoundingClientRect().right)));
  assert.ok(right.every(x => x <= 1), `dates right-aligned (${right})`);
  assert.equal(await page.textContent('#homeDueMore'), 'and 6 more');
  // Ticking a circle checks the task off (with Undo), and the next one moves up.
  await page.click('[data-home-done="t_overdue"]');
  await page.waitForTimeout(500);
  assert.equal((await dump(page)).docs['tasks/t_overdue'].done, true);
  assert.equal(await page.textContent('#toastMsg'), 'Marked done');
  assert.deepEqual((await rows()).map(x => x[0]), ['t_today_timed', 't_today_untimed', 't_tomorrow']);
  assert.equal(await page.textContent('#homeDueN'), '8 open');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#homeDue') !== null), true, 'focus stays in the card');
  await page.click('#toastUndo');
  await page.waitForTimeout(500);
  assert.equal((await dump(page)).docs['tasks/t_overdue'].done, false);
  // Tapping a task opens it; "and N more" goes to Tasks.
  await page.click('[data-home-open="t_today_timed"]');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskTitle'), 'Clean Rosa’s Diner');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#homeDueMore');
  assert.deepEqual(await shownPanels(page), ['paneTasks']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Tasks: the list picker is the title, and a summary of what\'s open and done this week', async () => {
  const { ctx, page, errors } = await phone(smallFixture(), { tab: 'tasks' });
  assert.equal(await page.textContent('#tasksTitle'), 'All tasks');
  assert.equal(await page.textContent('#taskSumTitle'), '11 active tasks');
  const tiles = await page.$$eval('.tsum-tile', els => els.map(e => e.textContent));
  assert.deepEqual(tiles, ['4Today', '4This week', '3Later'], 'late and today; the next 6 days; later or no date');
  assert.equal(await page.textContent('#sumDoneText'), '3 done this week');
  assert.match(await page.getAttribute('#sumBar', 'style'), /width: 21%/, '3 of 14');
  await page.selectOption('#listPickSel', 'l_jars');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('#tasksTitle'), 'JARS');
  assert.equal(await page.getAttribute('#filterChips [data-filter="l_jars"]', 'aria-pressed'), 'true', 'the same as the JARS chip');
  assert.equal(await page.textContent('#taskSumTitle'), '3 active tasks');
  await page.click('#sumDone');
  assert.equal(await page.getAttribute('[data-scope="done"]', 'aria-pressed'), 'true', 'done this week opens Done');
  // The chips still pick lists, and PO and Clients are chips there too.
  await page.click('[data-filter="*all"]');
  assert.equal(await page.inputValue('#listPickSel'), '*all');
  assert.ok(await page.isVisible('#poBtn') && await page.isVisible('#clientsBtn'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Lists: a card for each task list shows it in Tasks; orders and clients open their sheets', async () => {
  const { ctx, page, errors } = await phone(smallFixture(), { tab: 'lists' });
  const cards = await page.$$eval('#taskListCards .lcard', els => els.map(e => [e.dataset.listCard, e.querySelector('.lcard-name').textContent, e.querySelector('.lcard-n').textContent]));
  assert.deepEqual(cards, [['l_jars', 'JARS', '3'], ['l_pearl', 'Pearl', '2'], ['l_home', 'Home', '3']]);
  assert.match(await page.textContent('#listsPoSub'), /^1 open · 1 late$/);
  assert.equal(await page.textContent('#listsClientsSub'), '1 client');
  // Nothing on the tab is an empty button (the sections still to come aren't shown yet).
  const empty = await page.$$eval('#paneLists button', els => els.filter(b => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label')).length);
  assert.equal(empty, 0);
  await page.click('[data-list-card="l_pearl"]');
  assert.deepEqual(await shownPanels(page), ['paneTasks']);
  assert.equal(await page.textContent('#tasksTitle'), 'Pearl');
  assert.equal((await dump(page)).local['todo.filter'], 'l_pearl');
  const shown = await page.$$eval('#board .sec:not([hidden]) .task', els => els.map(e => e.dataset.id).sort());
  assert.ok(shown.length && shown.every(id => ['t_overdue', 't_wait'].includes(id)), `only Pearl's tasks (${shown})`);
  await page.click('#dockLists');
  await page.click('#listsClients');
  await page.waitForSelector('#clientsSheet.open');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Calendar: it opens on the month, Week is kept only when picked there, a day tapped opens it in Tasks, and "+ New event" is for that day or today', async () => {
  const fx = smallFixture();
  const T = fx.today;
  const { ctx, page, errors } = await phone(fx);
  await page.click('#dockWeek');
  assert.ok(await page.isVisible('#monthGrid'), 'Calendar opens on the month, like the screenshot');
  assert.ok(await page.isHidden('#weekView'));
  assert.equal(await page.getAttribute('[data-cal-mode="month"]', 'aria-pressed'), 'true');
  assert.equal((await dump(page)).local['todo.calMode'], undefined, 'nothing kept just for opening it');
  // "+ New event" with no day picked: a new task for today.
  assert.equal(await page.textContent('#newBtn'), 'New event');
  await page.click('#newBtn');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskDate'), T, 'today');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // Week, picked there: the week to plan, kept for the next time Calendar opens (after a reload too).
  await page.click('[data-cal-mode="week"]');
  assert.ok(await page.isVisible('#weekView .wk-task'), 'the week to plan, one tap away');
  assert.equal((await dump(page)).local['todo.calMode'], 'week');
  await page.click('#dockHome');
  await page.click('#dockWeek');
  assert.ok(await page.isVisible('#weekView .wk-task'), 'Week, as it was picked');
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#weekView .wk-task'), 'and after a reload');
  // The month button on Tasks shows the month without changing the pick.
  await page.click('#dockToday');
  await page.click('#monthBtn');
  assert.deepEqual(await shownPanels(page), ['paneCalendar']);
  assert.ok(await page.isVisible('#monthGrid') && await page.isHidden('#weekView'));
  assert.equal((await dump(page)).local['todo.calMode'], 'week', 'the month button keeps no pick');
  await page.click('[data-cal-mode="month"]');
  assert.equal((await dump(page)).local['todo.calMode'], 'month', 'Month, picked there, is kept');
  // A day tapped: Tasks shows just that day; "+ New event" back on Calendar is for that day.
  const day = addDays(T, 1);
  await page.click(`#monthGrid [data-day="${day}"]`);
  await page.waitForTimeout(300);
  assert.deepEqual(await shownPanels(page), ['paneTasks']);
  assert.ok(await page.isVisible('#dayBar'), 'that day in Tasks');
  await page.click('#dockWeek');
  assert.ok(await page.isVisible('#monthGrid'), 'the month again');
  assert.equal(await page.textContent('#newBtn'), 'New event');
  await page.click('#newBtn');
  await page.waitForSelector('#taskSheet.open');
  assert.equal(await page.inputValue('#taskDate'), day, 'a new task on the day picked');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // The month button on Tasks goes to the Calendar tab, on the month.
  await page.click('#dockToday');
  await page.click('#dayClear');
  await page.click('#monthBtn');
  assert.deepEqual(await shownPanels(page), ['paneCalendar']);
  assert.ok(await page.isVisible('#monthGrid'));
  assert.equal(await page.getAttribute('[data-cal-mode="month"]', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the keyboard: / searches from any tab, N adds what fits the tab', async () => {
  const { ctx, page, errors } = await phone();
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  assert.deepEqual(await shownPanels(page), ['paneTasks']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput');
  await page.click('#dockLists'); // leaving Tasks closes the search
  assert.ok(await page.isHidden('#searchBar'));
  await page.keyboard.press('n');
  await page.waitForSelector('#shopSheet.open'); // a new shopping list
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#dockHome');
  await page.keyboard.press('n');
  await page.waitForSelector('#taskSheet.open');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a new phone: the welcome is on Home, and Start fresh goes on to Tasks', async () => {
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#paneHome #welcome:not([hidden])');
  assert.equal((await dump(page)).local['todo.tab'], undefined);
  await page.click('#welcomeSkip');
  assert.deepEqual(await shownPanels(page), ['paneTasks']);
  assert.ok(await page.isVisible('#quickInput'));
  assert.deepEqual(errors, []);
  await ctx.close();
});
