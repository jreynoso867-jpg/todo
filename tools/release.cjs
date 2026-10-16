// Run after editing index.html: `node tools/release.cjs`
// 1. The page's Content-Security-Policy only lets in the exact inline scripts it was written with, by their
//    SHA-256 hashes. This puts the current hashes in, so an edited script still runs (and nothing else can).
// 2. The service worker keeps the app on the phone under a version name. A new name, worked out from the files,
//    makes phones fetch the new version and drop the old copy.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
const csp = /(script-src )([^;]+)(;)/;
if (!csp.test(html)) throw new Error('No script-src in the Content-Security-Policy');
html = html.replace(csp, `$1${hashes.join(' ')}$3`);
fs.writeFileSync(htmlPath, html);

const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const shell = JSON.parse(/const SHELL = (\[[^\]]*\]);/.exec(sw)[1]);
const h = crypto.createHash('sha256');
for (const f of shell) {
  const p = path.join(root, f === './' ? 'index.html' : f);
  h.update(fs.readFileSync(p));
}
const version = 'todo-' + h.digest('hex').slice(0, 10);
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
fs.writeFileSync(swPath, sw);
console.log(`${hashes.length} script hashes set; service worker version ${version}`);
