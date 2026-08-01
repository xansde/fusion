# Fusion VTT — Design System

**Fusion VTT** is a clean-room virtual tabletop for the web, built for **Pathfinder 2e (remaster)**, **Starfinder 2e** and **Etmos**. The GM runs a local server; players connect from the browser. This design system covers the **PF2e character sheet** surface — a dense, sober, dark-first tool inspired by Foundry's data density but with a **Pathbuilder 2e**-style level-by-level build flow and a collapsible side "Plano".

The UI language is **pt-BR**. Only mechanical ORC data is shown in compendium views — no prose (clean-room).

## Sources

- **Codebase (read-only, mounted):** `r10-design/` — five reference HTML mockups from the app's r10 sheet-redesign round: `tokens.html`, `ficha-overview.html`, `plano-coluna.html`, `magias-abas.html`, `spell-picker.html`, plus `PROMPT-claude-design.md` (the design brief with real token values and the reference character). Every token and interaction in this system is lifted directly from those files.
- **Reference character:** Tobias — Ratfolk (Snow Rat) Magus 3, Fireworks Performer. Used verbatim across the specimen cards and UI kit.

No logo or brand mark exists in the sources — see _Iconography_. No custom webfonts — the sheet uses the native `system-ui` stack.

---

## Content fundamentals

- **Language:** Portuguese (Brazil). Game-system proper nouns stay in their canonical form — often English (Starlit Span, Alchemist Dedication, Tinkering Fingers) mixed with Portuguese rules terms (Talento de Classe, Aumento de Perícia, Patamar). This bilingual mix is intentional and matches how PF2e is played in pt-BR tables.
- **Casing:** Sentence case for prose and button labels ("Adicionar magia", "Subir de nível"). UPPERCASE + wide tracking only for micro section labels ("SUPERFÍCIES", "PATAMAR 1", stat captions "FORT", "DES").
- **Voice:** Second-person, terse, functional — a tool talking, not a narrator. Tooltips explain state precisely ("Além do seu máximo atual de Pontos de Foco (1)"). No marketing tone, no exclamation.
- **Numbers:** Always signed modifiers ("+8", "+0"), monospace for anything rollable (modifiers, CD, dice, action costs). Ranges written "1/3", "33 / 33".
- **Emoji:** None in product copy. A few Unicode glyphs act as icons (see _Iconography_).
- **Disclaimers:** Clean-room note appears in compendium footers verbatim: "Dados mecânicos ORC — prosa não incluída (clean-room)".
- **Examples:** "Preparar magia…", "+ Adicionar magia", "Ocultar plano", "Trocar magia preparada — Slot Patamar 1", "Refocus: recupere 1 Ponto de Foco após 10 minutos de descanso…".

---

## Visual foundations

- **Mood:** Dark-first, sober, tool-dense. Reads like an IDE or a DAW, not a game landing page.
- **Surfaces:** Four-step dark ramp — `bg #0e0e12` (behind everything) → `surface #18181f` (windows/panels) → `surface-alt #1f1f2a` (nested cards, inputs, raised rows) → `border #2e2e3d` (hairlines). Elevation is communicated by this step-up, not by shadow. Windows and modals are the only elements with a shadow (`0 24px 64px rgba(0,0,0,0.55)`).
- **Text ramp:** `text #e8e8f0` (body/headings) → `text-muted #8888a0` (labels, captions) → `text-subtle #55556a` (units, hints, micro-labels).
- **Accent — violet `#7c5cfc`, interactive/active ONLY.** Active tab, primary button, link, filled pip, selected result, focused input border, hover borders. **Never** a decorative fill or a gradient. `accent-hover #9b7ffe`; `accent-dim rgba(124,92,252,0.15)` for active/selected washes.
- **Semantic colors, kept distinct from the accent:** success `#3ddc84`, warning `#ffc857`, danger `#ff5c5c`. Used for the green "chosen" checks, the amber optional-rule badge, and destructive hovers.
- **Proficiency (TEML):** the signature data motif — U grey · T violet · E green · M amber · L red. See `tokens/proficiency.css`.
- **Type:** `system-ui` stack, body **14px**, tight functional scale (20/16/15/14/13/12/11/10/9). Monospace stack (`ui-monospace, "Cascadia Code", …`) for all numbers.
- **Backgrounds:** flat solid fills only. No images, gradients, textures, or patterns anywhere.
- **Corner radii:** three steps — `sm 4px` (badges, inputs, inner rows), `base 8px` (cards, panels, buttons), `lg 12px` (windows, modals, standalone columns), plus `999px` pills for trait/filter chips.
- **Cards:** `surface-alt` fill + `1px solid border` + `8px` radius. **No shadow** on cards; shadow is reserved for windows/modals. No colored left-border accent stripes.
- **Spacing:** 8px grid, with dense half-steps (2/4/6) for tool rows.
- **Borders:** 1px solid `border` everywhere; **dashed** `border` marks an empty/unchosen slot or a fixed (locked) filter chip.
- **Hover states:** interactive elements gain an **accent border** and/or an `accent-dim` wash; muted text brightens to `text`; primary buttons lighten to `accent-hover`. Row hovers lift to a `surface`/`surface-alt` background. Remove/close controls turn `danger` on hover.
- **Press/active states:** the active tab/segment/chip fills or underlines with the accent; no scale/shrink animation.
- **Animation:** restrained. Short (0.12–0.15s) color/border/opacity transitions only. The d20 roll hint and slot remove-× fade in on hover. No bounces, no motion on load, no infinite loops.
- **Transparency/blur:** none except the modal backdrop (`rgba(0,0,0,0.6)`, no blur) and the rgba accent/semantic washes.
- **Imagery vibe:** N/A — the sheet is pure UI chrome; there is no photography or illustration.

