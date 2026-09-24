'use strict';
// The experiments listing, as an Express router the host server mounts.
// Extracted from fdeploy's api/index.js (the original still lives there).
//
//   const { experimentsRouter } = require('./experiments-routes');
//   app.use(experimentsRouter({ root: path.join(__dirname, '..'), name: 'fdeploy' }));
//
// Options: root (host repo root; required), dir (experiments directory and URL
// path, default 'fe-experiments'), name (the eyebrow label, default 'experiments'),
// home (where "Live" points when nothing else says, default '/').
//
// Serves:
//   GET /<dir>                 every run, newest first, from the pages' fe-exp:* meta
//   GET /<dir>/<slug>          one run: its index.html if it has one, else a listing
//   GET /<dir>/<old-flat>.html 301 to the directory layout (runs used to be flat files)
// Pages themselves (/<dir>/<slug>/<file>.html) and any assets beside them are
// static files: serve them with express.static (or the CDN) before this router,
// or after it, either way; the router answers only the three shapes above.
//
// Directory listing is generated from the directory at request time rather than
// hand-maintained: several agents drop files in here, and a static index would be
// wrong the first time one did.

const express = require('express');
const fs = require('fs');
const path = require('path');

const SEGMENT = /^[a-zA-Z0-9._-]+$/;
const PAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/;

