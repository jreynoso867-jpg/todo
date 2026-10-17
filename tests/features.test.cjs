// Feature and bug-fix tests, each on a fresh phone (its own storage). Usage: node --test tests/features.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays, ymd } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with the fixture list on it (or empty), the app open. Collects script errors.
async function phone(fx = smallFixture(), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (o.init) await page.addInitScript(o.init);
  if (fx) await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector(fx ? '#board .task' : '#quickForm:not([hidden]), #welcome:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const titles = page => page.$$eval('#board .task-title, #heroTitle', els => els.map(e => e.textContent.trim()));
const quickAdd = async (page, text) => { await page.fill('#quickInput', text); await page.press('#quickInput', 'Enter'); await page.waitForTimeout(300); };

test('quick add keeps the category being viewed, so the task stays in sight', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('[data-cat-filter="c_calls"]');
  await quickAdd(page, 'Order more gloves');
  assert.ok((await titles(page)).includes('Order more gloves'), 'the new task shows under the category filter');
  const d = await dump(page);
  const t = Object.entries(d.docs).find(([k, v]) => k.startsWith('tasks/') && v.title === 'Order more gloves');
  assert.deepEqual(t[1].cats, ['c_calls']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a monthly task on the 31st comes back on the 31st after February', async () => {
  const { ctx, page } = await phone();
  const tick = async id => { await page.click(`.task[data-id="${id}"] .ring`); await page.waitForTimeout(1300); };
  await tick('t_rent');
  let d = await dump(page);
  const feb = d.docs['tasks/t_rent'].spawnedId;
  assert.equal(d.docs['tasks/' + feb].due, '2027-02-28');
  assert.equal(d.docs['tasks/' + feb].repeatAnchor, 31);
  await tick(feb);
  d = await dump(page);
  const mar = d.docs['tasks/' + feb].spawnedId;
  assert.equal(d.docs['tasks/' + mar].due, '2027-03-31', 'back on the 31st, not stuck on the 28th');
  await ctx.close();
});

test('the first tap on an old checklist item in Up next counts', async () => {
  const T = ymd(new Date());
  const fx = { today: T, local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1' }, blobs: {}, docs: {
    'tasks/old': { title: 'Old checklist', note: '', priority: 0, done: false, due: T, time: null, repeat: null, list: null, pinned: true,
      checklist: [{ text: 'First' }, { text: 'Second' }], createdAt: 1, doneAt: null },
    'tasks/other': { title: 'Another', note: '', priority: 0, done: false, due: T, list: null, checklist: [], createdAt: 2, doneAt: null } } };
  const { ctx, page } = await phone(fx);
  await page.click('#heroCheck [data-item]');
  await page.waitForTimeout(300);
  const d = await dump(page);
  assert.equal(d.docs['tasks/old'].checklist[0].done, true);
  assert.equal(d.docs['tasks/old'].checklist[1].done, false);
  await ctx.close();
});

test('a save the phone turns down leaves no ghost task behind', async () => {
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__failPuts && typeof k === 'string' && k.startsWith('tasks/')) throw new DOMException('Storage is full', 'QuotaExceededError');
      return put.call(this, v, k);
    };
  };
  const { ctx, page } = await phone(smallFixture(), { init });
  await page.evaluate(() => { window.__failPuts = true; });
  await quickAdd(page, 'Ghost task');
  await page.waitForTimeout(400);
  assert.ok(!(await titles(page)).includes('Ghost task'), 'the task that could not be kept is not shown');
  assert.match(await page.textContent('#toastMsg'), /full/i);
  await page.evaluate(() => { window.__failPuts = false; });
  await page.reload();
  await page.waitForSelector('#board .task');
  assert.ok(!(await titles(page)).includes('Ghost task'));
  await ctx.close();
});

test('a task added right before the app closes is still there', async () => {
  // Closing within milliseconds of a save used to lose it about one time in four (the storage hadn't finished);
  // each change is now noted first and put in again on the next start. Five tries in a row.
  const { ctx, page } = await phone();
  for (let i = 1; i <= 5; i++) {
    await page.fill('#quickInput', `Saved before closing ${i}`);
    await page.press('#quickInput', 'Enter');
    await page.reload(); // no waiting at all
    await page.waitForSelector('#board .task');
    await page.waitForTimeout(300);
    const shown = await titles(page);
    for (let k = 1; k <= i; k++) assert.ok(shown.includes(`Saved before closing ${k}`), `try ${i}: task ${k} is there`);
  }
  await page.waitForTimeout(2500); // and it ends up in storage, not just on screen
  const d = await dump(page);
  for (let k = 1; k <= 5; k++) assert.ok(Object.entries(d.docs).some(([key, v]) => key.startsWith('tasks/') && v.title === `Saved before closing ${k}`), `task ${k} stored`);
  assert.equal(d.local['todo.saving'], '[]', 'nothing left waiting');
  await ctx.close();
});

