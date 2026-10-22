// Screenshots of the app on phone sizes, in each look, with the fixture list. Reports any script errors.
// Usage: node tests/shots.cjs <app dir> <out dir> [look,look...] [WxH] [text size]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { serve, smallFixture, launch, phoneContext, seed } = require('./lib.cjs');

(async () => {
  const dir = path.resolve(process.argv[2] || '.');
  const out = path.resolve(process.argv[3] || 'shots');
  const looks = (process.argv[4] || 'classic:light,midnight:dark,blush:light,blush:dark').split(',');
  const [w, h] = (process.argv[5] || '390x844').split('x').map(Number);
  const textSize = process.argv[6] || 'default';
  fs.mkdirSync(out, { recursive: true });
  const srv = await serve(dir);
  const browser = await launch();
  const errors = [];
  for (const spec of looks) {
    const [look, mode = 'light', full] = spec.split(':');
    const ctx = await phoneContext(browser, { viewport: { width: w, height: h }, colorScheme: mode });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${spec}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${spec} console: ${m.text()}`); });
    const fx = smallFixture();
    fx.docs['settings/theme'] = { look, appearance: 'system', accent: '', updatedAt: Date.now() };
    fx.docs['settings/view'] = { ...fx.docs['settings/view'], textSize };
    fx.local['todo.theme'] = look;
    await seed(page, srv.url, fx);
    await page.goto(srv.url + '/index.html');
    await page.waitForSelector('#board .task');
    await page.waitForTimeout(900);
    const name = `${look}-${mode}-${w}${textSize !== 'default' ? '-' + textSize : ''}${full && full !== 'full' ? '-' + full : ''}`;
    // A full-page capture doesn't scroll, so rows drawn only when on screen are drawn up front.
    if (full === 'full') await page.addStyleTag({ content: '.task{content-visibility:visible!important}' });
    // Screens other than the list: settings, a task, focus, the calendar, the other tabs.
    if (full === 'settings') { await page.click('#colorsBtn'); await page.waitForTimeout(500); }
    if (full === 'task') { await page.click('.task[data-id="t_today_timed"] .task-body'); await page.waitForTimeout(500); }
    if (full === 'focus') { await page.click('#heroFocus'); await page.waitForTimeout(300); }
    if (full === 'month') { await page.click('#monthBtn'); await page.waitForTimeout(500); } // the Calendar tab, on the month
    // The other tabs (the list opens on Tasks).
    if (full === 'home') { await page.click('#dockHome'); await page.waitForTimeout(500); }
    if (full === 'lists') { await page.click('#dockLists'); await page.waitForTimeout(500); }
    if (full === 'calendar') { await page.click('#dockWeek'); await page.waitForTimeout(500); }
    if (full === 'overdue') { await page.click('[data-scope="overdue"]'); await page.waitForTimeout(300); }
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: full === 'full' });
    if (full) {
      if (full === 'settings' || full === 'task') {
        await page.evaluate(() => { const sh = document.querySelector('.sheet.open'); if (sh) sh.scrollTop = 800; });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, name + '-2.png') });
        await page.evaluate(() => { const sh = document.querySelector('.sheet.open'); if (sh) sh.scrollTop = 1700; });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, name + '-3.png') });
      }
      await ctx.close();
      continue;
    }
    await page.evaluate(() => window.scrollTo(0, 820));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, name + '-2.png') });
    await ctx.close();
  }
  await browser.close();
  await srv.close();
  console.log(errors.length ? errors.join('\n') : 'no script errors');
})().catch(e => { console.error(e); process.exit(1); });
