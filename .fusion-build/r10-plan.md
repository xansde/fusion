# Rodada r10 — Ficha PF2e: builder Magus nível a nível + gestão de magias

> Feedback do usuário (2026-07-04) sobre a ficha r9. Método: batch-gated development.
> **Mudança de processo (usuário, 2026-07-04, durante R10-B/C): auditorias Opus REMOVIDAS
> desta rodada** — o R10-A foi o único batch auditado (score 94). Gate vigente: integração
> verde (build/typecheck/lint/testes) + validação manual do próprio usuário no app.
> Branch `build/app`.

## Feedback (itens do usuário)

1. Classe selecionável; ficha montável classe → nível a nível (começar SÓ com Magus).
2. Mostrar TODAS as skills, inclusive não treinadas (roláveis).
3. Abas de magia separadas por origem (ex.: Magus / Archetype / Focus Spells / Rituals).
4. Focus points: pool de até 3.
5. Adicionar/trocar spells pela ficha (hoje impossível).
6. Tudo separado por nível; referência de layout = Pathbuilder 2e (JSON do Tobias anexado
   ao feedback é o critério de aceitação: a ficha deve representar TUDO dele).

Nota de spec: character builder é [V2] na spec 17 (M/A(V2), linhas 671-674/953). O usuário
antecipou por decisão de produto na r10 — registrar no BUILD-LOG; specs/ de main intocadas.

## Decisões arquiteturais

- **DEC-R10-01 (modelo do build)**: escolhas de progressão = itens embedded (class,
  ancestry, heritage, background, feat, classFeature) com `flags.fusion.build = {level, slot}`
  + bloco `system.build` no character para o que não é item: boosts de atributo por origem
  (`ancestryBoosts/ancestryFlaws/ancestryFree/backgroundBoosts/classBoost/levelledBoosts{lvl:[...]}`),
  skill choices (`{level, slot, skill, rank}`), `freeArchetype: boolean`. Derivação continua
  a fonte de verdade dos números. **Compat r9**: derive steps build-driven (abilities, HP,
  proficiências de classe, skills treinadas) SÓ ativam quando existe item `type:'class'`
  embedded; sem ele, comportamento manual r9 intocado (Tobias atual segue válido até ser
  reconstruído via builder).
- **DEC-R10-02 (focus 3)**: `focusPoints.max` com teto 3 (REQ-PF2-083) — clamp na derivação
  + limite na UI; pips até max.
- **DEC-R10-03 (abas de magia)**: dentro da aba Spells, sub-abas: uma por spellcastingEntry
  não-focus (label = nome da entry), + "Focus" (entries isFocusPool + pips de focus + focus
  spells), + "Rituais" apenas se existirem itens ritual (REQ-PF2-087 é V2 — aba condicional).
- **DEC-R10-04 (gestão de spells)**: picker de compêndio (compendium:search/get — abertos a
  players; só import é GM-only). Adicionar = `doc:create` embedded spell com `location=entryId`;
  remover = `doc:delete` embedded; preparar/trocar/expend = `doc:update` embedded no item
  spellcastingEntry (`slots["N"].prepared[]`). Requer: `EMBEDDED_PARENT_MAP` ganhar
  `Item→'Actor'`, adapter `sendOp`/`normalizeDocUpdate` propagar `embedded`/`parent`, e
  validação Zod de Item embedded pf2e no server (hoje inexistente).
- **DEC-R10-05 (builder UX)**: coluna esquerda "Plano" colapsável (botão Hide Plan, como o
  print do usuário): cards Ancestry/Background/Class + um card por nível (1..level) com os
  slots daquele nível; slot vazio/preenchido; clique abre picker filtrado. Centro da ficha
  mantém stats sempre visíveis (referência Pathbuilder).
- **DEC-R10-08 (contrato visual — Claude Design, aprovado pelo usuário em 2026-07-04)**:
  o design system exportado em `.fusion-build/r10-design/claude-design/` é o CONTRATO VISUAL
  dos batches R10-C e R10-D. Estrutura: `tokens/*.css` (cores/raios/tipografia/TEML — mesmos
  hexas do base.css + extensões novas), `components/**` (React de referência: Slot/EmptySlot/
  AutoChip/LevelCard/ABCCard, SpellSlotCard/ResultRow, Tabs/Chip, Modal/Panel, Pip/
  ProficiencyBadge/SkillRow/StatChip, Button/ModeToggle/SearchBox) e `ui_kits/ficha-pf2e/`
  (composição completa: FichaApp = janela 1280×820, title bar com ModeToggle Jogar/Editar,
  PlanColumn 300px colapsável, CharacterHeader, SkillsPanel, Panel+Tabs, MagiasTab,
  SpellPicker modal; `data.js` = fixture Tobias idêntica à aceitação). Os componentes React
  NÃO são importados — são referência estrutural para os componentes Svelte 5 equivalentes.
  Parte do R10-C: portar para `styles/base.css` os tokens novos (`--fusion-*-dim` semânticos,
  `--fusion-on-accent`, `--fusion-shadow-modal`, `--fusion-radius-pill`, `--fusion-prof-*`).
  Mockups HTML estáticos na mesma pasta (`*.html`) são referência secundária.
- **DEC-R10-06 (packs novos)** — todos com `pack.json` license ORC + atribuição
  foundryvtt/pf2e (Apache-2.0), prosa strippada (stripFlavorProse), arte = placeholders:
  `classes-core` (magus), `class-features-core` (features do Magus + hybrid studies + shared
  do items{} map), `feats-core` (magus 55 + shared-class-feats + ancestry ratfolk + skill/general
  curados + alchemist dedication p/ free archetype), `ancestries-core` (ratfolk),
  `heritages-core` (7 do ratfolk), `backgrounds-core` (fireworks-performer no mínimo),
  `spells-core` expandido (tradição arcana completa + focus spells do magus). A progressão
  mecânica do Magus que só existe em prosa no vendor (slots por rank/nível, upgrades de
  proficiência por nível via items{} map) vira tabela estruturada `progression` autorada
  clean-room no documento de classe do Fusion (fatos de regra não são copyright; fonte
  Apache-2.0/ORC com atribuição).
