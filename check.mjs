#!/usr/bin/env node
// Check that a built game runs from any folder, and work out its version.
//
//   node check.mjs <game-folder>
//
// Reads <game-folder>/GAME.md front matter (title, optional build_output) and <game-folder>/package.json
// (version). Env: GITHUB_SHA (adds the short commit to the version). In GitHub Actions it writes dist,
// version and title to $GITHUB_OUTPUT; locally it just prints them.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const game = readFrontMatter(join(dir, 'GAME.md'));
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const dist = join(dir, game.build_output ?? 'dist');
if (!existsSync(join(dist, 'index.html'))) fail(`no index.html at the root of ${relative(dir, dist) || '.'}`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) fail(`index.html uses absolute paths ("/assets/..."); set base: './' in vite.config`);

const files = walk(dist);
const totalMB = files.reduce((s, f) => s + f.size, 0) / 1e6;
const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const out = {
  dist,
  version: sha ? `${pkg.version}+${sha}` : pkg.version,
  title: game.title ?? basename(dir),
};
console.log(`✓ ${out.title}: ${files.length} files, ${totalMB.toFixed(1)} MB`);
for (const [k, v] of Object.entries(out)) console.log(`  ${k}: ${v}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));

function readFrontMatter(path) {
  if (!existsSync(path)) fail(`missing ${path}`);
  const m = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) fail('GAME.md has no front matter');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*?)\s*(?:\s#.*)?$/);
    if (!kv) continue;
    let v = kv[2];
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (/^(true|false)$/.test(v)) v = v === 'true';
    else v = v.replace(/^["']|["']$/g, '');
    fm[kv[1]] = v;
  }
  return fm;
}

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    const s = statSync(p);
    return s.isDirectory() ? walk(p) : [{ path: p, size: s.size }];
  });
}

function fail(msg) {
  console.error(`::error::${msg.split('\n')[0]}`);
  console.error(msg);
  process.exit(1);
}
