# @fusion/translate-packs

CLI pipeline that generates two per-pack overlay files for the Fusion PF2e
compendium packs:

- **`i18n.pt-BR.json`** — pt-BR translation overlay (name + description per
  document), clean-room derived from the ORC/OGL English source. EN always
  remains the source of truth and the server fallback.
- **`mechanics.json`** — structured grants/unlocks overlay (feat-choice
  grants and ancestry-feat-eligibility unlocks), extracted deterministically
  from the vendor's `ChoiceSet`/`GrantItem` rule elements preserved on each
  document (`system.rules` + `flags.fusion.unconvertedRules`).

Both overlays are written alongside `pack.json` inside each pack's directory
(`systems/pf2e/packs/<slug>/`), resolved the same way the server resolves the
pack itself (`resolveSystemPacksDir` — dev, monorepo, and packaged-exe paths
all covered for free). Their shapes are validated against the Zod schemas in
`packages/shared/src/compendium.ts` (`PackI18nOverlaySchema`) and
`packages/shared/src/mechanics.ts` (`PackMechanicsOverlaySchema`).

See the T1 design contract (owner: implementer A / pipeline) for the full
rationale, schema literals, and the normalization algorithm this tool
implements.

## Pipeline stages

| Stage | Script                      | Output                                                       |
| ----- | --------------------------- | ------------------------------------------------------------ |
| 1     | `src/extract.mjs`           | `out/translate/<pack>/chunk-NNN.json` (work units)           |
| 2     | `src/grants-from-rules.mjs` | `out/mechanics/<pack>.rules.json` (deterministic)            |
| 3     | `src/apply.mjs`             | `systems/pf2e/packs/<pack>/{i18n.pt-BR.json,mechanics.json}` |
| 4     | `src/qa.mjs`                | `out/qa-report.json` (pass/fail per translated doc)          |

### 1. `extract.mjs` — work-unit generation

Scans every pack's `documents.json` and emits translation work-units in
chunks of ~20 docs:

```
node src/extract.mjs [--packs pack1,pack2] [--chunk-size 20] [--out out/translate]
```

Each chunk (`out/translate/<pack>/chunk-NNN.json`) carries, per doc: `id`,
`name`, `description` (raw EN), `sourceHash`, an optional `reason` (see
below), and the subset of `unconvertedRules`/`systemRules` relevant to
mechanics extraction (so a translator/LLM work-unit and
grants-from-rules.mjs can both consume the same chunk file without
re-reading the full pack).

**Re-runnable, and only skips a doc that is REALLY translated** (issue #9,
parent of #27 — the extractor used to have the identical blind spot the QA
gate had before it was fixed: a doc whose `sourceHash` matched was treated
as "done" even when its overlay entry had no `description` at all).
`buildWorkUnitsForPack` (`src/i18n-overlay.mjs`) uses the exact same
"does EN have real prose" definition as the QA gate's `checkDoc`
(`stripHtmlToText(description).trim().length > 0`, exported from
`src/qa-checks.mjs`) so the two never disagree about what counts as
translatable text. Per doc:

| EN has real prose? | Entry exists? | `sourceHash` matches? | `noDescription`? | PT `description` present? | Result                                                                                                            |
| ------------------ | ------------- | --------------------- | ---------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| —                  | no            | —                     | —                | —                         | **emit** (`stale: false`)                                                                                         |
| —                  | yes           | no (stale)            | —                | —                         | **emit** (`stale: true`) — retranslation needed                                                                   |
| no                 | yes           | yes                   | —                | —                         | **skip** — nothing to translate                                                                                   |
| yes                | yes           | yes                   | `true`           | —                         | **skip** — explicit valve (deliberately name-only)                                                                |
| yes                | yes           | yes                   | falsy            | non-empty                 | **skip** — actually translated                                                                                    |
| yes                | yes           | yes                   | falsy            | absent/`""`               | **emit** with `reason: "missing-description"` — the `name` is already translated, only the description is missing |

`stale: true` and `reason: "missing-description"` are mutually exclusive
markers on a unit: `stale` flags an EN-source change that invalidates an
existing translation, `reason: "missing-description"` flags a
same-EN-source entry that never got its description filled in.

### 2. `grants-from-rules.mjs` — deterministic mechanics extraction

Normalizes every doc's `ChoiceSet`/`GrantItem` rule-element pair into the
Grant/Unlock schema, with `source: "rule-element"` (100% deterministic — no
LLM involved at this stage):

```
node src/grants-from-rules.mjs [--packs pack1,pack2] [--out out/mechanics]
```

Algorithm (implemented in `src/normalize-rules.mjs`):

1. For each doc, collect `ChoiceSet` entries from
   `flags.fusion.unconvertedRules` and `grant-item` entries from
   `system.rules`.
2. A `ChoiceSet` whose `choices` is an **array** (e.g. skill/terrain/proficiency
   pick-lists — "Armor Proficiency", "Terrain Stalker") is a **static value
   choice**, never a feat/ancestry grant — ignored.
