// Shopping lists on the Lists tab: a card for each (its dot, name and first items; ⋮ to rename, recolor or delete),
// one list open at a time with a circle to tick each item, Done folded at the bottom, Clear done (with Undo), and an
// add bar over the tab bar that turns a pasted web link into the item's link. Everything is saved as the records of
// sections.test.cjs (shopLists/, shopItems/, Recently deleted in bin/), and nothing else is touched.
// Usage: node --test tests/shopping.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, withExtras, launch, phoneContext, seed, dump } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with the fixture on it (the shopping lists of lib.cjs's extras unless given), opened on Lists.
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
const rows = (page, sel = '#shopRows') => page.$$eval(sel + ' .shop-row', els => els.map(e => e.querySelector('.shop-text').textContent));
const cards = page => page.$$eval('#shopCards .shop-card', els => els.map(e => ({
  id: e.dataset.shopCard, name: e.querySelector('.lcard-name').textContent,
  items: [...e.querySelectorAll('.lcard-item')].map(i => i.textContent), more: (e.querySelector('.lcard-more') || {}).textContent || '' })));
const focused = page => page.evaluate(() => { const a = document.activeElement; return a.id || Object.entries(a.dataset).map(([k, v]) => `${k}=${v}`).join(' '); });
const openList = async (page, id) => { await page.click(`[data-shop-open="${id}"]`); await page.waitForSelector('#shopView:not([hidden])'); };
const item = (list, text, rank, more = {}) => ({ list, text, link: null, done: false, doneAt: null, rank, createdAt: 1700000000000 + rank, updatedAt: 1700000000000 + rank, ...more });

