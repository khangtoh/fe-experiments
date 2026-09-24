#!/usr/bin/env node
// Record a decision on an experiment directory, and hand back the chosen page
// with the experiment chrome removed so it can be applied to the live page.
//
// Usage (from the host repo root):
//   node decide.mjs --slug forge-hero-cooled --choose B --ruling D-25 \
//        [--date 2026-09-19] [--clean <out.html>]
//
// The ruling is <prefix>-<n>, prefix from fe-experiments.config.json "ledger.prefix" (default D).
//
// 1. Stamps every page in <dir>/<slug>/ with
//      <meta name="fe-exp:decision" content="chosen D-25 2026-09-19">  (the winner)
//      <meta name="fe-exp:decision" content="passed D-25 2026-09-19">  (the rest)
//    which the experiments index reads to mark the run decided and the
//    winner chosen, and ticks the winner's letter in every page's switcher.
// 2. With --clean, writes the winner minus the experiment chrome: the switcher
//    and its CSS, the fe-exp:* meta, and the experiment <title>/noindex, which
//    are restored from the live page named in fe-exp:page. What's left is the
//    live page plus the variant's change, ready to diff against and apply.
// A run built on two host pages (build-variants --suffix) has one winner page
// per host, e.g. c-over-the-hero.html and c-over-the-hero--forge.html: every
// page of the chosen letter is stamped chosen, and --clean also writes
// <out>--<suffix>.html for each suffixed winner.
// Re-running is safe: stamps and ticks are replaced, not duplicated.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
const die = (m) => { console.error('decide: ' + m); process.exit(1); };
if (!opt.slug || !opt.choose || !opt.ruling) die('usage: --slug <dir> --choose <letter> --ruling <' + cfg.ledger.prefix + '-n> [--date YYYY-MM-DD] [--clean out.html]');
const rulingRe = new RegExp('^' + cfg.ledger.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$');
if (!rulingRe.test(opt.ruling)) die('ruling must look like ' + cfg.ledger.prefix + '-25: ' + opt.ruling);
const date = opt.date || new Date().toISOString().slice(0, 10);
const letter = opt.choose.toLowerCase();

const dir = path.join(cfg.dir, opt.slug);
if (!fs.existsSync(dir)) die('no such experiment: ' + dir);
const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
const winners = pages.filter((f) => f.startsWith(letter + '-')).sort((a, b) => a.includes('--') - b.includes('--'));
const chosen = winners[0]; // the unsuffixed host first
if (!chosen) die('no variant ' + letter.toUpperCase() + ' in ' + dir + ' (have: ' + pages.join(', ') + ')');

const TICK_START = '<style data-fe-exp-decision>';
const tickCss = () => TICK_START + winners.map((w) => '.xp a[href="' + w + '"]::after').join(',') + '{content:"\\2713";margin-left:4px}</style>\n';

for (const f of pages) {
  const p = path.join(dir, f);
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace(/<meta name="fe-exp:decision" content="[^"]*">\n?/g, '')
    .replace(/<style data-fe-exp-decision>[^<]*<\/style>\n?/g, '');
  const won = winners.includes(f);
  const stamp = '<meta name="fe-exp:decision" content="' + (won ? 'chosen' : 'passed') + ' ' + opt.ruling + ' ' + date + '">\n';
  html = /<meta name="fe-exp:created"[^>]*>\n?/.test(html)
    ? html.replace(/(<meta name="fe-exp:created"[^>]*>\n?)/, (m) => (m.endsWith('\n') ? m : m + '\n') + stamp)
    : html.replace(/<\/title>\n?/, (m) => (m.endsWith('\n') ? m : m + '\n') + stamp);
  html = html.replace(/<\/head>/i, tickCss() + '</head>');
  fs.writeFileSync(p, html);
  console.log((won ? 'chosen ' : 'passed ') + p);
}

function clean(file, out) {
  let html = fs.readFileSync(path.join(dir, file), 'utf8');
  const livePath = (/<meta name="fe-exp:page" content="([^"]+)"/.exec(html) || [])[1];
  if (!livePath || !fs.existsSync(livePath)) die('chosen page has no readable fe-exp:page; cannot restore the live title');
  const live = fs.readFileSync(livePath, 'utf8');
  const liveTitle = (/<title>[^<]*<\/title>/i.exec(live) || [''])[0];
  html = html
    .replace(/<meta name="fe-exp:[^"]*" content="[^"]*">\n?/g, '')
    .replace(/<style data-fe-exp-decision>[^<]*<\/style>\n?/g, '')
    .replace(/<nav class="xp"[\s\S]*?<\/nav>\n?/, '')
    .replace(/<title>[^<]*<\/title>/i, liveTitle);
  if (!/name="robots"/i.test(live)) html = html.replace(/<meta name="robots" content="noindex,nofollow">\n?/, '');
  // Switcher CSS: its comment, every .xp rule, then any @media or <style> left
  // empty. Only inside <style> blocks: a CSS-shaped regex run over the whole
  // document once ate the tail of a <script> that sat just before the switcher's
  // <style> (the text between a script's last "}" and ".xp" has no braces).
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>\n?/g, (whole, attrs, css) => {
    const kept = css
      .replace(/\/\*[^*]*Experiment switcher[\s\S]*?\*\/\n?/g, '')
      .replace(/(?<=^|[{};])\s*[^{};]*\.xp\b[^{};]*\{[^{}]*\}/g, '')
      .replace(/@media[^{]*\{\s*\}\n?/g, '');
    return /^\s*(\/\*[\s\S]*?\*\/\s*)*$/.test(kept) ? '' : '<style' + attrs + '>' + kept + '</style>\n';
  });
  fs.writeFileSync(out, html);
  const left = html.split('\n').filter((l) => /\bxp\b/.test(l));
  console.log('clean page: ' + out + ' (compare with ' + livePath + ')');
  if (left.length) console.warn('warning: ' + left.length + ' line(s) still mention "xp"; check them by hand:\n  ' + left.map((l) => l.trim().slice(0, 140)).join('\n  '));
}

if (opt.clean) {
  for (const w of winners) {
    const suffix = (/--([a-z0-9-]+)\.html$/.exec(w) || [])[1];
    clean(w, suffix ? opt.clean.replace(/(\.html)?$/, '--' + suffix + '.html') : opt.clean);
  }
}
