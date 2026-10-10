#!/usr/bin/env node
// Load a built game in headless Chromium the way itch serves it (from a sub-path) and fail on
// uncaught errors, console errors or missing files.
//
//   node smoke.mjs <dist-folder> [screenshot.png]

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const WAIT_MS = 6000;
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
const errors = [];
page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && r.url().startsWith(origin) && errors.push(`missing file: ${r.url().slice(origin.length)}`));

await page.goto(`${origin}/game/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(WAIT_MS);
const canvas = await page.$('canvas');
if (shot) await page.screenshot({ path: shot });
await browser.close();
server.close();

if (!canvas) console.log('::warning::No <canvas> on the page after load. Fine for a DOM game, odd for Phaser/Three.');
if (errors.length) {
  console.error(`::error::Game threw ${errors.length} error(s) on load`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ loads from a sub-path with no errors after ${WAIT_MS / 1000} s${canvas ? ', canvas present' : ''}`);