3. A `ChoiceSet` with `choices.itemType === "feat"` **and** a paired
   `grant-item` (whose `uuid` references `rulesSelections.<flag>`) becomes a
   **grant**: `category`/`traits`/`maxLevel` are read from literal filter
   predicates; dynamic predicates (`{actor|...}`) are preserved in
   `levelExpr` and reduce `confidence` below 1.0 (never silently dropped —
   T2's LLM pass confirms/completes these).
4. A `ChoiceSet` with `choices.itemType` `"ancestry"`/`"heritage"` **without**
   a paired grant-item becomes an **unlock** (eligibility expansion, e.g.
   Adopted Ancestry) — `mechanism` is a kebab-case slug of the granting doc's
   own name (e.g. "Adopted Ancestry" → `"adopted-ancestry"`).
5. A `ChoiceSet(feat)` **without** a paired grant-item, or any other
   unrecognized shape, produces nothing — left for T2.

Docs with zero grants/unlocks get **no entry** in the output (keeps the
overlay lean — most packs have none of these rule-element pairs at all;
e.g. `spells-core`, `conditions`, `weapons-core`).

**Calibration (mandatory)** — asserted against the live `feats-core` pack in
`src/__tests__/mechanics-parity.test.mjs` and `normalize-rules.test.mjs`:

| Feat                 | Result                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic Concoction     | grant `{category:"class", filters:{traits:["alchemist"],maxLevel:2}, confidence:1.0}` — **must match `GRANTED_FEAT_CHOICES["basic concoction"]` in `packages/client/src/lib/sheets/pf2e/planVM.ts` exactly** (category/trait/maxLevel/labelKey) |
| Ancestral Paragon    | grant `{category:"ancestry", filters:{levelExpr:"item:level:1"}, confidence:0.6}` (dynamic trait predicates not literalized)                                                                                                                    |
| Adopted Ancestry     | unlock `{mechanism:"adopted-ancestry", filters:{excludeOwnAncestry:true}, confidence:1.0}`                                                                                                                                                      |
| Alchemist Dedication | no entry (its `grant-item`s target fixed items, not a `ChoiceSet`-driven choice)                                                                                                                                                                |

`src/calibration.mjs` stamps `labelKey` onto known granting feats (currently
just Basic Concoction) so the overlay can eventually replace the client's
hardcoded `GRANTED_FEAT_CHOICES` table without changing the label the player
sees — see `grantFromMechanics` wiring in `planVM.ts` (implementer C's
territory).

### 3. `apply.mjs` — merge into the real pack overlays

Merges stage 1's translation output (see format below) and stage 2's
mechanics output into the pack's committed overlay files:

```
node src/apply.mjs [--packs pack1,pack2]
                    [--translated-dir out/translate]
                    [--mechanics-dir out/mechanics]
```

**Translation input format** — one or more `translated-*.json` files per
pack under `<translated-dir>/<pack>/` (produced by a human or T2's LLM pass;
merged left-to-right in filename order, later files win on id conflicts):

```json
{
  "bduri70co98T1fwA": { "name": "Concocção Básica", "description": "<p>...</p>" }
}
```

`description` is optional — a name-only translation is valid (e.g. for docs
where only the picker label matters), but see the `reason:
"missing-description"` marker above: an omitted description is only treated
as _intentional_ once the entry (or this translation batch) sets
`noDescription: true`. The merge always re-stamps `sourceHash` from the
CURRENT EN doc (never trusts a hash embedded in the translation input), so
a stale translation can never silently claim freshness.

A translation batch may also declare `noDescription: true` explicitly to
set/keep the valve:

```json
{
  "someDocId": { "name": "Nome Só", "noDescription": true }
}
```

`mergeI18nOverlay` preserves `noDescription` across re-merges instead of
rebuilding each entry from scratch (a prior bug: the merge used to emit only
`{ name, sourceHash, description? }`, silently dropping any pre-existing
`noDescription: true`). Precedence per doc id: an explicit
`noDescription` in this batch wins; otherwise, if this batch supplies a real
`description`, any old valve is cleared (a fresh description was just
provided); otherwise the existing entry's `noDescription` is carried over
unchanged.

**Idempotent**: entries are re-sorted by key on every merge — re-running
`apply.mjs` with the same inputs produces byte-identical overlay files
(clean diffs).

**No-noise rule**: `apply.mjs` never writes an empty-`entries` `mechanics.json`
for a pack that has no grants/unlocks and no pre-existing overlay — most
packs (spells, conditions, weapons, ...) simply don't have one.

### 4. `qa.mjs` — automated translation QA

Runs 5 automated checks on every translated doc in a pack's
`i18n.pt-BR.json`, comparing against the live EN `documents.json`:

```
node src/qa.mjs [--packs pack1,pack2] [--out out/qa-report.json]
```

| Check              | Failure condition                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dice-formulas`    | the set of `\d+d\d+([+-]\d+)?` patterns differs between EN and PT (dice math must never drift)                                                      |
| `balanced-tags`    | PT's HTML tag multiset differs from EN's (a tag was dropped or added)                                                                               |
| `glossary-applied` | EN has recognizable glossary terms (see `glossary.pt-BR.json`) but none of them appear translated in PT (skipped when EN has zero recognized terms) |
| `length-ratio`     | `len(PT) / len(EN)` (plain text, tags stripped) falls outside `[0.5, 2.0]`                                                                          |
| `no-new-enrichers` | PT introduces an `@Tag[...]` enricher not present verbatim in EN — translation must only touch prose/labels, never enricher syntax                  |

A failing doc should go back for retranslation. Exit code is non-zero when
any doc fails any check (CI-gateable). The JSON report lists every checked
doc's pass/fail + failure reasons per pack.

## Glossary (clean-room)

`glossary.pt-BR.json` + `GLOSSARY.md` hold the generic pt-BR vocabulary used
during translation (mechanical terms, traits, conditions, skills, etc.) —
**not** the official Brazilian localization of any product. See
`GLOSSARY.md` for the full clean-room policy. `src/glossary.mjs` is the
loader consumed by `qa.mjs` (glossary-applied check); the actual translation
pass (T2, LLM-driven) is expected to apply the glossary deterministically
before/after generating prose, per the same policy.

`src/__tests__/glossary.test.mjs` is a living coverage test (owner:
implementer B) asserting the glossary against the real packs — any pack
regeneration introducing a new trait/condition fails that test until the
glossary covers it.

## Directory layout

```
tools/translate-packs/
├── glossary.pt-BR.json       # pt-BR vocabulary (terms/categories/keepEnglish/styleDecisions)
├── GLOSSARY.md                # clean-room policy for the glossary
├── package.json
├── src/
│   ├── extract.mjs            # stage 1 CLI
│   ├── grants-from-rules.mjs  # stage 2 CLI
│   ├── apply.mjs               # stage 3 CLI
│   ├── qa.mjs                  # stage 4 CLI
│   ├── hash.mjs                # sourceHash helpers (i18n + mechanics)
│   ├── pack-io.mjs             # filesystem helpers (resolve packs root, read/write overlays)
│   ├── i18n-overlay.mjs        # pure i18n.pt-BR.json build/merge logic
│   ├── mechanics-overlay.mjs   # pure mechanics.json build/merge logic
│   ├── normalize-rules.mjs     # ChoiceSet/GrantItem -> Grant/Unlock (pure, no I/O)
│   ├── calibration.mjs         # labelKey assignment for known granting feats (planVM.ts parity)
│   ├── glossary.mjs            # glossary loader + term lookup
│   ├── qa-checks.mjs           # pure per-doc QA checks (used by qa.mjs)
│   └── __tests__/
│       ├── hash.test.mjs
│       ├── normalize-rules.test.mjs
│       ├── mechanics-parity.test.mjs   # MANDATORY: parity vs planVM.ts's GRANTED_FEAT_CHOICES
│       ├── i18n-overlay.test.mjs
│       ├── mechanics-overlay.test.mjs
│       ├── qa.test.mjs
│       ├── glossary.test.mjs           # owner: implementer B
│       ├── pipeline-e2e.test.mjs       # subprocess CLI tests against a fixture pack
│       └── fixtures/
│           ├── feats-core-samples.json      # real docs pinned as fixtures
│           └── mini-packs-root/             # isolated fixture packs for E2E tests
└── out/                        # gitignored scratch dir for chunks/rules-json/reports
```

## Running

```
cd tools/translate-packs
node src/extract.mjs
node src/grants-from-rules.mjs
# ... translation happens here (human or T2 LLM pass; produces translated-*.json) ...
node src/apply.mjs
node src/qa.mjs
```

Or via the package scripts (`pnpm --filter @fusion/translate-packs run <script>`):
`extract`, `grants`, `apply`, `qa`.

## Testing

```
cd tools/translate-packs
node --test src/__tests__/*.test.mjs
```

All tests are pure Node (`node:test` + `node:assert/strict`) — no vitest
config, matching `tools/importer-pf2e`'s pattern. `pipeline-e2e.test.mjs`
runs the actual CLI scripts as subprocesses against an isolated fixture pack
root (`--packs-root` override) under a fresh `os.tmpdir()` — it never reads
or writes the real `systems/pf2e/packs/` tree. Unit tests for the pure
modules (`hash.mjs`, `normalize-rules.mjs`, `i18n-overlay.mjs`,
`mechanics-overlay.mjs`, `qa-checks.mjs`) use small in-memory fixtures plus
a few real docs pinned in `__tests__/fixtures/feats-core-samples.json`.

## Legal / clean-room

- Source EN text (`documents.json`) is ORC/OGL-licensed mechanical content
  from `foundryvtt/pf2e` (Apache-2.0 repo, ORC/OGL data) — free to translate.
- The pt-BR translation this pipeline generates is a clean-room derivation
  with explicit `attribution` in every `i18n.pt-BR.json`. It is **not** and
  must never become the official Brazilian localization of any Pathfinder
  product — see `GLOSSARY.md`.
- Overlays never mutate `documents.json` — EN remains the single source of
  truth and the server's fallback whenever a translation is absent or stale.
