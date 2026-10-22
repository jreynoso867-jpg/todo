// The Claude edition (built by tools/build-artifact.cjs) on a stand-in for Claude's runtime: window.claude has only
// use(), backed by the phone shim's database, so the page runs as it does in Claude (IS_PHONE false) and the
// tests can seed and dump its storage like the others. Usage: node --test tests/artifact.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, smallFixture, withExtras, EXTRA_COLLS, launch, phoneContext, seed, dump } = require('./lib.cjs');
const { build } = require('../tools/build-artifact.cjs');

const REPO = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
// What Claude wraps a published page in.
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
// A stand-in for the live copy, with made-up owner's words in the slots the build carries over.
const FAKE_LIVE = [
  "  const SIGNOFF = { pearl: 'Sam\\nExample Supply Co', jars: 'Sam\\nJARS', me: 'Sam' };",
  "    if (/pearl/i.test(name)) return { about: 'my job at Example Supply Co', sign: sg.pearl };",
  '<input id="reportClient" class="text-input" type="text" maxlength="80" placeholder="Like Example Grill, Oak St" autocomplete="off">',
  '<input id="clientName" class="text-input" type="text" maxlength="80" placeholder="Like Example Grill" enterkeyhint="next">',
].join('\n');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-artifact-'));
const built = build(SRC, FAKE_LIVE);
fs.writeFileSync(path.join(ROOT, 'index.html'), SKELETON + built.page + '</body></html>');
fs.writeFileSync(path.join(ROOT, 'blank.html'), '<!doctype html><title>x</title>');

// The runtime: the shim's database behind use(), and small fakes for the other capabilities.
const b0 = SRC.indexOf('<body>\n<script>\n') + '<body>\n<script>\n'.length;
let runtime = SRC.slice(b0, SRC.indexOf('</script>', b0));
const caps = runtime.match(/ {2}window\.claude = \{ phone: true, where,[^\n]*\n/);
assert.ok(caps, 'the shim hands out window.claude at its end');
runtime = runtime.replace(caps[0], `
  window.__saves = []; window.__mcp = [];
  const sample = Object.assign(async () => ({ text: 'ok', truncated: false }), { limits: async () => ({ images: { maxCount: 4 }, tools: { maxCount: 8 } }) });
  const fake = {
    downloads: { save: async o => { window.__saves.push({ filename: o.filename, data: typeof o.data === 'string' ? o.data : await o.data.text() }); } },
    mcp: { callTool: async (s, t, i) => { window.__mcp.push({ s, t, i }); return { payload: { id: 'ev' + window.__mcp.length } }; } },
    sample,
  };
  window.claude = Object.freeze({ use: async name => (name === 'db' ? (await loaded, db) : name === 'assets' ? caps.assets : fake[name] || null) });
`);

const ADDED_OK = /^(settings\/theme|settings\/prefs)$/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwnwEI0BkAg+gB/x3B7PQAAAAASUVORK5CYII=', 'base64');

let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); fs.rmSync(ROOT, { recursive: true, force: true }); });

async function open(fx, o = {}) {
  const ctx = await phoneContext(browser, o);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/_blob/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(srv.url + '/blank.html');
  await seed(page, srv.url, fx);
  const before = await dump(page);
  await page.addInitScript(runtime);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task, #hero[data-id]:not([data-id=""])', { timeout: 30000 });
  return { ctx, page, errors, before };
}
const shown = page => page.evaluate(async () => {
  const t = document.querySelector('#doneToggle');
  if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
  await new Promise(r => setTimeout(r, 100));
  return [...new Set([...document.querySelectorAll('#board .task-title, #heroTitle')].map(e => e.textContent.trim()))].filter(Boolean);
});

test('the build carries the owner\'s words over from the live copy and leaves the phone parts out', () => {
  assert.deepEqual(built.carried, ['follow-up signatures', 'work follow-up context', 'report client example', 'client name example']);
  assert.ok(built.page.includes("pearl: 'Sam\\nExample Supply Co'"));
  assert.ok(built.page.includes('placeholder="Like Example Grill, Oak St"'));
  assert.ok(built.page.startsWith("<title>Jose's To-Do List</title>"));
  assert.ok(!/<script>\n\/\* The phone app:/.test(built.page), 'no phone shim');
  const plain = build(SRC, null);
  assert.deepEqual(plain.carried, []);
  assert.ok(plain.page.includes('placeholder="Like Rosa’s Diner"'), 'without a live copy the generic words stay');
});

