# fe-experiments rules for fdeploy

The project's own design rules, checked against every variant before it ships
(fe-experiments SKILL.md step 4). Each one has been broken in a draft before.
Copy this file to the path named by `rules` in `fe-experiments.config.json`.

- **Content plan items stay.** If `Home Content Plan.md` says "keep the three capability cards", all three appear, with their links and link targets.
- **Numbers or nothing.** Only figures in `PRODUCT.md` → Evidence on Hand. Draw ranges (6–14 weeks) rather than invent a precise point. If live copy carries a figure that isn't on record, leave it out and flag it.
- **No invented proof.** No fake names, photos, testimonials, logos, or made-up metrics inside UI depictions.
- **Ground.** A paper band stays paper, with Deep Teal `#2F7D72`/`#1F5C53` as the accent, never Signal Teal. No pure white, no gradients on surfaces, no shadows.
- **One Instrument Serif italic word per view.**
- **Motion.** The hero field and the typed eyebrow are the page's only moving things. Everything else is a 120ms state change, dropped under `prefers-reduced-motion`.
- **Layout.** Radii only 100 · 14 · 12 · 9 · 6; `minmax(0,1fr)` tracks; max width 1240.
- **Copy.** No em dashes in new copy. Keep a list of every sentence you wrote that isn't on the live page.
- **Accessibility.** WCAG 2.2 AA contrast; diagrams get `role="img"` and an `aria-label`; hover behaviour also fires on focus.
