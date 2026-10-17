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
