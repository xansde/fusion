# Rodada r12 — plano (2026-07-05)

Feedback do usuário (prints Pathbuilder aba Actions + ficha Fusion). 8 itens → 3 workstreams paralelos com territórios disjuntos (processo calibrado: sem auditoria por batch, verificação viva central no fechamento, colaterais em background).

## Itens

1. Seleções de atributos do nível 1 não podem ser alteradas depois de feitas (nem como GM). → **W1**
2. Usuário ainda não sabe o que significa o que está selecionando (boosts/perícias sem descrição). → **W1**
3. Coisas selecionadas concedem ações que não aparecem na aba de ações. → **W2**
4. Aba de ações precisa de filtros como no Pathbuilder (Basic/Class/Skills/Gear/Exploration/Downtime/Activity + custo de ação + busca) — volume grande de ações universais. → **W2**
5. Magias de foco não aparecem. → **W3**
6. Magias aparecendo como sequência estranha de caracteres (IDs crus, ex.: `QM1xJwDDsAEYA3uJ`). → **W3**
7. Aba de magias deve mostrar também o CD de classe do arquétipo (Alchemist DC 18 ≠ Magus DC 15). → **W3**
8. Indicador de Pontos de Herói inexistente/confuso (pips rotulados "HP" confundem com testes contra a morte). → **W3**

## Reconhecimento (fatos)

- Vendor: `tools/importer-pf2e/vendor/pf2e/packs/pf2e/actions/` com subpastas-categoria: basic, skill, exploration, downtime, class, equipment, ancestry, archetype, background, familiar, etc. Docs `type: action` com `system.{actionType,actions,category,description,publication,rules,traits}`.
- IDs crus: `SpellsTab.svelte:332` — `slot?.spells.find(...)?.name ?? id` (slot preparado referencia id que não está no grimório espelhado).
- Aba Actions atual (`CharacterSheet.svelte` ~L689): só strikes.
- Hero Points: pips existem (`characterSheetVM.ts` REQ-UIF-023) mas rotulados "HP" no header.
- i18n: `packages/client/src/lib/i18n/{en,pt-BR}.json` — arquivo compartilhado; edits SÓ via Edit com âncoras únicas (nunca Write).

## Territórios

| WS | Pode editar | Proibido |
|---|---|---|
| W1 builder-ux | `planVM.ts`, `components/sheets/pf2e/plan/**`, testes do plan | characterSheetVM, CharacterSheet.svelte, SpellsTab, i18n, importer/packs |
| W2 actions | importer (normalize/transform), `systems/pf2e/packs/actions-core` (gerado), schema de action se preciso, NOVOS arquivos client (ActionsTab.svelte, actionsVM.ts, actionCategories), bloco da aba actions em CharacterSheet.svelte (Edit), i18n namespace `FUSION.Sheet.Actions.*` (Edit) | planVM/plan dialogs, SpellsTab, characterSheetVM, header do CharacterSheet |
| W3 spells+hero | `characterSheetVM.ts`, `SpellsTab.svelte`, `systems/pf2e/src/derivations/**`, bloco do header (hero points) em CharacterSheet.svelte (Edit), i18n namespaces Spells/HeroPoints (Edit) | planVM/plan dialogs, aba actions, importer |

## Decisões

- **DEC-R12-01**: categorias de ação derivadas das pastas do vendor (`_folders.json`), curadas para os grupos do Pathbuilder; mapeamento explícito em arquivo versionado (estilo traitGroups.ts) com teste de cobertura.
- **DEC-R12-02**: política de prosa r11 vale para actions-core (description preservada se license ∈ {ORC,OGL}; gmNotes etc. sempre strippados; textAttribution no pack.json).
- **DEC-R12-03**: aba Actions mescla compendium (ações universais) + ações concedidas pelos itens embutidos do ator (feats/features com actionType ≠ passive), com dedupe por slug.
- **DEC-R12-04**: CD de arquétipo derivado de dedication feats (mapa arquétipo→key ability no engine; alchemist→int), exposto em `derived` e exibido na aba de magias ao lado do spell DC.
- **DEC-R12-05**: nome de magia NUNCA cai para id cru na UI — resolução cruza entradas/grimório/compêndio; fallback visível é estado de erro com retry, não o id.
- Colateral pós-r12 (background): actions do sf2e (`vendor/pf2e/packs/sf2e/actions`).

## Fechamento

Integração por mim: suítes completas, rebuild do client + restart do dev server 33100 com cópia FRESCA do mundo do usuário (db+wal+shm), verificação viva playwright dos 8 itens, commits por workstream, BUILD-LOG + vault.
