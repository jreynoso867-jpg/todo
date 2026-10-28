// This repository is public: private files can't be committed by accident, and nothing committed holds a secret.
// No browser needed. Usage: node --test tests/repo.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
let inGit = true;
try { git('rev-parse', '--is-inside-work-tree'); } catch { inGit = false; }
const opts = { skip: !inGit && 'not a git checkout (the code zip, for example)' };

// One of each kind of private file, where someone might leave it.
const PRIVATE = [
  'private/notes.md',
  'claude-edition/todo-list.html',
  'jose-todo-transcript.html', 'deliver/jose-todo-transcript.md', 'transcript.txt', 'session.jsonl',
  'To-do everything 2026-10-28.json', 'To-do everything 2026-10-28 (1).json', 'tests/To-do everything 2026-10-28.json',
  'To-do backup 2026-10-28.csv', 'To-do safety copy 2026-10-28.json', 'To-do safety copy 2026-10-28 0915.json',
  'Job report - Someone - 2026-10-28.pdf', 'Call the supplier.ics',
  'todo-all-refs.bundle', 'jose-todo-code.zip', 'backup-2026-10-28/raw/tasks/t1.json', 'backups/list.json', 'backup/list.json',
  'AuthKey_ABCDE12345.p8', 'ios/App/AuthKey_ABCDE12345.p8', 'distribution.p12', 'distribution.cer', 'key.pem', 'signing.key',
  'App_Store.mobileprovision', '.env', '.env.local',
  'App.ipa', 'ios/App/App.xcarchive/Info.plist', 'ios/App/DerivedData/log.txt', 'ios/App/App.xcodeproj/xcuserdata/me.xcuserdatad/x.plist',
];

test('every kind of private file is kept out of commits', opts, () => {
  const r = spawnSync('git', ['-C', ROOT, 'check-ignore', '--no-index', '--stdin', '-z'], { input: PRIVATE.join('\0') + '\0', encoding: 'utf8' });
  const ignored = new Set(r.stdout.split('\0').filter(Boolean));
  assert.deepEqual(PRIVATE.filter(p => !ignored.has(p)), [], 'these would be committed');
});

test('nothing the app needs is kept out by those rules', opts, () => {
  assert.equal(git('ls-files', '-ci', '--exclude-standard').trim(), '', 'committed files that the rules now leave out');
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'package.json', 'capacitor.config.json', 'tests/lib.cjs',
    'ios/App/App/Info.plist', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json', 'tools/build-artifact.cjs']) {
    assert.equal(spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', f]).status, 1, `${f} must stay in`);
  }
});

const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/, 'a private key'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{24,}/, 'an API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];

test('no committed file holds a key, token or signing file', opts, () => {
  const found = [];
  for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (/\.(p8|p12|pfx|cer|pem|key|keystore|mobileprovision|provisionprofile|ipa)$|(^|\/)\.env(\.|$)/i.test(f)) found.push(`${f}: a signing or secrets file`);
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'latin1'); } catch { continue; } // a file deleted but not yet committed
    for (const [rx, what] of SECRETS) if (rx.test(text)) found.push(`${f}: ${what}`);
  }
  assert.deepEqual(found, []);
});