test('opened in Claude: the list loads, nothing in it changes, and the Claude-only parts show', async () => {
  const fx = withExtras(smallFixture()); // with shopping lists, wishes, goals, dates and their Recently deleted too
  const { ctx, page, errors, before } = await open(fx);
  await page.waitForTimeout(7000); // past the delayed housekeeping (history prune at 5 s, trash purge at 6 s)
  const titles = await shown(page);
  for (const [k, v] of Object.entries(fx.docs)) if (k.startsWith('tasks/') && v.sample !== true) assert.ok(titles.includes(v.title), `shown: ${v.title}`);
  const after = await dump(page);
  for (const [k, v] of Object.entries(before.docs)) assert.deepEqual(after.docs[k], v, `unchanged: ${k}`);
  for (const k of Object.keys(after.docs)) if (!(k in before.docs)) assert.match(k, ADDED_OK, `only additive records: ${k}`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ios-app')), false);
  assert.match(await page.textContent('#foot'), /sync wherever you open this page/);
  assert.ok(await page.isVisible('#planBtn') || await page.isVisible('#askBtn'), 'asking Claude is offered');
  await page.click('#colorsBtn');
  await page.waitForTimeout(400);
  assert.match(await page.textContent('#remNote'), /While the list is open/);
  assert.ok(await page.isHidden('#remClosed'));
  assert.ok(await page.isVisible('#gcalSec'), 'Google Calendar (connectors reachable)');
  assert.ok(await page.isHidden('#snapSec'), 'no on-phone safety copies');
  assert.ok(await page.isHidden('#lockSec'), 'no passcode lock');
  // Save everything: one file through Claude's downloads, with the photo in it.
  await page.click('#exportAll');
  await page.waitForFunction(() => window.__saves.length > 0, null, { timeout: 15000 });
  const file = await page.evaluate(() => window.__saves[0]);
  assert.match(file.filename, /\.json$/);
  const saved = JSON.parse(file.data);
  assert.ok(saved.photos.pphoto000001, 'the photo is in the file');
  for (const [k, v] of Object.entries(fx.docs)) {
    const c = k.slice(0, k.indexOf('/'));
    if (EXTRA_COLLS.includes(c)) assert.deepEqual(saved.collections[c][k.slice(c.length + 1)], v, `in the file: ${k}`);
  }
  assert.equal(saved.collections.bin, undefined, 'Recently deleted stays out of the file');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('opened in Claude: a new task stays after a reload, and Claude\'s dark switch is followed', async () => {
  const { ctx, page, errors } = await open(smallFixture());
  await page.fill('#quickInput', 'Order more gloves');
  await page.press('#quickInput', 'Enter');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('#board .task');
  await page.waitForTimeout(400);
  assert.ok((await shown(page)).includes('Order more gloves'));
  assert.ok([undefined, '[]'].includes((await dump(page)).local['todo.saving']), 'no save notes are kept in Claude');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('opened in Claude: the tabs work the same (with no phone welcome), and nothing in the list changes', async () => {
  const { ctx, page, errors, before } = await open(smallFixture()); // the fixture keeps Tasks as the tab
  const shownPanels = () => page.$$eval('main .pane', els => els.filter(e => !e.hidden && e.offsetParent).map(e => e.id));
  assert.deepEqual(await shownPanels(), ['paneTasks']);
  await page.click('#dockHome');
  assert.deepEqual(await shownPanels(), ['paneHome']);
  assert.equal(await page.$$eval('#homeDueRows .home-row', els => els.length), 3);
  assert.ok(await page.isHidden('#welcome'), 'the welcome is for the phone app only');
  await page.click('#dockLists');
  assert.deepEqual(await shownPanels(), ['paneLists']);
  assert.equal(await page.$$eval('#taskListCards .lcard', els => els.length), 3);
  await page.click('#dockWeek');
  assert.deepEqual(await shownPanels(), ['paneCalendar']);
  assert.ok(await page.isVisible('#weekView .wk-task'));
  await page.click('[data-cal-mode="month"]');
  assert.ok(await page.isVisible('#monthGrid [data-day]'));
  await page.click('#dockToday');
  assert.deepEqual(await shownPanels(), ['paneTasks']);
  assert.equal(await page.getAttribute('#dockToday', 'aria-current'), 'page');
  await page.click('#colorsBtn');
  await page.waitForSelector('#colorsSheet.open');
  assert.equal(await page.evaluate(() => document.querySelector('#dock').inert), true);
  const after = await dump(page);
  for (const [k, v] of Object.entries(before.docs)) assert.deepEqual(after.docs[k], v, `unchanged: ${k}`);
  for (const k of Object.keys(after.docs)) if (!(k in before.docs)) assert.match(k, ADDED_OK, `only additive records: ${k}`);
  assert.equal(after.local['todo.tab'], 'tasks');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('opened in Claude: a look saved by the old version (orange on pink) comes through untouched', async () => {
  const fx = smallFixture();
  fx.docs['settings/app'] = { skin: 'orange-pink', updatedAt: Date.now() - 1e6 };
  const { ctx, page, errors, before } = await open(fx);
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'orange-pink');
  assert.deepEqual((await dump(page)).docs['settings/app'], before.docs['settings/app']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('opened in Claude: a leftover unfinished save is never put back in (another device may have changed the item since)', async () => {
  const fx = smallFixture();
  const before = { ...fx.docs['tasks/t_overdue'] };
  fx.local['todo.saving'] = JSON.stringify([{ path: 'tasks/t_overdue', kind: 'update', data: { priority: 1 }, known: true, before }]);
  const { ctx, page, errors } = await open(fx);
  await page.waitForTimeout(2500);
  const d = await dump(page);
  assert.equal(d.docs['tasks/t_overdue'].priority, before.priority, 'the item is left as the database has it');
  assert.equal(d.local['todo.saving'], '[]', 'and the note is dropped');
  assert.deepEqual(errors, []);
  await ctx.close();
});
