#!/usr/bin/env node
// Project settings for fe-experiments, read from fe-experiments.config.json in the
// host repo (found by walking up from the current directory, or named by the
// FE_EXPERIMENTS_CONFIG env var). Every key has a default, so a host with no
// config file still works with the fdeploy-era layout: fe-experiments/<slug>/.
//
//   {
//     "name":    "fdeploy",                       // title prefix: "fdeploy experiment: …"
//     "dir":     "fe-experiments",                // experiments directory, and its URL path
//     "site":    "https://fdeploy.ai",            // live host, for the URLs in reports
//     "pages":   { "index.html": "/", "forge/index.html": "/forge" },  // page -> live URL
//     "rules":   "spec/fe-experiments-rules.md",  // project design rules the fork reads (optional)
//     "product": "PRODUCT.md",                    // the file that holds the figures on record (optional)
//     "ledger":  { "file": "spec/01-launch-decisions.md", "prefix": "D" },  // decisions log; rulings are <prefix>-<n>
//     "deploy":  { "branch": "main", "status": "Vercel" },   // push target; GitHub commit-status context to wait on
//     "check":   { "widths": [1440, 420], "port": 8765 }     // screenshot widths (last = phone); local server port
//   }
//
// CLI:  node config.mjs            -> the merged config as JSON
//       node config.mjs deploy.status  -> one value (strings bare, objects as JSON)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  name: path.basename(process.cwd()),
  dir: 'fe-experiments',
  site: '',
  pages: {},
  rules: null,
  product: null,
  ledger: { file: null, prefix: 'D' },
  deploy: { branch: 'main', status: 'Vercel' },
  check: { widths: [1440, 420], port: 8765 },
};

export function findConfig(from = process.cwd()) {
  if (process.env.FE_EXPERIMENTS_CONFIG) return path.resolve(process.env.FE_EXPERIMENTS_CONFIG);
  let dir = path.resolve(from);
  for (;;) {
    const f = path.join(dir, 'fe-experiments.config.json');
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadConfig() {
  const file = findConfig();
  const user = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = { ...DEFAULTS, ...user, file };
  for (const k of ['ledger', 'deploy', 'check']) cfg[k] = { ...DEFAULTS[k], ...(user[k] || {}) };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(cfg.dir)) throw new Error('config "dir" must be a lowercase kebab-case directory name: ' + cfg.dir);
  return cfg;
}

// The live URL a page is served at: from "pages", else index.html -> "/" and
// <dir>/index.html -> "/<dir>".
export function liveUrl(cfg, page) {
  if (cfg.pages[page]) return cfg.pages[page];
  const norm = page.replace(/\\/g, '/');
  return norm === 'index.html' ? '/' : '/' + path.posix.dirname(norm);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const key = process.argv[2];
  const v = key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), cfg) : cfg;
  if (v === undefined) { console.error('config: no such key: ' + key); process.exit(1); }
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, key ? 0 : 2));
}
