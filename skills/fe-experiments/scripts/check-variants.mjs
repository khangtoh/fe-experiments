#!/usr/bin/env node
// Render every variant at desktop and phone width (config "check.widths", default
// 1440 and 420) in headless Chrome, driven by playwright-core. For each page it
// prints the document width at the phone width (anything above it means a
// sideways scroll) and any console errors, and saves two screenshots per width:
//   <shots>/<page>-<w>.png          the whole page
//   <shots>/<page>-<w>-section.png  the section alone, siblings hidden, so a tall
//                                    phone page is not scaled down to illegibility
//
// Usage (from the host repo root):
//   node check-variants.mjs <section-id> <shots-dir> fe-experiments/x/a.html fe-experiments/x/b.html …
// Pass "main" (or any id on the page) as the section id for a whole-page check.
//
// Serves the host repo root on config "check.port" (default 8765) for the
// duration, with its own static server: root-relative asset paths (/site-nav.js)
// resolve exactly as they do in production. Needs playwright-core resolvable from
// this file (npm i -D playwright-core in the host, or the package's own
// node_modules) and Google Chrome installed; FE_CHROME=<path> names another
// Chromium build.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadConfig } from './config.mjs';

const [section, shots, ...pages] = process.argv.slice(2);
if (!section || !shots || !pages.length) {
  console.error('usage: check-variants.mjs <section-id> <shots-dir> page.html…');
  process.exit(1);
}
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (e) {
  console.error('check-variants: playwright-core is not installed where this script can see it.\n  npm i -D playwright-core   (in the host repo; it ships no browser and uses the installed Chrome)');
  process.exit(1);
}
const cfg = loadConfig();
const widths = cfg.check.widths;
const phone = widths[widths.length - 1];
const port = cfg.check.port;
const root = process.cwd();
fs.mkdirSync(shots, { recursive: true });
for (const p of pages) if (!fs.existsSync(p)) { console.error('no such page: ' + p); process.exit(1); }

const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain', xml: 'application/xml', map: 'application/json' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const abs = path.resolve(root, '.' + p);
  if (abs !== root && !abs.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  let file = abs;
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* fall through */ }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + p); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((ok, no) => server.listen(port, '127.0.0.1', ok).on('error', no)).catch((e) => {
  console.error('check-variants: cannot listen on :' + port + ' (' + e.code + '); set "check.port" in fe-experiments.config.json');
  process.exit(1);
});

const launch = process.env.FE_CHROME ? { executablePath: process.env.FE_CHROME } : { channel: 'chrome' };
let browser;
try { browser = await chromium.launch({ headless: true, ...launch }); } catch (e) {
  console.error('check-variants: could not launch Chrome (' + e.message.split('\n')[0] + ').\n  Install Google Chrome, or point FE_CHROME at a Chromium executable.');
  server.close(); process.exit(1);
}

// Hide everything that is not the section or one of its ancestors, then scroll to the top.
const isolate = (id) => `(()=>{let n=document.getElementById(${JSON.stringify(id)});if(!n)return 'no #${id}';
  while(n&&n!==document.body){for(const s of n.parentElement.children){if(s!==n&&s.tagName!=='SCRIPT'&&s.tagName!=='STYLE')s.style.display='none'}n=n.parentElement}
  scrollTo(0,0);return 'ok'})()`;

let failures = 0;
for (const f of pages) {
  const name = path.basename(f, '.html');
  const errors = [];
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('http://127.0.0.1:' + port + '/' + f.split(path.sep).join('/'), { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    if (w === phone) {
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(name + '  width@' + phone + ': ' + sw + (sw > phone ? '  <-- sideways scroll' : ''));
      if (sw > phone) failures++;
    }
    await page.screenshot({ path: path.join(shots, name + '-' + w + '.png'), fullPage: true });
    const iso = await page.evaluate(isolate(section));
    if (iso !== 'ok') console.log(name + '  ' + iso);
    await page.screenshot({ path: path.join(shots, name + '-' + w + '-section.png'), fullPage: true });
  }
  console.log(name + '  console: ' + (errors.length ? errors.join(' | ') : 'clean'));
  if (errors.length) failures++;
  await context.close();
}
await browser.close();
server.close();
console.log('screenshots in ' + shots);
process.exit(failures ? 2 : 0);
