#!/usr/bin/env node
// 헤드리스 크로미움으로 기법 하나를 1254×1254 PNG로 찍는다.
//
//   node concert/tools/render.js --method procedural --out out.png
//   node concert/tools/render.js --method procedural --params "layers=face&under=ref" --out face.png
//   node concert/tools/render.js --method procedural --frames 4 --dt 0.75 --out-dir frames/
//
// concert/ 폴더를 임시 로컬 서버로 띄워서 연다 (file://의 캔버스 오염 문제를 피한다).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.webp': 'image/webp',
};

function parseArgs(argv) {
  const out = { method: 'procedural', params: '', time: 0, seed: 7, out: 'render.png', timeout: 180000 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    if (k === 'animate') {
      out.animate = true;
      continue;
    }
    out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    i++;
  }
  out.time = parseFloat(out.time) || 0;
  out.timeout = parseInt(out.timeout, 10) || 180000;
  if (out.frames) out.frames = parseInt(out.frames, 10);
  if (out.dt) out.dt = parseFloat(out.dt);
  return out;
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const { execSync } = require('child_process');
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = loadPlaywright();
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--disable-gpu-sandbox'] });
  const logs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1254, height: 1254 }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const q = new URLSearchParams(args.params);
    q.set('m', args.method);
    q.set('raw', '1');
    if (!args.animate) q.set('static', '1');
    q.set('t', String(args.time));
    q.set('seed', String(args.seed));
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?${q}`);
    await page.waitForFunction(() => window.__concertReady || window.__concertError, null, {
      timeout: args.timeout,
    });
    const err = await page.evaluate(() => window.__concertError);
    if (err) throw new Error(err);
    const ms = Date.now() - started;
    const clip = { x: 0, y: 0, width: 1254, height: 1254 };
    const outputs = [];
    if (args.frames) {
      const dir = args.outDir || '.';
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < args.frames; i++) {
        const t = args.time + i * (args.dt || 0.5);
        await page.evaluate((tt) => window.__concertRenderAt(tt), t);
        const file = path.join(dir, `frame_${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path: file, clip });
        outputs.push(file);
      }
    } else {
      if (args.animate) await page.waitForTimeout(1500);
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      await page.screenshot({ path: args.out, clip });
      outputs.push(args.out);
    }
    console.log(JSON.stringify({ outputs, mountMs: ms, logs }, null, 1));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