test('a new shopping list and its items, made by tapping: the right records are saved and nothing else is touched', async () => {
  const fx = smallFixture();
  const { ctx, page, errors } = await phone(fx);
  // Something half typed in the task box stays as it is: the shopping list has its own add bar.
  await page.click('#dockToday');
  await page.fill('#quickInput', 'half a task');
  await page.click('#dockLists');
  assert.ok(await page.isVisible('#shopTitle'), 'a Shopping lists heading');
  assert.match(await page.textContent('#shopCardsEmpty'), /^No shopping lists yet/);
  assert.equal(await page.textContent('#newBtn'), 'New list', '"+ New list" on Lists makes a shopping list');
  await page.click('#newBtn');
  await page.waitForSelector('#shopSheet.open');
  assert.equal(await focused(page), 'shopNameInput');
  await page.click('#shopSave');
  assert.ok(await page.isVisible('#shopNameError'), 'a name is needed');
  await page.fill('#shopNameInput', '  Weekend   shop ');
  await page.click('#shopColors [data-color="6"]');
  await page.click('#shopSave');
  await page.waitForSelector('#shopView:not([hidden])');
  assert.equal(await page.textContent('#shopName'), 'Weekend shop');
  assert.equal(await page.getAttribute('#shopInput', 'placeholder'), 'Add to Weekend shop…');
  assert.equal(await focused(page), 'shopInput', 'straight on to the first item');
  assert.ok(await page.isVisible('#shopBar') && await page.isHidden('#newBtn'), 'the add bar takes the place of "+ New"');
  assert.ok(await page.isVisible('#shopBack'), 'a way back');
  // Enter or the arrow adds; a web link at the end (or alone) is the item's link, http moved up to https.
  await page.keyboard.type('Milk');
  await page.keyboard.press('Enter');
  await page.fill('#shopInput', 'Sunscreen SPF 50 https://example.com/spf50?size=2');
  await page.click('#shopAdd');
  await page.fill('#shopInput', 'http://www.example.com/a-lamp');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.deepEqual(await rows(page), ['Milk', 'Sunscreen SPF 50', 'example.com']);
  assert.equal(await page.inputValue('#shopInput'), '');
  assert.equal(await focused(page), 'shopInput', 'ready for the next one');
  const d = await dump(page);
  const lists = inColl(d.docs, 'shopLists');
  assert.equal(lists.length, 1);
  const [[lkey, l]] = lists;
  const lid = lkey.slice('shopLists/'.length);
  assert.deepEqual({ ...l, createdAt: 0, updatedAt: 0 }, { name: 'Weekend shop', color: 6, order: 1, createdAt: 0, updatedAt: 0 });
  assert.ok(l.createdAt > 0 && l.updatedAt === l.createdAt);
  const items = inColl(d.docs, 'shopItems').map(([, v]) => v).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(items.map(i => [i.list, i.text, i.link, i.done, i.doneAt, i.rank]), [
    [lid, 'Milk', null, false, null, 1000],
    [lid, 'Sunscreen SPF 50', 'https://example.com/spf50?size=2', false, null, 2000],
    [lid, 'example.com', 'https://www.example.com/a-lamp', false, null, 3000]]);
  for (const i of items) assert.ok(i.createdAt > 0 && i.updatedAt === i.createdAt);
  // Every task, list and setting as it was; no task made from anything typed here.
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d.docs[k], v, `unchanged: ${k}`);
  assert.deepEqual(Object.keys(d.docs).filter(k => !(k in fx.docs)).map(k => k.slice(0, k.indexOf('/'))).sort(),
    ['shopItems', 'shopItems', 'shopItems', 'shopLists'], 'only the new list and its items');
  // A link opens in a new tab and tells the site nothing.
  const links = await page.$$eval('#shopView a', els => els.map(a => [a.getAttribute('href'), a.target, a.rel, a.getAttribute('aria-label')]));
  assert.deepEqual(links, [
    ['https://example.com/spf50?size=2', '_blank', 'noopener noreferrer', 'Open the link for Sunscreen SPF 50'],
    ['https://www.example.com/a-lamp', '_blank', 'noopener noreferrer', 'Open the link for example.com']]);
  // Back to the cards: this one has its dot, its name and its items, and focus goes back to it.
  await page.click('#shopBack');
  await page.waitForSelector('#shopView', { state: 'hidden' });
  assert.ok(await page.isHidden('#shopBar'));
  assert.deepEqual(await cards(page), [{ id: lid, name: 'Weekend shop', items: ['Milk', 'Sunscreen SPF 50', 'example.com'], more: '' }]);
  assert.equal(await page.$eval('.shop-card .dot', e => e.closest('.c6') !== null), true, 'its color');
  assert.equal(await focused(page), `shopOpen=${lid}`);
  assert.ok(await page.isHidden('#shopCardsEmpty'));
  await page.click('#dockToday');
  assert.equal(await page.inputValue('#quickInput'), 'half a task', 'the task box untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a card shows the first four things to get and how many more', async () => {
  const fx = withExtras(smallFixture());
  for (let i = 1; i <= 7; i++) fx.docs[`shopItems/si_x${i}`] = item('sl_hardware', `Thing ${i}`, 1000 + i * 1000, i === 3 ? { done: true, doneAt: 1700000500000 } : {});
  const { ctx, page, errors } = await phone(fx);
  assert.deepEqual(await cards(page), [
    { id: 'sl_groceries', name: 'Groceries', items: ['Milk'], more: '' },
    { id: 'sl_hardware', name: 'Hardware <b>store</b> 🔧', items: ['Wood screws 日本語', 'Thing 1', 'Thing 2', 'Thing 4'], more: '+3' }]);
  assert.match(await page.getAttribute('[data-shop-open="sl_hardware"]', 'aria-label'), /^Hardware <b>store<\/b> 🔧, 7 items to get\. Open the list$/);
  // The order on the tab: Shopping lists first, then the task lists.
  const order = await page.$$eval('#paneLists h2', els => els.filter(e => e.offsetParent).map(e => e.textContent));
  assert.deepEqual(order.slice(0, 2), ['Shopping lists', 'Task lists']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ticking moves an item under Done (still there after a reload); Clear done goes to Recently deleted, and Undo brings it back', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openList(page, 'sl_groceries');
  assert.equal(await focused(page), 'shopName', 'the list\'s name, for a screen reader');
  assert.deepEqual(await rows(page), ['Milk']);
  assert.equal(await page.getAttribute('[data-shop-tick="si_milk"]', 'aria-checked'), 'false');
  assert.equal(await page.textContent('#shopDoneN'), '1');
  assert.equal(await page.getAttribute('#shopDoneToggle', 'aria-expanded'), 'false');
  assert.ok(await page.isHidden('#shopDoneBox'), 'Done starts folded');
  await page.click('[data-shop-tick="si_milk"]');
  await page.waitForTimeout(400);
  let d = (await dump(page)).docs;
  const milk = d['shopItems/si_milk'];
  assert.equal(milk.done, true);
  assert.ok(milk.doneAt > 0 && milk.updatedAt > fx.docs['shopItems/si_milk'].updatedAt);
  assert.deepEqual({ ...milk, done: false, doneAt: null, updatedAt: 0 }, { ...fx.docs['shopItems/si_milk'], updatedAt: 0 }, 'only done, doneAt and updatedAt change');
  assert.deepEqual(await rows(page), []);
  assert.equal(await page.textContent('#shopDoneN'), '2');
  assert.match(await page.textContent('#shopEmpty'), /ticked off/);
  assert.equal(await focused(page), 'shopDoneToggle', 'focus stays nearby');
  for (const [k, v] of Object.entries(fx.docs)) if (k !== 'shopItems/si_milk') assert.deepEqual(d[k], v, `unchanged: ${k}`);

  // The list open is for this visit only; after a reload the cards show, and Milk is still done.
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  assert.ok(await page.isHidden('#shopView'));
  assert.deepEqual((await cards(page))[0].items, [], 'nothing left to get');
  await openList(page, 'sl_groceries');
  await page.click('#shopDoneToggle');
  assert.equal(await page.getAttribute('#shopDoneToggle', 'aria-expanded'), 'true');
  assert.deepEqual(await rows(page, '#shopDoneRows'), ['Milk', 'Eggs ×12 “free range”']);
  assert.equal(await page.getAttribute('[data-shop-tick="si_milk"]', 'aria-checked'), 'true');
  // Unticked, it goes back where it was.
  await page.click('[data-shop-tick="si_milk"]');
  await page.waitForTimeout(400);
  assert.deepEqual(await rows(page), ['Milk']);
  d = (await dump(page)).docs;
  assert.equal(d['shopItems/si_milk'].done, false);
  assert.equal(d['shopItems/si_milk'].doneAt, null);
  await page.click('[data-shop-tick="si_milk"]');
  await page.waitForTimeout(400);

  const before = (await dump(page)).docs;
  await page.click('#shopClear');
  await page.waitForTimeout(600);
  assert.equal(await page.textContent('#toastMsg'), 'Cleared 2 items');
  d = (await dump(page)).docs;
  for (const id of ['si_milk', 'si_eggs']) {
    assert.equal(d['shopItems/' + id], undefined, `out of the list: ${id}`);
    const e = d['bin/shopItems~' + id];
    assert.deepEqual(e, { coll: 'shopItems', id, doc: before['shopItems/' + id], group: null, deletedAt: e.deletedAt }, `in Recently deleted as it was: ${id}`);
  }
  assert.ok(!Object.keys(d).some(k => k.startsWith('trash/') && !(k in before)), 'never in the tasks\' trash');
  assert.ok(await page.isHidden('#shopDone'));
  assert.deepEqual((await dump(page)).docs['shopLists/sl_groceries'], before['shopLists/sl_groceries'], 'the list stays');
  await page.click('#toastUndo');
  await page.waitForTimeout(600);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back as it was: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  assert.equal(await page.textContent('#shopDoneN'), '2');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an item the phone can\'t keep leaves no ghost behind', async () => {
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__failPuts && typeof k === 'string' && k.startsWith('shopItems/')) throw new DOMException('Storage is full', 'QuotaExceededError');
      return put.call(this, v, k);
    };
  };
  const { ctx, page } = await phone(withExtras(smallFixture()), { init });
  await openList(page, 'sl_groceries');
  await page.evaluate(() => { window.__failPuts = true; });
  await page.fill('#shopInput', 'Ghost item');
  await page.press('#shopInput', 'Enter');
  await page.waitForTimeout(600);
  assert.deepEqual(await rows(page), ['Milk'], 'the item that could not be kept is not shown');
  assert.match(await page.textContent('#toastMsg'), /full/i);
  await page.evaluate(() => { window.__failPuts = false; });
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  await openList(page, 'sl_groceries');
  await page.waitForTimeout(1500);
  assert.deepEqual(await rows(page), ['Milk']);
  assert.ok(!Object.values((await dump(page)).docs).some(v => v && v.text === 'Ghost item'), 'and it isn\'t kept');
  await ctx.close();
});

