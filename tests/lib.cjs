// Test helpers: a tiny static server, fixtures shaped exactly like the phone app's storage,
// and functions that seed and dump the app's IndexedDB ('jose-todo': docs + blobs) and localStorage.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  throw new Error('Playwright is needed for the tests: run `npm install` in tests/, or set NODE_PATH to a global install.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.md': 'text/markdown' };

// Serves `root` (changeable at any time, so one origin can switch from the old app to the new one).
function serve(root) {
  const state = { root, offline: false };
  const server = http.createServer((req, res) => {
    if (state.offline) { req.socket.destroy(); return; }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(state.root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(state.root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => {
    const url = `http://localhost:${server.address().port}`;
    ok({ url, state, close: () => new Promise(r => server.close(r)) });
  }));
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return ymd(x); };
const at = (day, hh = 9, mm = 0) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); };
// A 4x4 red PNG, a real picture by its bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwnwEI0BkAg+gB/x3B7PQAAAAASUVORK5CYII=', 'base64');

// Every kind of record the app keeps, with every field it knows, including legacy shapes.
function smallFixture(today = ymd(new Date())) {
  const T = today;
  const now = Date.now();
  const docs = {
    'lists/l_jars': { name: 'JARS', color: 1, order: 1 },
    'lists/l_pearl': { name: 'Pearl', color: 5, order: 2 },
    'lists/l_home': { name: 'Home', color: 2, order: 3 },
    'categories/c_calls': { name: 'Calls', color: 4, order: 1, createdAt: now - 9e8 },
    'categories/c_kitchen': { name: 'Kitchen', color: 6, order: 2, createdAt: now - 8e8 },
    'clients/cl_rosa': { name: 'Rosa’s Diner', address: '120 Main St, Springfield', contact: 'Rosa', phone: '555-201-3344',
      checklist: ['Degrease the fryer area', 'Clean hood filters'], note: 'Door code 4471', createdAt: now - 7e8 },
    'templates/tp_deep': { name: 'Deep clean', title: 'Deep clean', note: 'Bring degreaser', checklist: ['Hoods', 'Fryers', 'Floors'],
      list: 'l_jars', priority: 2, createdAt: now - 6e8 },
    'tasks/t_overdue': { title: 'Call ABC Supply about PO 4471', note: 'Ask about the late delivery\nPhone 555-123-4567', priority: 3,
      done: false, due: addDays(T, -2), time: null, repeat: null, list: 'l_pearl', checklist: [], createdAt: now - 5e8, doneAt: null,
      waiting: { on: 'ABC Supply', since: addDays(T, -5), nudges: 1, last: addDays(T, -2) },
      po: { number: '4471', vendor: 'ABC Supply', eta: addDays(T, -1), status: 'ordered', late: addDays(T, -1) }, cats: ['c_calls'] },
    'tasks/t_today_timed': { title: 'Clean Rosa’s Diner', note: '120 Main St, Springfield', priority: 0, done: false, due: T, time: '15:00',
      end: '17:00', repeat: null, list: 'l_jars', client: 'cl_rosa', rank: 1000, cats: ['c_kitchen'], createdAt: now - 4e8, doneAt: null,
      checklist: [{ id: 'a1', text: 'Degrease the fryer area', done: true }, { id: 'a2', text: 'Clean hood filters', done: false }],
      photos: [{ id: 'pphoto000001', w: 4, h: 4 }] },
    'tasks/t_today_untimed': { title: 'Pay electric bill', note: '', priority: 2, done: false, due: T, time: null, repeat: null,
      list: 'l_home', pinned: true, rank: 2000, checklist: [], createdAt: now - 3e8, doneAt: null },
    // A checklist saved before items had ids (legacy shape).
    'tasks/t_anytime': { title: 'Buy new mop heads', note: '', priority: 1, done: false, due: null, time: null, repeat: null, list: 'l_jars',
      checklist: [{ text: 'Mop heads' }, { text: 'Buckets', done: true }], createdAt: now - 2.5e8, doneAt: null },
    'tasks/t_tomorrow': { title: 'Send invoice to Rosa', note: '', priority: 0, done: false, due: addDays(T, 1), time: '09:30',
      repeat: 'weekly', list: 'l_jars', checklist: [], createdAt: now - 2e8, doneAt: null },
    'tasks/t_rent': { title: 'Pay rent', note: '', priority: 3, done: false, due: '2027-01-31', time: null, repeat: 'monthly',
      list: 'l_home', checklist: [], createdAt: now - 1.9e8, doneAt: null },
    'tasks/t_walk': { title: 'Morning walk', note: '', priority: 0, done: true, doneAt: at(T, 8), due: T, time: null, repeat: 'daily',
      spawnedId: 't_walk_next', list: 'l_home', checklist: [], createdAt: now - 1.8e8 },
    'tasks/t_walk_next': { title: 'Morning walk', note: '', priority: 0, done: false, due: addDays(T, 1), time: null, repeat: 'daily',
      list: 'l_home', checklist: [], createdAt: now - 1e5, doneAt: null },
    'tasks/t_sample': { title: 'Sample: swipe me', note: '', priority: 0, done: false, due: T, time: null, repeat: null, list: null,
      checklist: [], createdAt: now - 1.7e8, doneAt: null, sample: true },
    'tasks/t_wait': { title: 'Quote from Home Depot', note: '', priority: 0, done: false, due: addDays(T, 3), time: null, repeat: null,
      list: 'l_pearl', checklist: [], createdAt: now - 1.6e8, doneAt: null, waiting: { on: 'Home Depot', since: addDays(T, -1) } },
    'tasks/t_done_old': { title: 'Order gloves', note: '', priority: 1, done: true, doneAt: at(addDays(T, -3), 14), due: addDays(T, -3),
      time: null, repeat: null, list: 'l_jars', checklist: [], createdAt: now - 1.5e8 },
    'tasks/t_gcal': { title: 'Meet the landlord', note: '', priority: 0, done: false, due: addDays(T, 2), time: '11:00', repeat: null,
      list: null, checklist: [], createdAt: now - 1.4e8, doneAt: null, gcal: { id: 'evt123', sig: 'x' } },
    'tasks/t_unicode': { title: '日本語タスク 🎉 émoji', note: 'Ñoño “quotes” <b>not html</b>', priority: 0, done: false, due: addDays(T, 9),
      time: null, repeat: 'yearly', list: null, checklist: [], createdAt: now - 1.3e8, doneAt: null },
    'trash/t_gone': { task: { title: 'Old deleted task', note: '', priority: 0, done: false, due: addDays(T, -10), list: 'l_home',
      checklist: [], createdAt: now - 9e9 }, deletedAt: now - 2 * 864e5 },
    ['history/' + addDays(T, -1)]: { day: addDays(T, -1), items: { t_cleared: { list: 'l_home', at: at(addDays(T, -1), 17) } } },
    ['history/' + T]: { day: T, items: { t_walk: { list: 'l_home', at: at(T, 8) } } },
    'settings/app': { skin: 'classic', updatedAt: now - 1e8 },
    'settings/view': { textSize: 'default', sort: 'mine', gcal: false, updatedAt: now - 1e8 },
    'settings/streak': { days: { [addDays(T, -2)]: 'done', [addDays(T, -1)]: 'missed' }, updatedAt: now - 1e8 },
  };
  const blobs = { pphoto000001: { type: 'image/png', bytes: [...PNG] } };
  const local = { 'todo.welcomed': '1', 'todo.filter': '*all', 'todo.showDone': '0', 'todo.swipeTip2': '1' };
  return { today: T, docs, blobs, local };
}

