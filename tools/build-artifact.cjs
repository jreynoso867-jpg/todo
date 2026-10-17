#!/usr/bin/env node
// Builds the Claude artifact edition of the app from index.html.
//   node tools/build-artifact.cjs --live <saved copy of the published artifact> --out <file.html>
// The artifact runs on Claude's own runtime (window.claude.use), so the phone shim, the service worker, the
// security policy and the local font file go, and photos are read from Claude's /_blob/ store.
// A few lines in the published artifact are the owner's own words (the follow-up signature, example names in
// two boxes). They aren't kept in this public repository: they're carried over from the live copy (--live),
// which has to be read before publishing anyway. Without --live the generic lines from index.html stay.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function fail(msg) { console.error('build-artifact: ' + msg); process.exit(1); }

function build(src, live) {
  const body0 = src.indexOf('<body>\n');
  if (body0 < 0) throw new Error('no <body> in index.html');
  let body = src.slice(body0 + '<body>\n'.length);
  if (!body.startsWith('<script>\n/* The phone app:')) throw new Error('the phone shim is not the first thing in the body');
  body = body.slice(body.indexOf('</script>\n') + '</script>\n'.length);
  const sw = '<script>\n// The iPhone app has its files inside it already';
  const i = body.indexOf(sw);
  if (i < 0) throw new Error('service worker script not found');
  body = body.slice(0, i) + body.slice(body.indexOf('</script>\n', i) + '</script>\n'.length);
  const end = body.lastIndexOf('</body>');
  if (end < 0) throw new Error('no </body>');
  body = body.slice(0, end);

  let page = "<title>Jose's To-Do List</title>\n" +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap">\n' +
    body;
  const rep = (a, b) => {
    const n = page.split(a).length - 1;
    if (n !== 1) throw new Error(`expected exactly one of: ${a.slice(0, 100)} (found ${n})`);
    page = page.replace(a, () => b);
  };
  // Photos are served by Claude at /_blob/<id>.
  rep("  const photoSrc = p => p.preview || S.photoUrls.get(p.id) || '_blob/' + encodeURIComponent(p.id) + (NATIVE ? '.img' : '');",
    "  const photoSrc = p => p.preview || S.photoUrls.get(p.id) || '/_blob/' + p.id;");
  rep('          const res = S.photoUrls.has(id) ? await fetch(S.photoUrls.get(id)) : await window.claude.photo(id);',
    '          const res = await fetch(photoSrc({ id }));');
  // The list lives on Claude's servers, so changes made with no signal wait on the device.
  rep("  S.offline = false; // the phone app keeps the list on the phone, so there's nothing to wait for",
    '  S.offline = navigator.onLine === false;');
  rep("  window.addEventListener('online', () => { S.offline = false; renderNet(); scheduleFlush(300); });",
    "  window.addEventListener('online', () => { S.offline = false; renderNet(); scheduleFlush(300); });\n" +
    "  window.addEventListener('offline', () => { S.offline = true; wasOffline = true; renderNet(); });");
  // Words for this version.
  rep("      if (done) ok(); else toast('Couldn’t copy that. Try again.');",
    "      if (done) ok(); else toast('Couldn’t copy here. Open this page on your phone to share the task.');");
  rep('  <p class="foot" id="foot" hidden>Your tasks save on this phone as you go. Now and then, tap Save everything in Settings to keep a backup.</p>',
    '  <p class="foot" id="foot" hidden>Your tasks save automatically and sync wherever you open this page.</p>');
  rep('in one file. Keep it as a backup, or load it on a new phone to bring everything along.</p>',
    'in one file. Load it in the phone app to move your list there, or keep it as a backup.</p>');

  // The owner's own words, carried over from the live copy.
  const carried = [];
  const SLOTS = [
    { name: 'follow-up signatures', re: /^ {2}const SIGNOFF = \{[^\n]*\};$/m },
    { name: 'work follow-up context', re: /^ {4}if \(\/pearl\/i\.test\(name\)\) return \{ about: [^\n]*\};$/m },
    { name: 'report client example', re: /(<input id="reportClient"[^>\n]*? placeholder=")([^"\n]*)(")/, attr: true },
    { name: 'client name example', re: /(<input id="clientName"[^>\n]*? placeholder=")([^"\n]*)(")/, attr: true },
  ];
  for (const s of SLOTS) {
    const mine = page.match(s.re);
    if (!mine) throw new Error(`slot not found in index.html: ${s.name}`);
    if (!live) continue;
    const theirs = live.match(s.re);
    if (!theirs) { console.warn(`build-artifact: the live copy has no "${s.name}"; the generic line stays`); continue; }
    const text = s.attr ? theirs[2] : theirs[0];
    if (/[<>`]|script/i.test(s.attr ? text : text.replace(/^[^=]*= /, ''))) throw new Error(`refusing odd text in the live copy for ${s.name}`);
    page = page.replace(s.re, s.attr ? (all, a, _, c) => a + text + c : () => text);
    carried.push(s.name);
  }

  for (const bad of ['window.claude.photo', 'serviceWorker', 'Content-Security-Policy', 'archivo.woff2', 'icons/']) {
    if (page.includes(bad)) throw new Error(`the artifact still mentions ${bad}`);
  }
  return { page, carried };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const src = path.resolve(opt('--src') || path.join(__dirname, '..', 'index.html'));
  const out = opt('--out');
  if (!out) fail('usage: node tools/build-artifact.cjs [--live saved.html] --out page.html');
  const livePath = opt('--live');
  try {
    const { page, carried } = build(fs.readFileSync(src, 'utf8'), livePath ? fs.readFileSync(livePath, 'utf8') : null);
    fs.writeFileSync(out, page);
    console.log(`${out}: ${Buffer.byteLength(page)} bytes${carried.length ? `, carried over: ${carried.join(', ')}` : livePath ? '' : ' (no live copy given: generic words)'}`);
  } catch (e) { fail(e.message); }
}

module.exports = { build };
