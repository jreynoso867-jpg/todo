// The Wish list, opened from its card on the Lists tab: chips to show one kind (All, Travel, Food, Plans, Shopping,
// Other), a card per wish (its kind, its words, its price, a heart to tap, its link), "+ New wish" and its sheet (the
// words, the kind, a price, a web link, a note), Got it (a folded group at the bottom) and Not yet, and delete into
// Recently deleted. Everything is saved as the records of sections.test.cjs (wishes/, Recently deleted in bin/), and
// nothing else is touched.
// Usage: node --test tests/wishes.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, withExtras, launch, phoneContext, seed, dump } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with the fixture on it (the wishes of lib.cjs's extras unless given), opened on Lists.
async function phone(fx = withExtras(smallFixture()), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (o.init) await page.addInitScript(o.init);
  fx.local['todo.tab'] = o.tab || 'lists';
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#dock:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const inColl = (docs, c) => Object.entries(docs).filter(([k]) => k.startsWith(c + '/'));
const focused = page => page.evaluate(() => { const a = document.activeElement; return a.id || Object.entries(a.dataset).map(([k, v]) => `${k}=${v}`).join(' '); });
const openWishes = async page => { await page.click('#listsWish'); await page.waitForSelector('#wishView:not([hidden])'); };
// The cards showing, in order: [id, kind label, words, price, hearted, link].
const cards = (page, sel = '#wishGrid') => page.$$eval(sel + ' .wish-card', els => els.map(e => [
  e.dataset.wishCard, e.querySelector('.wish-cat').textContent, e.querySelector('.wish-name').textContent,
  (e.querySelector('.wish-price') || {}).textContent || '', e.querySelector('.wish-heart').getAttribute('aria-pressed') === 'true',
  e.querySelector('a.wish-link') ? e.querySelector('a.wish-link').getAttribute('href') : null]));
const chips = page => page.$$eval('#wishChips .chip', els => els.map(e => [e.textContent, e.getAttribute('aria-pressed')]));
const wish = (title, category, rank, more = {}) => ({ title, category, priceCents: null, link: null, hearted: false, got: false, gotAt: null,
  note: '', rank, createdAt: 1700000000000 + rank, updatedAt: 1700000000000 + rank, ...more });

test('a new wish made by tapping: the right record is saved, nothing else changes, and the heart is kept at once and after a reload', async () => {
  const fx = smallFixture();
  const { ctx, page, errors } = await phone(fx);
  // The Wish list's card on Lists, under the shopping lists.
  assert.ok(await page.isVisible('#moreCards'), 'the Wish list card shows');
  assert.equal(await page.textContent('#listsWishSub'), 'None yet');
  await openWishes(page);
  assert.equal(await page.textContent('#wishPaneTitle'), 'Wish list');
  assert.equal(await page.textContent('#wishSub'), 'Places, things and plans you want');
  assert.equal(await focused(page), 'wishPaneTitle', 'the heading, for a screen reader');
  assert.ok(await page.isVisible('#wishBack') && await page.isHidden('#listsHome'), 'in place of the cards, with a way back');
  assert.ok(await page.isVisible('#wishEmpty'));
  assert.equal(await page.textContent('#newBtn'), 'New wish', '"+ New wish" on the Wish list');
  assert.ok(await page.isHidden('#shopBar'), 'no shopping add bar here');
  await page.click('#newBtn');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.textContent('#wishSheetTitle'), 'New wish');
  assert.equal(await focused(page), 'wishName');
  assert.ok(await page.isHidden('#wishGotBtn') && await page.isHidden('#wishDelete'), 'nothing to tick off or delete yet');
  await page.click('#wishSave');
  assert.ok(await page.isVisible('#wishNameError'), 'it needs its words');
  assert.equal(await focused(page), 'wishName');
  await page.fill('#wishName', '  Sofa   bed for the den ');
  await page.click('#wishCats [data-wish-pick="shopping"]');
  assert.equal(await page.getAttribute('#wishCats [data-wish-pick="shopping"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#wishCats [data-wish-pick="other"]', 'aria-pressed'), 'false');
  await page.fill('#wishPrice', '$8,999');
  await page.fill('#wishLink', 'http://www.example.com/sofa?c=grey');
  await page.fill('#wishNote', 'Grey\nthree seats');
  await page.click('#wishSave');
  await page.waitForSelector('#wishSheet', { state: 'hidden' });
  await page.waitForTimeout(400);

  let d = (await dump(page)).docs;
  const made = inColl(d, 'wishes');
  assert.equal(made.length, 1);
  const [[key, w]] = made;
  const id = key.slice('wishes/'.length);
  assert.deepEqual(Object.keys(w).sort(), ['category', 'createdAt', 'got', 'gotAt', 'hearted', 'link', 'note', 'priceCents', 'rank', 'title', 'updatedAt']);
  assert.deepEqual({ ...w, createdAt: 0, updatedAt: 0 }, { title: 'Sofa bed for the den', category: 'shopping', priceCents: 899900,
    link: 'https://www.example.com/sofa?c=grey', hearted: false, got: false, gotAt: null, note: 'Grey\nthree seats', rank: 1000, createdAt: 0, updatedAt: 0 });
  assert.ok(Number.isInteger(w.priceCents), 'money is whole cents');
  assert.ok(w.createdAt > 0 && w.updatedAt === w.createdAt);
  // Every task, list and setting as it was; only the wish is new.
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual(Object.keys(d).filter(k => !(k in fx.docs)), [key], 'only the new wish');
  assert.ok(!Object.keys(d).some(k => (k.startsWith('tasks/') || k.startsWith('lists/')) && !(k in fx.docs)), 'no task or task list made');

  // Its card: the kind, the words, the price, the heart (off), its link, which opens in a new tab and tells the site nothing.
  assert.deepEqual(await cards(page), [[id, 'Shopping', 'Sofa bed for the den', '$8,999.00', false, 'https://www.example.com/sofa?c=grey']]);
  assert.deepEqual(await page.$eval('#wishGrid a.wish-link', a => [a.target, a.rel, a.getAttribute('aria-label')]),
    ['_blank', 'noopener noreferrer', 'Open the link for Sofa bed for the den']);
  assert.ok(await page.isHidden('#wishEmpty'));

  // The heart is kept the moment it's tapped (only hearted and updatedAt change), and after a reload.
  await page.click(`[data-wish-heart="${id}"]`);
  await page.waitForTimeout(400);
  assert.equal(await page.getAttribute(`[data-wish-heart="${id}"]`, 'aria-pressed'), 'true');
  assert.equal(await focused(page), `wishHeart=${id}`, 'focus stays on the heart');
  d = (await dump(page)).docs;
  assert.equal(d[key].hearted, true);
  assert.ok(d[key].updatedAt > w.updatedAt);
  assert.deepEqual({ ...d[key], hearted: false, updatedAt: 0 }, { ...w, updatedAt: 0 }, 'nothing else changed');
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  assert.ok(await page.isHidden('#wishView'), 'the Wish list is open for this visit only');
  assert.equal(await page.textContent('#listsWishSub'), '1 wish');
  await openWishes(page);
  assert.equal(await page.getAttribute(`[data-wish-heart="${id}"]`, 'aria-pressed'), 'true', 'still hearted after a reload');
  // Tapped again, it's off again.
  await page.click(`[data-wish-heart="${id}"]`);
  await page.waitForTimeout(400);
  assert.equal((await dump(page)).docs[key].hearted, false);

  // Opened by a tap, the sheet is filled in; a change is saved to the same record.
  await page.click(`[data-wish-open="${id}"]`);
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.textContent('#wishSheetTitle'), 'Edit wish');
  assert.deepEqual(await page.evaluate(() => ['#wishName', '#wishPrice', '#wishLink', '#wishNote'].map(s => document.querySelector(s).value)),
    ['Sofa bed for the den', '$8,999.00', 'https://www.example.com/sofa?c=grey', 'Grey\nthree seats']);
  assert.equal(await page.getAttribute('#wishCats [data-wish-pick="shopping"]', 'aria-pressed'), 'true');
  await page.fill('#wishPrice', '12.1');
  await page.click('#wishCats [data-wish-pick="plans"]');
  await page.click('#wishSave');
  await page.waitForTimeout(400);
  d = (await dump(page)).docs;
  assert.deepEqual([d[key].priceCents, d[key].category, d[key].title, d[key].createdAt], [1210, 'plans', 'Sofa bed for the den', w.createdAt]);
  assert.deepEqual(inColl(d, 'wishes').length, 1, 'no second wish');
  assert.deepEqual((await cards(page))[0].slice(1, 4), ['Plans', 'Sofa bed for the den', '$12.10']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('only a web link is kept: javascript: and other addresses are refused, and so is a price that isn\'t one', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openWishes(page);
  await page.click('[data-wish-open="w_lamp"]');
  await page.waitForSelector('#wishSheet.open');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(document.cookie)', 'data:text/html,<b>hi</b>', 'ftp://example.com/x', 'https://user:pw@example.com/']) {
    await page.fill('#wishLink', bad);
    await page.click('#wishSave');
    assert.ok(await page.isVisible('#wishLinkError'), `refused: ${bad}`);
    assert.ok(await page.isVisible('#wishSheet'), 'and the sheet stays open');
    assert.equal(await focused(page), 'wishLink');
  }
  await page.fill('#wishLink', '');
  for (const bad of ['abc', '-5', '12.345']) {
    await page.fill('#wishPrice', bad);
    await page.click('#wishSave');
    assert.ok(await page.isVisible('#wishPriceError'), `refused price: ${bad}`);
    assert.equal(await focused(page), 'wishPrice');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  let d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d[k], v, `nothing saved: ${k}`);
  // A new one with a script link isn't made either.
  await page.click('#newBtn');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.inputValue('#wishLink'), '', 'a new wish starts empty');
  assert.ok(await page.isHidden('#wishLinkError'), 'with no old message');
  await page.fill('#wishName', 'Concert tickets');
  await page.fill('#wishLink', 'javascript:alert(1)');
  await page.click('#wishSave');
  assert.ok(await page.isVisible('#wishLinkError'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  d = (await dump(page)).docs;
  assert.equal(inColl(d, 'wishes').length, inColl(fx.docs, 'wishes').length, 'no wish made');
  assert.equal(await page.$$eval('a[href^="javascript" i], [href*="alert("]', els => els.length), 0, 'no script link anywhere');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('words show exactly as typed: <b>, <img> and emoji are words, never page code', async () => {
  const fx = withExtras(smallFixture());
  const odd = '<img src=x onerror="window.__hit=1"> 🍕 <b>pizza</b> night';
  fx.docs['wishes/w_odd'] = wish(odd, 'food', 3500, { priceCents: 2500, note: '<i>not html</i>' });
  const { ctx, page, errors } = await phone(fx);
  await openWishes(page);
  assert.deepEqual((await cards(page)).map(c => c[2]), ['Trip to the coast', 'Reading lamp', odd]);
  assert.equal(await page.$$eval('#wishView b, #wishView img, #wishView i:not(.dot)', els => els.length), 0, 'no markup made from what was typed');
  assert.match(await page.getAttribute('[data-wish-open="w_odd"]', 'aria-label'), /^<img src=x onerror="window\.__hit=1"> 🍕 <b>pizza<\/b> night, Food, \$25\.00\. Edit the wish$/);
  await page.click('[data-wish-open="w_odd"]');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.inputValue('#wishName'), odd);
  assert.equal(await page.inputValue('#wishNote'), '<i>not html</i>');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Typed in the sheet: kept and shown as typed.
  await page.click('#newBtn');
  await page.fill('#wishName', '<b>Bold</b> 🎉 "quoted" & more');
  await page.click('#wishSave');
  await page.waitForTimeout(400);
  assert.equal((await cards(page)).pop()[2], '<b>Bold</b> 🎉 "quoted" & more');
  assert.equal(await page.$$eval('#paneLists b, #paneLists img', els => els.length), 0);
  assert.equal(await page.evaluate(() => window.__hit), undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the chips show one kind at a time (kept for the visit, never saved); prices read as dollars and cents', async () => {
  const fx = withExtras(smallFixture());
  fx.docs['wishes/w_show'] = wish('Comedy show', 'plans', 4000, { priceCents: 12345 });
  fx.docs['wishes/w_free'] = wish('Picnic', 'other', 5000, { priceCents: 0, hearted: true });
  fx.docs['wishes/w_coin'] = wish('Sticker', 'other', 6000, { priceCents: 5 });
  fx.docs['wishes/w_big'] = wish('House', 'other', 7000, { priceCents: 99999999999 });
  const { ctx, page, errors } = await phone(fx);
  const localBefore = (await dump(page)).local;
  assert.equal(await page.textContent('#listsWishSub'), '6 wishes · 1 got');
  await openWishes(page);
  assert.deepEqual(await chips(page), [['All', 'true'], ['Travel', 'false'], ['Food', 'false'], ['Plans', 'false'], ['Shopping', 'false'], ['Other', 'false']]);
  assert.deepEqual(await cards(page), [
    ['w_coast', 'Travel', 'Trip to the coast', '$35,000.00', true, 'https://example.com/coast'],
    ['w_lamp', 'Shopping', 'Reading lamp', '', false, null],
    ['w_show', 'Plans', 'Comedy show', '$123.45', false, null],
    ['w_free', 'Other', 'Picnic', '$0.00', true, null],
    ['w_coin', 'Other', 'Sticker', '$0.05', false, null],
    ['w_big', 'Other', 'House', '$999,999,999.99', false, null]]);
  // The kinds have their own icons; Travel's is the plane.
  assert.equal(await page.$$eval('#wishGrid .wish-cat svg', els => els.length), 6);
  assert.equal(await page.getAttribute('[data-wish-card="w_coast"]', 'class').then(c => c.includes('is-travel')), true);
  await page.click('#wishChips [data-wish-cat="travel"]');
  assert.deepEqual(await chips(page), [['All', 'false'], ['Travel', 'true'], ['Food', 'false'], ['Plans', 'false'], ['Shopping', 'false'], ['Other', 'false']]);
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_coast']);
  await page.click('#wishChips [data-wish-cat="other"]');
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_free', 'w_coin', 'w_big']);
  // Food has only one, and it's got: nothing to want, and Got it shows just that one.
  await page.click('#wishChips [data-wish-cat="food"]');
  assert.deepEqual(await cards(page), []);
  assert.equal(await page.textContent('#wishEmpty'), 'No food wishes waiting.');
  assert.equal(await page.textContent('#wishGotN'), '1');
  // Kept while the app is open: back to Lists and in again, Food is still picked.
  await page.click('#wishBack');
  await openWishes(page);
  assert.equal(await page.getAttribute('#wishChips [data-wish-cat="food"]', 'aria-pressed'), 'true');
  // A new wish of another kind shows All again, so it can be seen.
  await page.click('#newBtn');
  await page.fill('#wishName', 'Museum day');
  await page.click('#wishCats [data-wish-pick="plans"]');
  await page.click('#wishSave');
  await page.waitForTimeout(400);
  assert.equal(await page.getAttribute('#wishChips [data-wish-cat="all"]', 'aria-pressed'), 'true');
  assert.equal((await cards(page)).pop()[2], 'Museum day');
  // The chip is never saved: after a reload it's All, and no setting was written for it.
  await page.click('#wishChips [data-wish-cat="shopping"]');
  const localAfter = (await dump(page)).local;
  assert.deepEqual(Object.keys(localAfter).filter(k => k !== 'todo.saving').sort(), Object.keys(localBefore).filter(k => k !== 'todo.saving').sort(), 'no new setting on the phone');
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  await openWishes(page);
  assert.equal(await page.getAttribute('#wishChips [data-wish-cat="all"]', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Got it moves a wish into the folded Got it group; Not yet brings it back', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openWishes(page);
  assert.equal(await page.textContent('#wishGotN'), '1');
  assert.equal(await page.getAttribute('#wishGotToggle', 'aria-expanded'), 'false');
  assert.ok(await page.isHidden('#wishGotBox'), 'Got it starts folded');
  await page.click('[data-wish-open="w_coast"]');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.textContent('#wishGotBtn'), 'Got it');
  await page.click('#wishGotBtn');
  await page.waitForSelector('#wishSheet', { state: 'hidden' });
  await page.waitForTimeout(400);
  let d = (await dump(page)).docs;
  const coast = d['wishes/w_coast'];
  assert.equal(coast.got, true);
  assert.ok(coast.gotAt > 0 && coast.updatedAt > fx.docs['wishes/w_coast'].updatedAt);
  assert.deepEqual({ ...coast, got: false, gotAt: null, updatedAt: 0 }, { ...fx.docs['wishes/w_coast'], updatedAt: 0 }, 'only got, gotAt and updatedAt change');
  for (const [k, v] of Object.entries(fx.docs)) if (k !== 'wishes/w_coast') assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_lamp']);
  assert.equal(await page.textContent('#wishGotN'), '2');
  assert.ok(await page.isHidden('#wishGotBox'), 'still folded');
  assert.match(await page.textContent('#toastMsg'), /Got it/);
  assert.equal(await page.textContent('#listsWishSub'), '1 wish · 2 got', 'the Lists card counts it');
  await page.click('#wishGotToggle');
  assert.equal(await page.getAttribute('#wishGotToggle', 'aria-expanded'), 'true');
  assert.deepEqual((await cards(page, '#wishGotBox')).map(c => c[0]), ['w_coast', 'w_ramen']);
  // Not yet: back with the others, where it was.
  await page.click('#wishGotBox [data-wish-open="w_coast"]');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.textContent('#wishGotBtn'), 'Not yet');
  await page.click('#wishGotBtn');
  await page.waitForSelector('#wishSheet', { state: 'hidden' });
  await page.waitForTimeout(400);
  d = (await dump(page)).docs;
  assert.equal(d['wishes/w_coast'].got, false);
  assert.equal(d['wishes/w_coast'].gotAt, null);
  assert.deepEqual({ ...d['wishes/w_coast'], updatedAt: 0 }, { ...fx.docs['wishes/w_coast'], updatedAt: 0 });
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_coast', 'w_lamp']);
  assert.deepEqual((await cards(page, '#wishGotBox')).map(c => c[0]), ['w_ramen']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a heart tapped draws only its own card again (focus stays on it), and Got it\'s cards are made only once it\'s unfolded', async () => {
  const fx = withExtras(smallFixture());
  for (let i = 0; i < 12; i++) fx.docs['wishes/w_x' + i] = wish('Wish ' + i, 'other', 5000 + i * 1000);
  const { ctx, page, errors } = await phone(fx);
  await openWishes(page);
  assert.equal(await page.$$eval('#wishGotBox .wish-card', els => els.length), 0, 'folded: nothing made in it');
  const order = (await cards(page)).map(c => c[0]);
  await page.$$eval('#wishGrid .wish-card', els => els.forEach(e => { e.__drawn = true; }));
  await page.focus('[data-wish-heart="w_x3"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.equal((await dump(page)).docs['wishes/w_x3'].hearted, true);
  const again = await page.$$eval('#wishGrid .wish-card', els => els.filter(e => !e.__drawn).map(e => e.dataset.wishCard));
  assert.deepEqual(again, ['w_x3'], 'only the card tapped is drawn again');
  assert.deepEqual((await cards(page)).map(c => c[0]), order, 'in the same order');
  assert.equal(await page.getAttribute('[data-wish-heart="w_x3"]', 'aria-pressed'), 'true');
  assert.equal(await focused(page), 'wishHeart=w_x3', 'focus stays on its heart');
  await page.click('#wishGotToggle');
  assert.deepEqual((await cards(page, '#wishGotBox')).map(c => c[0]), ['w_ramen'], 'unfolded: made then');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Delete sends a wish to Recently deleted with Undo, and Restore there brings it back exactly as it was', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openWishes(page);
  const before = (await dump(page)).docs;
  await page.click('[data-wish-open="w_lamp"]');
  await page.waitForSelector('#wishSheet.open');
  assert.ok(await page.isVisible('#wishDelete'));
  await page.click('#wishDelete');
  await page.waitForTimeout(700);
  assert.ok(await page.isHidden('#wishSheet'));
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Reading lamp”');
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_coast']);
  let d = (await dump(page)).docs;
  assert.equal(d['wishes/w_lamp'], undefined, 'gone from the list');
  const e = d['bin/wishes~w_lamp'];
  assert.deepEqual(e, { coll: 'wishes', id: 'w_lamp', doc: before['wishes/w_lamp'], group: null, deletedAt: e.deletedAt }, 'kept in Recently deleted as it was');
  assert.ok(!Object.keys(d).some(k => k.startsWith('trash/') && !(k in before)), 'never in the tasks\' trash');
  await page.click('#toastUndo');
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back after Undo: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_coast', 'w_lamp']);

  // Deleted again, then put back from Recently deleted (on Tasks), by its name and kind.
  await page.click('[data-wish-open="w_lamp"]');
  await page.waitForSelector('#wishSheet.open');
  await page.click('#wishDelete');
  await page.waitForTimeout(700);
  await page.click('#dockToday');
  await page.click('#trashOpen');
  await page.waitForSelector('#trashSheet.open');
  const row = await page.$eval('[data-restore-bin="wishes~w_lamp"]', b => { const r = b.closest('.trash-row'); return [r.querySelector('.trash-meta').textContent, r.textContent]; });
  assert.equal(row[0], 'Wish · Deleted today');
  assert.match(row[1], /Reading lamp/);
  await page.click('[data-restore-bin="wishes~w_lamp"]');
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `exactly as before: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#dockLists');
  await openWishes(page);
  assert.deepEqual((await cards(page)).map(c => c[0]), ['w_coast', 'w_lamp']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Wish list: Back, Escape and another tab close it; N adds a wish there; nothing behind its sheet can be reached', async () => {
  const { ctx, page, errors } = await phone();
  const inert = () => page.evaluate(() => ['#shopBar', '#dock', '#newBtn', '#fab', '#app'].map(s => document.querySelector(s).inert));
  await openWishes(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#wishView') && await page.isVisible('#listsHome'), 'Escape: back to the cards');
  assert.equal(await focused(page), 'listsWish', 'focus back on its card');
  assert.equal(await page.textContent('#newBtn'), 'New list', 'and "+ New" is for a list again');
  await openWishes(page);
  await page.click('#wishBack');
  assert.ok(await page.isHidden('#wishView'), 'Back');
  await openWishes(page);
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#wishView'), 'Lists tapped again: back to the cards');
  await openWishes(page);
  await page.click('#dockHome');
  assert.ok(await page.isHidden('#newBtn') || await page.textContent('#newBtn') !== 'New wish', 'no "+ New wish" on another tab');
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#wishView') && await page.isVisible('#listsHome'), 'another tab closed it');

  // N: on the Wish list, a new wish; Escape closes the sheet first, then the Wish list.
  await openWishes(page);
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  await page.keyboard.press('n');
  await page.waitForSelector('#wishSheet.open');
  assert.equal(await page.textContent('#wishSheetTitle'), 'New wish');
  assert.equal(await page.inputValue('#wishName'), '', 'the key itself isn\'t typed');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.keyboard.press('n'); // typed into the sheet, not another sheet
  assert.equal(await page.inputValue('#wishName'), 'n');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#wishSheet') && await page.isVisible('#wishView'), 'Escape closes the sheet first');
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  // A card's sheet closes with a tap outside, and focus goes back to the card.
  await page.click('[data-wish-open="w_coast"]');
  await page.waitForSelector('#wishSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.click('#scrim', { position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#wishSheet'), 'a tap outside closes it');
  assert.equal(await focused(page), 'wishOpen=w_coast');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#wishView'));
  // A shopping list and the Wish list don't get in each other's way.
  await page.click('[data-shop-open="sl_groceries"]');
  await page.waitForSelector('#shopView:not([hidden])');
  assert.ok(await page.isHidden('#wishView') && await page.isVisible('#shopBar'));
  await page.click('#shopBack');
  await openWishes(page);
  assert.ok(await page.isHidden('#shopView') && await page.isHidden('#shopBar'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no sideways scrolling at 320 points with Extra large text, on the Wish list and its sheet (Classic, Midnight, Blush)', async () => {
  for (const look of ['classic', 'midnight', 'blush']) {
    const fx = withExtras(smallFixture());
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    fx.docs['wishes/w_long'] = wish('Supercalifragilisticexpialidocious hot-air balloon ride over the valley at sunrise', 'travel', 500,
      { priceCents: 99999999999, link: 'https://example.com/a/very/long/path/that/goes/on/and/on', hearted: true });
    fx.docs['wishes/w_long2'] = wish('Extraordinarilylongwordwithoutanyspacesatallforthetest', 'shopping', 600, { priceCents: 123456 });
    const { ctx, page, errors } = await phone(fx, { viewport: { width: 320, height: 640 } });
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
    assert.deepEqual(await check('#moreCards, #listsWish'), [], `${look}: the Lists card`);
    await openWishes(page);
    assert.deepEqual(await check('#wishView .wish-card, .wish-heart, .wish-link, .wish-name, .wish-price, #wishBack, #wishChips, #wishGotToggle, #newBtn'), [], `${look}: the Wish list`);
    // The chips row scrolls on its own, inside the screen; every chip can be reached.
    await page.click('#wishChips [data-wish-cat="other"]');
    assert.equal(await page.getAttribute('#wishChips [data-wish-cat="other"]', 'aria-pressed'), 'true');
    await page.click('#wishChips [data-wish-cat="all"]');
    // The last card isn't hidden under "+ New wish" when scrolled to the bottom.
    await page.click('#wishGotToggle');
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector('#newBtn').getBoundingClientRect().top - [...document.querySelectorAll('#wishView .wish-card')].pop().getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `${look}: the last card clears "+ New wish" (${gap})`);
    await page.click('[data-wish-open="w_long"]');
    await page.waitForSelector('#wishSheet.open');
    await page.waitForTimeout(400);
    assert.deepEqual(await check('#wishSheet .field, #wishSheet input, #wishSheet textarea, #wishSheet button'), [], `${look}: the sheet`);
    assert.ok(await page.$eval('#wishSheet', s => s.scrollWidth <= s.clientWidth + 1), `${look}: the sheet doesn't scroll sideways`);
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

test('on a wish card in Blush (light and dark), the raspberry kind, the heart and the link read clearly on the card as it really shows', async () => {
  for (const mode of ['light', 'dark']) {
    const fx = withExtras(smallFixture());
    fx.docs['settings/theme'] = { look: 'blush', appearance: mode, accent: '' };
    const { ctx, page, errors } = await phone(fx);
    await openWishes(page);
    const got = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const v = n => root.getPropertyValue(n).trim();
      const cs = sel => getComputedStyle(document.querySelector(sel));
      return {
        look: document.documentElement.dataset.look, mode: document.documentElement.dataset.mode,
        page: v('--page'), tint: v('--page-tint'), solid: v('--card-solid'), pop: v('--pop'), popInk: v('--pop-ink'),
        card: cs('[data-wish-card="w_lamp"]').backgroundColor,
        label: cs('[data-wish-card="w_lamp"] .wish-cat').color,
        travel: cs('[data-wish-card="w_coast"] .wish-cat').color,
        heart: cs('[data-wish-heart="w_coast"] svg').fill,
        heartOff: cs('[data-wish-heart="w_lamp"] svg').stroke,
        link: cs('[data-wish-card="w_coast"] .wish-link').color,
        name: cs('[data-wish-card="w_lamp"] .wish-name').color,
        price: cs('[data-wish-card="w_coast"] .wish-price').color,
      };
    });
    assert.deepEqual([got.look, got.mode], ['blush', mode]);
    for (const k of ['page', 'tint', 'solid']) assert.match(got[k], /^#[0-9A-F]{6}$/i, `${mode}: ${k} is a solid color`);
    assert.equal(parse(got.label).rgb.join(), parse(got.popInk).rgb.join(), `${mode}: the kind is in raspberry (--pop-ink)`);
    assert.equal(parse(got.heart).rgb.join(), parse(got.pop).rgb.join(), `${mode}: a hearted heart is raspberry (--pop)`);
    assert.notEqual(parse(got.travel).rgb.join(), parse(got.popInk).rgb.join(), `${mode}: Travel is in the quiet ink, like the screenshot`);
    // The card as it shows: its see-through fill over the page at its lightest and deepest, and the solid card color.
    const card = parse(got.card);
    const grounds = { 'card over the page': over(card, parse(got.page).rgb), 'card over the deepest page': over(card, parse(got.tint).rgb), 'solid card': parse(got.solid).rgb };
    const bad = [];
    for (const [where, ground] of Object.entries(grounds)) {
      const need = (name, color, min) => {
        const c = parse(color);
        const r = ratio(over(c, ground), ground);
        if (!(r >= min)) bad.push(`${mode}: ${name} ${color} on ${where}: ${r.toFixed(2)} (needs ${min})`);
      };
      need('kind label', got.label, 4.5);
      need('Travel label', got.travel, 4.5);
      need('words', got.name, 4.5);
      need('price', got.price, 4.5);
      need('heart', got.heart, 3);
      need('heart (off)', got.heartOff, 3);
      need('link button', got.link, 3);
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