// A big list: 2000 tasks (800 open across every section, 1200 done) and 60 days of history.
function largeFixture(today = ymd(new Date()), n = 2000) {
  const T = today;
  const now = Date.now();
  const docs = {};
  const lists = ['l1', 'l2', 'l3', 'l4', 'l5'];
  lists.forEach((id, i) => { docs['lists/' + id] = { name: ['JARS', 'Pearl', 'Home', 'Errands', 'Office'][i], color: i + 1, order: i + 1 }; });
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const open = Math.round(n * 0.4);
  for (let i = 0; i < n; i++) {
    const done = i >= open;
    const r = rnd();
    const due = done ? addDays(T, -Math.floor(rnd() * 60)) :
      r < 0.12 ? addDays(T, -1 - Math.floor(rnd() * 20)) : r < 0.37 ? T : r < 0.5 ? null : r < 0.62 ? addDays(T, 1) : addDays(T, 2 + Math.floor(rnd() * 60));
    const items = Array.from({ length: Math.floor(rnd() * 5) }, (_, k) => ({ id: `c${i}_${k}`, text: `Step ${k + 1} of task ${i}`, done: rnd() < 0.4 }));
    docs[`tasks/t${String(i).padStart(5, '0')}`] = {
      title: `Task number ${i} ${rnd() < 0.2 ? 'with a much longer title that wraps onto a second line on a phone' : ''}`.trim(),
      note: rnd() < 0.3 ? `Note for ${i}\nSecond line` : '', priority: Math.floor(rnd() * 4), done, doneAt: done ? at(due || T, 9 + Math.floor(rnd() * 9)) : null,
      due, time: due && rnd() < 0.4 ? `${pad(7 + Math.floor(rnd() * 12))}:${rnd() < 0.5 ? '00' : '30'}` : null, repeat: null,
      list: rnd() < 0.85 ? lists[Math.floor(rnd() * lists.length)] : null, checklist: items, createdAt: now - i * 6e4,
      ...(rnd() < 0.05 && !done ? { waiting: { on: 'Vendor ' + i, since: addDays(T, -3) } } : {}),
    };
  }
  for (let d = 1; d <= 60; d++) {
    const day = addDays(T, -d);
    const items = {};
    for (let k = 0; k < 4; k++) items[`h${d}_${k}`] = { list: lists[k % 5], at: at(day, 10 + k) };
    docs['history/' + day] = { day, items };
  }
  docs['settings/app'] = { skin: 'classic', updatedAt: now };
  return { today: T, docs, blobs: {}, local: { 'todo.welcomed': '1', 'todo.swipeTip2': '1' } };
}

