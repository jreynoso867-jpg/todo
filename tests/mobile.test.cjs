// The phone layout, as far as a desktop browser can show it (not a real iPhone): every control answers taps in an
// area at least 44 points tall (Apple's minimum), and no text box is set under 16px (iOS zooms the page into one).
// Usage: node --test tests/mobile.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve, smallFixture, withExtras, launch, phoneContext, seed } = require('./lib.cjs');

const APP = path.resolve(process.env.NEW_DIR || path.join(__dirname, '..'));
let srv, browser;
test.before(async () => { srv = await serve(APP); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// Each visible control, scrolled to the middle of the screen: how tall the area is that a tap on it reaches (a tap
// straight above or below its middle that lands on it, or on the see-through margin around it).
const TAP = () => {
  const out = [];
  const seen = new Set();
  for (const e of document.querySelectorAll('button, a[href], select, [role="button"], [role="switch"]')) {
    if (seen.has(e) || e.closest('[hidden], [inert]')) continue;
    seen.add(e);
    const r0 = e.getBoundingClientRect();
    if (!r0.width || !r0.height || getComputedStyle(e).visibility === 'hidden') continue;
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2, y = Math.round(r.top + r.height / 2);
    const hits = yy => { const h = document.elementFromPoint(x, yy); return !!h && (h === e || e.contains(h)); };
    if (!hits(y)) continue; // under something else just now (the tab bar, a sheet): not tappable here anyway
    let up = 0, down = 0;
    while (up < 40 && hits(y - up - 1)) up++;
    while (down < 40 && hits(y + down + 1)) down++;
    const label = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    out.push({ what: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ')[0]} "${label}"`, tall: up + down + 1 });
  }
  return out;
};
const textBoxes = () => [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea, select')]
  .filter(e => !e.closest('[hidden]') && e.getBoundingClientRect().width)
  .map(e => ({ what: `${e.tagName.toLowerCase()}#${e.id}`, px: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.px < 16);

test('on an iPhone SE: every control answers taps at least 44 points tall, and no text box would make iOS zoom', async () => {
  const ctx = await phoneContext(browser, { viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const fx = withExtras(smallFixture());
  fx.local['todo.tab'] = 'home';
  await seed(page, srv.url, fx);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#paneHome:not([hidden])');
  await page.waitForTimeout(600);
  const small = [], tiny = [];
  const look = async where => {
    // (Measured a whole pixel at a time from the middle, so a control 44 points tall can read 43.)
    for (const c of await page.evaluate(TAP)) if (c.tall < 43) small.push(`${where}: ${c.what} ${c.tall}`);
    for (const b of await page.evaluate(textBoxes)) tiny.push(`${where}: ${b.what} ${b.px}px`);
  };
  await look('Home');
  for (const [where, tab] of [['Tasks', '#dockToday'], ['Lists', '#dockLists'], ['Calendar', '#dockWeek']]) {
    await page.evaluate(sel => document.querySelector(sel).click(), tab);
    await page.waitForTimeout(500);
    await look(where);
  }
  await page.click('[data-cal-mode="week"]');
  await page.waitForTimeout(300);
  await look('Week');
  await page.click('#reviewBtn');
  await page.waitForSelector('#reviewSheet.open');
  await look('Review');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#dockToday').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#board .task-body').click());
  await page.waitForSelector('#taskSheet.open');
  await look('A task');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#colorsBtn').click());
  await page.waitForSelector('#colorsSheet.open');
  await look('Settings');
  assert.deepEqual(small, [], 'too small to tap');
  assert.deepEqual(tiny, [], 'text boxes iOS would zoom into');
  assert.deepEqual(errors, []);
  await ctx.close();
});
