// Data preservation: a phone that used the old app opens the new one. Every record and photo must come through
// unchanged (only new, additive settings may appear), and every task must still show up.
// Usage: node --test tests/upgrade.test.cjs   (OLD_REF picks the old version; default: the commit before the redesign)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { serve, smallFixture, largeFixture, withExtras, EXTRA_COLLS, launch, phoneContext, seed, dump } = require('./lib.cjs');

const REPO = path.resolve(__dirname, '..');
const OLD_REF = process.env.OLD_REF || 'fd3731e';
// The last version before shopping lists, wishes, savings goals and important dates: another device (or the website)
// may still run it on the same list, so it must leave those alone.
const PRE_SECTIONS_REF = process.env.PRE_SECTIONS_REF || '58a3ff2';
const NEW_DIR = path.resolve(process.env.NEW_DIR || REPO);

function checkout(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-old-'));
  const tar = execFileSync('git', ['-C', REPO, 'archive', ref], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return dir;
}

// Records the new version may add. Anything else that changes fails the test.
const ADDED_OK = /^(settings\/theme|settings\/prefs)$/;
const LOCAL_ADDED_OK = /^todo\.(saving|theme|appearance|accent|prefs|snapLast|version|lastExport|scope|alerted|focus|summarySeen|motivation)/;

async function openApp(page, url) {
  await page.goto(url + '/index.html');
  await page.waitForSelector('#board .task, #hero[data-id]:not([data-id=""])', { timeout: 30000 });
  await page.waitForTimeout(7000); // past the app's delayed housekeeping (trash purge at 6 s, history prune at 5 s)
}

async function shownTitles(page) {
  return page.evaluate(async () => {
    const t = document.querySelector('#doneToggle');
    if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
    await new Promise(r => setTimeout(r, 50));
    const out = new Set();
    for (const el of document.querySelectorAll('#board .task-title, #heroTitle')) out.add(el.textContent.trim());
    return [...out];
  });
}

for (const [name, make] of [['small', smallFixture], ['small, with shopping lists, wishes, goals and dates', () => withExtras(smallFixture())], ['large', () => largeFixture(undefined, 600)]]) {
  test(`upgrade keeps every record (${name} list)`, { timeout: 180000 }, async () => {
    const oldDir = checkout(OLD_REF);
    const srv = await serve(oldDir);
    const browser = await launch();
    try {
      const ctx = await phoneContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const fx = make();
      await seed(page, srv.url, fx);

      // 1. The old app, as it runs on the phone today.
      await openApp(page, srv.url);
      const before = await dump(page);
      for (const k of Object.keys(fx.docs)) assert.ok(k in before.docs, `the old app kept the seeded record ${k}`);

      // 2. Same phone, same storage: the new version opens.
      srv.state.root = NEW_DIR;
      await openApp(page, srv.url);
      const after = await dump(page);
      assert.deepEqual(errors, [], 'no script errors');

      for (const [k, v] of Object.entries(before.docs)) {
        assert.ok(k in after.docs, `record kept: ${k}`);
        assert.deepEqual(after.docs[k], v, `record unchanged: ${k}`);
      }
      for (const k of Object.keys(after.docs)) if (!(k in before.docs)) assert.match(k, ADDED_OK, `only additive records appear: ${k}`);
      assert.deepEqual(Object.keys(after.blobs).filter(k => !/^snap(meta)?:/.test(k)).sort(), Object.keys(before.blobs).sort(), 'every photo kept');
      // The upgrade made a safety copy of exactly what the old app had.
      const snapKeys = Object.keys(after.blobs).filter(k => k.startsWith('snap:upgrade:'));
      if (after.local['todo.version']) assert.equal(snapKeys.length, 1, 'the upgrade made one safety copy');
      if (snapKeys.length) {
        const copy = JSON.parse(Buffer.from(after.blobs[snapKeys[0]].bytes).toString('utf8'));
        assert.deepEqual(copy, before.docs, 'the upgrade safety copy holds the whole list as it was');
      }
      for (const [k, v] of Object.entries(before.blobs)) assert.deepEqual(after.blobs[k], v, `photo unchanged: ${k}`);
      for (const [k, v] of Object.entries(before.local)) if (k !== 'todo.celebrated') assert.equal(after.local[k], v, `setting kept: ${k}`);
      for (const k of Object.keys(after.local)) if (!(k in before.local)) assert.match(k, LOCAL_ADDED_OK, `only additive settings: ${k}`);

      // 3. Every task the old app showed is still on screen in the new one.
      if (name.startsWith('small')) {
        const titles = await shownTitles(page);
        for (const [k, d] of Object.entries(fx.docs)) {
          if (!k.startsWith('tasks/')) continue;
          assert.ok(titles.includes(d.title), `task shown: ${d.title}`);
        }
        // The photo still loads from the phone's storage.
        await page.evaluate(() => (document.querySelector('.task[data-id="t_today_timed"] .task-body') || document.querySelector('#heroOpen')).click());
        await page.waitForTimeout(400);
        const ok = await page.evaluate(async () => {
          const im = document.querySelector('#sheetPhotos img');
          if (!im) return 'no img';
          for (let i = 0; i < 40 && !(im.complete && im.naturalWidth); i++) await new Promise(r => setTimeout(r, 100));
          return im.naturalWidth > 0 ? true : 'not loaded';
        });
        assert.equal(ok, true, 'photo shows');
      }
      await ctx.close();
    } finally {
      await browser.close();
      await srv.close();
    }
  });
}

// The other way round: a list that has the newer kinds is opened by the version before them (another device, the website
// not yet updated). It doesn't know them, so it must leave every one alone, Recently deleted copies too (even one older
// than 7 days, which that version's own clear-out doesn't look at), and put nothing into the tasks or their trash.
test('an older version opening the list leaves the shopping lists, wishes, goals and dates alone', { timeout: 180000 }, async () => {
  const oldDir = checkout(PRE_SECTIONS_REF);
  const srv = await serve(oldDir);
  const browser = await launch();
  try {
    const ctx = await phoneContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const fx = withExtras(smallFixture());
    const old = Date.now() - 9 * 864e5;
    fx.docs['bin/wishes~w_old'] = { coll: 'wishes', id: 'w_old', group: null, deletedAt: old,
      doc: { title: 'Old wish', category: 'other', priceCents: null, link: null, hearted: false, got: false, gotAt: null, note: '', rank: 1, createdAt: old, updatedAt: old } };
    await seed(page, srv.url, fx);
    const seeded = await dump(page);
    await openApp(page, srv.url); // and 7 s more, past its delayed housekeeping
    const after = await dump(page);
    assert.deepEqual(errors, [], 'no script errors');
    const newer = Object.keys(fx.docs).filter(k => [...EXTRA_COLLS, 'bin'].includes(k.slice(0, k.indexOf('/'))));
    assert.ok(newer.length >= 20);
    for (const k of newer) {
      assert.ok(k in seeded.docs && k in after.docs, `kept: ${k}`);
      assert.deepEqual(after.docs[k], seeded.docs[k], `left alone: ${k}`);
    }
    for (const k of Object.keys(after.docs)) if (!(k in seeded.docs)) assert.ok(!/^(tasks|trash)\//.test(k), `nothing new in the tasks or their trash: ${k}`);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
