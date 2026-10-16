// CPU profile of opening the app on a 2000-task list: prints the functions that take the most time (self time).
// Usage: node tests/profile.cjs <app dir> [boot|toggle|type]
'use strict';
const path = require('node:path');
const { serve, largeFixture, launch, phoneContext, seed } = require('./lib.cjs');

(async () => {
  const dir = path.resolve(process.argv[2] || '.');
  const what = process.argv[3] || 'boot';
  const srv = await serve(dir);
  const browser = await launch();
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  await seed(page, srv.url, largeFixture());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  if (what === 'boot') {
    await cdp.send('Profiler.start');
    await page.goto(srv.url + '/index.html');
    await page.waitForSelector('#board .task');
    await page.waitForTimeout(1000);
  } else {
    await page.goto(srv.url + '/index.html');
    await page.waitForSelector('#board .task');
    await page.waitForTimeout(1500);
    await cdp.send('Profiler.start');
    if (what === 'toggle') {
      for (let i = 0; i < 4; i++) { await page.evaluate(() => document.querySelector('#board .task:not(.is-done) .ring').click()); await page.waitForTimeout(1300); }
    } else {
      await page.type('#quickInput', 'tomorrow 3pm call the vendor !!');
    }
  }
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas;
  const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of counts) {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url ? path.basename(f.url) : ''}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us);
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, us] of top) console.log((us / 1000).toFixed(1).padStart(8), 'ms ', k);
  await browser.close();
  await srv.close();
})();
