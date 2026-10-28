// Performance benchmark: boot (on Tasks, and on Home), check-off, opening a task, editing and saving one, typing in
// quick add, searching, switching tabs, memory and DOM size, on a small and a 2000-task list, with the CPU slowed 4x
// to stand in for a phone.
// Usage: node tests/bench.cjs <app dir> [label]   (prints JSON)
'use strict';
const path = require('node:path');
const { serve, smallFixture, largeFixture, launch, phoneContext, seed } = require('./lib.cjs');

const RUNS = Number(process.env.RUNS || 5);
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const round = n => Math.round(n * 10) / 10;

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.map(x => [x.name, x.value]));
}

async function one(browser, srv, fx) {
  const ctx = await phoneContext(browser);
  const page = await ctx.newPage();
  await seed(page, srv.url, fx);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__bench = {};
    new MutationObserver(() => {
      if (!window.__bench.rows && document.querySelector('#board .task')) window.__bench.rows = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  const before = await metrics(cdp);
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('#board .task', { timeout: 60000 });
  await page.waitForTimeout(1500); // let the boot work settle (snapshots, timers)
  const after = await metrics(cdp);
  const boot = await page.evaluate(() => window.__bench.rows);
  const res = {
    firstRowsMs: round(boot),
    bootMainThreadMs: round((after.TaskDuration - before.TaskDuration) * 1000),
    bootScriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1000),
    bootLayoutStyleMs: round(((after.LayoutDuration - before.LayoutDuration) + (after.RecalcStyleDuration - before.RecalcStyleDuration)) * 1000),
  };

  // Check off and back on a task in Today: main-thread time from the tap until every render it causes is done.
  const toggles = [];
  for (let i = 0; i < 6; i++) {
    const m0 = await metrics(cdp);
    await page.evaluate(async () => {
      const ring = document.querySelector('#board [data-sec="today"] .task:not(.is-done) .ring, #board .task:not(.is-done) .ring');
      ring.click();
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    });
    const m1 = await metrics(cdp);
    toggles.push((m1.TaskDuration - m0.TaskDuration) * 1000);
    await page.waitForTimeout(1200); // past the linger, so the next one starts fresh
  }
  res.checkOffMainThreadMs = round(median(toggles));

  // Open a task's sheet, then close it.
  const opens = [];
  for (let i = 0; i < 4; i++) {
    const m0 = await metrics(cdp);
    await page.evaluate(async () => {
      document.querySelector('#board .task:not(.is-done) .task-body').click();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    });
    const m1 = await metrics(cdp);
    opens.push((m1.TaskDuration - m0.TaskDuration) * 1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  res.openTaskMainThreadMs = round(median(opens));

  // Editing a task: open it, change its words, Save. Main-thread time from the tap on Save until every render is done.
  const saves = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => document.querySelector('#board .task:not(.is-done) .task-body').click());
    await page.waitForSelector('#taskSheet.open');
    await page.fill('#taskTitle', `Edited title ${i}`);
    const m0 = await metrics(cdp);
    await page.evaluate(async () => {
      document.querySelector('#sheetSubmit').click();
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    });
    const m1 = await metrics(cdp);
    saves.push((m1.TaskDuration - m0.TaskDuration) * 1000);
    await page.waitForTimeout(450);
  }
  res.editSaveMainThreadMs = round(median(saves));

  // Searching: open search and type six letters, then cancel.
  const s0 = await metrics(cdp);
  await page.click('#searchBtn');
  await page.type('#searchInput', 'task 1', { delay: 0 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
  const s1 = await metrics(cdp);
  res.search6charsMainThreadMs = round((s1.TaskDuration - s0.TaskDuration) * 1000);
  await page.click('#searchCancel');
  await page.waitForTimeout(300);

  // Switching tabs: Home, Lists, Calendar, then back to Tasks; the median of each switch.
  const switches = [];
  for (const tab of ['#dockHome', '#dockLists', '#dockWeek', '#dockToday', '#dockHome', '#dockToday']) {
    const m0 = await metrics(cdp);
    await page.evaluate(async sel => {
      document.querySelector(sel).click();
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    }, tab);
    const m1 = await metrics(cdp);
    switches.push((m1.TaskDuration - m0.TaskDuration) * 1000);
    await page.waitForTimeout(300);
  }
  res.tabSwitchMainThreadMs = round(median(switches));
  res.tabSwitchSlowestMs = round(Math.max(...switches));

  // Typing in quick add: 20 keystrokes.
  const q = await page.$('#quickInput');
  if (q) {
    const m0 = await metrics(cdp);
    await q.type('tomorrow 3pm call the vendor !!', { delay: 0 });
    const m1 = await metrics(cdp);
    res.typing30charsMainThreadMs = round((m1.TaskDuration - m0.TaskDuration) * 1000);
    await q.fill('');
  }

  // Memory and DOM after a garbage collection.
  await cdp.send('HeapProfiler.collectGarbage');
  const m = await metrics(cdp);
  res.heapMB = round(m.JSHeapUsedSize / 1048576);
  res.domNodes = m.Nodes;
  res.taskRowsInDom = await page.evaluate(() => document.querySelectorAll('.task').length);
  await ctx.close();

  // Opening on Home (where the app opens until another tab is picked): main-thread time until it settles.
  const hctx = await phoneContext(browser);
  const hpage = await hctx.newPage();
  await seed(hpage, srv.url, { ...fx, local: { ...fx.local, 'todo.tab': 'home' } });
  const hcdp = await hctx.newCDPSession(hpage);
  await hcdp.send('Performance.enable');
  await hcdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const h0 = await metrics(hcdp);
  await hpage.goto(srv.url + '/index.html');
  await hpage.waitForSelector('#homeDue:not([hidden])', { timeout: 60000 });
  await hpage.waitForTimeout(1500);
  const h1 = await metrics(hcdp);
  res.homeBootMainThreadMs = round((h1.TaskDuration - h0.TaskDuration) * 1000);
  await hctx.close();
  return res;
}

(async () => {
  const dir = path.resolve(process.argv[2] || '.');
  const label = process.argv[3] || path.basename(dir);
  const srv = await serve(dir);
  const browser = await launch();
  const out = { label };
  for (const [name, fx] of [['small', smallFixture()], ['large2000', largeFixture()]]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await one(browser, srv, fx));
    const keys = Object.keys(runs[0]);
    out[name] = Object.fromEntries(keys.map(k => [k, median(runs.map(r => r[k]))]));
  }
  await browser.close();
  await srv.close();
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
