#!/usr/bin/env node
// Assemble full-page variants for <dir>/<slug>/ (dir from fe-experiments.config.json,
// default fe-experiments).
//
// Layout (always): one directory per exploration, one page per variant,
//   fe-experiments/<slug>/<letter>-<name>.html   e.g. fe-experiments/mission/a-gap.html
// served at /fe-experiments/<slug>/<letter>-<name>.html; /fe-experiments lists
// every directory, /fe-experiments/<slug> lists its variants (server/experiments-routes.js).
//
// Section mode (--section <id>): each variant is a fragment file holding, in order:
//   <!-- variant: A | The gap, drawn -->     (letter | name; required)
//   <style>…</style>                          (optional; scope every rule under the variant's class)
//   <section id="<section-id>" …>…</section>  (required; the replacement)
//   <script>…</script>                        (optional; runs at end of body)
//
// Whole-page mode (no --section): each fragment is the header comment followed by
// a complete HTML document, already edited; the script only adds the chrome below.
//
// For every section fragment the script copies the source page verbatim, replaces the
// <section id="…"> (nested sections are matched correctly), appends the variant
// CSS as a second <style> in <head>, adds noindex, an experiment title and
// fe-exp:page / fe-exp:created meta (read by the experiments index), and
// fixes a Live · A · B · C switcher to the bottom-left of the page. Switcher
// links are bare filenames: the variants always sit in one directory together.
//
// Usage (from the host repo root):
//   node build-variants.mjs --page index.html --section mission [--slug mission] \
//        [--live /] frag-a.html frag-b.html frag-c.html
//   node build-variants.mjs --page forge/index.html --slug forge page-a.html page-b.html
//
// One run across two host pages (e.g. a shared component shown on / and /forge):
//   --host <Label>      appended to each variant's name in its title ("Index · Forge"),
//                       so the experiments listing says which page it is
//   --suffix <tag>      files become <letter>-<name>--<tag>.html; the switcher and the
//                       stale-page warning only consider pages with the same suffix
//   --pair <tag|.>      add a link from each page to the same letter on the other host
//                       (its suffix, or "." for the unsuffixed pages); --pair-label names it
//   e.g. home:  --page index.html        --slug nav --host Home  --pair forge --pair-label Forge
//        forge: --page forge/index.html  --slug nav --host Forge --suffix forge --pair . --pair-label Home
//
// --out <dir> writes somewhere else (tests); real runs always land in <dir>/<slug>/.
// Prints the files written and any warnings.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, liveUrl } from './config.mjs';

const cfg = loadConfig();
const args = process.argv.slice(2);
const opt = {};
const frags = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[++i];
  else frags.push(a);
}
const die = (m) => { console.error('build-variants: ' + m); process.exit(1); };
if (!opt.page || !frags.length || (!opt.section && !opt.slug)) {
  die('usage: --page <file> (--section <id> | --slug <s>) [--slug s] [--live url] frag.html…');
}
const page = opt.page;
if (!fs.existsSync(page)) die('no such page: ' + page + ' (run from the host repo root)');
const sectionId = opt.section || null;
const slug = opt.slug || sectionId;
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('slug must be lowercase kebab-case (it becomes a directory name): ' + slug);
const outDir = opt.out || path.join(cfg.dir, slug);
const created = new Date().toISOString().slice(0, 10);
const live = opt.live || liveUrl(cfg, page);
const tagOk = (t) => /^[a-z0-9][a-z0-9-]*$/.test(t);
if (opt.suffix && !tagOk(opt.suffix)) die('suffix must be lowercase kebab-case: ' + opt.suffix);
if (opt.pair && opt.pair !== '.' && !tagOk(opt.pair)) die('pair must be a suffix or ".": ' + opt.pair);
const sfx = opt.suffix ? '--' + opt.suffix : '';
const sameHost = (f) => sfx ? f.endsWith(sfx + '.html') : !f.includes('--');