test('⋮ renames and recolors a list; Delete sends it with its items to Recently deleted, and Restore brings it all back as it was', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await page.click('[data-shop-more="sl_hardware"]');
  await page.waitForSelector('#shopSheet.open');
  assert.equal(await page.inputValue('#shopNameInput'), 'Hardware <b>store</b> 🔧');
  assert.equal(await page.getAttribute('#shopColors [data-color="6"]', 'aria-pressed'), 'true');
  await page.fill('#shopNameInput', 'Hardware');
  await page.click('#shopColors [data-color="2"]');
  await page.click('#shopSave');
  await page.waitForTimeout(400);
  assert.equal(await focused(page), 'shopMore=sl_hardware', 'focus back on ⋮');
  let d = (await dump(page)).docs;
  const h = d['shopLists/sl_hardware'];
  assert.deepEqual({ ...h, updatedAt: 0 }, { ...fx.docs['shopLists/sl_hardware'], name: 'Hardware', color: 2, updatedAt: 0 });
  assert.ok(h.updatedAt > fx.docs['shopLists/sl_hardware'].updatedAt);
  assert.deepEqual((await cards(page)).map(c => c.name), ['Groceries', 'Hardware']);

  // Deleted from the open list's own ⋮.
  const before = d;
  await openList(page, 'sl_groceries');
  await page.click('#shopMenu');
  await page.waitForSelector('#shopSheet.open');
  assert.ok(await page.isVisible('#shopDelete'));
  await page.click('#shopDelete');
  await page.waitForTimeout(700);
  assert.ok(await page.isHidden('#shopView'), 'back on the cards');
  assert.ok(await page.isHidden('#shopBar'));
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Groceries”');
  assert.deepEqual((await cards(page)).map(c => c.id), ['sl_hardware']);
  d = (await dump(page)).docs;
  for (const k of ['shopLists/sl_groceries', 'shopItems/si_milk', 'shopItems/si_eggs']) {
    assert.equal(d[k], undefined, `gone from the list: ${k}`);
    const e = d['bin/' + k.replace('/', '~')];
    assert.deepEqual(e.doc, before[k], `kept in Recently deleted: ${k}`);
    assert.equal(e.group, 'shopLists~sl_groceries');
  }
  // Recently deleted (on Tasks) shows it by name and kind; Restore brings the list and its items back exactly.
  await page.click('#dockToday');
  await page.click('#trashOpen');
  await page.waitForSelector('#trashSheet.open');
  const meta = await page.$eval('[data-restore-bin="shopLists~sl_groceries"]', b => b.closest('.trash-row').querySelector('.trash-meta').textContent);
  assert.equal(meta, 'Shopping list · 2 items · Deleted today');
  await page.click('[data-restore-bin="shopLists~sl_groceries"]');
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `exactly as before: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#dockLists');
  assert.deepEqual((await cards(page)).map(c => c.id), ['sl_groceries', 'sl_hardware']);
  // Undo right after a delete works the same.
  await page.click('[data-shop-more="sl_hardware"]');
  await page.click('#shopDelete');
  await page.waitForTimeout(600);
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Hardware”');
  await page.click('#toastUndo');
  await page.waitForTimeout(600);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back after Undo: ${k}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('tapping an item edits it: its words, its link (web links only), its place in the list; or deletes it, with Undo', async () => {
  const fx = withExtras(smallFixture());
  fx.docs['shopItems/si_bread'] = item('sl_groceries', 'Bread', 3000);
  fx.docs['shopItems/si_jam'] = item('sl_groceries', 'Jam', 4000);
  const { ctx, page, errors } = await phone(fx);
  await openList(page, 'sl_groceries');
  assert.deepEqual(await rows(page), ['Milk', 'Bread', 'Jam']);
  // Only a web link becomes a link; anything else stays words.
  await page.fill('#shopInput', 'Honey javascript:alert(1)');
  await page.press('#shopInput', 'Enter');
  await page.waitForTimeout(400);
  let d = (await dump(page)).docs;
  const honey = inColl(d, 'shopItems').find(([, v]) => v.text.startsWith('Honey'));
  assert.deepEqual([honey[1].text, honey[1].link], ['Honey javascript:alert(1)', null]);

  await page.click('[data-shop-edit="si_bread"]');
  await page.waitForSelector('#itemSheet.open');
  assert.equal(await focused(page), 'itemText');
  assert.equal(await page.inputValue('#itemText'), 'Bread');
  assert.equal(await page.inputValue('#itemLink'), '');
  await page.fill('#itemLink', 'javascript:alert(1)');
  await page.click('#itemSave');
  assert.ok(await page.isVisible('#itemLinkError'), 'refused');
  assert.ok(await page.isVisible('#itemSheet'), 'and the sheet stays open');
  assert.equal((await dump(page)).docs['shopItems/si_bread'].link, null);
  await page.fill('#itemText', 'Rye bread');
  await page.fill('#itemLink', 'https://example.com/rye');
  await page.click('#itemSave');
  await page.waitForTimeout(400);
  d = (await dump(page)).docs;
  assert.deepEqual({ ...d['shopItems/si_bread'], updatedAt: 0 }, { ...fx.docs['shopItems/si_bread'], text: 'Rye bread', link: 'https://example.com/rye', updatedAt: 0 });
  assert.equal(await page.getAttribute('#shopRows a', 'href'), 'https://example.com/rye');
  assert.equal(await page.$$eval('a[href^="javascript"], [href*="alert("]', els => els.length), 0, 'no script link anywhere');

  // Up and down (one record changes each time), stopping at the ends.
  await page.click('[data-shop-edit="si_bread"]');
  await page.waitForSelector('#itemSheet.open');
  assert.equal(await page.isDisabled('#itemUp'), false);
  await page.click('#itemUp');
  await page.waitForTimeout(300);
  assert.equal(await page.isDisabled('#itemUp'), true, 'at the top');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.deepEqual(await rows(page), ['Rye bread', 'Milk', 'Jam', 'Honey javascript:alert(1)']);
  d = (await dump(page)).docs;
  assert.ok(d['shopItems/si_bread'].rank < d['shopItems/si_milk'].rank);
  for (const k of ['shopItems/si_milk', 'shopItems/si_jam']) assert.deepEqual(d[k], fx.docs[k], `not touched: ${k}`);
  await page.click('[data-shop-edit="si_bread"]');
  for (let i = 0; i < 3; i++) { await page.click('#itemDown'); await page.waitForTimeout(250); }
  assert.equal(await page.isDisabled('#itemDown'), true, 'at the bottom');
  await page.click('#itemCancel');
  await page.waitForTimeout(400);
  assert.deepEqual(await rows(page), ['Milk', 'Jam', 'Honey javascript:alert(1)', 'Rye bread']);

  // Delete, with Undo.
  const before = (await dump(page)).docs;
  await page.click('[data-shop-edit="si_jam"]');
  await page.click('#itemDelete');
  await page.waitForTimeout(600);
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “Jam”');
  assert.deepEqual(await rows(page), ['Milk', 'Honey javascript:alert(1)', 'Rye bread']);
  d = (await dump(page)).docs;
  assert.deepEqual(d['bin/shopItems~si_jam'].doc, before['shopItems/si_jam']);
  await page.click('#toastUndo');
  await page.waitForTimeout(600);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back as it was: ${k}`);
  assert.deepEqual(await rows(page), ['Milk', 'Jam', 'Honey javascript:alert(1)', 'Rye bread']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('names and items show exactly as typed: markup and emoji are words, never page code', async () => {
  const { ctx, page, errors } = await phone();
  await openList(page, 'sl_hardware');
  assert.equal(await page.textContent('#shopName'), 'Hardware <b>store</b> 🔧');
  assert.equal(await page.getAttribute('#shopInput', 'placeholder'), 'Add to Hardware <b>store</b> 🔧…');
  assert.deepEqual(await rows(page), ['Wood screws 日本語']);
  await page.fill('#shopInput', '<img src=x onerror="window.__hit=1"> 🍕 <b>pizza</b>');
  await page.press('#shopInput', 'Enter');
  await page.waitForTimeout(400);
  assert.deepEqual(await rows(page), ['Wood screws 日本語', '<img src=x onerror="window.__hit=1"> 🍕 <b>pizza</b>']);
  await page.click('#shopBack');
  assert.equal(await page.$$eval('#paneLists b, #paneLists img', els => els.length), 0, 'no markup made from what was typed');
  assert.equal(await page.evaluate(() => window.__hit), undefined);
  assert.deepEqual((await cards(page))[1].items, ['Wood screws 日本語', '<img src=x onerror="window.__hit=1"> 🍕 <b>pizza</b>']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the open list: Back, Escape and another tab close it; N adds there; the add bar is out of reach behind a sheet', async () => {
  const { ctx, page, errors } = await phone();
  const inert = () => page.evaluate(() => ['#shopBar', '#dock', '#newBtn', '#fab', '#app'].map(s => document.querySelector(s).inert));
  await openList(page, 'sl_groceries');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#shopView') && await page.isHidden('#shopBar'), 'Escape: back to the cards');
  assert.equal(await focused(page), 'shopOpen=sl_groceries');
  await openList(page, 'sl_groceries');
  await page.click('#shopBack');
  assert.ok(await page.isHidden('#shopView'), 'Back');
  await openList(page, 'sl_groceries');
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#shopView'), 'Lists tapped again: back to the cards');
  await openList(page, 'sl_groceries');
  await page.click('#dockHome');
  assert.ok(await page.isHidden('#shopBar'), 'no add bar on another tab');
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#shopView') && await page.isVisible('#shopCards'), 'another tab closed it');

  // N: in a list, the add bar; on the cards, a new shopping list.
  await openList(page, 'sl_groceries');
  await page.keyboard.press('n');
  assert.equal(await focused(page), 'shopInput');
  assert.equal(await page.inputValue('#shopInput'), '', 'the key itself isn\'t typed');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#shopView'));
  await page.keyboard.press('n');
  await page.waitForSelector('#shopSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#shopSheet'));

  // Behind the item sheet and the list's sheet, nothing on the page can be reached, the add bar included.
  await openList(page, 'sl_groceries');
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  await page.click('[data-shop-edit="si_milk"]');
  await page.waitForSelector('#itemSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#itemSheet') && await page.isVisible('#shopView'), 'Escape closes the sheet first');
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  assert.equal(await focused(page), 'shopEdit=si_milk', 'focus back where it was');
  await page.click('#shopMenu');
  await page.waitForSelector('#shopSheet.open');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.click('#scrim', { position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#shopSheet'), 'a tap outside closes it');
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no sideways scrolling at 320 points with Extra large text, on the cards and in a list (Classic, Midnight, Blush)', async () => {
  for (const look of ['classic', 'midnight', 'blush']) {
    const fx = withExtras(smallFixture());
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    fx.docs['shopLists/sl_long'] = { name: 'Supercalifragilisticexpialidocious household restock', color: 4, order: 3, createdAt: 1, updatedAt: 1 };
    fx.docs['shopItems/si_long'] = item('sl_long', 'Extraordinarilylongwordwithoutanyspacesatallforthetest and more words after it', 1000,
      { link: 'https://example.com/a/very/long/path/that/goes/on/and/on' });
    fx.docs['shopItems/si_long2'] = item('sl_long', 'Second thing', 2000);
    const { ctx, page, errors } = await phone(fx, { viewport: { width: 320, height: 640 } });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.text), 'xl');
    const check = () => page.evaluate(() => {
      const vw = window.innerWidth;
      const out = [];
      const over = document.scrollingElement.scrollWidth - vw;
      if (over > 0) out.push(`page ${over}px too wide`);
      for (const el of document.querySelectorAll('#shopCards .shop-card, #shopView .shop-row, #shopView .shop-link, #shopBar, #shopAdd, #shopBack, #shopMenu, #newBtn')) {
        if (el.hidden || (!el.offsetParent && getComputedStyle(el).position !== 'fixed')) continue;
        const b = el.getBoundingClientRect();
        if (b.width && (b.left < -0.5 || b.right > vw + 0.5)) out.push(`${el.id || el.className} runs off the screen`);
      }
      return out;
    });
    assert.deepEqual(await check(), [], `${look}: the cards`);
    await openList(page, 'sl_long');
    assert.deepEqual(await check(), [], `${look}: a list`);
    // The last row isn't hidden under the add bar when scrolled to the bottom.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector('#shopBar').getBoundingClientRect().top - document.querySelector('#shopRows .shop-row:last-child').getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `${look}: the last row clears the add bar (${gap})`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