// The newer kinds of record, each in its own flat collection: shopping lists and their items, wishes, savings goals and
// what went into them, important dates, and Recently deleted for these (bin/<collection>~<id>, never trash/). Unicode
// and markup in the words, a Feb 29 birthday, a negative amount. Every bin entry is less than 7 days old, so nothing here
// is due to be cleared when the app opens.
function extrasFixture(today = ymd(new Date())) {
  const T = today;
  const now = Date.now();
  const t = (ago, d = 0) => ({ createdAt: now - ago, updatedAt: now - ago + d });
  const day = 864e5;
  const binned = (coll, id, doc, group, ago) => ({ coll, id, doc, group, deletedAt: now - ago });
  const party = { name: 'Party supplies', color: 7, order: 3, ...t(9e8, 1e5) };
  const trip = { name: 'Trip fund', targetCents: 250000, due: addDays(T, 90), closedAt: null, order: 3, ...t(8e8, 2e5) };
  const docs = {
    'shopLists/sl_groceries': { name: 'Groceries', color: 3, order: 1, ...t(5e8, 1e6) },
    'shopLists/sl_hardware': { name: 'Hardware <b>store</b> 🔧', color: 6, order: 2, ...t(4e8) },
    'shopItems/si_milk': { list: 'sl_groceries', text: 'Milk', link: null, done: false, doneAt: null, rank: 1000, ...t(3e8) },
    'shopItems/si_eggs': { list: 'sl_groceries', text: 'Eggs ×12 “free range”', link: 'https://example.com/eggs?size=12', done: true,
      doneAt: now - 2e7, rank: 2000, ...t(2.9e8, 2.7e8) },
    'shopItems/si_screws': { list: 'sl_hardware', text: 'Wood screws 日本語', link: null, done: false, doneAt: null, rank: 1000, ...t(2.8e8) },
    'wishes/w_coast': { title: 'Trip to the coast', category: 'travel', priceCents: 3500000, link: 'https://example.com/coast', hearted: true,
      got: false, gotAt: null, note: 'Spring, maybe\nTwo weeks', rank: 1000, ...t(2.5e8, 1e7) },
    'wishes/w_ramen': { title: 'Ramen at Example Grill 🍜', category: 'food', priceCents: 1850, link: null, hearted: false, got: true,
      gotAt: now - 1e8, note: '<b>not html</b>', rank: 2000, ...t(2.4e8, 1.4e8) },
    'wishes/w_lamp': { title: 'Reading lamp', category: 'shopping', priceCents: null, link: null, hearted: false, got: false, gotAt: null,
      note: '', rank: 3000, ...t(2.3e8) },
    'goals/g_car': { name: 'New car', targetCents: 3500000, due: addDays(T, 200), closedAt: null, order: 1, ...t(7e8, 1e6) },
    'goals/g_laptop': { name: 'Laptop', targetCents: 120000, due: null, closedAt: now - 3e8, order: 2, ...t(6e8, 3e8) },
    'goalEntries/ge_bonus': { goal: 'g_car', amountCents: 1000000, day: addDays(T, -40), note: 'Bonus', ...t(4e9) },
    'goalEntries/ge_june': { goal: 'g_car', amountCents: 600000, day: addDays(T, -10), note: '', ...t(9e8) },
    'goalEntries/ge_out': { goal: 'g_car', amountCents: -25050, day: addDays(T, -3), note: 'Took some out', ...t(2.6e8) },
    'goalEntries/ge_laptop': { goal: 'g_laptop', amountCents: 120000, day: addDays(T, -60), note: '', ...t(5.2e9) },
    'dates/d_sam': { title: 'Sam’s birthday', kind: 'birthday', date: '1992-02-29', yearly: true, note: 'Likes tea', ...t(3e9) },
    'dates/d_dentist': { title: 'Dentist', kind: 'appointment', date: addDays(T, 5), yearly: false, note: '', ...t(2e8) },
    'dates/d_shop': { title: 'Shop opened', kind: 'anniversary', date: '2015-06-01', yearly: true, note: '', ...t(2.2e9) },
    // Recently deleted: a wish on its own, a shopping list with its items, a goal with its entries, a date.
    'bin/wishes~w_kayak': binned('wishes', 'w_kayak', { title: 'Kayak <i>lessons</i>', category: 'plans', priceCents: 12000,
      link: 'https://example.com/kayak', hearted: true, got: false, gotAt: null, note: '', rank: 4000, ...t(9e8, 1e8) }, null, 2 * day),
    'bin/shopLists~sl_party': binned('shopLists', 'sl_party', party, 'shopLists~sl_party', day),
    'bin/shopItems~si_cups': binned('shopItems', 'si_cups', { list: 'sl_party', text: 'Paper cups', link: null, done: false, doneAt: null,
      rank: 1000, ...t(8.9e8) }, 'shopLists~sl_party', day),
    'bin/shopItems~si_ice': binned('shopItems', 'si_ice', { list: 'sl_party', text: 'Ice', link: null, done: true, doneAt: now - 9e7,
      rank: 2000, ...t(8.8e8, 7e8) }, 'shopLists~sl_party', day),
    'bin/goals~g_trip': binned('goals', 'g_trip', trip, 'goals~g_trip', 3 * day),
    'bin/goalEntries~ge_t1': binned('goalEntries', 'ge_t1', { goal: 'g_trip', amountCents: 40000, day: addDays(T, -20), note: 'First',
      ...t(7e8) }, 'goals~g_trip', 3 * day),
    'bin/goalEntries~ge_t2': binned('goalEntries', 'ge_t2', { goal: 'g_trip', amountCents: 15000, day: addDays(T, -8), note: '',
      ...t(6e8) }, 'goals~g_trip', 3 * day),
    'bin/dates~d_party': binned('dates', 'd_party', { title: 'Block party', kind: 'other', date: addDays(T, 30), yearly: false,
      note: 'Bring chairs', ...t(5e8) }, null, 4 * day),
  };
  return { today: T, docs, blobs: {}, local: {} };
}
// A fixture with the newer kinds added to it.
function withExtras(fx) {
  const x = extrasFixture(fx.today);
  return { ...fx, docs: { ...fx.docs, ...x.docs }, blobs: { ...fx.blobs }, local: { ...fx.local } };
}
// The collections the newer kinds live in (bin is Recently deleted for them; it isn't in a saved file).
const EXTRA_COLLS = ['shopLists', 'shopItems', 'wishes', 'goals', 'goalEntries', 'dates'];

