#!/usr/bin/env node
// Check a built game against itch.io's HTML5 limits and work out where it goes.
//
//   node check.mjs <game-folder>
//
// Reads <game-folder>/GAME.md front matter (itch_slug, optional build_output) and
// <game-folder>/package.json (version). Env: ITCH_USER (required), ITCH_CHANNEL (default html5),
// GITHUB_SHA (adds the short commit to the version). In GitHub Actions it writes dist, target,
// version and url to $GITHUB_OUTPUT; locally it just prints them.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const LIMITS = { files: 500, totalMB: 500, fileMB: 200 }; // itch HTML5 defaults (staff can raise them)

const dir = resolve(process.argv[2] ?? '.');
const user = process.env.ITCH_USER;
const channel = process.env.ITCH_CHANNEL || 'html5';
if (!user) fail('ITCH_USER is not set');

const game = readFrontMatter(join(dir, 'GAME.md'));
if (!game.itch_slug) fail('GAME.md has no itch_slug');
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const dist = join(dir, game.build_output ?? 'dist');
if (!existsSync(join(dist, 'index.html'))) fail(`no index.html at the root of ${relative(dir, dist) || '.'}`);

const files = walk(dist);
const totalMB = files.reduce((s, f) => s + f.size, 0) / 1e6;
const biggest = files.reduce((a, b) => (b.size > a.size ? b : a));
const problems = [];
if (files.length > LIMITS.files) problems.push(`${files.length} files (limit ${LIMITS.files})`);
if (totalMB > LIMITS.totalMB) problems.push(`${totalMB.toFixed(1)} MB total (limit ${LIMITS.totalMB} MB)`);
if (biggest.size / 1e6 > LIMITS.fileMB) problems.push(`${relative(dist, biggest.path)} is ${(biggest.size / 1e6).toFixed(1)} MB (limit ${LIMITS.fileMB} MB)`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) problems.push(`index.html uses absolute paths ("/assets/..."); set base: './' in vite.config`);
if (problems.length) fail(`build breaks itch limits:\n  - ${problems.join('\n  - ')}`);

const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const out = {
  dist,
  target: `${user}/${game.itch_slug}:${channel}`,
  version: sha ? `${pkg.version}+${sha}` : pkg.version,
  url: `https://${user}.itch.io/${game.itch_slug}`,
};
console.log(`✓ ${game.title ?? game.itch_slug}: ${files.length} files, ${totalMB.toFixed(1)} MB, largest ${(biggest.size / 1e6).toFixed(1)} MB`);
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
