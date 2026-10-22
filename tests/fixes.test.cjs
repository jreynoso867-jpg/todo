// Problems found by the October review, each shown failing before its fix. Usage: node --test tests/fixes.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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
