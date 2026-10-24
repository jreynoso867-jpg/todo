// Problems found by the October review, each shown failing before its fix. Usage: node --test tests/fixes.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { serve, smallFixture, launch, phoneContext, seed, dump, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function phone(fx = smallFixture(), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (o.init) await page.addInitScript(o.init);
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const tap = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const toastText = page => page.textContent('#toastMsg');

test('unchecking a repeating task takes back an untouched next copy, into Recently deleted', async () => {
  const fx = smallFixture();
  fx.local['todo.showDone'] = '1';
  const { ctx, page, errors } = await phone(fx);
  await tap(page, '.task[data-id="t_walk"] .ring');
  await page.waitForTimeout(800);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_walk'].done, false);
  assert.equal(d.docs['tasks/t_walk_next'], undefined, 'the copy nobody touched is taken back');
  assert.equal(d.docs['trash/t_walk_next'].task.title, 'Morning walk', 'and it can still be restored');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('unchecking a repeating task keeps a next copy that has your changes', async () => {
  const fx = smallFixture();
  fx.local['todo.showDone'] = '1';
  fx.docs['tasks/t_walk_next'] = { ...fx.docs['tasks/t_walk_next'], note: 'Take the long way, the park path is closed' };
  const { ctx, page, errors } = await phone(fx);
  await tap(page, '.task[data-id="t_walk"] .ring');
  await page.waitForTimeout(800);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_walk'].done, false);
  assert.equal(d.docs['tasks/t_walk_next'].note, 'Take the long way, the park path is closed', 'the edited copy stays');
  assert.match(await toastText(page), /stays/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a repeating purchase order marked received makes next time\'s', async () => {
  const fx = smallFixture();
  const T = fx.today;
  fx.docs['tasks/t_po_rep'] = { title: 'Monthly glove order', note: '', priority: 0, done: false, due: T, time: null, repeat: 'monthly',
    list: 'l_pearl', checklist: [], createdAt: Date.now() - 5e6, doneAt: null,
    po: { number: '5120', vendor: 'ABC Supply', eta: T, status: 'ordered', late: null } };
  const { ctx, page, errors } = await phone(fx);
  await page.click('#poBtn');
  await page.waitForSelector('#poBody .card-row[data-id="t_po_rep"] [data-po-received]');
  await page.click('#poBody .card-row[data-id="t_po_rep"] [data-po-received]');
  await page.waitForTimeout(800);
  const d = await dump(page);
  const done = d.docs['tasks/t_po_rep'];
  assert.equal(done.done, true);
  assert.ok(done.spawnedId, 'it points at the next one');
  const next = d.docs['tasks/' + done.spawnedId];
  assert.equal(next.title, 'Monthly glove order');
  assert.ok(next.due > T, 'next month');
  assert.equal(next.done, false);
  assert.equal(next.po, undefined, 'a new order starts without the old PO');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the next copy of a repeating job keeps its client', async () => {
  const fx = smallFixture();
  fx.docs['tasks/t_today_timed'] = { ...fx.docs['tasks/t_today_timed'], repeat: 'weekly' };
  const { ctx, page, errors } = await phone(fx);
  await tap(page, '#heroOpen:not([disabled]) ~ * #heroDone, #heroDone');
  await page.waitForTimeout(800);
  let d = await dump(page);
  let job = d.docs['tasks/t_today_timed'];
  if (!job.done) { // it wasn't the Up next card on this run: check it off from its row
    await tap(page, '.task[data-id="t_today_timed"] .ring');
    await page.waitForTimeout(800);
    d = await dump(page);
    job = d.docs['tasks/t_today_timed'];
  }
  assert.equal(job.done, true);
  assert.equal(d.docs['tasks/' + job.spawnedId].client, 'cl_rosa');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Clear done in a day view clears only that day\'s done tasks', async () => {
  const fx = smallFixture();
  const T = fx.today;
  fx.docs['tasks/t_done_tomorrow'] = { title: 'Pick up supplies', note: '', priority: 0, done: true, doneAt: Date.now() - 6e5, due: addDays(T, 1),
    time: null, repeat: null, list: 'l_jars', checklist: [], createdAt: Date.now() - 9e6 };
  fx.local['todo.showDone'] = '1';
  const { ctx, page, errors } = await phone(fx);
  await page.click(`#week [data-day="${addDays(T, 1)}"]`);
  await page.waitForTimeout(300);
  await page.click('#clearDone');
  await page.waitForTimeout(800);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_done_tomorrow'], undefined, 'that day\'s done task is cleared');
  assert.ok(d.docs['tasks/t_done_old'], 'a done task from another day stays');
  assert.ok(d.docs['tasks/t_walk'], 'today\'s done task stays');
  assert.match(await toastText(page), /Cleared 1 done task/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a delete whose Recently deleted copy can\'t be kept leaves the task where it is', async () => {
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__failTrash && typeof k === 'string' && k.startsWith('trash/')) throw new DOMException('Storage is full', 'QuotaExceededError');
      return put.call(this, v, k);
    };
  };
  const { ctx, page, errors } = await phone(smallFixture(), { init });
  await page.evaluate(() => { window.__failTrash = true; });
  await page.click('.task[data-id="t_anytime"] .task-body');
  await page.click('#sheetDelete');
  await page.waitForTimeout(900);
  const d = await dump(page);
  assert.ok(d.docs['tasks/t_anytime'], 'the task is still there');
  assert.equal(d.docs['trash/t_anytime'], undefined);
  assert.match(await toastText(page), /wasn’t deleted/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a delete that had to wait keeps the task when its Recently deleted copy is then turned down', async () => {
  // The storage busy for trash/ keys (the copy waits on the phone, and the delete behind it), then full (turned down).
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      const f = window.__fault;
      if (f && typeof k === 'string' && k.startsWith('trash/')) throw new DOMException('No room', f.full ? 'QuotaExceededError' : 'UnknownError');
      return put.call(this, v, k);
    };
  };
  const fx = smallFixture();
  const { ctx, page, errors } = await phone(fx, { init });
  const before = (await dump(page)).docs;
  await page.evaluate(() => { window.__fault = {}; });
  await page.click('.task[data-id="t_anytime"] .task-body');
  await page.click('#sheetDelete');
  // and two more at once, from Select
  await page.click('#selectBtn');
  await page.click('.task[data-id="t_wait"] .ring');
  await page.click('.task[data-id="t_unicode"] .ring');
  await page.click('[data-sel="delete"]');
  await page.waitForFunction(() => /"tasks\/t_unicode"/.test(localStorage.getItem('todo.outbox') || ''), null, { timeout: 8000 });
  const out = JSON.parse(await page.evaluate(() => localStorage.getItem('todo.outbox'))).map(o => `${o.kind} ${o.path}`);
  for (const id of ['t_anytime', 't_wait', 't_unicode']) assert.ok(out.indexOf(`set trash/${id}`) >= 0 && out.indexOf(`set trash/${id}`) < out.indexOf(`delete tasks/${id}`), `the copy waits ahead of the delete: ${id}`);
  assert.equal(await page.$('.task[data-id="t_anytime"]'), null, 'gone from the list while it waits');
  await page.evaluate(() => { window.__fault.full = true; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => localStorage.getItem('todo.outbox') === '[]', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const d = await dump(page);
  for (const [k, v] of Object.entries(before)) if (!k.startsWith('history/')) assert.deepEqual(d.docs[k], v, `kept exactly as it was: ${k}`);
  for (const id of ['t_anytime', 't_wait', 't_unicode']) assert.equal(d.docs['trash/' + id], undefined);
  assert.match(await toastText(page), /Couldn’t keep a copy in Recently deleted, so 3 things weren’t deleted/);
  assert.ok(await page.$('.task[data-id="t_anytime"]'), 'back on the list');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a new version of the app takes a safety copy first, even after the day\'s copy', async () => {
  const fx = smallFixture();
  const day = new Date();
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  fx.local['todo.version'] = '2.0.0';
  fx.local['todo.snapLast'] = JSON.stringify({ day: ymd, hash: 'whatever' });
  const { ctx, page, errors } = await phone(fx);
  await page.waitForTimeout(1500);
  const d = await dump(page);
  assert.equal(Object.keys(d.blobs).filter(k => k.startsWith('snap:upgrade:')).length, 1, 'one copy from before the update');
  assert.notEqual(d.local['todo.version'], '2.0.0', 'and the new version is noted');
  assert.deepEqual(errors, []);
  await ctx.close();
});

const findTask = (d, title) => Object.entries(d.docs).find(([k, v]) => k.startsWith('tasks/') && v && v.title === title);
const quickAdd = async (page, text) => { await page.fill('#quickInput', text); await page.press('#quickInput', 'Enter'); await page.waitForTimeout(400); };

test('smart add reads a time range with minutes ("8:30-10") and leaves "3-5 boxes" alone', async () => {
  const { ctx, page, errors } = await phone();
  await quickAdd(page, 'Inventory 8:30-10');
  await quickAdd(page, 'Bring 3-5 boxes');
  const d = await dump(page);
  const inv = findTask(d, 'Inventory');
  assert.ok(inv, 'saved as "Inventory"');
  assert.equal(inv[1].time, '08:30');
  assert.equal(inv[1].end, '10:00');
  const boxes = findTask(d, 'Bring 3-5 boxes');
  assert.ok(boxes && !boxes[1].time, 'no time read from a count');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a job that is under way isn\'t called late (Up next, and a night job\'s row)', async () => {
  const fx = smallFixture();
  const T = fx.today;
  delete fx.docs['tasks/t_overdue'];
  fx.docs['tasks/t_today_untimed'] = { ...fx.docs['tasks/t_today_untimed'], pinned: false };
  fx.docs['tasks/t_night'] = { title: 'Night clean at the grill', note: '', priority: 0, done: false, due: T, time: '23:00', end: '02:00',
    repeat: null, list: 'l_jars', checklist: [], createdAt: Date.now() - 4e6, doneAt: null };
  const [y, m, dd] = T.split('-').map(Number);
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(y, m - 1, dd, 16, 0) });
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(400);
  assert.match(await page.textContent('#heroWhen'), /^Due today/, 'the 3-5 PM job at 4 PM');
  await page.clock.setFixedTime(new Date(y, m - 1, dd, 23, 30));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  const late = await page.$eval('.task[data-id="t_night"] .task-meta', el => !!el.querySelector('.late'));
  assert.equal(late, false, 'the 11 PM-2 AM job at 11:30 PM');
  await ctx.close();
});

test('a tick in an open task\'s checklist is kept at once, like on Up next', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('.task[data-id="t_today_timed"] .task-body');
  await page.waitForSelector('#taskSheet.open');
  await page.click('#checkList [data-item="a2"] .check-box');
  await page.waitForTimeout(400);
  await page.click('#sheetCancel');
  await page.waitForTimeout(500);
  assert.ok(await page.isHidden('#taskSheet'), 'one tap on Cancel closes it (nothing unsaved)');
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_today_timed'].checklist.find(i => i.id === 'a2').done, true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a new PO saves with just its number and vendor, and isn\'t due today', async () => {
  const { ctx, page, errors } = await phone();
  await page.click('#poBtn');
  await page.click('#poNew');
  await page.waitForSelector('#taskSheet.open');
  await page.fill('#poNumber', '5520');
  await page.fill('#poVendor', 'Sysco');
  await page.click('#sheetSubmit');
  await page.waitForTimeout(600);
  const po = findTask(await dump(page), 'PO 5520 · Sysco');
  assert.ok(po, 'saved, named after the PO');
  assert.equal(po[1].due, null, 'no due date: it comes back to Today if it\'s late');
  assert.equal(po[1].po.number, '5520');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Up next offers the follow-up without Claude, and the ready-made one to a vendor names just the PO', async () => {
  const fx = smallFixture();
  fx.docs['tasks/t_today_untimed'] = { ...fx.docs['tasks/t_today_untimed'], pinned: false };
  const { ctx, page, errors } = await phone(fx);
  assert.ok(await page.isVisible('#heroNudge'), 'Write follow-up shows on the website');
  await page.click('#heroNudge');
  await page.waitForSelector('#nudgeDraft:not([hidden])');
  const body = await page.inputValue('#nudgeBody');
  assert.match(body, /PO 4471/);
  assert.ok(!body.includes('Call ABC Supply about'), 'not his note to himself');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the spreadsheet link says what it makes, and Today in the dock leaves the Done view', async () => {
  const fx = smallFixture();
  fx.local['todo.scope'] = 'done';
  const { ctx, page, errors } = await phone(fx);
  assert.equal((await page.textContent('#backupBtn')).trim(), 'Save as a spreadsheet');
  await page.click('#dockToday');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => localStorage.getItem('todo.scope')), 'all');
  assert.ok(await page.isVisible('#hero'), 'Up next is back');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('New job on a client that already has one today opens that job instead of making a second', async () => {
  const fx = smallFixture();
  fx.docs['tasks/t_today_timed'] = { ...fx.docs['tasks/t_today_timed'] }; // Rosa's job today, from the fixture
  const { ctx, page, errors } = await phone(fx);
  await page.click('#clientsBtn');
  await page.click('#clientRows [data-client="cl_rosa"] [data-client-job]');
  await page.waitForTimeout(600);
  const d = await dump(page);
  const jobs = Object.entries(d.docs).filter(([k, v]) => k.startsWith('tasks/') && v.client === 'cl_rosa' && v.due === fx.today && !v.done);
  assert.equal(jobs.length, 1, 'still one job today');
  assert.match(await page.textContent('#toastMsg'), /already has a job today/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Contrast of two computed CSS colors (rgb()/rgba(), alpha laid over white), as WCAG defines it.
const CONTRAST = `(() => {
  const parse = c => { const m = c.match(/[\\d.]+/g).map(Number); const a = m.length > 3 ? m[3] : 1; return m.slice(0, 3).map(v => v * a + 255 * (1 - a)); };
  const lum = c => { const [r, g, b] = parse(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  return (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
})()`;

test('Mark done on an Up next card with no list reads clearly in every look, mode and accent', async () => {
  const fx = smallFixture();
  delete fx.docs['tasks/t_overdue'];
  fx.docs['tasks/t_today_timed'] = { ...fx.docs['tasks/t_today_timed'], due: addDays(fx.today, 1) };
  fx.docs['tasks/t_today_untimed'] = { ...fx.docs['tasks/t_today_untimed'], list: null, pinned: false };
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.evaluate(() => document.querySelector('#hero').dataset.id), 't_today_untimed');
  const bad = await page.evaluate(async src => {
    const contrast = eval(src);
    const out = [];
    for (const t of window.todoTheme.themes.filter(x => x.kind !== 'skin')) {
      for (const mode of t.modes) {
        for (const accent of ['', '#FFC53D', '#B8FF3C', '#2563FF']) {
          window.todoTheme.set({ look: t.id, appearance: mode, accent });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cs = getComputedStyle(document.querySelector('#heroDone'));
          const c = contrast(cs.color, cs.backgroundColor);
          if (c < 4.5) out.push(`${t.id}/${mode}/${accent || 'own'} ${c.toFixed(2)}`);
        }
      }
    }
    return out;
  }, CONTRAST);
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the red overdue counts read clearly in every look and mode', async () => {
  const { ctx, page, errors } = await phone();
  const bad = await page.evaluate(async src => {
    const contrast = eval(src);
    const out = [];
    for (const t of window.todoTheme.themes.filter(x => x.kind !== 'skin')) {
      for (const mode of t.modes) {
        window.todoTheme.set({ look: t.id, appearance: mode, accent: '' });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        for (const sel of ['.sec[data-sec="overdue"] .count', '#todayBadge']) {
          const el = document.querySelector(sel);
          if (!el || !el.textContent) continue;
          const cs = getComputedStyle(el);
          const c = contrast(cs.color, cs.backgroundColor);
          if (c < 4.5) out.push(`${t.id}/${mode} ${sel} ${c.toFixed(2)}`);
        }
      }
    }
    return out;
  }, CONTRAST);
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('at Extra large text on a small iPhone, nothing on the Up next card is cut off', async () => {
  for (const look of [null, 'blush']) { // the list's own look (Classic here), and Blush with its wider serif title
    const fx = smallFixture();
    fx.local['todo.textSize'] = 'xl';
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    if (look) fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    const { ctx, page, errors } = await phone(fx, { viewport: { width: 320, height: 640 } });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.look || null), look);
    const over = await page.evaluate(() => {
      const hero = document.querySelector('#hero');
      const box = hero.getBoundingClientRect();
      const right = box.right - parseFloat(getComputedStyle(hero).paddingRight) + 0.5;
      return [...hero.querySelectorAll('*')].filter(el => el.offsetParent && el.getClientRects().length)
        .filter(el => el.getBoundingClientRect().right > right && !el.closest('.hero-title'))
        .map(el => `${el.id || el.className}: ${Math.round(el.getBoundingClientRect().right - right)}px`);
    });
    assert.deepEqual(over, [], look || 'own look');
    const pageOver = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(pageOver <= 0, `${look || 'own look'}: ${pageOver}px too wide`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('VoiceOver and keyboard: focus moves on after a check-off, a toast waits while focused, and the badge says what it counts', async () => {
  const { ctx, page, errors } = await phone();
  assert.match(await page.getAttribute('#dockToday', 'aria-label'), /overdue/);
  const first = await page.$eval('#board .sec:not([hidden]) .task', li => li.dataset.id);
  await page.focus(`.task[data-id="${first}"] .ring`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const where = await page.evaluate(() => {
    const a = document.activeElement;
    return a && a.classList.contains('ring') ? a.closest('.task').dataset.id : (a ? a.tagName : 'none');
  });
  assert.ok(where !== 'BODY' && where !== first, `focus went to ${where}`);
  await page.focus('#toastUndo');
  await page.waitForTimeout(7000);
  assert.ok(await page.evaluate(() => document.querySelector('#toast').classList.contains('show')), 'the toast stays while focused');
  await page.focus('#quickInput');
  await page.waitForTimeout(6500); // an Undo toast gets its full 6 seconds again once let go
  assert.ok(await page.evaluate(() => !document.querySelector('#toast').classList.contains('show')), 'and goes once let go');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the passcode keypad says how many digits are in, and a lockout is announced once', async () => {
  const { ctx, page, errors } = await phone();
  const keys = async code => { for (const k of code) await page.click(`.pl-key[data-k="${k}"]`); await page.waitForTimeout(250); };
  await page.click('#colorsBtn');
  await page.click('#lockOn');
  await keys('135792');
  await keys('135792');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('.pl-key');
  await page.click('.pl-key[data-k="1"]');
  await page.click('.pl-key[data-k="3"]');
  assert.equal(await page.getAttribute('.pl-dots', 'aria-label'), '2 of 6 digits entered');
  await page.click('.pl-key[data-k="del"]');
  await page.click('.pl-key[data-k="del"]');
  for (let i = 0; i < 5; i++) await keys('000000');
  await page.waitForTimeout(400);
  const lock = await page.evaluate(() => ({ msgLive: document.querySelector('.pl-msg').getAttribute('aria-live'), msg: document.querySelector('.pl-msg').textContent,
    said: [...document.querySelectorAll('.pl-box [aria-live="polite"]')].map(e => e.textContent).join(' | ') }));
  assert.equal(lock.msgLive, 'off', 'the ticking clock is not read out');
  assert.match(lock.msg, /Try again in \d+:\d\d/);
  assert.match(lock.said, /Try again in about a minute|Try again in \d+ minutes/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// In the page: the contrast of an element's words (or of a color given) with what's really under them. See-through fills
// (the element's own, its card's glass) are laid over the first solid fill under them; under them all, the look's page,
// at its lightest and at its deepest (--page and --page-tint: Blush's page is a gradient). The lowest of those. Colors
// are read by painting them, so any way the browser writes one (rgba, color(srgb …), a color-mix) is measured.
const SEEN = `(() => {
  const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const rgba = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const seen = (el, color) => {
    const root = getComputedStyle(document.documentElement);
    const layers = [];
    let base = null;
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] === 0) continue;
      if (c[3] >= 0.999) { base = [c.slice(0, 3)]; break; }
      layers.push(c);
    }
    if (!base) base = [rgba(root.getPropertyValue('--page')).slice(0, 3), rgba(root.getPropertyValue('--page-tint')).slice(0, 3)];
    const fg = rgba(color || getComputedStyle(el).color);
    return Math.min(...base.map(b => { const ground = layers.reduceRight((g, l) => over(l, g), b); return ratio(over(fg, ground), ground); }));
  };
  seen.rgba = rgba;
  return seen;
})()`;
// A phone on a fixed day and time (Friday, Oct 16 2026, 10:00), in a look, opened on a tab.
async function lookPhone(look, mode, tab, o = {}) {
  const fx = smallFixture('2026-10-16');
  fx.docs['settings/theme'] = { look, appearance: mode, accent: '' };
  fx.local['todo.tab'] = tab;
  const ctx = await phoneContext(browser, { colorScheme: mode });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: new Date(2026, 9, 16, o.hour || 10, 0) });
  await seed(page, (o.srv || srv).url, fx);
  await page.goto((o.srv || srv).url + '/index.html');
  await page.waitForSelector('#dock:not([hidden])', { timeout: 20000 });
  // Colors are read the moment they're set (a look switched, a list color tried): no fading from one to the next.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

test('the red "late" words read clearly where they show: Classic light (Home, Lists, the Calendar) and Blush dark\'s late countdown; other looks keep their red', async () => {
  const red = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim());
  const check = async (page, sels) => page.evaluate(([src, sels]) => {
    const seen = eval(src);
    return sels.map(s => { const el = document.querySelector(s); return el && el.offsetParent ? [s, Math.round(seen(el) * 100) / 100, getComputedStyle(el).color] : [s, 'missing']; });
  }, [SEEN, sels]);
  // Classic, light: the new late labels.
  let { ctx, page, errors } = await lookPhone('classic', 'light', 'home');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.look || 'classic'), 'classic');
  const got = [...await check(page, ['#homeDueRows .hr-when.late'])];
  await page.click('#dockLists');
  got.push(...await check(page, ['#listsPoSub.late']));
  await page.click('#dockWeek');
  got.push(...await check(page, ['#monthAll .ma-side.late']));
  for (const [s, c] of got) assert.ok(c >= 4.5, `Classic light: ${s} ${c}`);
  assert.deepEqual(errors, []);
  await ctx.close();
  // Blush, dark: a late countdown on a task's row.
  ({ ctx, page, errors } = await lookPhone('blush', 'dark', 'tasks'));
  const [[, c]] = await check(page, ['#board .cd.late']);
  assert.ok(c >= 4.5, `Blush dark: the late countdown ${c}`);
  assert.deepEqual(errors, []);
  await ctx.close();
  // Elsewhere these stay the look's own red.
  for (const [look, mode, tab, sels] of [['blush', 'light', 'tasks', ['#board .cd.late']], ['midnight', 'dark', 'home', ['#homeDueRows .hr-when.late']], ['classic', 'dark', 'home', ['#homeDueRows .hr-when.late']]]) {
    ({ ctx, page, errors } = await lookPhone(look, mode, tab));
    const want = await page.evaluate(([src, r]) => eval(src).rgba(r).join(), [SEEN, await red(page)]);
    for (const [s, , color] of await check(page, sels)) assert.equal(await page.evaluate(([src, c]) => eval(src).rgba(c).join(), [SEEN, color]), want, `${look} ${mode}: ${s} in --red`);
    await ctx.close();
  }
});

test('Blush light: the list names on task rows read clearly on the see-through cards', async () => {
  const { ctx, page, errors } = await lookPhone('blush', 'light', 'tasks');
  const bad = await page.evaluate(src => {
    const seen = eval(src);
    const out = [];
    const rows = [...document.querySelectorAll('#board .task-meta .list-name')].filter(e => e.offsetParent);
    // Every list color, on the first row with a list name.
    const li = rows[0].closest('.task');
    for (let n = 1; n <= 10; n++) {
      for (let i = 0; i <= 10; i++) li.classList.toggle('c' + i, i === n);
      const c = seen(rows[0]);
      if (!(c >= 4.5)) out.push(`list color ${n}: ${c.toFixed(2)}`);
    }
    return out;
  }, SEEN);
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Blush: the kickoff card has a thin raspberry edge, not a heavy black one; other looks keep theirs', async () => {
  const edge = page => page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#brief'), '::before');
    const root = getComputedStyle(document.documentElement);
    return { width: cs.width, color: cs.backgroundColor, image: cs.backgroundImage, pop: root.getPropertyValue('--pop').trim() };
  });
  for (const mode of ['light', 'dark']) {
    const { ctx, page, errors } = await lookPhone('blush', mode, 'home');
    assert.ok(await page.isVisible('#brief'));
    const e = await edge(page);
    assert.equal(e.width, '4px', mode);
    assert.equal(e.image, 'none', `${mode}: no gradient`);
    assert.equal(await page.evaluate(([src, a, b]) => eval(src).rgba(a).join() === eval(src).rgba(b).join(), [SEEN, e.color, e.pop]), true, `${mode}: raspberry (${e.color} vs ${e.pop})`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  for (const [look, mode] of [['classic', 'light'], ['midnight', 'dark']]) {
    const { ctx, page } = await lookPhone(look, mode, 'home');
    const e = await edge(page);
    assert.equal(e.width, '5px', look);
    assert.match(e.image, /gradient/, `${look}: the look's gradient, as before`);
    await ctx.close();
  }
});

// The version before these fixes: Up next in every other look must come out exactly as it did there.
const PRE_UX_REF = process.env.PRE_UX_REF || 'a5f07f6';
test('Up next in Blush: a soft card in its list\'s tone, everything on it clear for list colors 1-10 in light and dark; other looks\' Up next unchanged', async () => {
  for (const mode of ['light', 'dark']) {
    const { ctx, page, errors } = await lookPhone('blush', mode, 'tasks');
    const out = await page.evaluate(src => {
      const seen = eval(src);
      const hero = document.querySelector('#hero');
      const root = getComputedStyle(document.documentElement);
      const bad = [];
      const looks = [];
      for (let n = 1; n <= 10; n++) {
        for (let i = 0; i <= 10; i++) hero.classList.toggle('c' + i, i === n);
        const cs = getComputedStyle(hero);
        looks.push([n, seen.rgba(cs.color).join() === seen.rgba(root.getPropertyValue('--head')).join(), seen.rgba(cs.backgroundColor)[3] < 1,
          seen.rgba(getComputedStyle(document.querySelector('#heroDone')).backgroundColor).join() === seen.rgba(root.getPropertyValue('--accent')).join()]);
        // Every word showing on the card, on what's under it (its own pill, the card, the page).
        const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
        for (let t; (t = walker.nextNode());) {
          const el = t.parentElement;
          if (!t.textContent.trim() || !el.offsetParent || el.closest('[hidden], svg')) continue;
          const c = seen(el);
          if (!(c >= 4.5)) bad.push(`color ${n}: "${t.textContent.trim().slice(0, 30)}" ${c.toFixed(2)}`);
        }
        // The list's dot before "Up next": a mark, 3:1.
        const dot = getComputedStyle(document.querySelector('#heroKicker'), '::before');
        if (dot.content === 'none' || dot.content === 'normal') bad.push(`color ${n}: no list dot`);
        else { const c = seen(document.querySelector('#heroKicker'), dot.backgroundColor); if (!(c >= 3)) bad.push(`color ${n}: the dot ${c.toFixed(2)}`); }
      }
      return { bad, looks };
    }, SEEN);
    assert.deepEqual(out.bad, [], mode);
    for (const [n, ink, glass, done] of out.looks) {
      assert.ok(ink, `${mode} color ${n}: its words in the heading ink`);
      assert.ok(glass, `${mode} color ${n}: a see-through card, like the others`);
      assert.ok(done, `${mode} color ${n}: Mark done in the look's own pill`);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // Every other look, mode and list color: Up next as it was before.
  const take = async where => {
    const { ctx, page } = await lookPhone('classic', 'light', 'tasks', { srv: where });
    const snap = await page.evaluate(async () => {
      const T = window.todoTheme;
      const hero = document.querySelector('#hero');
      const out = {};
      const parts = { '': hero, kicker: '#heroKicker', title: '#heroTitle', when: '#heroWhen', list: '#heroList', cd: '#heroCd', done: '#heroDone', focus: '#heroFocus' };
      for (const t of T.themes.filter(x => x.id !== 'blush')) {
        for (const mode of t.modes) {
          T.set({ look: t.id, appearance: mode, accent: '' });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          for (let n = 0; n <= 10; n++) {
            for (let i = 0; i <= 10; i++) hero.classList.toggle('c' + i, i === n);
            for (const [k, sel] of Object.entries(parts)) {
              const e = typeof sel === 'string' ? document.querySelector(sel) : sel;
              const cs = getComputedStyle(e), b = getComputedStyle(e, '::before');
              out[`${t.id}/${mode}/c${n}/${k}`] = [cs.color, cs.backgroundColor, cs.backgroundImage, cs.borderTopColor, cs.borderTopWidth, cs.boxShadow, cs.display, cs.fontFamily, b.content, b.backgroundColor].join(' | ');
            }
          }
        }
      }
      return out;
    });
    await ctx.close();
    return snap;
  };
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-pre-ux-'));
  execFileSync('tar', ['-x', '-C', oldDir], { input: execFileSync('git', ['-C', path.resolve(__dirname, '..'), 'archive', PRE_UX_REF], { maxBuffer: 1 << 28 }) });
  const old = await serve(oldDir);
  try {
    const before = await take(old);
    const now = await take(srv);
    assert.ok(Object.keys(before).length > 1000, 'every look, mode and color looked at');
    for (const [k, v] of Object.entries(before)) assert.equal(now[k], v, `unchanged: ${k}`);
  } finally {
    await old.close();
    fs.rmSync(oldDir, { recursive: true, force: true });
  }
});