function esc(v) {
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function experimentsRouter(opts) {
  if (!opts || !opts.root) throw new Error('experimentsRouter: "root" (the host repo root) is required');
  const ROOT = path.resolve(opts.root);
  const DIR = opts.dir || 'fe-experiments';
  const NAME = opts.name || 'experiments';
  if (!SEGMENT.test(DIR)) throw new Error('experimentsRouter: bad dir ' + DIR);
  const router = express.Router();

  const notFound = (res) => res.status(404).type('text/plain').send('404 Not Found');

  function isDir(rel) {
    try { return fs.statSync(path.join(ROOT, rel)).isDirectory(); } catch (e) { return false; }
  }

  function sendFile(res, relPath, next) {
    const resolved = path.resolve(ROOT, relPath);
    if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return notFound(res);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return notFound(res);
    return res.sendFile(resolved, (err) => { if (err) next(err); });
  }

  // Reads only the head of a page: its <title> and the fe-exp:* meta tags the
  // build script stamps (the page it varies, when it was made, and any ruling).
  function readHead(abs) {
    let head = '';
    try {
      const fd = fs.openSync(abs, 'r');
      const buf = Buffer.alloc(8192);
      head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
      fs.closeSync(fd);
    } catch (e) { /* unreadable: fall back to the filename */ }
    const meta = (k) => { const m = new RegExp('<meta name="fe-exp:' + k + '" content="([^"]*)"', 'i').exec(head); return m ? m[1] : ''; };
    const t = /<title>([^<]*)<\/title>/i.exec(head);
    // "chosen D-25 2026-09-19" or "passed D-25 2026-09-19", stamped by decide.mjs.
    const d = /^(chosen|passed) (\S+) (\S+)$/.exec(meta('decision'));
    return { title: t ? t[1].trim() : '', page: meta('page'), created: meta('created'),
      decision: d ? { state: d[1], ruling: d[2], date: d[3] } : null };
  }

  function readExperiment(slug) {
    const rel = path.join(DIR, slug);
    const pages = fs.readdirSync(path.join(ROOT, rel)).filter((f) => PAGE_FILE.test(f)).sort().map((f) => {
      const h = readHead(path.join(ROOT, rel, f));
      const letter = (/^([a-z0-9])-/i.exec(f) || [])[1] || '';
      // "<name> experiment: mission variant A, The gap, drawn" -> "The gap, drawn"
      const named = /variant [A-Za-z0-9]+, (.+)$/.exec(h.title);
      return {
        file: f,
        href: '/' + DIR + '/' + slug + (f === 'index.html' ? '' : '/' + f),
        letter: letter.toUpperCase(),
        name: named ? named[1] : (h.title || f.replace(/\.html$/, '').replace(/[-_]/g, ' ')),
        page: h.page,
        created: h.created,
        decision: h.decision,
      };
    });
    // A two-host run has a winner page per host; name the decision by the
    // unsuffixed one (c-x.html, not c-x--forge.html).
    const winner = pages.filter((p) => p.decision && p.decision.state === 'chosen')
      .sort((a, b) => a.file.includes('--') - b.file.includes('--'))[0];
    return {
      slug,
      pages,
      page: (pages.find((p) => p.page) || {}).page || '',
      created: pages.map((p) => p.created).filter(Boolean).sort().pop() || '',
      decision: winner ? { ruling: winner.decision.ruling, date: winner.decision.date, letter: winner.letter, name: winner.name } : null,
    };
  }

  function listExperiments() {
    const root = path.join(ROOT, DIR);
    const dirs = fs.readdirSync(root).filter((d) => SEGMENT.test(d) && !d.startsWith('.') && isDir(path.join(DIR, d)));
    const exps = dirs.map(readExperiment).filter((e) => e.pages.length);
    // Newest first; undated ones after, by name.
    exps.sort((a, b) => (b.created || '').localeCompare(a.created || '') || a.slug.localeCompare(b.slug));
    // Anything still dropped at the top level is listed rather than hidden.
    const loose = fs.readdirSync(root).filter((f) => PAGE_FILE.test(f) && f !== 'index.html');
    if (loose.length) {
      exps.push({ slug: '', loose: true, page: '', created: '', pages: loose.sort().map((f) => ({
        file: f, href: '/' + DIR + '/' + f, letter: '', name: f.replace(/\.html$/, '').replace(/[-_]/g, ' '),
      })) });
    }
    return exps;
  }

  // Old flat URLs were <experiment>-<page>.html. The longest experiment name that
  // prefixes the file wins, so forge-hero-b-polish-a-diptych.html resolves to
  // forge-hero-b-polish/a-diptych.html and not to forge-hero/.
  function legacyExperimentUrl(file) {
    const base = file.slice(0, -'.html'.length);
    let dirs;
    try { dirs = fs.readdirSync(path.join(ROOT, DIR)).filter((d) => SEGMENT.test(d) && isDir(path.join(DIR, d))); } catch (e) { return null; }
    dirs.sort((a, b) => b.length - a.length);
    for (const d of dirs) {
      if (base === d) return '/' + DIR + '/' + d;
      if (base.startsWith(d + '-')) {
        const rest = base.slice(d.length + 1) + '.html';
        if (fs.existsSync(path.join(ROOT, DIR, d, rest))) return '/' + DIR + '/' + d + '/' + rest;
      }
    }
    return null;
  }

  function renderIndex(experiments, only) {
    const title = (e) => e.loose ? 'Loose pages' : e.slug.replace(/[-_]/g, ' ');
    const groups = experiments.length
      ? experiments.map((e) => {
          const facts = [e.page, e.pages.length + (e.pages.length === 1 ? ' page' : ' variants'), e.created].filter(Boolean);
          const ruled = e.decision
            ? '<p class="ruled"><span class="badge">Decided &middot; ' + esc(e.decision.ruling) + '</span>' +
              (e.decision.letter ? esc(e.decision.letter) + ' &middot; ' : '') + esc(e.decision.name) +
              ' went live on ' + esc(e.decision.date) + '</p>'
            : '';
          const head = only || e.loose
            ? '<h2>' + esc(title(e)) + '</h2>'
            : '<h2><a href="/' + DIR + '/' + esc(e.slug) + '">' + esc(title(e)) + '</a></h2>';
          const rows = e.pages.map((p) =>
            '<li><a href="' + esc(p.href) + '">' +
            (p.letter ? '<span class="l">' + esc(p.letter) + '</span>' : '<span class="l">&middot;</span>') +
            '<span class="n">' + esc(p.name) +
            (p.decision && p.decision.state === 'chosen' ? ' <span class="chosen">Chosen</span>' : '') + '</span>' +
            '<span class="f">' + esc(p.file) + '</span></a></li>').join('');
          return '<section class="exp">' + head + '<p class="meta">' + esc(facts.join(' · ')) + '</p>' + ruled + '<ul>' + rows + '</ul></section>';
        }).join('')
      : '<p class="empty">No experiments yet.</p>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>' + (only ? esc(title(only)) + ' — ' : '') + 'Experiments — ' + esc(NAME) + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
      '<style>' +
      ':root{--bg:#0A0F16;--panel:#14202C;--line:#1F2733;--card-line:#2C3A49;--text:#F4ECE0;--muted:#93A2B2;--accent:#7FD0C4;--mono:\'IBM Plex Mono\',monospace}' +
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:\'Archivo\',sans-serif}' +
      '.wrap{max-width:1240px;margin:0 auto;padding:64px 32px 96px}' +
      '.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}' +
      'h1{font-size:clamp(28px,3.2vw,40px);line-height:1.1;letter-spacing:-.03em;margin:0 0 14px}' +
      'p.lede{color:var(--muted);font-size:16.5px;line-height:1.65;max-width:68ch;margin:0 0 8px}' +
      'p.warn{color:var(--muted);font-size:13px;line-height:1.6;max-width:68ch;margin:18px 0 0}' +
      '.back{font-family:var(--mono);font-size:12px;color:var(--muted);text-decoration:none}.back:hover{color:var(--text)}' +
      '.exp{margin-top:48px;padding-top:28px;border-top:1px solid var(--line)}' +
      '.exp h2{margin:0;font-size:22px;font-weight:500;letter-spacing:-.02em;text-transform:capitalize}' +
      '.exp h2 a{color:inherit;text-decoration:none}.exp h2 a:hover{color:var(--accent)}' +
      'p.meta{margin:6px 0 0;font-family:var(--mono);font-size:12px;color:var(--muted)}' +
      'ul{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px}' +
      'li a{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:16px;align-items:baseline;' +
      'text-decoration:none;color:inherit;background:var(--panel);border:1px solid var(--card-line);' +
      'border-radius:12px;padding:16px 18px;transition:border-color .12s ease}' +
      'li a:hover{border-color:var(--muted)}' +
      '.l{font-family:var(--mono);font-size:13px;font-weight:500;color:var(--accent)}' +
      '.n{font-size:16.5px;font-weight:500;letter-spacing:-.01em;min-width:0}' +
      '.f{font-family:var(--mono);font-size:12px;color:var(--muted);white-space:nowrap}' +
      '.empty{color:var(--muted);font-size:15px;margin-top:36px}' +
      'p.ruled{margin:12px 0 0;font-size:14px;color:var(--text);display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}' +
      '.badge,.chosen{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;border-radius:6px;padding:4px 8px;white-space:nowrap}' +
      '.badge{color:var(--accent);border:1px solid var(--accent)}' +
      '.chosen{color:var(--bg);background:var(--accent);margin-left:8px;vertical-align:2px}' +
      '@media(max-width:640px){li a{grid-template-columns:24px minmax(0,1fr)}.f{display:none}.wrap{padding:48px 20px 72px}}' +
      '</style></head><body><div class="wrap">' +
      (only
        ? '<a class="back" href="/' + DIR + '">&larr; All experiments</a>' + groups
        : '<div class="eyebrow">' + esc(NAME) + ' &middot; experiments</div>' +
          '<h1>Design experiments</h1>' +
          '<p class="lede">One directory per exploration, one page per variant: full copies of the live page ' +
          'with only the explored part changed. They are not routes of the site and are excluded from search.</p>' +
          '<p class="warn">This directory is public. Anything dropped into <code>' + esc(DIR) + '/</code> is ' +
          'world-readable at this URL, so keep client work, credentials and unreleased copy out of it. ' +
          'The list is generated from the directory on each request, so it is never stale.</p>' + groups) +
      '</div></body></html>';
  }

  router.get('/' + DIR, (req, res) => {
    let experiments;
    try { experiments = listExperiments(); } catch (e) { return notFound(res); }
    return res.type('html').send(renderIndex(experiments));
  });

  router.get('/' + DIR + '/:name', (req, res, next) => {
    const name = req.params.name;
    if (!SEGMENT.test(name)) return notFound(res);
    if (/\.html$/.test(name)) {
      const target = legacyExperimentUrl(name);
      return target ? res.redirect(301, target) : notFound(res);
    }
    const dir = path.join(DIR, name);
    if (!isDir(dir)) return notFound(res);
    if (fs.existsSync(path.join(ROOT, dir, 'index.html'))) return sendFile(res, path.join(dir, 'index.html'), next);
    const exp = readExperiment(name);
    return exp.pages.length ? res.type('html').send(renderIndex([exp], exp)) : notFound(res);
  });

  router.readExperiment = readExperiment;
  router.listExperiments = listExperiments;
  return router;
}

module.exports = { experimentsRouter };
