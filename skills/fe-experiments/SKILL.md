---
name: fe-experiments
description: >-
  Run /impeccable on a page of a static site with the user's arguments passed
  straight through, ask any questions up front, then land the result as
  full-page experiments in <dir>/<slug>/ (one directory per run, never on the
  live page), screenshot them at desktop and phone width, push, wait for the
  deploy and hand back live URLs for review. Use whenever the user invokes
  /fe-experiments or $fe-experiments, or wants to see design options, variants,
  alternatives, "what would X look like", a nicer/bolder/quieter/redesigned
  version of a section or page, or any /impeccable design pass they want to
  review on the real site before it replaces the live page. Also use it when the
  user picks a winner ("we'll go with cooled B", "/fe-experiments decide <run>
  <letter>"): it logs the ruling in the project's decision ledger, implements it
  on the live page and marks the run decided on the experiments index.
---

# fe-experiments

`/fe-experiments <impeccable arguments>` is `/impeccable <the same arguments>`, with the output rerouted: the design work lands as **full pages in its own directory, `<dir>/<slug>/`** (`dir` is `fe-experiments` unless the config says otherwise), each a copy of the live page, and is deployed so the user can review it on the real site straight away, usually from a phone. Exploring never edits the live page. When the user picks a winner, the **decide** mode logs it in the decision ledger, applies it to the live page and marks it on the experiments index.

Arguments for this run: `$ARGUMENTS` (Claude Code fills this in; in Codex, the arguments are whatever followed `$fe-experiments` in the user's message).

Paths below are relative to the host repo root. `$SKILL` is this skill's directory:

```sh
SKILL=.agents/skills/fe-experiments   # what `npx skills add` installs; .claude/skills/fe-experiments is a symlink to it
```

## Project settings

`fe-experiments.config.json` at the host root names the pages, the live host, the decision ledger and the rules file. Read it first (`node $SKILL/scripts/config.mjs` prints the merged config with defaults):

- `pages`: page file → live URL. The target of a run is one of these.
- `site`: the live host, for the URLs in the report.
- `rules`: a markdown file of the project's own design rules, checked in step 4.
- `product`: the file that holds the figures on record (step 4, "numbers or nothing").
- `ledger.file` / `ledger.prefix`: the decisions log and the ruling format (`D-27`).
- `deploy.branch` / `deploy.status`: where to push, and the GitHub commit-status context to wait on.

## Two modes

- **Explore** (the default): anything that isn't `decide …` goes to /impeccable and becomes a new run, steps 1–7 below.
- **Decide**: `/fe-experiments decide <slug> <letter> [notes]`, or the user saying they've picked a variant ("we'll go with cooled B"). Don't invoke impeccable. The winner is recorded in the ledger, applied to the live page, and marked on the experiments index. See **Deciding** at the end.

## How the run is split

In Claude Code the exploration itself (steps 2–7) runs in a **forked subagent** (Agent tool, `subagent_type: "fork"`), so the long design, build, check and deploy cycle stays out of the main conversation and the user can keep talking while it runs. A fork runs in the background and can't stop to ask the user anything, so every question is asked **before** forking. The main conversation does step 1, forks, and relays the result.

In Codex there is no fork: do step 1, wait for the answers, then run steps 2–7 yourself in the same session, and give the step 7 report at the end.

## 1. In the main conversation: settle everything that needs the user

Invoke the `impeccable` skill, passing the arguments above **verbatim**. Don't paraphrase, reorder or drop words; the first word routes to an impeccable command (`delight`, `bolder`, `layout`, `critique`…) and the rest is its target. Run its setup here: the context loader, the register, and the command reference it points to. Then collect every decision the user must make before any design work starts:

- impeccable's blocking gates: `teach` when the product file is missing, the confirmed shape brief for `craft`, the image-generation gate;
- anything the command reference says to ask when unclear (e.g. `delight` asks about tone when the brand personality isn't evident);
- anything this skill can't default: which page, when the target could be more than one of `pages`; which section, when the words don't match a section `id`; how many variants, if the user named a number.

Ask them together in one question (AskUserQuestion in Claude Code; a plain question in Codex) and wait. Don't invent questions to seem thorough: if the code, the product file or a sensible default answers something, decide it and list it as an assumption. When there's nothing to ask, start straight away.

Then fork (Claude Code) with a short description like "fe-experiments: mission delight". The fork inherits the conversation, including the loaded impeccable instructions, so the prompt only needs:

- the arguments, verbatim, and the impeccable command they route to;
- the page, section `id` (or whole page) and slug. The slug names this exploration's directory, so pick a new one per run (lowercase kebab-case, e.g. `forge-hero-cooled`), never an existing directory's;
- every answer the user gave, and every assumption you made;
- the instruction: "You are the fork: do steps 2–7 of fe-experiments yourself, and don't spawn further agents. Don't ask the user anything. If a new question comes up, take the conservative option that matches the product file and list it under assumptions in your report. End with the step 7 report."

After forking, tell the user in one line that the exploration is running and what it covers. Don't touch `<dir>/` or push while the fork is running, because it's committing to the same branch. When the fork's report arrives, relay it: the user can't see it otherwise. Lead with the live URLs, or the deploy failure.

## 2. (fork) Do the design work

Follow impeccable's command reference and design laws for the command. One override applies throughout: wherever impeccable would edit a page, make the change in a copy under `<dir>/` instead, as described next.

## 3. (fork) Where the work lands

**Layout, always:** one directory per exploration, one page per variant.

```
fe-experiments/
  mission/                 <- one /fe-experiments run (the slug)
    a-gap.html             <- variant A: <letter>-<name>.html
    b-to-scale.html
  forge-forest/
    index.html             <- a single-page experiment may be the directory's index
```

Pages are served at `/<dir>/<slug>/<letter>-<name>.html`. `/<dir>` lists every directory, newest first; `/<dir>/<slug>` lists that run's variants (both generated by the host's server from the pages' `fe-exp:*` meta, which the build script stamps; `$SKILL/server/experiments-routes.js` is that server code). Never write pages at the top level of `<dir>/`: the index shows them as "Loose pages", and the old flat URLs are reserved for redirects to the directories.

Every result is a full page, so it's judged between the real hero and footer, not as an isolated snippet. Don't build a side-by-side comparison strip.

- **One section** (the usual case, e.g. "the mission"): produce two to four variants that differ in *structure*, not just colour or spacing. A reliable spread is: draw the claim (a diagram of what the heading asserts), put it to scale (a real axis such as weeks, built only from figures on record), and evolve the current structure (replace its weakest element). Before designing, write one sentence on what is actually weak about the current section; the variants answer it. Write each variant as a fragment in the scratchpad:

  ```html
  <!-- variant: A | The gap, drawn -->
  <style>/* scope every rule under a fresh class such as .mv-a; the page's
            original section CSS is still present, so never reuse its classes */</style>
  <section id="mission" class="mv-a">…</section>
  <script>/* optional, plain JS */</script>
  ```

  ```sh
  node $SKILL/scripts/build-variants.mjs \
    --page index.html --section mission <scratch>/a.html <scratch>/b.html
  ```

- **A whole page** (e.g. `bolder forge`): copy the page into the scratchpad, edit the copy, put `<!-- variant: A | Name -->` on the first line, then run the same script with `--slug <name>` and no `--section`.

- **A single result** (impeccable's command naturally yields one version, e.g. `polish`): still one full page, letter A.

- **One run on two host pages** (a shared component such as `<site-nav>`, shown on two of `pages`): build each host into the same directory, the second with `--suffix <tag>`, both with `--host <Label>` and `--pair` (see the script header), and put the variant's component copy beside the pages (`site-nav-a.js`), loaded by a relative `<script src>`.

The script writes `<dir>/<slug>/<letter>-<name>.html`, keeps the section `id` so nav anchors still land, adds `noindex`, an experiment title and the `fe-exp:page` / `fe-exp:created` meta, and fixes a Live · A · B · C switcher to the bottom-left. It warns if the directory already holds pages this run didn't write, which means the slug is being reused by a different exploration: choose a new slug instead. Re-run it after every fragment edit rather than hand-editing its output, so the pages never drift apart. Root-relative asset paths (`/flow-hero.js`) work from `/<dir>/<slug>/`; the script warns about any relative ones.

**Evaluate-only commands** (`critique`, `audit`) produce findings, not pages: report them, and only build pages if the user then asks for changes.

## 4. (fork) Project rules every experiment keeps

impeccable brings general design laws; the project's own live in the file named by `rules` in the config. Read that file and check each rule against every variant rather than trusting memory: each one is there because a draft broke it. Two hold for every project:

- **Numbers or nothing.** Only figures in the file named by `product`. Draw ranges rather than invent a precise point. If live copy carries a figure that isn't on record, leave it out and flag it.
- **No invented proof.** No fake names, photos, testimonials, logos, or made-up metrics inside UI depictions.

Keep a list of every sentence you wrote that isn't on the live page; it goes in the report.

## 5. (fork) Look at every page before shipping

```sh
node $SKILL/scripts/check-variants.mjs <section-id> <scratch>/shots fe-experiments/<slug>/*.html
```

For a whole page, pass `main` as the section id. The script serves the repo root itself, renders each page in headless Chrome (playwright-core + the installed Google Chrome), prints the document width at the phone width (anything over it means sideways scroll) and any console errors, and saves full-page and section-only screenshots at each width in `check.widths` (default 1440 and 420). It exits 2 when any page is too wide or logs an error. Read the section-only shots at both widths, then the full pages. Fix and rebuild until:

- the width at 420 is 420 and the console is clean;
- no text is struck through by gridlines or rules (give it the row's own background);
- columns with unequal top blocks still line up (`grid-template-rows: subgrid`);
- footer rows don't wrap awkwardly (shorten the text rather than shrink the type).

## 6. (fork) Push and deploy

`deploy.branch` is the deploy branch; if the project owner has given standing approval for pushing to it (fdeploy has), push without asking. Commit only the new `<dir>/<slug>/` directory, with git's configured identity and the usual Co-Authored-By trailer, then push.

Then wait for the deploy, running it in the foreground (the fork has nothing else to do meanwhile; it polls for up to six minutes, so give the shell call a 420000 ms timeout):

```sh
bash $SKILL/scripts/wait-deploy.sh
```

It reads the `deploy.status` commit status on GitHub through `gh`. Exit 0 means deployed; 2 means still pending after six minutes (say so). Exit 1 means failed or blocked: report the provider's description and the log URL it prints, don't call the pages live, and stop. On Vercel, "Deployment was blocked" has meant the commit author was rejected (a commit authored with a git identity that isn't a member of the Vercel team); check `git config user.email`, tell the user, and leave the fix to them. Don't re-author commits under someone else's identity to get past the check.

The live site is often unreachable from a sandbox, so the commit status is the evidence. Only report the pages as live on exit 0.

## 7. (fork) Report back

Keep it short:

- the live URLs (`<site>/<dir>/<slug>/<file>`), the run's listing (`<site>/<dir>/<slug>`) and the switcher, or the deploy failure;
- the one-sentence diagnosis;
- one short paragraph per variant: the idea, and the single detail or interaction that makes it;
- your recommendation and why;
- every copy change and new sentence, any live figure left out as unverified, and any source file (a design artboard, a style guide) that would also need the change if a variant is applied.

Add an **Assumptions** line listing anything you decided without the user. This report goes back to the main conversation, which relays it; then the user chooses.

## Deciding

A decision does three things, always together and in one commit: **log** it in the decision ledger, **implement** it on the live page, and **mark** it on the experiments index. A ruling that's logged but not live, or live but not logged, is the drift this mode exists to prevent.

### In the main conversation

1. Resolve the run and the variant. If the user named neither or it's ambiguous, ask, offering the variants of the most recent runs (`ls -t <dir>/`, titles from each page's `<title>`), the last run's recommendation first.
2. Ask only what the ruling needs and only the user can say: a partial adoption ("B, but with D's teal") or a stated reason. Record the user's own words; never supply a reason on their behalf.
3. Fork (Claude Code; inline in Codex) with the run, the letter, any modifications, the user's words, and: "You are the fork: do the Deciding steps of fe-experiments yourself, don't spawn further agents, don't ask the user anything. End with the Deciding report." Don't touch `<dir>/`, the live page or the ledger while it runs.

### In the fork

1. **Number it.** The ledger is `ledger.file`; rulings are `<prefix>-<n>`. The next ruling is one past the highest:
   ```sh
   grep -o '\*\*D-[0-9]\+ ·' spec/01-launch-decisions.md | tail -1
   ```
2. **Mark it**, and get the winner without its experiment chrome:
   ```sh
   node $SKILL/scripts/decide.mjs --slug <slug> --choose <letter> --ruling D-<n> --clean <scratch>/clean.html
   ```
   This stamps `fe-exp:decision` on every page of the run (the index then shows "Decided · D-n" on the run and "Chosen" on the winner) and ticks the winner's letter in each page's switcher. `clean.html` is the winner with the switcher, `fe-exp:*` meta, experiment title and noindex removed, which should equal the live page plus the variant's change. Read any `xp` lines it warns about.
3. **Implement it.** Diff `clean.html` against the live page (`fe-exp:page`).
   - If the live page changed after the run's `fe-exp:created` (`git log --since=<date> -- <page>`), port the variant's change onto the current page. Never overwrite newer live work with the experiment's older copy.
   - Don't paste the experiment in as-is. Variants are built in layers, so fold the new CSS into the page's own `<style>`, delete the rules and scripts for the elements it replaced (now dead), and rewrite experiment-lineage comments ("Delight variant B: …") as production comments that say what the code does and cite the ruling. Match the surrounding code's conventions.
   - Apply any modifications the user asked for. Then update anything that documents the replaced treatment (a style guide, a content plan, a design artboard that is still the source for that section), or list it in the report if the change isn't obvious.
   - Check the live page the same way as step 5: `check-variants.mjs` with `main` and the page's path, both widths, and compare it with the chosen experiment's screenshots. They should match. Any difference is either a requested modification or a bug.
4. **Log it.** Add `**<prefix>-<n> · <title>** — _<date>_ — **<the ruling in one line>**` as the last entry under the ledger's decisions heading, followed by short `_What was chosen._`, `_Passed over._` (each other variant, one line) and `_What changed._` (files, and the experiment URL `<site>/<dir>/<slug>`) paragraphs, in the voice of the entries above it. Say who ruled and quote their words; don't invent a rationale. If the ledger keeps a dated findings list, add a line there too. Run the project's spec validator if it has one (fdeploy: `./node_modules/.bin/specloop check`).
5. **Ship it.** One commit containing the live page, the ledger, any docs, and the stamped `<dir>/<slug>/` pages, then push, run `wait-deploy.sh` in the foreground (420000 ms timeout), and check that the live page and `/<dir>/<slug>` return 200.

### Deciding report

- The ruling (`<prefix>-n`) and what's now live, with the URL; or the deploy failure.
- What the implementation changed beyond the variant (dead code removed, comments rewritten, modifications, docs touched), and anything that still needs the user's attention.
- The experiments listing URL, where the run now shows as decided.

## Gotchas

- **Chrome, not gstack.** The checker used to shell out to a `gstack browse` binary; it now drives the installed Google Chrome through `playwright-core`, which must be resolvable from the skill's real directory (`npm i -D playwright-core` in the host). No browser download. `FE_CHROME=<path>` points at another Chromium build.
- **Serve directories with `redirect: false`.** If the host mounts `express.static` before the router with Express's defaults, `/<dir>` and `/<dir>/<slug>` 301 to a trailing slash (they are directories on disk) and the listing never renders. Use `express.static(root, { index: false, redirect: false })`, as fdeploy's `api/index.js` does.
- **`git add -A` in a shared tree** once swept another session's work into a production push. Add `<dir>/<slug>/` by path.
- **The switcher inherits nav styling.** Pages that style bare `nav` elements (sticky, bordered, blurred) restyle the pill; its CSS resets those properties, and reads `--barh` to sit above a fixed bottom bar.
- **`decide.mjs --clean` strips CSS only inside `<style>` blocks.** A document-wide regex once ate the tail of a `<script>` that sat before the switcher's style. Read its "still mention xp" warning when it prints one.
