#!/usr/bin/env node
// Load a built game in headless Chromium from a sub-path (so absolute asset paths break) and fail on
// uncaught errors, console errors or missing files.
//
//   node smoke.mjs <dist-folder> [screenshot.png]

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const WAIT_MS = 6000;
// Big 3D games build their world at boot; on a CPU renderer (SwiftShader) that can take a minute or two.
const LOAD_MS = 180000;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

const dist = resolve(process.argv[2] ?? 'dist');
const shot = process.argv[3];

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/game/')) return void res.writeHead(404).end();
  const file = join(dist, normalize(path.slice('/game/'.length) || 'index.html'));
  if (!file.startsWith(dist)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// SwiftShader gives headless Chromium WebGL on CI machines with no GPU.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(LOAD_MS);
const errors = [];
page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && r.url().startsWith(origin) && errors.push(`missing file: ${r.url().slice(origin.length)}`));

const t0 = Date.now();
await page.goto(`${origin}/game/index.html`, { waitUntil: 'load', timeout: LOAD_MS });
const loadS = ((Date.now() - t0) / 1000).toFixed(1);
await page.waitForTimeout(WAIT_MS);
const canvas = await page.$('canvas');
// A heavy 3D frame on a CPU renderer can be slow to capture; a missing screenshot isn't a broken game.
if (shot) await page.screenshot({ path: shot, timeout: 90000 }).catch(() => console.log('::warning::Screenshot timed out (heavy 3D frame on a CPU renderer). The load check still ran.'));
await browser.close();
server.close();

if (!canvas) console.log('::warning::No <canvas> on the page after load. Fine for a DOM game, odd for Phaser/Three.');
if (errors.length) {
  console.error(`::error::Game threw ${errors.length} error(s) on load`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ loads from a sub-path in ${loadS} s with no errors after ${WAIT_MS / 1000} s more${canvas ? ', canvas present' : ''}`);