test('a save cut off by closing goes back in only if nothing newer would be written over', async () => {
  // The list can be open on more than one device, so an unfinished save from last time is checked against the item first.
  const fx = smallFixture();
  const D = fx.docs;
  const now = Date.now();
  D['settings/view'] = { ...D['settings/view'], textSize: 'large', updatedAt: now };
  D['tasks/t_walk'] = { ...D['tasks/t_walk'], title: 'Walk the dog A1' }; // the first of two quick edits got in
  const notes = [
    // An update whose fields nobody else touched: it goes in, and another device's edit to the note stays.
    { path: 'tasks/t_overdue', kind: 'update', data: { priority: 1 }, known: true, before: { ...D['tasks/t_overdue'], note: 'an older note' } },
    // A title edited on another device since: the old save is left out.
    { path: 'tasks/t_today_timed', kind: 'update', data: { title: 'Stale title' }, known: true, before: { ...D['tasks/t_today_timed'], title: 'What it said before' } },
    // A new task that never got in.
    { path: 'tasks/t_brandnew', kind: 'set', data: { title: 'Made right before closing', done: false, priority: 0, list: null, checklist: [], createdAt: now }, known: true },
    // A delete of an item unchanged since: it goes in. A delete of an item changed since: it doesn't.
    { path: 'tasks/t_anytime', kind: 'delete', known: true, before: D['tasks/t_anytime'] },
    { path: 'tasks/t_tomorrow', kind: 'delete', known: true, before: { ...D['tasks/t_tomorrow'], title: 'Before someone renamed it' } },
    // Two quick edits: the first got in, the second goes in after it.
    { path: 'tasks/t_walk', kind: 'update', data: { title: 'Walk the dog A1' }, known: true, before: { ...D['tasks/t_walk'], title: 'Walk the dog' } },
    { path: 'tasks/t_walk', kind: 'update', data: { title: 'Walk the dog A12' }, known: true, before: D['tasks/t_walk'] },
    // A settings save older than what's stored: left out.
    { path: 'settings/view', kind: 'set', data: { textSize: 'small', sort: 'smart', gcal: false, updatedAt: now - 60000 }, known: false },
  ];
  fx.local['todo.saving'] = JSON.stringify(notes);
  const { ctx, page, errors } = await phone(fx);
  await page.waitForTimeout(2500);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_overdue'].priority, 1, 'the untouched save went in');
  assert.equal(d.docs['tasks/t_overdue'].note, fx.docs['tasks/t_overdue'].note, 'and nothing else changed');
  assert.equal(d.docs['tasks/t_today_timed'].title, 'Clean Rosa’s Diner', 'the newer title stays');
  assert.equal(d.docs['tasks/t_brandnew'].title, 'Made right before closing');
  assert.equal(d.docs['tasks/t_anytime'], undefined, 'the delete of an unchanged item went in');
  assert.ok(d.docs['tasks/t_tomorrow'], 'an item changed since is not deleted');
  assert.equal(d.docs['tasks/t_walk'].title, 'Walk the dog A12', 'the second quick edit went in after the first');
  assert.equal(d.docs['settings/view'].textSize, 'large', 'the newer settings stay');
  assert.equal(d.local['todo.saving'], '[]', 'every note was looked at');
  const shown = await titles(page);
  assert.ok(shown.includes('Made right before closing') && !shown.includes('Stale title'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('themes, light/dark and the accent are saved and come back', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('#colorsBtn');
  await page.waitForTimeout(400);
  await page.click('[data-look="cyberpunk"]');
  await page.click('[data-appearance="dark"]');
  await page.click('#accentPicks [data-accent="#FFC53D"]');
  await page.waitForTimeout(200);
  const read = () => page.evaluate(() => ({ look: document.documentElement.dataset.look, theme: document.documentElement.dataset.theme,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }));
  assert.deepEqual(await read(), { look: 'cyberpunk', theme: 'dark', accent: '#FFC53D' });
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(300);
  assert.deepEqual(await read(), { look: 'cyberpunk', theme: 'dark', accent: '#FFC53D' });
  const d = await dump(page);
  assert.equal(d.docs['settings/theme'].look, 'cyberpunk');
  // An original orange look still works, and is always light.
  await page.click('#colorsBtn');
  await page.waitForTimeout(300);
  await page.click('[data-look="orange-bg"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'orange-bg');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('"System" follows the light/dark switch of an app it is opened in', async () => {
  // Claude marks the page with data-theme when its own switch is set to light or dark, and takes it away for "System".
  const { ctx, page, errors } = await phone(smallFixture(), { colorScheme: 'light' });
  const mode = () => page.evaluate(() => document.documentElement.dataset.mode);
  assert.equal(await mode(), 'light');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'light' && document.documentElement.dataset.theme === 'light');
  // A light pick made here beats the other app's dark.
  await page.click('#colorsBtn');
  await page.waitForTimeout(300);
  await page.click('[data-appearance="light"]');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  assert.equal(await mode(), 'light');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('views show one kind of task, and the pick is remembered', async () => {
  const { ctx, page } = await phone();
  await page.click('[data-scope="overdue"]');
  const shown = () => page.$$eval('#board .sec:not([hidden])', els => els.map(e => e.dataset.sec));
  assert.deepEqual(await shown(), ['overdue']);
  assert.equal(await page.isHidden('#hero'), true);
  await page.reload();
  await page.waitForSelector('#board .task');
  assert.deepEqual(await shown(), ['overdue']);
  // Adding a task while a view would hide it switches to where it went.
  await quickAdd(page, 'Due today from overdue view');
  assert.equal(await page.getAttribute('[data-scope="today"]', 'aria-pressed'), 'true');
  await page.click('[data-scope="done"]');
  assert.deepEqual(await shown(), ['done']);
  assert.ok(await page.isVisible('#doneList'));
  await ctx.close();
});

test('deadlines count down on the rows and on Up next', async () => {
  const { ctx, page } = await phone();
  const cd = id => page.textContent(`.task[data-id="${id}"] .cd`);
  assert.match(await cd('t_overdue'), /^2 days late$/);
  assert.match(await cd('t_tomorrow'), /^in (\d+d )?\d+h( \d+m)?$|^in \d+m$/);
  assert.match(await page.textContent('#heroCdTime'), /^\d\d:\d\d:\d\d$/);
  const a = await page.textContent('#heroCdTime');
  await page.waitForFunction(was => document.querySelector('#heroCdTime').textContent !== was, a, { timeout: 5000 }); // it ticks
  // Turned off in Settings, they go away.
  await page.click('#colorsBtn');
  await page.waitForSelector('#colorsSheet.open');
  await page.click('[data-pref="countdowns"]');
  await page.waitForSelector('[data-pref="countdowns"][aria-checked="false"]');
  await page.click('#colorsDone');
  await page.waitForTimeout(400);
  assert.equal(await page.$('.task .cd'), null);
  assert.equal(await page.isHidden('#heroCd'), true);
  await ctx.close();
});

test('a focus session keeps running through a reload', async () => {
  const { ctx, page } = await phone();
  await page.click('#heroFocus');
  await page.click('[data-focus-min="15"]');
  await page.click('#focusStart');
  await page.waitForTimeout(1100);
  assert.match(await page.textContent('#focusTime'), /^14:5\d$/);
  await page.keyboard.press('Escape');
  assert.ok(await page.isVisible('#focusPill'));
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(1100);
  assert.ok(await page.isVisible('#focusPill'), 'still running after the reload');
  await page.click('#focusPill');
  await page.click('#focusEnd');
  assert.ok(await page.isHidden('#focusPill'));
  await ctx.close();
});

test('safety copies: the upgrade copy can put a deleted task back', async () => {
  const { ctx, page } = await phone();
  await page.waitForTimeout(600); // the first-run copy is written
  await page.click('.task[data-id="t_wait"] .task-body');
  await page.click('#sheetDelete');
  await page.waitForTimeout(500);
  assert.ok(!(await titles(page)).includes('Quote from Home Depot'));
  await page.click('#colorsBtn');
  await page.waitForSelector('#snapRows [data-snap]');
  const btn = '#snapRows [data-snap^="snap:upgrade:"]';
  await page.click(btn);
  await Promise.all([page.waitForEvent('load'), page.click(btn)]);
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(400);
  assert.ok((await titles(page)).includes('Quote from Home Depot'), 'the task is back');
  const d = await dump(page);
  assert.ok(Object.keys(d.blobs).some(k => k.startsWith('snap:restore:')), 'what was there before the put-back was copied too');
  await ctx.close();
});

test('opens with no connection once it has been opened before', async () => {
  const { ctx, page } = await phone(smallFixture(), { sw: true });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#board .task', { timeout: 10000 });
  assert.ok((await titles(page)).includes('Clean Rosa’s Diner'));
  await ctx.close();
});

test('a new phone with an empty list', async () => {
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#welcome:not([hidden])');
  await page.click('#welcomeSkip');
  await quickAdd(page, 'First task');
  assert.ok((await titles(page)).includes('First task'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('save everything to a file, load it on another phone', async () => {
  const a = await phone();
  await a.page.click('#colorsBtn');
  await a.page.waitForTimeout(300);
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#exportAll')]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-export-')), 'export.json');
  await dl.saveAs(file);
  const before = (await dump(a.page)).docs;
  await a.ctx.close();
  const b = await phone(null);
  await b.page.click('#welcomeLoad').catch(() => {});
  await b.page.setInputFiles('#importInput', file);
  await b.page.waitForFunction(() => /Loaded/.test(document.querySelector('#moveStatus').textContent), null, { timeout: 20000 });
  const after = (await dump(b.page)).docs;
  for (const [k, v] of Object.entries(before)) {
    if (!k.startsWith('tasks/') || v.sample) continue;
    const { gcal, photos, ...rest } = v;
    const got = after[k];
    assert.ok(got, `task came over: ${k}`);
    const { photos: p2, ...rest2 } = got;
    assert.deepEqual(rest2, rest, `task unchanged: ${k}`);
    assert.equal((p2 || []).length, (photos || []).length, `its photos came too: ${k}`);
  }
  await b.ctx.close();
});

test('the largest text fits a small iPhone without sideways scrolling', async () => {
  for (const look of ['classic', 'midnight']) {
    const fx = smallFixture();
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    const { ctx, page } = await phone(fx, { viewport: { width: 375, height: 667 } });
    const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${look}: ${over}px too wide`);
    await page.click('#colorsBtn');
    await page.waitForTimeout(300);
    const sheetOver = await page.evaluate(() => { const s = document.querySelector('#colorsSheet'); return s.scrollWidth - s.clientWidth; });
    assert.ok(sheetOver <= 0, `${look} settings: ${sheetOver}px too wide`);
    await ctx.close();
  }
});

test('every theme reads clearly (WCAG contrast)', async () => {
  const { ctx, page } = await phone();
  const problems = await page.evaluate(() => {
    const T = window.todoTheme;
    const out = [];
    for (const t of T.themes.filter(x => x.kind === 'tokens')) {
      for (const mode of t.modes) {
        for (const accent of ['', '#FFC53D', '#2563FF', '#B8FF3C']) {
          const k = T.tokens(t.id, mode, accent);
          const check = (a, b, min, what) => { const c = T.contrast(k[a], k[b]); if (c < min) out.push(`${t.id}/${mode}/${accent || 'own'}: ${what} ${c.toFixed(2)}`); };
          check('--ink', '--page', 7, 'text on page');
          check('--ink', '--card', 7, 'text on card');
          check('--soft', '--page', 4.5, 'quiet text on page');
          check('--soft', '--card', 4.5, 'quiet text on card');
          check('--on-accent', '--accent', 4.5, 'button text');
          check('--accent-ink', '--page', 4.5, 'accent text on page');
          check('--accent-ink', '--card', 4.5, 'accent text on card');
          check('--red', '--card', 4.5, 'overdue text');
          check('--toast-fg', '--toast-bg', 4.5, 'toast text');
          check('--toast-action', '--toast-bg', 4.5, 'toast button');
          for (const p of ['--prio-1', '--prio-2', '--prio-3']) check(p, '--card', 3, 'priority mark ' + p);
        }
      }
    }
    return out;
  });
  assert.deepEqual(problems, []);
  await ctx.close();
});