const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Find the full extent of <section id="…">…</section>, counting nested sections.
function sectionRange(html, id) {
  const open = new RegExp('<section\\b[^>]*\\bid="' + id + '"[^>]*>', 'i');
  const m = open.exec(html);
  if (!m) return null;
  const tag = /<(\/?)section\b[^>]*>/gi;
  tag.lastIndex = m.index + m[0].length;
  let depth = 1, t;
  while ((t = tag.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return [m.index, t.index + t[0].length];
  }
  return null;
}

function parseFragment(file) {
  const src = fs.readFileSync(file, 'utf8');
  const head = /<!--\s*variant:\s*([A-Za-z0-9]+)\s*\|\s*([^>]+?)\s*-->/.exec(src);
  if (!head) die(file + ': missing <!-- variant: X | Name --> header');
  if (!sectionId) {
    return { letter: head[1].toUpperCase(), name: head[2], doc: src.slice(head.index + head[0].length).trim() + '\n' };
  }
  const style = /<style>([\s\S]*?)<\/style>/i.exec(src);
  const range = sectionRange(src, sectionId);
  if (!range) die(file + ': no <section id="' + sectionId + '"> (the replacement must keep the id so nav anchors still land)');
  const script = /<script>([\s\S]*?)<\/script>/i.exec(src.slice(range[1]));
  return {
    letter: head[1].toUpperCase(),
    name: head[2],
    css: style ? style[1].trim() : '',
    section: src.slice(range[0], range[1]),
    js: script ? script[1].trim() : '',
  };
}

const source = fs.readFileSync(page, 'utf8');
const srcRange = sectionId ? sectionRange(source, sectionId) : null;
if (sectionId && !srcRange) die(page + ': no <section id="' + sectionId + '">');

// Relative asset paths break when the copy is served from /<dir>/<slug>/.
const rel = [...source.matchAll(/\b(?:src|href)="(?![a-z]+:|\/|#|mailto:)([^"]+)"/gi)].map((m) => m[1]);
if (rel.length) console.warn('warning: relative paths in ' + page + ' will not resolve from /' + outDir + '/: ' + [...new Set(rel)].join(', '));

const variants = frags.map(parseFragment);
variants.forEach((v) => {
  v.stem = v.letter.toLowerCase() + '-' + kebab(v.name);
  v.file = v.stem + sfx + '.html';
});
const letters = variants.map((v) => v.letter);
if (new Set(letters).size !== letters.length) die('duplicate variant letters: ' + letters.join(', '));

const switcherCss = `
/* Experiment switcher. Not part of the design: an ink pill fixed bottom-left.
   Pages style bare nav elements (one host makes every nav sticky at top:0 with a
   border and blur), so the pill resets what a nav rule could hand it. It sits
   above a fixed bottom bar when the page publishes one as --barh, and drops its
   label on phones so it stays one line. */
.xp{position:fixed;left:16px;bottom:calc(var(--barh, 0px) + 16px);top:auto;right:auto;width:auto;height:auto;margin:0;backdrop-filter:none;box-shadow:none;z-index:9999;display:flex;align-items:center;gap:4px;padding:5px;background:#14202C;border:1px solid #2C3A49;border-radius:100px;font-family:'IBM Plex Mono',monospace;font-size:12px}
.xp span{color:#93A2B2;padding:0 8px 0 10px;letter-spacing:.14em;text-transform:uppercase;font-size:10.5px}
.xp a{color:#F4ECE0;padding:6px 11px;border-radius:100px;text-decoration:none;white-space:nowrap;transition:background .12s ease}
.xp a:hover{background:#1F2733;color:#F4ECE0}
.xp a[aria-current]{background:#7FD0C4;color:#0A0F16}
@media(max-width:480px){.xp span{display:none}}`;

fs.mkdirSync(outDir, { recursive: true });
// A directory is one exploration. Pages this run doesn't rewrite are left alone,
// but say so: a second, unrelated run reusing the slug would mix two explorations.
const stale = fs.readdirSync(outDir).filter((f) => f.endsWith('.html') && sameHost(f) && !variants.some((v) => v.file === f));
if (stale.length) console.warn('warning: ' + outDir + ' also holds ' + stale.join(', ') + ' (not rebuilt; use a new --slug for a new exploration)');

for (const v of variants) {
  let out = v.doc || (source.slice(0, srcRange[0]) + v.section + source.slice(srcRange[1]));

  const title = cfg.name + ' experiment: ' + slug + ' variant ' + v.letter + ', ' + v.name + (opt.host ? ' · ' + opt.host : '');
  out = /<title>[^<]*<\/title>/i.test(out)
    ? out.replace(/<title>[^<]*<\/title>/i, '<title>' + esc(title) + '</title>')
    : out.replace(/<head>/i, '<head>\n<title>' + esc(title) + '</title>');
  if (!/name="robots"/i.test(out)) out = out.replace(/<\/title>/i, '</title>\n<meta name="robots" content="noindex,nofollow">');
  out = out.replace(/<meta name="fe-exp:[^"]*" content="[^"]*">\n?/g, '')
    .replace(/<\/title>/i, '</title>\n<meta name="fe-exp:page" content="' + esc(page) + '">\n<meta name="fe-exp:created" content="' + created + '">');

  const note = sectionId ? 'Everything outside #' + sectionId + ' is ' + page + ', verbatim.' : 'A whole-page variant of ' + page + '.';
  const css = '<style>\n/* ' + slug + ' variant ' + v.letter + ': ' + v.name + '. ' + note + ' */\n' +
    (v.css ? v.css + '\n' : '') + switcherCss + '\n</style>\n';
  out = out.replace(/<\/head>/i, css + '</head>');

  const nav = '<nav class="xp" aria-label="' + esc(slug) + ' variants"><span>' + esc(slug) + '</span>' +
    '<a href="' + live + '">Live</a>' +
    variants.map((w) => '<a href="' + w.file + '"' + (w === v ? ' aria-current="page"' : '') + '>' + w.letter + '</a>').join('') +
    (opt.pair ? '<a href="' + v.stem + (opt.pair === '.' ? '' : '--' + opt.pair) + '.html">' + esc(opt['pair-label'] || 'Other') + ' \u2194</a>' : '') +
    '</nav>\n';
  out = out.replace(/<\/body>/i, nav + (v.js ? '<script>\n' + v.js + '\n</script>\n' : '') + '</body>');

  fs.writeFileSync(path.join(outDir, v.file), out);
  console.log('wrote ' + path.join(outDir, v.file));
}
