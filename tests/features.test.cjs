// Feature and bug-fix tests, each on a fresh phone (its own storage). Usage: node --test tests/features.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays, ymd } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
const REPO = path.resolve(__dirname, '..');
// The last version before the Blush look: the other looks must come out of the engine exactly as they did there,
// and that version (on another device, or the website) must treat a Blush pick safely.
const PRE_BLUSH_REF = process.env.PRE_BLUSH_REF || 'f0d6b34';
function checkout(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-old-'));
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['-C', REPO, 'archive', ref], { maxBuffer: 1 << 28 }) });
  return dir;
}
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
  const fx = { today: T, local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1', 'todo.tab': 'tasks' }, blobs: {}, docs: {
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

test('Blush is picked in Settings, saved with the list and comes back; older copies still see Classic', async () => {
  const { ctx, page, errors } = await phone(smallFixture(), { colorScheme: 'light' });
  await page.click('#colorsBtn');
  await page.waitForTimeout(400);
  await page.click('[data-look="blush"]');
  await page.waitForTimeout(200);
  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { look: document.documentElement.dataset.look, mode: document.documentElement.dataset.mode,
      page: cs.getPropertyValue('--page').trim(), head: cs.getPropertyValue('--font-head').trim() };
  });
  let r = await read();
  assert.equal(r.look, 'blush');
  assert.equal(r.mode, 'light');
  assert.equal(r.page, '#FFF8F4');
  assert.match(r.head, /^ui-serif/, 'serif headings');
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(300);
  r = await read();
  assert.equal(r.look, 'blush', 'still Blush after a reload');
  const d = await dump(page);
  assert.equal(d.docs['settings/theme'].look, 'blush');
  assert.equal(d.docs['settings/app'].skin, 'classic', 'an older copy reads Classic');
  assert.equal(d.local['todo.skin'], 'classic');
  // The greeting's name is in the serif, in the greeting color, and it is plain text.
  const greet = await page.evaluate(() => {
    const em = document.querySelector('#briefTitle .greet-name');
    if (!em) return null;
    const hex = c => '#' + c.match(/\d+/g).slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const cs = getComputedStyle(em);
    return { text: em.textContent, title: document.querySelector('#briefTitle').textContent, style: cs.fontStyle, family: cs.fontFamily,
      color: hex(cs.color), want: getComputedStyle(document.documentElement).getPropertyValue('--greet').trim().toUpperCase() };
  });
  assert.ok(greet, 'the greeting shows');
  assert.equal(greet.text, 'Jose');
  assert.match(greet.title, /^Good (morning|afternoon|evening), Jose$/);
  assert.equal(greet.style, 'italic');
  assert.match(greet.family, /^ui-serif/);
  assert.equal(greet.color, greet.want);
  // Cards are see-through, but a row being swiped is solid, so the swipe color can't show through it.
  const solid = await page.evaluate(() => {
    const li = document.querySelector('#board .task');
    const inner = li.querySelector('.task-inner');
    const glass = getComputedStyle(inner).backgroundColor;
    li.classList.add('swiping');
    const swiping = getComputedStyle(inner).backgroundColor;
    li.classList.remove('swiping');
    return { glass, swiping, radius: getComputedStyle(inner).borderTopLeftRadius };
  });
  assert.match(solid.glass, /^rgba\(.*, 0\.\d+\)$/, 'a glass card');
  assert.match(solid.swiping, /^rgb\(/, 'solid while swiping');
  assert.equal(solid.radius, '26px');
  // In the iPhone app, the strip under the clock carries the page's gradient (a plain page color would leave an edge).
  const strip = await page.evaluate(() => {
    document.documentElement.classList.add('ios-app');
    const bg = getComputedStyle(document.body, '::after').backgroundImage;
    document.documentElement.classList.remove('ios-app');
    return bg;
  });
  assert.match(strip, /radial-gradient/);
  // Claude's own light/dark switch moves Blush too.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
  assert.equal((await read()).page, '#181012');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the other looks come out of the engine exactly as before Blush', async () => {
  const html = execFileSync('git', ['-C', REPO, 'show', `${PRE_BLUSH_REF}:index.html`], { maxBuffer: 1 << 28 }).toString();
  const engine = src => src.match(/<script>\n(\/\* Looks:[\s\S]*?)<\/script>/)[1];
  const take = async src => {
    const ctx = await phoneContext(browser);
    const page = await ctx.newPage();
    await page.goto(srv.url + '/__blank');
    await page.addScriptTag({ content: engine(src) });
    const got = await page.evaluate(() => {
      const T = window.todoTheme;
      const out = { themes: T.themes, tokens: {}, previews: {} };
      for (const t of T.themes) {
        for (const mode of ['light', 'dark']) {
          out.previews[`${t.id}/${mode}`] = T.preview(t.id, mode);
          for (const accent of ['', '#FFC53D', '#2563FF', '#B8FF3C', '#7C3AED', '#FF3B30']) out.tokens[`${t.id}/${mode}/${accent}`] = T.tokens(t.id, mode, accent);
        }
      }
      return out;
    });
    await ctx.close();
    return got;
  };
  const before = await take(html);
  const now = await take(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  assert.deepEqual(now.themes.filter(t => before.themes.some(b => b.id === t.id)), before.themes, 'the same looks, in the same order');
  assert.ok(now.themes.some(t => t.id === 'blush' && t.kind === 'tokens' && t.modes.join() === 'dark,light'), 'Blush is a look with light and dark');
  for (const [k, v] of Object.entries(before.tokens)) assert.deepEqual(now.tokens[k], v, `colors unchanged: ${k}`);
  for (const [k, v] of Object.entries(before.previews)) assert.deepEqual(now.previews[k], v, `preview unchanged: ${k}`);
});

test('the Blush preview in Settings shows its gradient', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('#colorsBtn');
  await page.waitForTimeout(400);
  const bg = await page.evaluate(() => [...document.querySelectorAll('#skinGrid [data-look="blush"] .skin-half, #skinGrid [data-look="midnight"] .skin-half')]
    .map(h => `${h.closest('[data-look]').dataset.look}: ${h.style.backgroundImage}`));
  assert.equal(bg.length, 4, 'a light and a dark half each');
  for (const b of bg) {
    if (b.startsWith('blush')) assert.match(b, /radial-gradient/, b);
    else assert.doesNotMatch(b, /gradient/, 'Midnight previews as before');
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the version before Blush opens a list that picked Blush in Classic, and writes nothing', async () => {
  const oldDir = checkout(PRE_BLUSH_REF);
  const old = await serve(oldDir);
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const fx = smallFixture();
  fx.docs['settings/theme'] = { look: 'blush', appearance: 'dark', accent: '', updatedAt: Date.now() - 60000 };
  fx.docs['settings/app'] = { skin: 'classic', updatedAt: Date.now() - 60000 };
  fx.local['todo.theme'] = 'blush';
  try {
    await seed(page, old.url, fx);
    await page.goto(old.url + '/index.html');
    await page.waitForSelector('#board .task', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const root = await page.evaluate(() => ({ look: document.documentElement.dataset.look || null, skin: document.documentElement.dataset.skin || null }));
    assert.deepEqual(root, { look: null, skin: null }, 'Classic (a stylesheet look: no data-look, no data-skin)');
    const d = await dump(page);
    assert.deepEqual(d.docs['settings/theme'], fx.docs['settings/theme'], 'the Blush pick is left as it was');
    assert.deepEqual(d.docs['settings/app'], fx.docs['settings/app']);
    for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d.docs[k], v, `record unchanged: ${k}`);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await old.close();
  }
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
  for (const look of ['classic', 'midnight', 'blush']) { // Blush's serif headings are wider than the condensed Archivo
    const fx = smallFixture();
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    const { ctx, page } = await phone(fx, { viewport: { width: 375, height: 667 } });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.look || 'classic'), look, 'the look is on');
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
    // Hooks a look may leave out: the stylesheet's :root then uses these instead, so they're checked as those.
    const SAME_AS = { '--card-solid': '--card', '--page-tint': '--page', '--pop': '--accent-ink', '--pop-ink': '--accent-ink', '--greet': '--accent-ink' };
    const isHex = v => /^#[0-9A-F]{6}$/i.test(v);
    for (const t of T.themes.filter(x => x.kind === 'tokens')) {
      for (const mode of t.modes) {
        for (const accent of ['', '#FFC53D', '#2563FF', '#B8FF3C']) {
          const k = T.tokens(t.id, mode, accent);
          const tag = `${t.id}/${mode}/${accent || 'own'}`;
          const val = n => (n in k ? k[n] : k[SAME_AS[n]]);
          // Only #RRGGBB can be measured; anything else (a see-through rgba card, a gradient) is a failure, never a pass.
          const check = (a, b, min, what) => {
            const x = val(a), y = val(b);
            if (!isHex(x) || !isHex(y)) { out.push(`${tag}: ${what} can't be measured (${a} ${x}, ${b} ${y})`); return; }
            const c = T.contrast(x, y);
            if (!(c >= min)) out.push(`${tag}: ${what} ${c.toFixed(2)}`);
          };
          // A see-through card (Blush) is measured by the solid color under it, and a gradient page at its deepest point (--page-tint).
          check('--ink', '--page', 7, 'text on page');
          check('--ink', '--card-solid', 7, 'text on card');
          check('--ink', '--page-tint', 7, 'text on the page gradient');
          check('--soft', '--page', 4.5, 'quiet text on page');
          check('--soft', '--card-solid', 4.5, 'quiet text on card');
          check('--soft', '--page-tint', 4.5, 'quiet text on the page gradient');
          check('--on-accent', '--accent', 4.5, 'button text');
          check('--accent-ink', '--page', 4.5, 'accent text on page');
          check('--accent-ink', '--card-solid', 4.5, 'accent text on card');
          check('--accent-ink', '--page-tint', 4.5, 'accent text on the page gradient');
          check('--red', '--card-solid', 4.5, 'overdue text');
          check('--red', '--page', 4.5, 'overdue heading on page');
          check('--red', '--page-tint', 4.5, 'overdue heading on the page gradient');
          check('--toast-fg', '--toast-bg', 4.5, 'toast text');
          check('--toast-action', '--toast-bg', 4.5, 'toast button');
          for (const p of ['--prio-1', '--prio-2', '--prio-3']) check(p, '--card-solid', 3, 'priority mark ' + p);
          // Raspberry labels and the greeting's name are text; hearts and progress bars are marks (3:1).
          for (const g of ['--page', '--card-solid', '--page-tint']) {
            check('--pop-ink', g, 4.5, 'label text on ' + g);
            check('--greet', g, 4.5, 'greeting name on ' + g);
            check('--pop', g, 3, 'heart/progress on ' + g);
          }
          check('--pop', '--wash', 3, 'heart/progress on a beige chip');
        }
      }
    }
    // The look's own hooks are written as #RRGGBB (or are left out and fall back), so nothing above was skipped.
    const b = T.tokens('blush', 'light', '');
    for (const n of ['--card-solid', '--page-tint', '--pop', '--pop-ink', '--greet']) if (!b || !isHex(b[n])) out.push(`blush/light: ${n} is missing`);
    return out;
  });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('the contrast checks above are honest for Blush: its page never goes past --page-tint, its glass cards never past --card-solid', async () => {
  // The page is drawn (page color + gradient) at phone sizes and every pixel measured. In light the deepest point
  // must be no darker than the tint; in dark, no lighter. The see-through card over that point is held to the solid card.
  const src = fs.readFileSync(path.join(APP, 'index.html'), 'utf8').match(/<script>\n(\/\* Looks:[\s\S]*?)<\/script>/)[1];
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  await page.goto(srv.url + '/__blank');
  await page.addScriptTag({ content: src });
  const out = [];
  for (const [w, h] of [[390, 844], [320, 640], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const mode of ['light', 'dark']) {
      const k = await page.evaluate(m => window.todoTheme.tokens('blush', m, ''), mode);
      await page.evaluate(k => { document.body.style.cssText = `margin:0;height:100vh;background:${k['--page-glow']}, ${k['--page']}`; }, k);
      const png = (await page.screenshot()).toString('base64');
      out.push(...await page.evaluate(async ({ png, mode, k, size }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + png;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        const T = window.todoTheme, toHex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
        const glass = k['--card'].match(/[\d.]+/g).map(Number);
        const lum = h => T.contrast(h, '#000000'); // brighter = higher
        const bad = [];
        for (let i = 0; i < d.length; i += 4 * 7) { // every 7th pixel is plenty for a smooth gradient
          const px = [d[i], d[i + 1], d[i + 2]], on = toHex(px), card = toHex(px.map((v, j) => glass[j] * glass[3] + v * (1 - glass[3])));
          const pastTint = mode === 'light' ? lum(on) < lum(k['--page-tint']) : lum(on) > lum(k['--page-tint']);
          const pastCard = mode === 'light' ? lum(card) < lum(k['--card-solid']) : lum(card) > lum(k['--card-solid']);
          if (pastTint) bad.push(`${size} ${mode}: page ${on} is past --page-tint ${k['--page-tint']}`);
          if (pastCard) bad.push(`${size} ${mode}: card ${card} is past --card-solid ${k['--card-solid']}`);
          if (bad.length) break;
        }
        return bad;
      }, { png, mode, k, size: `${w}x${h}` }));
    }
  }
  assert.deepEqual(out, []);
  await ctx.close();
});