async function launch(opts = {}) {
  const browser = await playwright.chromium.launch({ args: ['--js-flags=--expose-gc'] });
  return browser;
}

// An iPhone-sized, touch-capable context. Service workers are blocked unless asked for.
async function phoneContext(browser, o = {}) {
  return browser.newContext({
    viewport: o.viewport || { width: 390, height: 844 }, deviceScaleFactor: o.dpr || 2, isMobile: true, hasTouch: true,
    serviceWorkers: o.sw ? 'allow' : 'block', colorScheme: o.colorScheme || 'light', reducedMotion: o.reducedMotion || 'no-preference',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
}

// Writes the fixture straight into the app's own database, the way the phone app keeps it.
async function seed(page, base, fx) {
  await page.goto(base + '/__blank');
  await page.evaluate(async ({ docs, blobs, local }) => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open('jose-todo', 1);
      r.onupgradeneeded = () => { for (const n of ['docs', 'blobs']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    await new Promise((ok, fail) => {
      const t = db.transaction(['docs', 'blobs'], 'readwrite');
      for (const [k, v] of Object.entries(docs)) t.objectStore('docs').put(v, k);
      for (const [k, v] of Object.entries(blobs)) t.objectStore('blobs').put({ type: v.type, buf: new Uint8Array(v.bytes).buffer }, k);
      t.oncomplete = ok;
      t.onerror = () => fail(t.error);
    });
    db.close();
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
  }, fx);
}

// Everything the app has stored: every doc, every blob (type and bytes), and the todo.* localStorage keys.
async function dump(page) {
  return page.evaluate(async () => {
    const db = await new Promise((ok, fail) => { const r = indexedDB.open('jose-todo'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    const read = name => new Promise((ok, fail) => {
      const out = {};
      const t = db.transaction(name, 'readonly');
      const req = t.objectStore(name).openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return; out[String(c.key)] = c.value; c.continue(); };
      t.oncomplete = () => ok(out);
      t.onerror = () => fail(t.error);
    });
    const docs = await read('docs');
    const blobsRaw = await read('blobs');
    db.close();
    const blobs = {};
    for (const [k, v] of Object.entries(blobsRaw)) blobs[k] = { type: v.type, bytes: v.buf ? [...new Uint8Array(v.buf)] : null };
    const local = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('todo.')) local[k] = localStorage.getItem(k); }
    return { docs, blobs, local };
  });
}

module.exports = { serve, smallFixture, largeFixture, extrasFixture, withExtras, EXTRA_COLLS, launch, phoneContext, seed, dump, ymd, addDays, at, playwright };