- **DEC-R10-07 (skills)**: derivação itera as 16 `SKILL_SLUGS` (untrained rank 0 = só
  ability mod, REQ-PF2-012) + lores; VM lista todas; rolagem permitida untrained.

## Batches

### R10-A — Fundação: schemas & derivação (systems/pf2e, engine-2e)
1. `ClassSystemSchema` += progressão estruturada (featLevels por categoria, skillIncreaseLevels,
   trainedSkills{value,additional}, spellcasting table por nível, proficiency upgrades, featuresByLevel).
2. Novo item type `classFeature` (schema + registro em documentTypes.Item + exports).
3. `system.build` no CharacterSystemSchema (DEC-R10-01) + focus max ≤3 (DEC-R10-02).
4. `stepCharSkills` → 16 canônicas + lores (DEC-R10-07).
5. Derive steps build-driven gated por class item: abilities de boosts, HP
   (ancestryHP + (classHP+conMod)×level), proficiências/saves/classDC de classe por nível,
   skills treinadas do build, slots de spellcasting do Magus por nível.
6. Testes: fixture "Tobias por build" reproduzindo o JSON do Pathbuilder →
   AC 19 (couro +1 item, dexCap), HP 33, saves +8/+8/+7, DC 18/atk +8, skills idênticas,
   focus 1/1 (max exibível 3).
Aceitação: doc com class magus + build do Tobias deriva números idênticos ao Pathbuilder.

### R10-B — Packs do Magus (tools/importer-pf2e)
1. Normalizers no transform.mjs p/ class/classFeature/ancestry/heritage/background/feat
   (preservar progressão; prosa strippada; ChoiceSet segue unconvertedRules).
2. Tabela `progression` do magus autorada e validada contra o items{} map do vendor.
3. Manifests novos no build-mvp-subset.mjs (DEC-R10-06) + indexFields p/ picker
   (category, level, traits).
4. Rodar pipeline e commitar packs em systems/pf2e/packs/.
5. Testes: pipeline + validação de TODOS os docs gerados contra os schemas do R10-A.
Aceitação: packs descobertos pelo CompendiumService; contagens no build-report.

### R10-C — Gestão de spells + abas + skills/focus na ficha (itens 2,3,4,5)
1. Server: `EMBEDDED_PARENT_MAP` Item→Actor + validação Zod de Item embedded pf2e + testes.
2. Client `sendOp`: propagar `embedded`/`parent`; novos tipos de op na VM/props da sheet.
3. VM/UI: skills todas (16+lores, roláveis untrained); focus pips com teto 3.
4. VM/UI: sub-abas de magia por entry + Focus (+Rituais condicional) (DEC-R10-03).
5. Spell picker (search/get) + add/remove spell; preparar/trocar por slot; expend/restore.
6. i18n pt-BR/en + testes VM/component.
Aceitação: na ficha do Tobias — todas as skills aparecem e rolam; abas Magus/Focus;
adicionar spell arcana, preparar num slot rank 1, trocar e expend funcionam ponta a ponta.

### R10-D — Builder nível a nível estilo Pathbuilder (itens 1,6)
1. Coluna "Plano" colapsável com cards ABC + cards por nível (DEC-R10-05).
2. Seleção de classe (picker classes-core) → aplica class item + entries (Magus arcane
   prepared + Conflux focus) + trained skills iniciais (arcana + N adicionais à escolha).
3. Slots por nível computados da progression + estado vazio/preenchido.
4. Pickers filtrados por slot (categoria/nível máx/trait magus|ratfolk; hybrid study lista
   classFeatures com tag; free archetype toggle → slot archetype nos níveis pares).
5. Side-effects: skill training/increase, boosts (Set Abilities), hybrid study (Starlit
   Span), remoção de escolha (limpa item + choice + side-effects).
6. Level-up: mudar nível revela/remove cards; escolhas de níveis acima do atual ficam ocultas
   mas preservadas.
7. i18n + testes (lógica pura da VM do builder + component).
Aceitação: montar o Tobias DO ZERO só pela UI (Ratfolk/Snow Rat/Fireworks Performer/Magus 3
+ escolhas do JSON) → números batem com o Pathbuilder.

### R10-E — Integração, validação viva e entrega
1. Suíte completa do monorepo (build, typecheck, lint, boundaries, testes; forks=4;
   flakiness re-rodar isolado).
2. Sonda headless (ui-probe) + Claude Preview: recriar Tobias via builder na UI real,
   screenshots das novas telas.
3. Auditoria final Opus do conjunto r10.
4. BUILD-LOG + memória do projeto + vault (context/todo) + commits granulares.
5. Exe regenerado + smoke (padrão r9).

## Convenções para os agentes

- Código/comentários/identificadores em inglês; docs pt-BR. Conventional commits.
- Clean-room: NUNCA copiar código/assets/prosa proprietária; vendor foundryvtt/pf2e é
  Apache-2.0/ORC — dados mecânicos ok com atribuição; arte Paizo proibida (placeholders).
- Testes server: pool forks/maxForks 4; "Timeout calling onTaskUpdate" sem teste falhando =
  flakiness, re-rodar isolado.
- Build order: @fusion/shared antes de @fusion/server (`pnpm build` no root resolve).
- Redação/visibilidade: sempre redaction.ts + isRolePrivileged (nunca duplicar predicados).