---

## Iconography

Fusion's reference sheet uses **no icon font, no SVG sprite, and no image icons**. Glyphs are a small, deliberate set of **Unicode characters** rendered in the system font:

- `✓` (U+2713) — a completed/chosen slot or ABC card (in `success` green).
- `×` (U+00D7) — remove a slot, close a modal (turns `danger` on hover).
- `🔒` (U+1F512) — a locked/automatic class feature (an AutoChip you can't change).
- `🔍` (U+1F50D) — the search field's leading glyph.
- `⚁` (U+2681, die face) — the roll hint that fades in on a hovered skill row.
- `⚫` (U+26AB) — the large glyph in empty-state panels (no rituals, etc.).
- `→` `…` `•` — arrows, ellipses and bullets in labels.

Emoji are **not** used as decoration or content — only these functional glyphs. If a future surface needs a broader icon set, substitute a thin-stroke line set (e.g. Lucide) via CDN and document it here; none is wired up today.

---

## Foundations index (Design System tab)

Specimen cards live in `guidelines/` (groups: **Colors**, **Type**, **Spacing**, **Brand**):
`colors-surfaces`, `colors-text-accent`, `colors-semantic`, `type-scale`, `type-numbers`, `spacing-grid`, `radii`, `proficiency-teml`, `pips`.

Tokens live in `tokens/`: `colors.css`, `typography.css`, `spacing.css`, `radii.css`, `proficiency.css` — all `@import`ed by root `styles.css` (the single file consumers link).

---

## Components

Reusable primitives extracted from the reference sheet. Each has a `.jsx`, a `.d.ts` props contract, a `.prompt.md`, and its group ships a `@dsCard` demo. Import via `const { X } = window.FusionVTTDesignSystem_1daa5f`.

**forms/** — `Button` (primary/secondary/ghost/subtle/danger; tiny→lg), `ModeToggle` (Jogar/Editar segmented), `SearchBox`.
**character/** — `ProficiencyBadge` (TEML), `Pip` + `PipRow` (Foco/Heroísmo), `StatChip` (saves/perception/attributes), `ACShield`, `SkillRow`.
**navigation/** — `Tabs` (section bar), `Chip` (sub-tabs + filters; active/fixed).
**layout/** — `Panel` (section card), `Modal` (compendium dialog).
**plan/** — `ABCCard` (Ancestry/Heritage/Background/Class), `LevelCard` + `Slot` + `EmptySlot` + `AutoChip` + `OptionalBadge`.
**spells/** — `SpellSlotCard` + `SpellSlotEmpty` + `SpellChip`, `ResultRow` (compendium result).

---

## UI kits

**`ui_kits/ficha-pf2e/`** — the full PF2e character sheet, interactive. `index.html` renders the sheet window (title bar with Jogar/Editar, collapsible Plano column, always-visible stat block, all 17 skills, section tabs) with the **Magias** tab open, and the **spell compendium picker** modal reachable via "+ Adicionar magia". Factored into `data.js` (Tobias + compendium data), `CharacterHeader.jsx`, `PlanColumn.jsx`, `SkillsPanel.jsx`, `MagiasTab.jsx`, `SpellPicker.jsx`, `FichaApp.jsx`.

---

## Intentional additions

- **`SpellSlotEmpty` / `EmptySlot`** — split out as their own exports (rather than a prop on the filled variants) because empty dashed slots appear independently across the plan column and spell tab.
- **`OptionalBadge`** — extracted from the plan mockup's inline "Regra opcional ativa" tag so any slot can flag an optional rule.

No other primitives were invented; the inventory maps 1:1 to the reference sheet.

## Notes & caveats

- **No webfonts / no logo** in the sources. The brand name renders in plain `system-ui` type; the mono stack names `Cascadia Code`/`Source Code Pro` only as fallbacks (system mono is used when absent).
- Compendium prose is intentionally omitted (clean-room) — only ORC mechanical fields are shown.
