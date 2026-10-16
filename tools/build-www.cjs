#!/usr/bin/env node
// The iPhone app's web files: the same files the website serves, copied into www/ for Capacitor
// (`npx cap sync ios` then copies www/ into the Xcode project). Nothing is changed on the way.
// Usage: node tools/build-www.cjs   (or: npm run build)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'archivo.woff2', 'icons', 'reminder.wav']; // reminder.wav: the notifications' sound

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of FILES) {
  const from = path.join(root, f);
  if (!fs.existsSync(from)) throw new Error(`missing ${f}`);
  fs.cpSync(from, path.join(out, f), { recursive: true });
}
// The page only runs scripts whose fingerprints are in its security policy; a stale policy would leave the app blank.
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const csp = /script-src ([^;]+);/.exec(html);
const crypto = require('crypto');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const missing = scripts.filter(h => !csp || !csp[1].includes(h));
if (missing.length) {
  console.error(`index.html has ${missing.length} script(s) not in its security policy. Run: node tools/release.cjs`);
  process.exit(1);
}
console.log(`www/ ready: ${FILES.join(', ')} (${scripts.length} scripts, all in the policy)`);
