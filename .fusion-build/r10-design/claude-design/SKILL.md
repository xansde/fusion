---
name: fusion-vtt-design
description: Use this skill to generate well-branded interfaces and assets for Fusion VTT — a dark-first, sober virtual-tabletop tool for Pathfinder 2e / Starfinder 2e / Etmos (pt-BR UI). Contains essential design guidelines, colors, type, tokens, and the PF2e character-sheet UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key facts:

- Dark-first tool aesthetic. Violet accent `#7c5cfc` on interactive/active elements ONLY — never decorative fill, never gradients.
- Surfaces `#0e0e12 / #18181f / #1f1f2a`, border `#2e2e3d`; text `#e8e8f0 / #8888a0 / #55556a`.
- Semantics distinct from accent: success `#3ddc84`, warning `#ffc857`, danger `#ff5c5c`.
- `system-ui`, body 14px; mono for numbers. Radii 4/8/12; 8px grid. UI in pt-BR.
- TEML proficiency badges: U grey, T violet, E green, M amber, L red.
- Tokens are in `styles.css` (imports `tokens/*.css`). Components load from the compiled `_ds_bundle.js` under `window.FusionVTTDesignSystem_1daa5f`.
