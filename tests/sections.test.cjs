// The newer kinds of record (shopping lists and their items, wishes, savings goals and their entries, important dates)
// and their Recently deleted: kept, saved to a file and loaded back, put back after a cut-off save, waiting while the
// phone can't save, restored and cleared. The parts with no screen of their own yet (the money, link and date helpers,
// moving records into Recently deleted) are run in Node straight from index.html, with stand-ins for the rest of the app.
// Usage: node --test tests/sections.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, smallFixture, extrasFixture, withExtras, EXTRA_COLLS, launch, phoneContext, seed, dump } = require('./lib.cjs');
const { fakeCapacitor } = require('./fake-capacitor.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
const SRC = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with the fixture on it (or empty), the app open. Collects script errors.
async function phone(fx = withExtras(smallFixture()), o = {}) {
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
const collOf = k => k.slice(0, k.indexOf('/'));
const extrasOf = fx => Object.entries(fx.docs).filter(([k]) => EXTRA_COLLS.includes(collOf(k)));
const binOf = fx => Object.entries(fx.docs).filter(([k]) => k.startsWith('bin/'));
const restoreBin = async (page, key) => { await page.click(`[data-restore-bin="${key}"]`); await page.waitForTimeout(600); };
const trashRows = page => page.$$eval('#trashRows .trash-row', els => els.map(e => ({
  title: e.querySelector('.trash-title').textContent, meta: e.querySelector('.trash-meta').textContent })));
const waitStatus = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#moveStatus').textContent), re.source, { timeout: 20000 });
// Every record but the settings (loading a file applies its look and text size, on purpose).
const records = docs => Object.fromEntries(Object.entries(docs).filter(([k]) => !k.startsWith('settings/')));

test('Save everything carries every shopping list, wish, goal and date, and loading the file again adds nothing twice', async () => {
  const fx = withExtras(smallFixture());
  const a = await phone(fx);
  await a.page.click('#colorsBtn');
  await a.page.waitForTimeout(300);
  assert.match(await a.page.textContent('#moveNote'), /shopping lists, wishes, savings goals, important dates/);
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#exportAll')]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-sections-')), 'export.json');
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.version, 1, 'the same file format older copies read');
  assert.equal(data.collections.bin, undefined, 'Recently deleted stays out of the file, the same as for tasks');
  const extras = extrasOf(fx);
  for (const [k, v] of extras) assert.deepEqual(data.collections[collOf(k)][k.slice(k.indexOf('/') + 1)], v, `in the file: ${k}`);
  for (const c of EXTRA_COLLS) assert.equal(Object.keys(data.collections[c]).length, extras.filter(([k]) => collOf(k) === c).length, `only what's there: ${c}`);
  assert.match(await a.page.textContent('#moveStatus'), /2 shopping lists, 3 shopping items, 3 wishes, 2 savings goals, 4 savings entries, 3 important dates/);

  // Loaded back on the same phone: everything is already here, and nothing is touched.
  const before = records((await dump(a.page)).docs);
  await a.page.setInputFiles('#importInput', file);
  await waitStatus(a.page, /already here/);
  assert.deepEqual(records((await dump(a.page)).docs), before, 'nothing added or changed');
  assert.deepEqual(a.errors, []);
  await a.ctx.close();

  // Another phone: every record comes over by its own id, exactly as it was.
  const b = await phone(null);
  await b.page.setInputFiles('#importInput', file);
  await waitStatus(b.page, /Loaded/);
  assert.match(await b.page.textContent('#moveStatus'), /2 shopping lists, 3 shopping items, 3 wishes, 2 savings goals, 4 savings entries, 3 important dates/);
  const got = (await dump(b.page)).docs;
  for (const [k, v] of extras) assert.deepEqual(got[k], v, `came over unchanged: ${k}`);
  assert.ok(!Object.keys(got).some(k => k.startsWith('bin/')), 'no Recently deleted copies come over');
  // And a second time: already here.
  const once = records(got);
  await b.page.setInputFiles('#importInput', file);
  await waitStatus(b.page, /already here/);
  assert.deepEqual(records((await dump(b.page)).docs), once, 'nothing twice');
  assert.deepEqual(b.errors, []);
  await b.ctx.close();
});

test('Recently deleted shows the new kinds by name and kind, and Restore brings each back exactly as it was', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  const before = (await dump(page)).docs;
  // One deleted task, a wish, a shopping list with its 2 items, a goal with its 2 entries, a date: five rows.
  assert.match(await page.textContent('#trashOpen'), /Recently deleted · 5/);
  await page.click('#trashOpen');
  await page.waitForSelector('#trashSheet:not([hidden])');
  const rows = await trashRows(page);
  const meta = t => (rows.find(r => r.title === t) || { meta: 'missing' }).meta;
  assert.equal(rows.length, 5);
  assert.match(meta('Old deleted task'), /^Task · Deleted .* · Home$/);
  assert.match(meta('Kayak <i>lessons</i>'), /^Wish · Deleted /, 'its words show as they were typed, markup and all');
  assert.match(meta('Party supplies'), /^Shopping list · 2 items · Deleted yesterday$/);
  assert.match(meta('Trip fund'), /^Goal · 2 entries · Deleted /);
  assert.match(meta('Block party'), /^Date · Deleted /);
  assert.equal(rows[0].title, 'Party supplies', 'the newest first');
  assert.equal(rows[4].title, 'Block party');

  for (const [key, title] of [['shopLists~sl_party', 'Party supplies'], ['goals~g_trip', 'Trip fund'], ['wishes~w_kayak', 'Kayak <i>lessons</i>'], ['dates~d_party', 'Block party']]) {
    await restoreBin(page, key);
    assert.equal(await page.textContent('#toastMsg'), `Restored “${title}”`);
  }
  const d = (await dump(page)).docs;
  for (const [k, e] of binOf(fx)) {
    assert.deepEqual(d[`${e.coll}/${e.id}`], e.doc, `back in its own collection exactly as it was: ${e.coll}/${e.id}`);
    assert.equal(d[k], undefined, `and out of Recently deleted: ${k}`);
  }
  for (const [k, v] of Object.entries(before)) if (!k.startsWith('bin/')) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  for (const k of Object.keys(d)) {
    if (k in before || k.startsWith('settings/')) continue;
    assert.ok(EXTRA_COLLS.includes(collOf(k)), `only restored records are new, nothing in tasks/ or trash/: ${k}`);
  }
  assert.deepEqual((await trashRows(page)).map(r => r.title), ['Old deleted task'], 'the deleted task waits as before');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Recently deleted is one tap from Lists and from Settings, and each delete of the new kinds says it waits there', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await page.click('#dockLists');
  // At the foot of Lists: how many wait there, one tap away.
  assert.ok(await page.isVisible('#listsTrash'), 'on the Lists tab');
  assert.equal(await page.textContent('#listsTrash'), 'Recently deleted · 5');
  await page.click('#listsTrash');
  await page.waitForSelector('#trashSheet.open');
  assert.equal((await trashRows(page)).length, 5);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'listsTrash', 'focus back where it was');
  // In Settings too: it closes Settings and opens Recently deleted.
  await page.click('#colorsBtn');
  await page.waitForSelector('#colorsSheet.open');
  assert.equal(await page.textContent('#setTrash'), 'Recently deleted · 5');
  await page.click('#setTrash');
  await page.waitForSelector('#trashSheet.open');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#colorsSheet'), 'Settings closes');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'colorsBtn');
  // A delete of the new kinds says where it went, as a task's delete does.
  await page.click('#listsWish');
  await page.click('[data-wish-open="w_lamp"]');
  await page.click('#wishDelete');
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Reading lamp”. It stays in Recently deleted for 7 days.');
  await page.click('#wishBack');
  assert.equal(await page.textContent('#listsTrash'), 'Recently deleted · 6');
  await page.click('[data-shop-open="sl_groceries"]');
  await page.click('[data-shop-tick="si_milk"]');
  await page.waitForTimeout(400);
  await page.click('#shopClear');
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#toastMsg'), 'Cleared 2 items. They stay in Recently deleted for 7 days.');
  // With nothing in it, neither shows.
  await page.click('#shopBack');
  await page.click('#listsTrash');
  await page.waitForSelector('#trashSheet.open');
  await page.click('#trashPurge');
  await page.click('#trashPurge');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#listsTrash'), 'nothing waiting: no link');
  await page.click('#colorsBtn');
  assert.ok(await page.isHidden('#setTrash'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('in Recently deleted the new kinds go after 7 days, like tasks, and Delete all now clears both', async () => {
  const fx = withExtras(smallFixture());
  const old = Date.now() - 8 * 864e5;
  const t = { createdAt: old - 9e8, updatedAt: old - 9e8 };
  fx.docs['bin/wishes~w_old'] = { coll: 'wishes', id: 'w_old', doc: { title: 'Old wish', category: 'other', priceCents: null, link: null, hearted: false,
    got: false, gotAt: null, note: '', rank: 9000, ...t }, group: null, deletedAt: old };
  fx.docs['bin/goals~g_old'] = { coll: 'goals', id: 'g_old', doc: { name: 'Old goal', targetCents: 5000, due: null, closedAt: null, order: 9, ...t },
    group: 'goals~g_old', deletedAt: old };
  fx.docs['bin/goalEntries~ge_old'] = { coll: 'goalEntries', id: 'ge_old', doc: { goal: 'g_old', amountCents: 1000, day: '2026-01-02', note: '', ...t },
    group: 'goals~g_old', deletedAt: old };
  const { ctx, page, errors } = await phone(fx);
  const before = (await dump(page)).docs;
  await page.waitForTimeout(7000); // the once-a-visit clear-out runs 6 s after opening
  let d = (await dump(page)).docs;
  for (const k of ['bin/wishes~w_old', 'bin/goals~g_old', 'bin/goalEntries~ge_old']) assert.equal(d[k], undefined, `older than 7 days, gone: ${k}`);
  for (const [k, v] of Object.entries(before)) if (!/~(w|g|ge)_old$/.test(k)) assert.deepEqual(d[k], v, `everything else unchanged: ${k}`);

  await page.click('#trashOpen');
  await page.click('#trashPurge');
  assert.equal(await page.textContent('#trashPurge'), 'Tap again to delete 5 things for good');
  await page.click('#trashPurge');
  await page.waitForTimeout(800);
  d = (await dump(page)).docs;
  assert.ok(!Object.keys(d).some(k => /^(trash|bin)\//.test(k)), 'Recently deleted is empty');
  for (const [k, v] of Object.entries(before)) if (!/^(trash|bin)\//.test(k)) assert.deepEqual(d[k], v, `nothing else touched: ${k}`);
  assert.equal(await page.textContent('#toastMsg'), 'Deleted 5 things for good');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a restore cut off by closing the app finishes on the next start (the save notes know the new kinds)', async () => {
  // Removing a Recently deleted copy is made to hang, as if the app were closed while the phone was still saving.
  const init = () => {
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (k) {
      if (window.__hang && typeof k === 'string' && k.startsWith(window.__hang)) {
        const store = this;
        const spin = () => { store.get('__none').onsuccess = spin; }; // the save never finishes
        spin();
        return store.get('__none');
      }
      return del.call(this, k);
    };
  };
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx, { init });
  await page.click('#trashOpen');
  await page.evaluate(() => { window.__hang = 'bin/'; });
  await page.click('[data-restore-bin="wishes~w_kayak"]');
  await page.waitForFunction(() => (localStorage.getItem('todo.saving') || '').includes('bin/wishes~w_kayak'), null, { timeout: 8000 });
  const note = JSON.parse(await page.evaluate(() => localStorage.getItem('todo.saving'))).find(n => n.path === 'bin/wishes~w_kayak');
  assert.equal(note.kind, 'delete');
  assert.equal(note.known, true, 'the note knows how the copy looked, so the delete can be put back in');
  assert.deepEqual(note.before, fx.docs['bin/wishes~w_kayak']);
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(2500);
  const d = await dump(page);
  assert.deepEqual(d.docs['wishes/w_kayak'], fx.docs['bin/wishes~w_kayak'].doc, 'the wish is back');
  assert.equal(d.docs['bin/wishes~w_kayak'], undefined, 'and its copy left Recently deleted');
  assert.equal(d.local['todo.saving'], '[]', 'nothing left waiting');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('unfinished saves to the new kinds go back in only if nothing newer would be written over', async () => {
  const fx = withExtras(smallFixture());
  const D = fx.docs;
  const now = Date.now();
  fx.local['todo.saving'] = JSON.stringify([
    // An update to a wish nobody else touched: it goes in.
    { path: 'wishes/w_coast', kind: 'update', data: { hearted: false, updatedAt: now }, known: true, before: D['wishes/w_coast'] },
    // A goal renamed somewhere else since: the old save is left out.
    { path: 'goals/g_car', kind: 'update', data: { name: 'Stale name', updatedAt: now }, known: true, before: { ...D['goals/g_car'], name: 'What it said before' } },
    // A delete of an unchanged date goes in; a new shopping item that never got in goes in.
    { path: 'dates/d_dentist', kind: 'delete', known: true, before: D['dates/d_dentist'] },
    { path: 'shopItems/si_bread', kind: 'set', known: true, data: { list: 'sl_groceries', text: 'Bread', link: null, done: false, doneAt: null, rank: 3000, createdAt: now, updatedAt: now } },
    // Removing a Recently deleted copy that changed since: left alone.
    { path: 'bin/dates~d_party', kind: 'delete', known: true, before: { ...D['bin/dates~d_party'], deletedAt: 1 } },
  ]);
  const { ctx, page, errors } = await phone(fx);
  await page.waitForTimeout(2500);
  const d = await dump(page);
  assert.equal(d.docs['wishes/w_coast'].hearted, false, 'the untouched save went in');
  assert.equal(d.docs['wishes/w_coast'].title, D['wishes/w_coast'].title, 'and nothing else changed');
  assert.equal(d.docs['goals/g_car'].name, 'New car', 'the newer name stays');
  assert.equal(d.docs['dates/d_dentist'], undefined);
  assert.equal(d.docs['shopItems/si_bread'].text, 'Bread');
  assert.deepEqual(d.docs['bin/dates~d_party'], D['bin/dates~d_party']);
  assert.equal(d.local['todo.saving'], '[]', 'every note was looked at');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a change to a new kind the phone can’t save yet waits on the phone, already counts, and goes in later', async () => {
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__busy && typeof k === 'string' && k.startsWith(window.__busy)) throw new DOMException('The storage is busy', 'UnknownError');
      return put.call(this, v, k);
    };
  };
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx, { init });
  await page.evaluate(() => { window.__busy = 'wishes/'; });
  await page.click('#trashOpen');
  await page.click('[data-restore-bin="wishes~w_kayak"]');
  await page.waitForFunction(() => /bin\/wishes~w_kayak/.test(localStorage.getItem('todo.outbox') || ''), null, { timeout: 8000 });
  const out = JSON.parse(await page.evaluate(() => localStorage.getItem('todo.outbox')));
  assert.deepEqual(out.map(o => [o.path, o.kind]), [['wishes/w_kayak', 'set'], ['bin/wishes~w_kayak', 'delete']], 'both wait, in order');
  // While they wait, the list already shows them: out of Recently deleted, and in Save everything.
  assert.ok(!(await trashRows(page)).some(r => r.title === 'Kayak <i>lessons</i>'));
  await page.click('#trashDone');
  await page.click('#colorsBtn');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportAll')]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.deepEqual(data.collections.wishes.w_kayak, fx.docs['bin/wishes~w_kayak'].doc);
  assert.equal((await dump(page)).docs['wishes/w_kayak'], undefined, 'not in the storage yet');
  await page.evaluate(() => { window.__busy = null; });
  await page.waitForFunction(() => localStorage.getItem('todo.outbox') === '[]', null, { timeout: 30000 });
  const d = (await dump(page)).docs;
  assert.deepEqual(d['wishes/w_kayak'], fx.docs['bin/wishes~w_kayak'].doc);
  assert.equal(d['bin/wishes~w_kayak'], undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// The phone's storage, for keys starting with window.__fault.at: busy (the change waits on the phone, see above), or
// full once window.__fault.full is set (the change is turned down for good).
const faultyStorage = () => {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) {
    const f = window.__fault;
    if (f && typeof k === 'string' && k.startsWith(f.at)) throw new DOMException('No room', f.full ? 'QuotaExceededError' : 'UnknownError');
    return put.call(this, v, k);
  };
};
// Waits until every waiting change has been tried (a page coming back into view tries them at once).
const drained = async page => {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => localStorage.getItem('todo.outbox') === '[]', null, { timeout: 30000 });
  await page.waitForTimeout(400);
};

test('a delete that had to wait keeps the record when its Recently deleted copy is then turned down (a shopping list with its items, a wish)', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx, { init: faultyStorage });
  const before = (await dump(page)).docs;
  await page.click('#dockLists');
  await page.evaluate(() => { window.__fault = { at: 'bin/' }; });
  await page.click('[data-shop-more="sl_groceries"]');
  await page.waitForSelector('#shopSheet.open');
  await page.click('#shopDelete');
  await page.click('#listsWish');
  await page.waitForSelector('#wishView:not([hidden])');
  await page.click('[data-wish-open="w_lamp"]');
  await page.waitForSelector('#wishSheet.open');
  await page.click('#wishDelete');
  await page.waitForFunction(() => /"wishes\/w_lamp"/.test(localStorage.getItem('todo.outbox') || ''), null, { timeout: 8000 });
  const out = JSON.parse(await page.evaluate(() => localStorage.getItem('todo.outbox'))).map(o => `${o.kind} ${o.path}`);
  for (const p of ['shopItems/si_milk', 'shopItems/si_eggs', 'shopLists/sl_groceries', 'wishes/w_lamp']) {
    assert.ok(out.indexOf(`set bin/${p.replace('/', '~')}`) >= 0 && out.indexOf(`set bin/${p.replace('/', '~')}`) < out.indexOf(`delete ${p}`), `the copy waits ahead of the delete: ${p}`);
  }
  // Then the storage is full: the copies are turned down for good, so nothing that waited on them is deleted.
  await page.evaluate(() => { window.__fault.full = true; });
  await drained(page);
  const d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `kept exactly as it was: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing new: ${k}`);
  assert.match(await page.textContent('#toastMsg'), /Couldn’t keep a copy in Recently deleted, so 4 things weren’t deleted/);
  await page.click('#wishBack');
  assert.ok(await page.isVisible('[data-shop-open="sl_groceries"]'), 'the list shows again');
  await page.click('#listsWish');
  assert.ok(await page.isVisible('[data-wish-open="w_lamp"]'), 'and so does the wish');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a restore that had to wait leaves its copy in Recently deleted when putting the record back is then turned down', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx, { init: faultyStorage });
  const before = (await dump(page)).docs;
  await page.evaluate(() => { window.__fault = { at: 'wishes/' }; });
  await page.click('#trashOpen');
  await page.click('[data-restore-bin="wishes~w_kayak"]');
  await page.waitForFunction(() => /bin\/wishes~w_kayak/.test(localStorage.getItem('todo.outbox') || ''), null, { timeout: 8000 });
  await page.evaluate(() => { window.__fault.full = true; });
  await drained(page);
  const d = (await dump(page)).docs;
  assert.deepEqual(d['bin/wishes~w_kayak'], before['bin/wishes~w_kayak'], 'still in Recently deleted, as it was');
  assert.equal(d['wishes/w_kayak'], undefined);
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.match(await page.textContent('#toastMsg'), /Couldn’t put it back, so it stays in Recently deleted/);
  assert.ok((await trashRows(page)).some(r => r.title === 'Kayak <i>lessons</i>'), 'its row shows again');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('clearing Recently deleted never waits on the phone, and doesn’t run while changes are waiting', async () => {
  const fx = withExtras(smallFixture());
  const old = Date.now() - 8 * 864e5;
  fx.docs['trash/t_gone'].deletedAt = old;
  fx.docs['bin/dates~d_party'].deletedAt = old;
  fx.docs['bin/wishes~w_kayak'].deletedAt = old;
  // Removing from Recently deleted is busy for now: a clear-out that waited could take a newer copy later.
  const busyDelete = () => {
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (k) {
      if (window.__busyDel !== false && typeof k === 'string' && /^(bin|trash)\//.test(k)) throw new DOMException('The storage is busy', 'UnknownError');
      return del.call(this, k);
    };
  };
  let { ctx, page, errors } = await phone(fx, { init: busyDelete });
  await page.waitForTimeout(7500); // the once-a-visit clear-out runs 6 s after opening
  assert.ok(!/"(bin|trash)\//.test(await page.evaluate(() => localStorage.getItem('todo.outbox') || '')), 'nothing waits to be cleared');
  await page.evaluate(() => { window.__busyDel = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2500);
  let d = (await dump(page)).docs;
  for (const k of ['trash/t_gone', 'bin/dates~d_party', 'bin/wishes~w_kayak']) assert.deepEqual(d[k], fx.docs[k], `left for the next visit: ${k}`);
  assert.deepEqual(errors, []);
  await ctx.close();

  // A change still waiting from before (the storage busy for it): no clearing at all, not even Delete all now.
  const fx2 = withExtras(smallFixture());
  fx2.docs['bin/dates~d_party'].deletedAt = old;
  fx2.local['todo.outbox'] = JSON.stringify([{ path: 'tasks/t_anytime', kind: 'update', data: { title: 'Buy mop heads and a bucket' } }]);
  ({ ctx, page, errors } = await phone(fx2, { init: faultyStorage }));
  await page.evaluate(() => { window.__fault = { at: 'tasks/t_anytime' }; });
  await page.waitForTimeout(7500);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('todo.outbox'))).map(o => o.path), ['tasks/t_anytime'], 'only the change that was waiting');
  await page.click('#trashOpen');
  await page.click('#trashPurge');
  await page.click('#trashPurge');
  await page.waitForTimeout(600);
  assert.match(await page.textContent('#toastMsg'), /still saving/);
  await page.evaluate(() => { window.__fault = null; });
  await drained(page);
  d = (await dump(page)).docs;
  assert.equal(d['tasks/t_anytime'].title, 'Buy mop heads and a bucket', 'the waiting change went in');
  for (const [k, v] of Object.entries(fx2.docs)) if (k !== 'tasks/t_anytime' && !k.startsWith('settings/')) assert.deepEqual(d[k], v, `nothing cleared: ${k}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the iPhone app’s Files safety copy holds the new kinds, even on a phone with nothing else in it', async () => {
  const x = extrasFixture();
  const fx = { today: x.today, docs: x.docs, blobs: {}, local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1' } };
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seed(page, srv.url, fx);
  await page.addInitScript(fakeCapacitor, { notify: 'granted' });
  await page.goto(srv.url + '/index.html');
  const name = `DOCUMENTS/Safety copies/To-do safety copy ${fx.today}.json`;
  await page.waitForFunction(n => window.__cap.files.has(n), name, { timeout: 20000 });
  const data = JSON.parse(await page.evaluate(n => window.__cap.files.get(n).data, name));
  for (const [k, v] of extrasOf(fx)) assert.deepEqual(data.collections[collOf(k)][k.slice(k.indexOf('/') + 1)], v, `in the copy: ${k}`);
  assert.equal(data.collections.bin, undefined);
  const d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* ---------- the helpers with no screen yet, run in Node straight from index.html ---------- */
// The block of index.html that holds the newer kinds' records, run on its own: everything it uses from the rest of the
// app is handed in, so a test can watch exactly what it would save. (It runs this repository's own index.html, the
// same code the browser tests run; nothing from outside goes into it.)
const HEAD = '  /* ---------- shopping lists, wishes, savings goals and important dates: their records';
function recordsBlock(deps) {
  const a = SRC.indexOf(HEAD);
  assert.ok(a > 0, 'the records block is in index.html');
  const b = SRC.indexOf('\n  /* ---------- ', a + HEAD.length);
  const names = Object.keys(deps);
  const out = 'return { PARENT, money, parseCents, cleanLink, nextDateOn, dateCountdown, goalTotals, CLEAN, addRecord, editRecord, binKey, binMany, restoreEntries, binGroupOf, purgeBin, recordTitle };';
  return new Function(...names, SRC.slice(a, b) + '\n' + out)(...names.map(n => deps[n]));
}
const pad = n => String(n).padStart(2, '0');
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
// A stand-in app: S with the given records, a database that keeps what's written (and turns down the paths in `refuse`:
// a path for its set, 'delete <path>' for its delete), and a log of every write in order.
function standIn(records, refuse = new Set()) {
  const store = new Map(Object.entries(JSON.parse(JSON.stringify(records))));
  const log = [];
  const toasts = [];
  let n = 0;
  const S = { today: '2026-10-22', status: 'ready', binLoaded: true };
  for (const c of [...EXTRA_COLLS, 'bin']) S[c] = new Map();
  const reload = () => { for (const c of [...EXTRA_COLLS, 'bin']) S[c] = new Map([...store].filter(([k]) => collOf(k) === c).map(([k, v]) => [k.slice(c.length + 1), v])); };
  reload();
  const docRef = (c, id) => ({
    id,
    set: async d => { log.push(['set', `${c}/${id}`]); if (refuse.has(`${c}/${id}`)) throw { code: 'quota_exceeded' }; store.set(`${c}/${id}`, JSON.parse(JSON.stringify(d))); },
    update: async d => { log.push(['update', `${c}/${id}`, d]); store.set(`${c}/${id}`, { ...store.get(`${c}/${id}`), ...d }); },
    delete: async () => { log.push(['delete', `${c}/${id}`]); if (refuse.has(`delete ${c}/${id}`)) throw { code: 'permission_denied' }; store.delete(`${c}/${id}`); },
    get: async () => ({ exists: store.has(`${c}/${id}`), data: () => JSON.parse(JSON.stringify(store.get(`${c}/${id}`))) }),
  });
  const db = { collection: c => ({ doc: id => docRef(c, id === undefined ? 'new' + (++n) : id) }) };
  const deps = {
    S, db, REC_COLLS: EXTRA_COLLS, TRASH_DAYS: 7, pad, parseYmd,
    writable: () => S.status === 'ready',
    nothingWaiting: () => true,
    deletedAt: e => (e ? Number(e.deletedAt) || 0 : -1),
    write: async (key, op) => { try { await op(); return true; } catch (e) { return false; } },
    runPool: async (jobs, size = 4) => { let i = 0; const worker = async () => { while (i < jobs.length) { const job = jobs[i++]; await job(); } }; await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker)); },
    toast: (msg, undo) => toasts.push({ msg, undo }),
    plural: (k, one, many) => `${k} ${k === 1 ? one : many}`,
    clean: (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max),
    cleanNote: s => String(s || '').replace(/\r\n?/g, '\n').trim(),
    clampColor: c => { const k = Math.round(Number(c)); return k >= 1 && k <= 10 ? k : 1; },
    freeColor: used => { for (let c = 1; c <= 10; c++) if (!used.has(c)) return c; return 1; },
    isYmd: s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s),
    daysBetween: (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000),
    copyJson: v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))),
    sameData: (a, b) => stable(a) === stable(b),
    isPlain: o => !!o && typeof o === 'object' && !Array.isArray(o),
    safeId: id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[/\u0000-\u001F\u007F]/.test(id),
    recRef: (c, id) => docRef(c, id),
    binRef: key => docRef('bin', key),
  };
  return { R: recordsBlock(deps), S, store, log, toasts, reload };
}

test('money is whole cents, and only real web links are kept', () => {
  const { R } = standIn({});
  const cases = { '12.10': 1210, '0.20': 20, '35,000': 3500000, '$1,234.5': 123450, '-40': -4000, '−250.50': -25050, '.5': 50, '12.': 1200, '-0': 0,
    '1.234': null, 'abc': null, '': null, '12.3.4': null, '999999999999': null,
    // A comma is a thousands separator only before exactly three digits; on its own before one or two at the end (a
    // phone set to a region that writes 12,50) it's the decimal point. Anything else isn't an amount.
    '12,50': 1250, '1,5': 150, ',5': 50, '-12,50': -1250, '1,234,567.89': 123456789, '12,345': 1234500, '$ 12': 1200,
    '12 34': null, '1,23,456': null, '12,3456': null, '1.234,56': null, '1,2,3': null, '12,50.5': null, '1,234,56': null };
  for (const [s, want] of Object.entries(cases)) assert.equal(R.parseCents(s), want, `parseCents(${JSON.stringify(s)})`);
  assert.equal(R.parseCents('12.10') + R.parseCents('0.20'), 1230, 'no floating-point drift');
  assert.equal(R.money(3500000), '$35,000.00');
  assert.equal(R.money(1230), '$12.30');
  assert.equal(R.money(-25050), '-$250.50');
  const links = {
    'https://example.com/eggs?size=12': 'https://example.com/eggs?size=12',
    '  https://example.com/a  ': 'https://example.com/a',
    'http://example.com/x': 'https://example.com/x',
    'javascript:alert(1)': null, 'JavaScript:alert(1)': null, 'data:text/html,hi': null, 'ftp://example.com/f': null,
    'https://name:secret@example.com/': null, 'example.com': null, 'https://': null, '': null,
  };
  for (const [s, want] of Object.entries(links)) assert.equal(R.cleanLink(s), want, `cleanLink(${JSON.stringify(s)})`);
  assert.equal(R.cleanLink(42), null);
  assert.equal(R.cleanLink(null), null);
});

test('important dates: the next time each comes round, a Feb 29 in other years, across New Year, and the countdown words', () => {
  const { R } = standIn({});
  const leap = { date: '1992-02-29', yearly: true };
  assert.equal(R.nextDateOn(leap, '2026-10-22'), '2027-02-28', 'Feb 28 in a year with no Feb 29');
  assert.equal(R.nextDateOn(leap, '2027-03-01'), '2028-02-29', 'and Feb 29 in a leap year');
  assert.equal(R.nextDateOn(leap, '2028-02-29'), '2028-02-29', 'today counts');
  assert.equal(R.nextDateOn(leap, '2100-01-10'), '2100-02-28', '2100 is not a leap year');
  const jan = { date: '1990-01-03', yearly: true };
  assert.equal(R.nextDateOn(jan, '2026-12-30'), '2027-01-03', 'a birthday just after New Year');
  assert.equal(R.dateCountdown(R.nextDateOn(jan, '2026-12-30'), '2026-12-30'), 'In 4 days');
  assert.equal(R.nextDateOn({ date: '2026-10-01', yearly: false }, '2026-10-22'), null, 'a one-off date that has passed');
  assert.equal(R.nextDateOn({ date: '2026-11-01', yearly: false }, '2026-10-22'), '2026-11-01');
  assert.equal(R.nextDateOn({ date: '2027-05-01', yearly: true }, '2026-10-22'), '2027-05-01', 'a yearly date starts on its first day');
  assert.equal(R.nextDateOn({ date: 'soon', yearly: true }, '2026-10-22'), null);
  const from = '2026-10-22';
  const words = { '2026-10-22': 'Today', '2026-10-23': 'Tomorrow', '2026-10-24': 'In 2 days', '2026-12-21': 'In 60 days', '2026-12-22': 'Dec 22',
    '2027-03-10': 'Mar 10', '2027-12-10': 'Dec 10, 2027', '2026-10-21': 'Yesterday', '2026-10-12': '10 days ago' };
  for (const [day, want] of Object.entries(words)) assert.equal(R.dateCountdown(day, from), want, `dateCountdown(${day})`);
});

test('records are cleaned the same way every time, and a goal’s progress comes from its entries', () => {
  const x = extrasFixture('2026-10-22');
  const { R, S, store, log } = standIn(x.docs);
  const w = R.CLEAN.wishes({ title: '  A   lamp ', category: 'boats', priceCents: -5, link: 'javascript:alert(1)', hearted: 'yes', got: true, note: 'a\r\nb' });
  assert.equal(w.title, 'A lamp');
  assert.equal(w.category, 'other');
  assert.equal(w.priceCents, null);
  assert.equal(w.link, null);
  assert.equal(w.hearted, false);
  assert.ok(w.gotAt > 0, 'got it notes when');
  assert.equal(w.note, 'a\nb');
  assert.equal(R.CLEAN.dates({ title: 'B', kind: 'birthday', date: '2000-01-01' }).yearly, true, 'birthdays come round every year');
  assert.equal(R.CLEAN.dates({ title: 'C', kind: 'appointment', date: '2026-11-01' }).yearly, false);
  assert.deepEqual(R.goalTotals('g_car'), { saved: 1574950, target: 3500000, left: 1925050, reached: false });
  assert.equal(R.goalTotals('g_laptop').reached, true);

  // A new record gets an id from the database, its times and a place at the end; one that can't be saved isn't written.
  const id = R.addRecord('shopItems', { list: 'sl_groceries', text: ' Bread ', link: 'http://example.com/bread' });
  const saved = store.get('shopItems/' + id);
  assert.equal(saved.text, 'Bread');
  assert.equal(saved.link, 'https://example.com/bread');
  assert.equal(saved.rank, 3000, 'after the list’s last item');
  assert.ok(saved.createdAt > 0 && saved.updatedAt === saved.createdAt);
  assert.equal(R.addRecord('shopItems', { list: 'no_such_list', text: 'Lost' }), null, 'an item needs its list');
  assert.equal(R.addRecord('goals', { name: 'Free', targetCents: 0 }), null, 'a goal needs a target');
  assert.equal(R.addRecord('tasks', { title: 'Not here' }), null, 'tasks are not made here');
  S.status = 'readonly';
  assert.equal(R.addRecord('wishes', { title: 'Seen, not changed' }), null, 'nothing is written in a view-only list');
  S.status = 'ready';
  // An edit writes only what changed (and when something was ticked), with a new updatedAt.
  log.length = 0;
  return R.editRecord('shopItems', 'si_milk', { done: true }).then(() => {
    assert.equal(log.length, 1);
    const [kind, p, data] = log[0];
    assert.equal(kind + ' ' + p, 'update shopItems/si_milk');
    assert.deepEqual(Object.keys(data).sort(), ['done', 'doneAt', 'updatedAt']);
    assert.equal(data.done, true);
  });
});

test('deleting a shopping list or a goal: every copy into Recently deleted first, the items before their list, and all of it comes back', async () => {
  const x = extrasFixture('2026-10-22');
  const { R, store, log, toasts, reload } = standIn(x.docs);
  const items = ['si_milk', 'si_eggs'];
  const gone = await R.binMany([['shopLists', 'sl_groceries'], ['goals', 'g_car']], 'Deleted');
  const kinds = log.map(([k, p]) => `${k} ${p}`);
  // Each group is all or nothing, so each group's copies come before its own deletes.
  for (const [head, kids] of [['shopLists/sl_groceries', items.map(i => 'shopItems/' + i)], ['goals/g_car', ['ge_bonus', 'ge_june', 'ge_out'].map(i => 'goalEntries/' + i)]]) {
    const copies = [head, ...kids].map(p => kinds.indexOf(`set bin/${p.replace('/', '~')}`));
    const dels = [head, ...kids].map(p => kinds.indexOf(`delete ${p}`));
    assert.ok(copies.every(i => i >= 0) && dels.every(i => i >= 0), `${head}: copied and deleted`);
    assert.ok(Math.max(...copies) < Math.min(...dels), `${head}: every copy is kept before anything goes`);
    assert.ok(dels[0] > Math.max(...dels.slice(1)), `${head}: the children go before their parent`);
  }
  assert.ok(store.has('shopItems/si_screws'), 'another list’s item stays');
  assert.ok(!kinds.some(s => / (tasks|trash)\//.test(s)), 'nothing goes near the tasks or their trash');
  const binned = store.get('bin/shopItems~si_eggs');
  assert.deepEqual(binned, { coll: 'shopItems', id: 'si_eggs', doc: x.docs['shopItems/si_eggs'], group: 'shopLists~sl_groceries', deletedAt: binned.deletedAt });
  assert.equal(store.get('bin/goalEntries~ge_out').group, 'goals~g_car');
  assert.equal(gone.length, 7, 'the list, its 2 items, the goal and its 3 entries');
  assert.equal(toasts[0].msg, 'Deleted. They stay in Recently deleted for 7 days.', 'it says where they went');
  assert.equal(typeof toasts[0].undo, 'function');

  // Recently deleted brings a whole group back, the list before its items; Undo does the same.
  reload();
  const back = R.binGroupOf('shopItems~si_milk');
  assert.deepEqual(back.map(([c, id]) => `${c}/${id}`).sort(), ['shopItems/si_eggs', 'shopItems/si_milk', 'shopLists/sl_groceries']);
  log.length = 0;
  assert.equal(await R.restoreEntries(back), true);
  const order = log.map(([k, p]) => `${k} ${p}`);
  assert.ok(order.indexOf('set shopLists/sl_groceries') < order.indexOf('set shopItems/si_milk'), 'the list comes back first');
  for (const id of items) assert.deepEqual(store.get('shopItems/' + id), x.docs['shopItems/' + id], `back exactly as it was: ${id}`);
  assert.deepEqual(store.get('shopLists/sl_groceries'), x.docs['shopLists/sl_groceries']);
  assert.ok(!store.has('bin/shopLists~sl_groceries') && !store.has('bin/shopItems~si_milk'));
  await toasts[0].undo();
  await new Promise(r => setTimeout(r, 0));
  for (const k of ['goals/g_car', 'goalEntries/ge_bonus', 'goalEntries/ge_june', 'goalEntries/ge_out']) assert.deepEqual(store.get(k), x.docs[k], `Undo put it back: ${k}`);
  for (const k of ['goals~g_car', 'goalEntries~ge_bonus', 'goalEntries~ge_june', 'goalEntries~ge_out']) assert.ok(!store.has('bin/' + k), `and took its copy out: ${k}`);
  assert.deepEqual(store.get('bin/goals~g_trip'), x.docs['bin/goals~g_trip'], 'what was in Recently deleted before stays');
});

test('a group whose delete is turned down part way keeps all of it: what went comes back, and none of it stays in Recently deleted', async () => {
  const x = extrasFixture('2026-10-22');
  const list = ['shopLists/sl_groceries', 'shopItems/si_milk', 'shopItems/si_eggs'];
  const goal = ['goals/g_car', 'goalEntries/ge_bonus', 'goalEntries/ge_june', 'goalEntries/ge_out'];
  const binKeys = paths => paths.map(p => 'bin/' + p.replace('/', '~'));
  // An item's delete turned down: its list isn't deleted (no item is left without it), and the other item comes back.
  // The list's own delete turned down after its items went: they come back. The same for a goal and a wish on its own.
  for (const refused of ['delete shopItems/si_milk', 'delete shopLists/sl_groceries', 'delete goalEntries/ge_june', 'delete goals/g_car', 'delete wishes/w_lamp']) {
    const { R, store, log } = standIn(x.docs, new Set([refused]));
    const gone = await R.binMany([['shopLists', 'sl_groceries'], ['goals', 'g_car'], ['wishes', 'w_lamp'], ['dates', 'd_dentist']], 'Deleted');
    const kept = refused.includes('shop') ? list : refused.includes('wish') ? ['wishes/w_lamp'] : goal;
    for (const k of kept) assert.deepEqual(store.get(k), x.docs[k], `${refused}: kept as it was: ${k}`);
    for (const k of binKeys(kept)) assert.ok(!store.has(k), `${refused}: no copy left in Recently deleted: ${k}`);
    const went = [...list, ...goal, 'wishes/w_lamp', 'dates/d_dentist'].filter(k => !kept.includes(k));
    assert.deepEqual(gone.map(([c, id]) => `${c}/${id}`).sort(), went.sort(), `${refused}: only what went is reported (and comes back with Undo)`);
    for (const k of went) assert.ok(!store.has(k) && store.has(binKeys([k])[0]), `${refused}: the rest went as asked: ${k}`);
    assert.ok(!log.some(([kind, p]) => kind === 'delete' && kept[0] === p && refused !== 'delete ' + p), `${refused}: the list, goal or wish itself isn't deleted once a part of it can't be`);
  }
});

test('Restore keeps a record that is already back and newer, and only takes its copy out of Recently deleted', async () => {
  const x = extrasFixture('2026-10-22');
  const copy = x.docs['bin/wishes~w_kayak'].doc;
  // Brought back (and changed) on another device, or loaded from a file, while its copy waited in Recently deleted.
  const newer = { ...copy, title: 'Kayak lessons, booked', updatedAt: copy.updatedAt + 5000 };
  let { R, store, log } = standIn({ ...x.docs, 'wishes/w_kayak': newer });
  assert.equal(await R.restoreEntries(R.binGroupOf('wishes~w_kayak')), true);
  assert.deepEqual(store.get('wishes/w_kayak'), newer, 'the newer one stays');
  assert.ok(!log.some(([k, p]) => k === 'set' && p === 'wishes/w_kayak'), 'it isn’t written over');
  assert.ok(!store.has('bin/wishes~w_kayak'), 'and the copy leaves Recently deleted');
  // An older one (from an old file, say) is replaced by the copy, as Restore says.
  const older = { ...copy, title: 'Kayak', updatedAt: copy.updatedAt - 5000 };
  ({ R, store } = standIn({ ...x.docs, 'wishes/w_kayak': older }));
  await R.restoreEntries(R.binGroupOf('wishes~w_kayak'));
  assert.deepEqual(store.get('wishes/w_kayak'), copy);
  // The page can still show a record it just deleted (the news that it went comes a moment later): put back all the same.
  const s3 = standIn(x.docs);
  const gone = await s3.R.binMany([['wishes', 'w_lamp']]);
  assert.ok(s3.S.wishes.has('w_lamp') && !s3.store.has('wishes/w_lamp'), '(the page hasn’t heard yet)');
  await s3.R.restoreEntries(gone);
  assert.deepEqual(s3.store.get('wishes/w_lamp'), x.docs['wishes/w_lamp'], 'back');
  assert.ok(!s3.store.has('bin/wishes~w_lamp'));
  // Newer on the page but gone from the database by now: put back too, never lost.
  const s4 = standIn(x.docs);
  const gone4 = await s4.R.binMany([['wishes', 'w_lamp']]);
  s4.S.wishes.set('w_lamp', { ...x.docs['wishes/w_lamp'], title: 'Reading lamp (brass)', updatedAt: Date.now() + 1000 });
  await s4.R.restoreEntries(gone4);
  assert.deepEqual(s4.store.get('wishes/w_lamp'), x.docs['wishes/w_lamp'], 'back from its copy');
  assert.ok(!s4.store.has('bin/wishes~w_lamp'));
});

test('clearing Recently deleted looks at each entry again just before it goes: one deleted again since stays', async () => {
  const x = extrasFixture('2026-10-22');
  const old = Date.now() - 8 * 864e5;
  for (const k of Object.keys(x.docs)) if (k.startsWith('bin/')) x.docs[k] = { ...x.docs[k], deletedAt: old };
  const { R, S, store } = standIn(x.docs);
  const done = R.purgeBin(false);
  // While the first ones go, the date is put back on another device and deleted again: a fresh copy, kept 7 more days.
  const fresh = { ...S.bin.get('dates~d_party'), deletedAt: Date.now() };
  S.bin.set('dates~d_party', fresh);
  store.set('bin/dates~d_party', fresh);
  await done;
  assert.deepEqual(store.get('bin/dates~d_party'), fresh, 'the fresh copy stays');
  for (const k of Object.keys(x.docs)) if (k.startsWith('bin/') && k !== 'bin/dates~d_party') assert.ok(!store.has(k), `older than 7 days, gone: ${k}`);
});

test('a group whose copy can’t be kept in Recently deleted isn’t deleted at all', async () => {
  const x = extrasFixture('2026-10-22');
  const { R, store, log, toasts } = standIn(x.docs, new Set(['bin/shopItems~si_eggs']));
  const gone = await R.binMany([['shopLists', 'sl_groceries'], ['wishes', 'w_lamp']], 'Deleted');
  assert.deepEqual(gone.map(([c, id]) => `${c}/${id}`), ['wishes/w_lamp'], 'only the wish went');
  for (const k of ['shopLists/sl_groceries', 'shopItems/si_milk', 'shopItems/si_eggs']) assert.deepEqual(store.get(k), x.docs[k], `kept: ${k}`);
  assert.ok(!log.some(([k, p]) => k === 'delete' && /^(shopLists|shopItems)\//.test(p)), 'nothing in the list was deleted');
  for (const k of ['shopLists~sl_groceries', 'shopItems~si_milk', 'shopItems~si_eggs']) assert.ok(!store.has('bin/' + k), `its other copies were taken back out: ${k}`);
  assert.ok(store.has('bin/wishes~w_lamp'), 'the wish went to Recently deleted');
  assert.match(toasts[toasts.length - 1].msg, /Couldn’t keep a copy in Recently deleted, so it wasn’t deleted/);
});
