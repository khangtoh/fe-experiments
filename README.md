# fe-experiments

An agent skill for **Claude Code** and **Codex** that turns an `/impeccable` design
pass into deployed, reviewable **full-page experiments**, and later applies the
winner. Extracted from the fdeploy website repo, where it produced and decided
runs D-25 through D-27.

- `/fe-experiments delight the mission` (Claude) or `$fe-experiments delight the
  mission` (Codex): asks whatever the design pass needs up front, builds two to
  four variants of the page as complete copies under `fe-experiments/<slug>/`,
  screenshots each at desktop and phone width, pushes, waits for the deploy and
  reports live URLs. The live page is never edited.
- `/fe-experiments decide <slug> <letter>`: logs the ruling in the project's
  decision ledger, folds the variant into the live page, and stamps the run as
  decided on the experiments index. One commit.

```
skills/fe-experiments/
  SKILL.md                    the instructions (Claude Code and Codex read the same file)
  agents/openai.yaml          Codex display metadata
  scripts/config.mjs          reads fe-experiments.config.json (defaults built in)
  scripts/build-variants.mjs  fragments -> full pages with the Live · A · B switcher
  scripts/check-variants.mjs  headless-Chrome screenshots + width/console checks
  scripts/decide.mjs          stamps a ruling on a run, hands back the clean winner
  scripts/wait-deploy.sh      polls the GitHub commit status until the deploy lands
  server/experiments-routes.js  Express router: /fe-experiments and /fe-experiments/<slug>
templates/
  fe-experiments.config.json  fdeploy's settings, as an example
  fe-experiments.rules.md     fdeploy's design rules, as an example
  serve.js                    a minimal host server mounting the router
```

## Install

Both agents, with the [skills CLI](https://skills.sh), from the repo
(`gh` must be logged in while it is private):

```sh
npx skills add khangtoh/fe-experiments --skill fe-experiments -a claude-code -a codex -y
```

That writes the real files to `.agents/skills/fe-experiments/` (Codex reads
them there), symlinks `.claude/skills/fe-experiments` to it (Claude Code), and
records the source in `skills-lock.json`. A local checkout works in place of
the slug (`npx skills add /path/to/checkout …`). Without the CLI, copy
`skills/fe-experiments/` to `.agents/skills/` and symlink or copy it into
`.claude/skills/`; the scripts resolve their own location, so either works.

## Host setup

The skill expects these in the host repo. The fdeploy values are in `templates/`.

1. **`fe-experiments.config.json`** at the repo root. Every key has a default,
   so a missing file gives the fdeploy layout (`fe-experiments/`, ruling prefix
   `D`, status context `Vercel`). See `scripts/config.mjs` for the keys.
   `node .agents/skills/fe-experiments/scripts/config.mjs` prints the merged result.
2. **A rules file** at the path named by `rules`: the project's own design
   rules, checked against every variant. `templates/fe-experiments.rules.md` is
   fdeploy's.
3. **`playwright-core`** in the host's `node_modules`, so the checker can find
   it from the installed skill (`npm i -D playwright-core`; no browser download),
   and **Google Chrome** installed. `FE_CHROME=<path>` names another Chromium.
4. **`gh`** logged in, for the deploy wait (it reads the commit status on
   GitHub; the live site is often unreachable from a sandbox).
5. The **`impeccable`** skill, which does the design work; fe-experiments only
   reroutes its output.
6. **The listing routes** in the host's server, if the site has one:

   ```js
   const { experimentsRouter } = require('./experiments-routes');
   app.use(express.static(ROOT, { index: false, redirect: false }));
   app.use(experimentsRouter({ root: ROOT, name: 'fdeploy' }));
   ```

   `redirect: false` matters: with Express's default, `/fe-experiments` (a
   directory on disk) 301s to a trailing slash and the router never runs.
   `templates/serve.js` is the whole thing. Copy the router where the server
   can `require` it; on Vercel, keep it inside the function's file or its
   `includeFiles` so it deploys with the function.

   On Vercel, also make sure the experiments directory reaches the function
   (`"includeFiles": "{index.html,fe-experiments/**}"` in `vercel.json`) and
   that the config file is not something you mind being public: a root-level
   `.json` is CDN-served unless `.vercelignore` or the server denies it. It
   holds no secrets, only paths and URLs.

## What was verified

All of this ran on macOS 24.5 with Node 24, Chrome 153, `gh` 2.x and skills CLI 1.7.0,
against a scratch copy of fdeploy's `index.html`:

- `build-variants.mjs` built two mission variants; `check-variants.mjs`
  rendered them at 1440 and 420 (width 420, console clean, 8 screenshots);
  `decide.mjs` stamped B as chosen under D-28 and produced a clean page whose
  diff against the live page was exactly the variant's change; the router
  served `/fe-experiments` (Decided · D-28, Chosen), `/fe-experiments/mission`,
  the page, a 404, and the 301 for an old flat URL.
- `wait-deploy.sh` returned 0 for fdeploy's deployed HEAD in about a second.
- `npx skills add khangtoh/fe-experiments` installed the package for both
  agents (and from a local path before it was pushed), and the scripts ran
  from `.agents/skills/fe-experiments/`.

## Switching fdeploy_www to this package

The original still lives at `fdeploy_www/.claude/skills/fe-experiments/`
(SKILL.md plus four scripts, one of which needs the `gstack browse` binary).
To replace it: run the install command above in `fdeploy_www`, delete the old
directory, copy
`templates/fe-experiments.config.json` to the root and
`templates/fe-experiments.rules.md` to `spec/`, and `bun add -d playwright-core`.
`api/index.js` already serves the listing, so the router is not needed there.

## Hooks

The skill ships no `settings.json` hooks. The PostToolUse/Stop hooks in
fdeploy's `.claude/settings.local.json` belong to impeccable's design detector,
not to this skill. What the skill hooks into instead is documented above: the
host's config file, its server, its deploy status, and its decision ledger.
