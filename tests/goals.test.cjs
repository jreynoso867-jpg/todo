// Savings goals, opened from their card on the Lists tab: "Open N" and "Closed", a card per goal (its name, its due
// date, "$16,000.00 of $35,000.00", a bar, what's left or "Reached!", what went in, newest first, Add money and Close goal,
// or Reopen), "+ New goal" and its sheet (the name, the amount to reach, a due date), the add-money sheet (an amount put
// in or taken out, its day, a note), and delete into Recently deleted. Everything is saved as the records of
// sections.test.cjs (goals/ and goalEntries/, money in whole cents, Recently deleted in bin/), saved and left are never
// stored, and nothing else is touched.
// Usage: node --test tests/goals.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, withExtras, launch, phoneContext, seed, dump, addDays } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// A phone with the fixture on it (the goals of lib.cjs's extras unless given), opened on Lists.
async function phone(fx = withExtras(smallFixture()), o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  fx.local['todo.tab'] = o.tab || 'lists';
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#dock:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const inColl = (docs, c) => Object.entries(docs).filter(([k]) => k.startsWith(c + '/'));
const focused = page => page.evaluate(() => { const a = document.activeElement; return a.id || Object.entries(a.dataset).map(([k, v]) => `${k}=${v}`).join(' '); });
const openGoals = async page => { await page.click('#listsGoals'); await page.waitForSelector('#goalView:not([hidden])'); };
const settle = page => page.waitForTimeout(450);
// The cards showing, in order: what each one says.
const cards = page => page.$$eval('#goalList .goal-card', els => els.map(e => {
  const t = s => { const x = e.querySelector(s); return x && !x.hidden ? x.textContent : ''; };
  const bar = e.querySelector('.goal-bar');
  return {
    id: e.dataset.goalCard, name: t('.goal-name'), due: t('.goal-due'), amt: t('.goal-amt'), left: t('.goal-left'),
    pct: bar.getAttribute('aria-valuenow'), width: bar.querySelector('i').style.width,
    entries: [...e.querySelectorAll('.goal-entry')].map(b => [b.dataset.goalEntry, b.querySelector('.ge-day').textContent,
      b.querySelector('.ge-note').textContent, b.querySelector('.ge-amt').textContent]),
    acts: [...e.querySelectorAll('.goal-act')].map(b => b.textContent),
  };
}));
const card = async (page, id) => (await cards(page)).find(c => c.id === id);
const shows = page => page.evaluate(() => [...document.querySelectorAll('#goalTabs [data-goal-show]')].map(b => [b.dataset.goalShow, b.getAttribute('aria-pressed')]));
// "Oct 15" (with the year when it isn't this year), the way the cards show a day.
const shortDay = (d, today) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', d.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};
const t0 = 1700000000000;
const goal = (name, targetCents, more = {}) => ({ name, targetCents, due: null, closedAt: null, order: 1, createdAt: t0, updatedAt: t0, ...more });
const entry = (g, amountCents, day, more = {}) => ({ goal: g, amountCents, day, note: '', createdAt: t0 + 5, updatedAt: t0 + 5, ...more });
// Add money to a goal through its sheet (o.out: Take out).
async function addMoney(page, id, amount, o = {}) {
  await page.click(`[data-goal-add="${id}"]`);
  await page.waitForSelector('#moneySheet.open');
  if (o.out) await page.click('#moneyDir [data-money-dir="out"]');
  await page.fill('#moneyAmount', amount);
  if (o.note) await page.fill('#moneyNote', o.note);
  await page.click('#moneySave');
  await page.waitForSelector('#moneySheet', { state: 'hidden' });
  await settle(page);
}

test('a new goal and money put in, made by tapping: whole cents are saved, nothing else changes, and it reads "$250.00 of $1,000.00" after a reload', async () => {
  const fx = smallFixture();
  const T = fx.today;
  const { ctx, page, errors } = await phone(fx);
  // The Savings goals card on Lists, next to the Wish list's, under a heading for both.
  assert.ok(await page.isVisible('#listsGoals') && await page.isVisible('#listsWish'));
  assert.equal(await page.textContent('#moreTitle'), 'Wishes and savings');
  assert.equal(await page.textContent('#listsGoalsSub'), 'None yet');
  await openGoals(page);
  assert.equal(await page.textContent('#goalPaneTitle'), 'Savings goals');
  assert.equal(await page.textContent('#goalSub'), 'A goal, what you’ve saved and what’s left');
  assert.equal(await focused(page), 'goalPaneTitle', 'the heading, for a screen reader');
  assert.ok(await page.isVisible('#goalBack') && await page.isHidden('#listsHome'), 'in place of the cards, with a way back');
  assert.deepEqual(await shows(page), [['open', 'true'], ['closed', 'false']]);
  assert.ok(await page.isHidden('#goalOpenN'), 'no count while nothing is open');
  assert.equal(await page.textContent('#goalEmpty'), 'No savings goals yet. Tap New goal to start one.');
  assert.equal(await page.textContent('#newBtn'), 'New goal', '"+ New goal" on Savings goals');
  assert.ok(await page.isHidden('#shopBar'));

  // + New goal: its words and an amount to reach are needed; the due date is optional.
  await page.click('#newBtn');
  await page.waitForSelector('#goalSheet.open');
  assert.equal(await page.textContent('#goalSheetTitle'), 'New goal');
  assert.equal(await focused(page), 'goalName');
  assert.ok(await page.isHidden('#goalDelete'), 'nothing to delete yet');
  await page.click('#goalSave');
  assert.ok(await page.isVisible('#goalNameError'));
  assert.equal(await focused(page), 'goalName');
  await page.fill('#goalName', '  Trip   fund ');
  for (const bad of ['', 'abc', '0', '0.00', '-5', '1.234']) {
    await page.fill('#goalTarget', bad);
    await page.click('#goalSave');
    assert.ok(await page.isVisible('#goalTargetError'), `refused target: "${bad}"`);
    assert.equal(await focused(page), 'goalTarget');
  }
  await page.fill('#goalTarget', '1,000');
  await page.fill('#goalDue', '2027-01-04');
  await page.click('#goalSave');
  await page.waitForSelector('#goalSheet', { state: 'hidden' });
  await settle(page);
  let d = (await dump(page)).docs;
  const made = inColl(d, 'goals');
  assert.equal(made.length, 1);
  const [[gkey, g]] = made;
  const gid = gkey.slice('goals/'.length);
  assert.deepEqual(Object.keys(g).sort(), ['closedAt', 'createdAt', 'due', 'name', 'order', 'targetCents', 'updatedAt']);
  assert.deepEqual({ ...g, createdAt: 0, updatedAt: 0 }, { name: 'Trip fund', targetCents: 100000, due: '2027-01-04', closedAt: null, order: 1, createdAt: 0, updatedAt: 0 });
  assert.ok(g.createdAt > 0 && g.updatedAt === g.createdAt);
  assert.deepEqual(await cards(page), [{ id: gid, name: 'Trip fund', due: 'Jan 4, 2027', amt: '$0.00 of $1,000.00', left: '$1,000.00 to go',
    pct: '0', width: '0%', entries: [], acts: ['Add money', 'Close goal'] }]);
  assert.equal(await page.textContent('#goalOpenN'), '1', 'Open 1');
  assert.equal(await page.getAttribute('[data-goal-show="open"]', 'aria-label'), 'Open goals, 1');

  // Add money: the day starts at today, the amount is saved as whole cents.
  await page.click(`[data-goal-add="${gid}"]`);
  await page.waitForSelector('#moneySheet.open');
  assert.equal(await page.textContent('#moneySheetTitle'), 'Add money');
  assert.equal(await page.textContent('#moneyFor'), 'For Trip fund');
  assert.equal(await focused(page), 'moneyAmount');
  assert.equal(await page.inputValue('#moneyDay'), T, 'today');
  assert.equal(await page.getAttribute('#moneyDir [data-money-dir="in"]', 'aria-pressed'), 'true');
  assert.ok(await page.isHidden('#moneyDelete'));
  await page.fill('#moneyAmount', '250');
  await page.click('#moneySave');
  await page.waitForSelector('#moneySheet', { state: 'hidden' });
  await settle(page);
  d = (await dump(page)).docs;
  const ents = inColl(d, 'goalEntries');
  assert.equal(ents.length, 1);
  const [[ekey, e]] = ents;
  const eid = ekey.slice('goalEntries/'.length);
  assert.deepEqual(Object.keys(e).sort(), ['amountCents', 'createdAt', 'day', 'goal', 'note', 'updatedAt']);
  assert.deepEqual({ ...e, createdAt: 0, updatedAt: 0 }, { goal: gid, amountCents: 25000, day: T, note: '', createdAt: 0, updatedAt: 0 });
  assert.ok(Number.isInteger(e.amountCents), 'money is whole cents');
  assert.deepEqual(d[gkey], g, 'the goal itself is unchanged (saved and left are never stored)');
  // Every task, list and setting as it was; only the goal and its entry are new.
  for (const [k, v] of Object.entries(fx.docs)) assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual(Object.keys(d).filter(k => !(k in fx.docs)).sort(), [ekey, gkey].sort(), 'only the goal and its entry');
  assert.ok(!Object.keys(d).some(k => (k.startsWith('tasks/') || k.startsWith('lists/')) && !(k in fx.docs)), 'no task or task list made');
  const want = { id: gid, name: 'Trip fund', due: 'Jan 4, 2027', amt: '$250.00 of $1,000.00', left: '$750.00 to go', pct: '25', width: '25%',
    entries: [[eid, shortDay(T, T), '', '$250.00']], acts: ['Add money', 'Close goal'] };
  assert.deepEqual(await cards(page), [want]);
  assert.equal(await focused(page), `goalAdd=${gid}`, 'focus back on Add money');

  // After a reload: the same, worked out again from the entry.
  await page.reload();
  await page.waitForSelector('#dock:not([hidden])');
  await page.waitForTimeout(300);
  assert.ok(await page.isHidden('#goalView'), 'Savings goals is open for this visit only');
  assert.equal(await page.textContent('#listsGoalsSub'), '1 open');
  await openGoals(page);
  assert.deepEqual(await cards(page), [want]);

  // Its name opens the sheet filled in; a change is saved to the same record.
  await page.click(`[data-goal-open="${gid}"]`);
  await page.waitForSelector('#goalSheet.open');
  assert.equal(await page.textContent('#goalSheetTitle'), 'Edit goal');
  assert.deepEqual(await page.evaluate(() => ['#goalName', '#goalTarget', '#goalDue'].map(s => document.querySelector(s).value)), ['Trip fund', '$1,000.00', '2027-01-04']);
  assert.ok(await page.isVisible('#goalDelete'));
  await page.fill('#goalName', 'Beach trip');
  await page.fill('#goalTarget', '1200');
  await page.click('#goalDueClear');
  assert.equal(await page.inputValue('#goalDue'), '', 'the due date can be taken off');
  await page.click('#goalSave');
  await settle(page);
  d = (await dump(page)).docs;
  assert.deepEqual({ ...d[gkey], updatedAt: 0 }, { ...g, name: 'Beach trip', targetCents: 120000, due: null, updatedAt: 0 });
  assert.ok(d[gkey].updatedAt > g.updatedAt);
  assert.equal(inColl(d, 'goals').length, 1, 'no second goal');
  const c = await card(page, gid);
  assert.deepEqual([c.name, c.due, c.amt, c.left, c.pct], ['Beach trip', '', '$250.00 of $1,200.00', '$950.00 to go', '20']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('money is whole cents: 12.10 and 0.20 make $12.30; Take out (or a minus sign) lowers what\'s saved; zero isn\'t an amount', async () => {
  const fx = smallFixture();
  fx.docs['goals/g_jar'] = goal('Jar', 5000);
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  await addMoney(page, 'g_jar', '12.10');
  await addMoney(page, 'g_jar', '0.20');
  let d = (await dump(page)).docs;
  assert.deepEqual(inColl(d, 'goalEntries').map(([, e]) => e.amountCents).sort((a, b) => a - b), [20, 1210]);
  let c = await card(page, 'g_jar');
  assert.deepEqual([c.amt, c.left], ['$12.30 of $50.00', '$37.70 to go']);
  // Not an amount, or nothing: refused, and nothing is saved.
  await page.click('[data-goal-add="g_jar"]');
  await page.waitForSelector('#moneySheet.open');
  for (const bad of ['', '0', '0.00', '-0', 'abc', '1.234', '$']) {
    await page.fill('#moneyAmount', bad);
    await page.click('#moneySave');
    assert.ok(await page.isVisible('#moneyAmountError'), `refused: "${bad}"`);
    assert.ok(await page.isVisible('#moneySheet'));
    assert.equal(await focused(page), 'moneyAmount');
  }
  await page.keyboard.press('Escape');
  await settle(page);
  assert.equal(inColl((await dump(page)).docs, 'goalEntries').length, 2, 'nothing saved');
  // Take out: saved as a negative amount, and the total goes down.
  await addMoney(page, 'g_jar', '5', { out: true, note: 'Bus fare' });
  // A minus sign typed is taken out too.
  await addMoney(page, 'g_jar', '-2.30');
  d = (await dump(page)).docs;
  const amounts = inColl(d, 'goalEntries').map(([, e]) => e.amountCents).sort((a, b) => a - b);
  assert.deepEqual(amounts, [-500, -230, 20, 1210]);
  assert.ok(amounts.every(Number.isInteger));
  c = await card(page, 'g_jar');
  assert.deepEqual([c.amt, c.left, c.pct], ['$5.00 of $50.00', '$45.00 to go', '10']);
  assert.deepEqual(c.entries.map(x => [x[2], x[3]]).sort(), [['', '$0.20'], ['', '$12.10'], ['', '-$2.30'], ['Bus fare', '-$5.00']].sort());
  assert.deepEqual(d['goals/g_jar'], fx.docs['goals/g_jar'], 'the goal itself is never touched by its entries');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('"Reached!" once what\'s saved is at the target or over it, with the bar full', async () => {
  const fx = smallFixture();
  const T = fx.today;
  fx.docs['goals/g_bike'] = goal('Bike', 10000, { due: '2027-01-04' });
  fx.docs['goalEntries/ge_a'] = entry('g_bike', 9000, addDays(T, -2));
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  let c = await card(page, 'g_bike');
  assert.deepEqual([c.amt, c.left, c.pct, c.width], ['$90.00 of $100.00', '$10.00 to go', '90', '90%']);
  await addMoney(page, 'g_bike', '10');
  c = await card(page, 'g_bike');
  assert.deepEqual([c.amt, c.left, c.pct, c.width], ['$100.00 of $100.00', 'Reached!', '100', '100%']);
  await addMoney(page, 'g_bike', '5');
  c = await card(page, 'g_bike');
  assert.deepEqual([c.amt, c.left, c.pct, c.width], ['$105.00 of $100.00', 'Reached!', '100', '100%'], 'over the target: still reached, the bar no longer than full');
  await addMoney(page, 'g_bike', '20', { out: true });
  c = await card(page, 'g_bike');
  assert.deepEqual([c.amt, c.left, c.pct], ['$85.00 of $100.00', '$15.00 to go', '85']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the cards: each goal\'s due date, what went in newest first; Close goal moves it to Closed and keeps it all; Reopen brings it back', async () => {
  const fx = withExtras(smallFixture());
  const T = fx.today;
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.textContent('#listsGoalsSub'), '1 open · 1 closed');
  await openGoals(page);
  assert.equal(await page.textContent('#goalOpenN'), '1');
  const due = shortDay(addDays(T, 200), '0000');
  assert.deepEqual(await cards(page), [{ id: 'g_car', name: 'New car', due, amt: '$15,749.50 of $35,000.00', left: '$19,250.50 to go',
    pct: '44', width: '44%', acts: ['Add money', 'Close goal'],
    entries: [['ge_out', shortDay(addDays(T, -3), T), 'Took some out', '-$250.50'], ['ge_june', shortDay(addDays(T, -10), T), '', '$6,000.00'],
      ['ge_bonus', shortDay(addDays(T, -40), T), 'Bonus', '$10,000.00']] }]);
  // Closed: the goals put away, with Reopen.
  await page.click('[data-goal-show="closed"]');
  assert.deepEqual(await shows(page), [['open', 'false'], ['closed', 'true']]);
  let list = await cards(page);
  assert.deepEqual(list.map(c => [c.id, c.amt, c.left, c.acts]), [['g_laptop', '$1,200.00 of $1,200.00', 'Reached!', ['Reopen']]]);
  await page.click('[data-goal-show="open"]');

  // Close goal: only closedAt (and updatedAt) change; its entries stay as they were.
  const before = (await dump(page)).docs;
  await page.click('[data-goal-close="g_car"]');
  await settle(page);
  assert.equal(await page.textContent('#toastMsg'), 'Closed “New car”');
  let d = (await dump(page)).docs;
  assert.ok(d['goals/g_car'].closedAt > 0 && d['goals/g_car'].updatedAt > before['goals/g_car'].updatedAt);
  assert.deepEqual({ ...d['goals/g_car'], closedAt: null, updatedAt: 0 }, { ...before['goals/g_car'], updatedAt: 0 });
  for (const [k, v] of Object.entries(before)) if (k !== 'goals/g_car') assert.deepEqual(d[k], v, `unchanged: ${k}`);
  assert.deepEqual(await cards(page), [], 'gone from Open');
  assert.equal(await page.textContent('#goalEmpty'), 'No open goals. The ones you closed are under Closed.');
  assert.ok(await page.isHidden('#goalOpenN'));
  assert.equal(await focused(page), 'goalShow=open', 'focus stays close by');
  assert.equal(await page.textContent('#listsGoalsSub'), '2 closed');
  await page.click('[data-goal-show="closed"]');
  list = await cards(page);
  assert.deepEqual(list.map(c => c.id), ['g_car', 'g_laptop'], 'the one closed last comes first');
  assert.deepEqual(list[0].acts, ['Reopen']);
  assert.equal(list[0].amt, '$15,749.50 of $35,000.00', 'what was saved is kept');
  assert.equal(list[0].entries.length, 3);
  assert.equal(await page.textContent('[data-goal-card="g_car"] .goal-closed'), 'Closed today');
  // Reopen: back as it was.
  await page.click('[data-goal-reopen="g_car"]');
  await settle(page);
  assert.equal(await page.textContent('#toastMsg'), '“New car” is open again');
  d = (await dump(page)).docs;
  assert.deepEqual({ ...d['goals/g_car'], updatedAt: 0 }, { ...before['goals/g_car'], updatedAt: 0 });
  assert.deepEqual((await cards(page)).map(c => c.id), ['g_laptop']);
  await page.click('[data-goal-show="open"]');
  assert.deepEqual((await cards(page)).map(c => c.id), ['g_car']);
  // Close's Undo opens it again.
  await page.click('[data-goal-close="g_car"]');
  await settle(page);
  await page.click('#toastUndo');
  await settle(page);
  d = (await dump(page)).docs;
  assert.equal(d['goals/g_car'].closedAt, null);
  assert.deepEqual((await cards(page)).map(c => c.id), ['g_car']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an entry tapped opens it to change or delete; Delete goes to Recently deleted with Undo', async () => {
  const fx = withExtras(smallFixture());
  const T = fx.today;
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  // Put in: filled in as it was.
  await page.click('[data-goal-entry="ge_june"]');
  await page.waitForSelector('#moneySheet.open');
  assert.equal(await page.textContent('#moneySheetTitle'), 'Edit entry');
  assert.deepEqual(await page.evaluate(() => ['#moneyAmount', '#moneyDay', '#moneyNote'].map(s => document.querySelector(s).value)), ['$6,000.00', addDays(T, -10), '']);
  assert.equal(await page.getAttribute('#moneyDir [data-money-dir="in"]', 'aria-pressed'), 'true');
  assert.ok(await page.isVisible('#moneyDelete'));
  await page.fill('#moneyAmount', '6100');
  await page.fill('#moneyNote', 'June <b>pay</b>');
  await page.fill('#moneyDay', addDays(T, -9));
  await page.click('#moneySave');
  await settle(page);
  let d = (await dump(page)).docs;
  assert.deepEqual({ ...d['goalEntries/ge_june'], updatedAt: 0 },
    { ...fx.docs['goalEntries/ge_june'], amountCents: 610000, note: 'June <b>pay</b>', day: addDays(T, -9), updatedAt: 0 });
  assert.equal(inColl(d, 'goalEntries').length, 4, 'no new entry');
  let c = await card(page, 'g_car');
  assert.equal(c.amt, '$15,849.50 of $35,000.00');
  assert.deepEqual(c.entries[1], ['ge_june', shortDay(addDays(T, -9), T), 'June <b>pay</b>', '$6,100.00']);
  // Taken out: Take out is on, the amount without its sign.
  const before = (await dump(page)).docs;
  await page.click('[data-goal-entry="ge_out"]');
  await page.waitForSelector('#moneySheet.open');
  assert.equal(await page.getAttribute('#moneyDir [data-money-dir="out"]', 'aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => ['#moneyAmount', '#moneyNote'].map(s => document.querySelector(s).value)), ['$250.50', 'Took some out']);
  await page.click('#moneyDelete');
  await settle(page);
  assert.ok(await page.isHidden('#moneySheet'));
  assert.equal(await page.textContent('#toastMsg'), 'Deleted -$250.50 from “New car”. It stays in Recently deleted for 7 days.');
  d = (await dump(page)).docs;
  assert.equal(d['goalEntries/ge_out'], undefined);
  const b = d['bin/goalEntries~ge_out'];
  assert.deepEqual(b, { coll: 'goalEntries', id: 'ge_out', doc: before['goalEntries/ge_out'], group: null, deletedAt: b.deletedAt }, 'kept in Recently deleted as it was');
  assert.ok(!Object.keys(d).some(k => k.startsWith('trash/') && !(k in before)), 'never in the tasks\' trash');
  c = await card(page, 'g_car');
  assert.equal(c.amt, '$16,100.00 of $35,000.00', 'what was taken out no longer counts');
  assert.deepEqual(c.entries.map(x => x[0]), ['ge_june', 'ge_bonus']);
  await page.click('#toastUndo');
  await settle(page);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back after Undo: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  assert.equal((await card(page, 'g_car')).amt, '$15,849.50 of $35,000.00');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('after Undo (a goal closed, an entry deleted), focus goes to what came back', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  const undoTo = async (attr, id, what) => {
    await page.focus('#toastUndo');
    await page.keyboard.press('Enter');
    await page.waitForFunction(([attr, id]) => document.activeElement && document.activeElement.getAttribute(attr) === id, [attr, id], { timeout: 3000 })
      .catch(async () => assert.fail(`${what}: focus went to ${await focused(page) || 'the page'}`));
  };
  // Close goal (it moves to Closed), then Undo: back on the open goals, focus on its name.
  await page.focus('[data-goal-close="g_car"]');
  await page.keyboard.press('Enter');
  await settle(page);
  assert.match(await page.textContent('#toastMsg'), /^Closed “New car”/);
  await undoTo('data-goal-open', 'g_car', 'closed');
  // An entry deleted from its sheet, then Undo: focus on the entry.
  await page.focus('[data-goal-entry="ge_june"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#moneySheet.open');
  await page.focus('#moneyDelete');
  await page.keyboard.press('Enter');
  await settle(page);
  await undoTo('data-goal-entry', 'ge_june', 'entry deleted');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('deleting a goal takes its entries along: one row in Recently deleted, and Restore brings the goal and every entry back exactly', async () => {
  const fx = withExtras(smallFixture());
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  const before = (await dump(page)).docs;
  const kids = ['goalEntries/ge_bonus', 'goalEntries/ge_june', 'goalEntries/ge_out'];
  const del = async () => {
    await page.click('[data-goal-open="g_car"]');
    await page.waitForSelector('#goalSheet.open');
    await page.click('#goalDelete');
    await page.waitForTimeout(700);
  };
  await del();
  assert.ok(await page.isHidden('#goalSheet'));
  assert.equal(await page.textContent('#toastMsg'), 'Deleted “New car”. It stays in Recently deleted for 7 days.');
  assert.deepEqual(await cards(page), []);
  let d = (await dump(page)).docs;
  for (const k of ['goals/g_car', ...kids]) {
    assert.equal(d[k], undefined, `gone: ${k}`);
    const e = d['bin/' + k.replace('/', '~')];
    assert.deepEqual(e.doc, before[k], `kept in Recently deleted: ${k}`);
    assert.equal(e.group, 'goals~g_car', 'one group');
  }
  assert.deepEqual(d['goalEntries/ge_laptop'], before['goalEntries/ge_laptop'], 'another goal\'s entries stay');
  // Undo right away: all of it back.
  await page.click('#toastUndo');
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `back after Undo: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  assert.deepEqual((await cards(page)).map(c => c.id), ['g_car']);

  // Deleted again, then Recently deleted (on Tasks): one row for the goal and its entries, by name and kind.
  await del();
  await page.click('#dockToday');
  await page.click('#trashOpen');
  await page.waitForSelector('#trashSheet.open');
  const rows = await page.$$eval('#trashRows [data-restore-bin]', els => els.map(b => b.dataset.restoreBin));
  assert.ok(rows.includes('goals~g_car'));
  assert.ok(!rows.some(k => /ge_(bonus|june|out)/.test(k)), `its entries have no rows of their own (${rows})`);
  const row = await page.$eval('[data-restore-bin="goals~g_car"]', b => { const r = b.closest('.trash-row'); return [r.querySelector('.trash-title').textContent, r.querySelector('.trash-meta').textContent]; });
  assert.deepEqual(row, ['New car', 'Goal · 3 entries · Deleted today']);
  await page.click('[data-restore-bin="goals~g_car"]');
  await page.waitForTimeout(700);
  d = (await dump(page)).docs;
  for (const [k, v] of Object.entries(before)) assert.deepEqual(d[k], v, `exactly as before: ${k}`);
  for (const k of Object.keys(d)) assert.ok(k in before, `nothing left over: ${k}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#dockLists');
  await openGoals(page);
  const c = await card(page, 'g_car');
  assert.deepEqual([c.amt, c.entries.length], ['$15,749.50 of $35,000.00', 3]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Show all on one goal draws only that card again; the others stay as they were drawn', async () => {
  const fx = withExtras(smallFixture());
  for (let i = 0; i < 7; i++) fx.docs['goalEntries/ge_x' + i] = entry('g_car', 1000 + i, addDays(fx.today, -i - 1));
  for (let i = 0; i < 4; i++) fx.docs['goals/g_x' + i] = goal('Goal ' + i, 50000, { order: 3 + i });
  const { ctx, page, errors } = await phone(fx);
  await openGoals(page);
  const before = (await cards(page)).map(c => c.id);
  await page.$$eval('#goalList .goal-card', els => els.forEach(e => { e.__drawn = true; }));
  await page.click('[data-goal-more="g_car"]');
  await settle(page);
  assert.equal((await card(page, 'g_car')).entries.length, 10, 'all its entries');
  assert.deepEqual(await page.$$eval('#goalList .goal-card', els => els.filter(e => !e.__drawn).map(e => e.dataset.goalCard)), ['g_car']);
  assert.deepEqual((await cards(page)).map(c => c.id), before, 'in the same order');
  assert.equal(await focused(page), 'goalMore=g_car', 'focus stays on Show fewer');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('names and notes show exactly as typed: <b>, <img> and emoji are words, never page code', async () => {
  const fx = smallFixture();
  const T = fx.today;
  const odd = '<img src=x onerror="window.__hit=1"> 🏖️ <b>beach</b> fund';
  fx.docs['goals/g_odd'] = goal(odd, 100000);
  fx.docs['goalEntries/ge_odd'] = entry('g_odd', 1500, T, { note: '<i>not html</i> 🎉' });
  const { ctx, page, errors } = await phone(fx);
  assert.equal(await page.textContent('#listsGoalsSub'), '1 open');
  await openGoals(page);
  const c = await card(page, 'g_odd');
  assert.equal(c.name, odd);
  assert.equal(c.entries[0][2], '<i>not html</i> 🎉');
  assert.equal(await page.$$eval('#goalView b, #goalView img, #goalView i:not(.goal-fill)', els => els.length), 0, 'no markup made from what was typed');
  assert.match(await page.getAttribute('[data-goal-open="g_odd"]', 'aria-label'), /^<img src=x onerror="window\.__hit=1"> 🏖️ <b>beach<\/b> fund, \$15\.00 of \$1,000\.00\. Edit the goal$/);
  await page.click('[data-goal-open="g_odd"]');
  await page.waitForSelector('#goalSheet.open');
  assert.equal(await page.inputValue('#goalName'), odd);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#newBtn');
  await page.waitForSelector('#goalSheet.open');
  await page.fill('#goalName', '<b>Bold</b> 🎉 "quoted" & more');
  await page.fill('#goalTarget', '50');
  await page.click('#goalSave');
  await settle(page);
  assert.equal((await cards(page)).pop().name, '<b>Bold</b> 🎉 "quoted" & more');
  assert.equal(await page.$$eval('#paneLists b, #paneLists img', els => els.length), 0);
  assert.equal(await page.evaluate(() => window.__hit), undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Savings goals: Back, Escape and another tab close it; N adds a goal there; nothing behind its sheets can be reached', async () => {
  const { ctx, page, errors } = await phone();
  const inert = () => page.evaluate(() => ['#shopBar', '#dock', '#newBtn', '#fab', '#app'].map(s => document.querySelector(s).inert));
  await openGoals(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#goalView') && await page.isVisible('#listsHome'), 'Escape: back to the cards');
  assert.equal(await focused(page), 'listsGoals', 'focus back on its card');
  assert.equal(await page.textContent('#newBtn'), 'New shopping list', 'and "+ New" is for a list again');
  await openGoals(page);
  await page.click('#goalBack');
  assert.ok(await page.isHidden('#goalView'), 'Back');
  await openGoals(page);
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#goalView'), 'Lists tapped again: back to the cards');
  await openGoals(page);
  await page.click('#dockHome');
  assert.ok(await page.isHidden('#newBtn') || await page.textContent('#newBtn') !== 'New goal', 'no "+ New goal" on another tab');
  await page.click('#dockLists');
  assert.ok(await page.isHidden('#goalView') && await page.isVisible('#listsHome'), 'another tab closed it');

  // N: a new goal; Escape closes the sheet first, then Savings goals.
  await openGoals(page);
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  await page.keyboard.press('n');
  await page.waitForSelector('#goalSheet.open');
  assert.equal(await page.textContent('#goalSheetTitle'), 'New goal');
  assert.equal(await page.inputValue('#goalName'), '', 'the key itself isn\'t typed');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.keyboard.press('n'); // typed into the sheet, not another sheet
  assert.equal(await page.inputValue('#goalName'), 'n');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#goalSheet') && await page.isVisible('#goalView'), 'Escape closes the sheet first');
  assert.deepEqual(await inert(), [false, false, false, false, false]);
  // The add-money sheet: out of reach behind it, Escape closes it, focus back on Add money.
  await page.click('[data-goal-add="g_car"]');
  await page.waitForSelector('#moneySheet.open');
  assert.deepEqual(await inert(), [true, true, true, true, true]);
  await page.keyboard.press('n');
  assert.ok(await page.isHidden('#goalSheet'), 'N doesn\'t open another sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#moneySheet') && await page.isVisible('#goalView'));
  assert.equal(await focused(page), 'goalAdd=g_car');
  // A goal's sheet closes with a tap outside, and focus goes back to its name.
  await page.click('[data-goal-open="g_car"]');
  await page.waitForSelector('#goalSheet.open');
  await page.click('#scrim', { position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#goalSheet'), 'a tap outside closes it');
  assert.equal(await focused(page), 'goalOpen=g_car');
  await page.click('[data-goal-entry="ge_bonus"]');
  await page.waitForSelector('#moneySheet.open');
  await page.click('#moneyCancel');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#moneySheet'));
  assert.equal(await focused(page), 'goalEntry=ge_bonus');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.isHidden('#goalView'));
  // The Wish list and Savings goals don't get in each other's way.
  await page.click('#listsWish');
  await page.waitForSelector('#wishView:not([hidden])');
  assert.ok(await page.isHidden('#goalView'));
  assert.equal(await page.textContent('#newBtn'), 'New wish');
  await page.click('#wishBack');
  await openGoals(page);
  assert.ok(await page.isHidden('#wishView') && await page.isHidden('#shopView') && await page.isHidden('#shopBar'));
  // Nothing was written by looking around.
  const d = (await dump(page)).docs;
  const fx = withExtras(smallFixture());
  assert.deepEqual(Object.keys(d).sort(), Object.keys(fx.docs).sort());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no sideways scrolling at 320 points with Extra large text, on Savings goals and its sheets (Classic, Midnight, Blush)', async () => {
  for (const look of ['classic', 'midnight', 'blush']) {
    const fx = withExtras(smallFixture());
    const T = fx.today;
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize: 'xl' };
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '' };
    fx.docs['goals/g_long'] = goal('Supercalifragilisticexpialidocious round-the-world sailing trip with the whole family', 99999999999, { due: '2027-12-30', order: 5 });
    fx.docs['goals/g_word'] = goal('Extraordinarilylongwordwithoutanyspacesatallforthetest', 12345678, { order: 6 });
    fx.docs['goalEntries/ge_l1'] = entry('g_long', -99999999999, '2025-12-31', { note: 'A very long note about where the money came from and why it went' });
    fx.docs['goalEntries/ge_l2'] = entry('g_long', 99999999999, addDays(T, -1));
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
    assert.deepEqual(await check('#moreCards, #listsWish, #listsGoals'), [], `${look}: the Lists cards`);
    await openGoals(page);
    const view = '#goalView .goal-card, .goal-open, .goal-due, .goal-amt, .goal-bar, .goal-left, .goal-entry, .ge-amt, .ge-day, .goal-act, #goalBack, #goalTabs, #goalTabs .chip, #newBtn';
    assert.deepEqual(await check(view), [], `${look}: Savings goals`);
    // The last card isn't hidden under "+ New goal" when scrolled to the bottom.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector('#newBtn').getBoundingClientRect().top - [...document.querySelectorAll('#goalList .goal-card')].pop().getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `${look}: the last card clears "+ New goal" (${gap})`);
    await page.click('[data-goal-show="closed"]');
    assert.deepEqual(await check(view), [], `${look}: Closed`);
    await page.click('[data-goal-show="open"]');
    await page.click('[data-goal-open="g_long"]');
    await page.waitForSelector('#goalSheet.open');
    await page.waitForTimeout(400);
    assert.deepEqual(await check('#goalSheet .field, #goalSheet input, #goalSheet button'), [], `${look}: the goal sheet`);
    assert.ok(await page.$eval('#goalSheet', s => s.scrollWidth <= s.clientWidth + 1), `${look}: the goal sheet doesn't scroll sideways`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.click('[data-goal-entry="ge_l1"]');
    await page.waitForSelector('#moneySheet.open');
    await page.waitForTimeout(400);
    assert.deepEqual(await check('#moneySheet .field, #moneySheet input, #moneySheet button, #moneyFor'), [], `${look}: the money sheet`);
    assert.ok(await page.$eval('#moneySheet', s => s.scrollWidth <= s.clientWidth + 1), `${look}: the money sheet doesn't scroll sideways`);
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

test('on a goal card in Blush (light and dark), the bar and the money read clearly on the card as it really shows', async () => {
  for (const mode of ['light', 'dark']) {
    const fx = withExtras(smallFixture());
    fx.docs['settings/theme'] = { look: 'blush', appearance: mode, accent: '' };
    const { ctx, page, errors } = await phone(fx);
    await openGoals(page);
    const got = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const v = n => root.getPropertyValue(n).trim();
      const cs = sel => getComputedStyle(document.querySelector(sel));
      const c = '[data-goal-card="g_car"]';
      return {
        look: document.documentElement.dataset.look, mode: document.documentElement.dataset.mode,
        page: v('--page'), tint: v('--page-tint'), solid: v('--card-solid'), accentInk: v('--accent-ink'),
        card: cs(c).backgroundColor, track: cs(c + ' .goal-bar').backgroundColor, fill: cs(c + ' .goal-bar i').backgroundColor,
        name: cs(c + ' .goal-open').color, due: cs(c + ' .goal-due').color, amt: cs(c + ' .goal-amt').color, left: cs(c + ' .goal-left').color,
        day: cs(c + ' .ge-day').color, note: cs(c + ' .ge-note').color, eamt: cs(c + ' .ge-amt').color, act: cs(c + ' .goal-act').color,
        badge: cs('#goalOpenN').backgroundColor, badgeText: cs('#goalOpenN').color,
      };
    });
    assert.deepEqual([got.look, got.mode], ['blush', mode]);
    for (const k of ['page', 'tint', 'solid']) assert.match(got[k], /^#[0-9A-F]{6}$/i, `${mode}: ${k} is a solid color`);
    // The bar is in the look's readable accent, which in Blush is the ink, like the screenshot: near-black on the light
    // look, cream on the dark.
    assert.equal(parse(got.fill).rgb.join(), parse(got.accentInk).rgb.join(), `${mode}: the bar is in --accent-ink`);
    assert.ok(mode === 'light' ? lum(parse(got.fill).rgb) < 0.03 : lum(parse(got.fill).rgb) > 0.6, `${mode}: ink-black (or cream) ${got.fill}`);
    const card = parse(got.card);
    const grounds = { 'card over the page': over(card, parse(got.page).rgb), 'card over the deepest page': over(card, parse(got.tint).rgb), 'solid card': parse(got.solid).rgb };
    const bad = [];
    for (const [where, ground] of Object.entries(grounds)) {
      const need = (name, color, min, under = ground) => {
        const r = ratio(over(parse(color), under), under);
        if (!(r >= min)) bad.push(`${mode}: ${name} ${color} on ${where}: ${r.toFixed(2)} (needs ${min})`);
      };
      need('goal name', got.name, 4.5);
      need('due date', got.due, 4.5);
      need('money', got.amt, 4.5);
      need('what\'s left', got.left, 4.5);
      need('entry day', got.day, 4.5);
      need('entry note', got.note, 4.5);
      need('entry amount', got.eamt, 4.5);
      need('Add money', got.act, 4.5);
      need('the bar', got.fill, 3);
      // the bar's fill against its own track (the part still to go)
      need('the bar on its track', got.fill, 3, over(parse(got.track), ground));
    }
    const badge = parse(got.badge).rgb;
    assert.ok(ratio(parse(got.badgeText).rgb, badge) >= 4.5, `${mode}: the Open count reads on its badge`);
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
