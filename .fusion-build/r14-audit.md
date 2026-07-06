# Auditoria r14 — ficha do Tobias (Fase 0, item a item)

> Read-only quanto a código. Ambiente: cópia descartável do mundo real `argiburgo`
> (`world.db` + `-wal` + `-shm` + `world.json`), servida em `localhost:33100`
> (server buildado da branch `build/app`), login **Jogador** (dono do Tobias).
> Data: 2026-07-06. Actor: `sfHTKD2zi8yzTCB7` (Tobias, Ratfolk Magus 3, Starlit Span,
> Alchemist Dedication como arquétipo livre).

## 1. Resumo executivo

A ficha do Tobias está **funcional e majoritariamente correta** — todos os números
derivados (HP, CA, saves, atributos, CDs, perícias) batem com o build, e **todas as
rolagens clicáveis funcionam** (saves, strikes/MAP, dano, spell attack, perícias; card
com breakdown no chat). A tela de escolha de magias e a tradução de magias/ações do
compêndio estão excelentes. Os gaps concentram-se em **tradução de superfícies** e em
**automação de grants**:

1. **Conteúdo embutido do personagem fica em EN cru** em toda a UI (coluna Plano,
   título do popup de detalhes, aba Actions, aba Skills, aba Feats, header, abas da
   ficha). As traduções pt-BR **existem nos packs** (i18n.pt-BR: "Análise do Magus",
   "Familiar Ratkin", "Veloz", "Alcance Luminoso", "Concoção Básica"...) mas a ficha
   não as consome para os itens embutidos, porque o join depende de `system.slug` —
   **que é `undefined` em todos os items** (embutidos e nos próprios docs de pack).
2. Na aba **Actions**, Magus's Analysis e Bon Mot aparecem só em EN **e** o painel de
   descrição mostra **prosa EN** — causa raiz precisa: o tradutor de ações só carrega
   o pack `actions-core`, mas essas feats vivem em `feats-core`, então nunca há pack
   row para herdar `namePt`/`fallbackUuid`.
3. Na aba **Spells**, o nome da magia **não é clicável** (nem foco, nem preparadas,
   nem truques) — não abre descrição e não dispara rolagem (não há handler algum).
4. **Alchemist Dedication não materializou os grants** (Alchemical Crafting + Quick
   Alchemy) — os `GrantItem` (uuid) dos rule elements do doc nunca executam no builder.
5. A **entry de spellcasting fantasma "arcane Spells"** (duplicata vazia, minúscula)
   ainda existe no mundo, ao lado de "Magias Arcanas".
6. Slot de **ability boosts** mostra a string crua `"con, dex, int, int, cha, dex,
   con, int"` — precisa virar grid líquido por atributo.
7. **Shooting Star (Estrela Cadente) JÁ aparece na aba Foco** (o usuário adicionou
   manualmente) — o item 5 do feedback ("Starlit Span não liberou Shooting Star") é
   real como **automação faltante**, mas Starlit Span **não concede** Shooting Star nos
   packs (rule elements vazios); a magia veio de adição manual, não de grant.

---

## 2. Inventário da ficha (seleções → nível/slot → pack doc)

Fonte: `system.build.choices` + `items[]` embutidos do actor (todos com `system.slug:
undefined`; ligação com o pack por `flags.fusion.sourceId`).

| Seleção (embutida) | Tipo | Nível/slot (build) | Pack de origem | i18n pt-BR no pack |
|---|---|---|---|---|
| Ratfolk | ancestry | — (A) | ancestries-core | (a checar) |
| Snow Rat | heritage | — (B linhagem) | heritages-core | (a checar) |
| Fireworks Performer | background | — (C) | backgrounds-core | (a checar) |
| Magus | class | — | classes-core | — |
| Starlit Span | classFeature (hybridStudy) | L1 `hybridStudy-1` | class-features-core | **Alcance Luminoso** |
| Rat Familiar | feat (ancestry) | L1 `ancestryFeat-1` | feats-core | **Familiar Ratkin** |
| Magus's Analysis | feat (class) | L2 `classFeat-2` | feats-core | **Análise do Magus** |
| Bon Mot | feat (skill) | L2 `skillFeat-2` | feats-core | **Bon Mot** (idêntico) |
| Alchemist Dedication | feat (archetype) | L2 `archetypeFeat-2` | feats-core | **Dedicação a Alquimista** |
| Basic Concoction | feat (archetype) | L4 `archetypeFeat-4` | feats-core | **Concoção Básica** |
| Fleet | feat (general) | L3 `generalFeat-3` | feats-core | **Veloz** |
| Skill Training ×6 (occultism, athletics, intimidation, religion, survival, thievery) | skillTraining | L1 | — | — |
| Skill Increase (crafting→Master) | skillIncrease | L3 | — | — |
| Ability Boosts (L1) | abilityBoosts | L1 | — | — |
| **Magias Arcanas** | spellcastingEntry (arcane, prepared) | — | — | — |
| **arcane Spells** (FANTASMA, vazia) | spellcastingEntry (arcane, prepared) | — | — | — |
| **Focus Spells** | spellcastingEntry (isFocusPool) | — | — | — |
| Truques: Ignição, Projétil Telecinético, Arco Elétrico, Escudo, Detectar Magia | spell (lvl 0) | — | spells-core | (traduzidos) |
| Preparadas: Sure Strike, Horizon Thunder Sphere, Blazing Bolt | spell | — | spells-core | traduzidos |
| Shooting Star | spell (focus/magus) | — | spells-core | **Estrela Cadente** |

Grants **esperados** dos rule elements dos docs de pack (fonte da verdade):

- **Alchemist Dedication** (`feats-core`, sourceId `CJMkxlxHiHZQYDCz`) — 4 REs:
  `upgrade crafting rank →1`, `upgrade weapon proficiency (alchemical bomb) →1`,
  **GrantItem `Compendium.pf2e.feats-srd.Item.Alchemical Crafting`**,
  **GrantItem `Compendium.pf2e.actionspf2e.Item.Quick Alchemy`**.
- **Basic Concoction** (`h5ZT9i79BFVJ0VfE`) — `ChoiceSet` (feat de classe alquimista
  nível ≤2); `mechanics.json` já expõe grant `feat-choice` (labelKey
  `FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction`).
- **Starlit Span** (`class-features-core`, `Pew7duAozEeAemif`) — **systemRules vazio**;
  **não concede Shooting Star** nos packs.
- Magus's Analysis: 1 RE (`FlatModifier skill-check +1`, sem grant).
- Rat Familiar: 1 RE (`familiarAbilities +2`, sem grant). Fleet: 1 RE (`land-speed +5`).

---

## 3. TABELA DE GAPS priorizada

| # | Item / Superfície | Esperado | Observado | Causa provável (arquivo:linha) | Batch | Prio |
|---|---|---|---|---|---|---|
| 1 | **Coluna Plano — nomes de conteúdo** | pt-BR principal + EN subtítulo (Análise do Magus / Magus's Analysis; Familiar Ratkin; Veloz; Alcance Luminoso; Bon Mot/Bon Mot) | Só EN cru (Magus's Analysis, Bon Mot, Fleet, Rat Familiar, Starlit Span) | `PlanSlot.svelte:55-67` renderiza `{name}` cru; `planVM.ts` monta `name` do item embutido (EN) sem tradutor de nomes de pack | B1 | **P0** |
| 2 | **Coluna Plano — rótulo de tipo de slot** | pt-BR (Talento de Classe, Aumento de Atributo, Estudo Híbrido, Treino de Perícia...) + EN subtítulo | Só EN (Class Feat, Ability Boosts, Hybrid Study, Skill Training, Skill Feat, Archetype Feat, General Feat, Skill Increase, Ancestry Feat) | `planVM.ts:420-431` `SLOT_TYPE_LABELS` hardcoded EN; `PlanSlot.svelte` exibe cru | B1 | **P0** |
| 3 | **PlanDetailsDialog — título** | Título pt-BR + EN subtítulo | Título EN cru (corpo/descrição já vem pt-BR) | `PlanDetailsDialog.svelte:112` `<h2>{request.name}</h2>` usa nome EN em vez do `namePt` do entry resolvido (o dialog já resolve o doc por nome via `findEntryUuidByName:76`) | B1 | **P0** |
| 4 | **Aba Actions — nome da feat embutida** | Análise do Magus / Magus's Analysis; Bon Mot | Só EN (Bon Mot, Magus's Analysis em "DO PERSONAGEM") | `actionsVM.ts:768-780` `loadActionEntries` só carrega pack `actions-core`; feats vivem em `feats-core` → sem pack row → merge (`:407-414`) não herda `namePt` | B1 | **P0** |
| 5 | **Aba Actions — descrição do painel** | Descrição pt-BR (ORC/OGL) | **Prosa EN crua** ("You make an assessment informed by your knowledge...") | Mesmo motivo do #4: `fallbackUuid` fica null (sem pack row de actions-core) → painel usa descrição embutida EN. Corrigir com join a `feats-core` por sourceId/nome | B1 | **P0** |
| 6 | **Slot Ability Boosts** | Grid 3×2 líquido por atributo: FOR -1, DES +3, CON +2, INT +4, SAB +0, CAR +1 | String crua `"con, dex, int, int, cha, dex, con, int"` | `planVM.ts` monta `name` do slot como join da lista de boosts; `PlanSlot` exibe cru | B1 | **P1** |
| 7 | **Aba Skills — nomes de perícias** | pt-BR + EN (Acrobacia/Acrobatics, Arcanismo/Arcana...) | Só EN (Acrobatics, Arcana, Athletics, Crafting, Deception, Diplomacy, Intimidation, Medicine, Nature, Occultism, Performance, Religion, Society, Stealth, Survival, Thievery) + ranks U/T/M | Tabela de perícias sem i18n pt-BR na aba Skills (SkillsTab/VM) | NOVO | **P1** |
| 8 | **Abas da ficha** | pt-BR (Principal, Perícias, Ações, Magias, Inventário, Bio) | EN (Main, Skills, Actions, Spells, Inventory, Feats, Bio) | Rótulos hardcoded EN em `CharacterSheet.svelte` (lista de abas) | B1 (já mexe na lista de abas p/ remover Feats) | **P1** |
| 9 | **Header da ficha — "Level N"** | "Nível 3" | "Ratfolk · Magus (Starlit Span) Level 3" | String "Level" hardcoded no cabeçalho da ficha | NOVO | **P2** |
| 10 | **Aba Spells — nome não clicável** | Clique no nome abre descrição (popup) | `div.focus-spell-row__name` / `span.spell-chip__name` **sem role/handler/cursor** — inerte; não abre nada nem rola | `SpellsTab.svelte` — nome renderizado como texto puro, sem botão de detalhes | **B4** | **P0** |
| 11 | **Alchemist Dedication — grants** | Chips de cadeado aninhados: **Alchemical Crafting** (feat) + **Quick Alchemy** (ação); upgrades crafting/weapon-prof | Nenhum chip de grant; nada materializado | GrantItem (uuid) dos REs do doc nunca executa no builder (gap conhecido r12; grants fixos fora do `mechanics.json`) | **B2** | **P0** |
| 12 | **Entry fantasma "arcane Spells"** | Uma única entry arcana ("Magias Arcanas") | 2ª entry arcana preparada **vazia** ("arcane Spells", minúscula): "Nenhuma magia no grimório ainda" | Dado no mundo (entry duplicada, provável artefato pré-r11). Não achei origem em código do importer/derivations | NOVO (dado) | **P1** |
| 13 | **Shooting Star / Estrela Cadente na Foco** | Se vier de Starlit Span, materializar automaticamente | Presente (adicionado manualmente), OK; porém `location: undefined` em TODOS os spells | Starlit Span **não** concede a magia (REs vazios). Automação de foco é B2 apenas se algum granter declarar; senão é comportamento manual esperado | B2 (verificar granter) | **P2** |
| 14 | **Barra "CD ALQUIMISTA 19"** | Confirmar valor esperado (plano supôs 16) | Mostra **19**; aparece em TODAS as entries (inclusive fantasma) | `archetype-dc-bar` calcula DC = 10 + (nível+rank Trained) + INT = 10+5+4 = **19** (matematicamente correto p/ prof incluindo nível). "16" do plano = fórmula sem nível | NOVO (validar spec) | **P2** |
| 15 | **Chat — rótulos das rolagens em EN** | pt-BR (Salvaguarda de Fortitude, Dano, Ataque de Magia) | "Fortitude Save", "Damage", "Spell Attack (Magias Arcanas)", "MAP", "Will Save", "Reflex Save", "Acrobatics" | Rótulos de roll construídos em EN (redaction/roll formatting no client ou server) | NOVO | **P2** |
| 16 | **Aba Feats — níveis errados** | (aba será REMOVIDA) — mas registra: usa `system.level` do feat, não o slot de aquisição | Bon Mot "Lvl 1" (era L2), Magus's Analysis "Lvl 1" (era L2), Fleet "Lvl 1" (era L3) | aba Feats deriva nível do item, não do build.choices | B1 (remoção) | **P2** |

---

## 4. Verificações que PASSARAM (já 100%)

- **Rolagens clicáveis** — saves (Fortitude/Reflex/Will), strikes com MAP 0/1/2, dano
  (Funda 1d6, Mordida 1d4-1), **spell attack** (botão `spells-stat--rollable`), e
  **perícias** (`skill-row__rollable`): todas geram card no chat com breakdown.
- **Tradução de ações do compêndio** (actions-core): pt-BR principal + EN subtítulo
  já funciona ("Administrar Primeiros Socorros / Administer First Aid", "Cascata Arcana
  / Arcane Cascade", "Auxiliar / Aid"...). O padrão a replicar para feats.
- **Tradução de magias** (spells-core): truques e preparadas em pt-BR (Ignição, Escudo,
  Golpe Certeiro, Esfera de Trovão do Horizonte, Raio Incandescente); Estrela Cadente na
  Foco. `buildSpellNameTranslator` (SpellsTab/characterSheetVM) é o modelo do B1.
- **Rótulos ABC de tipo** no Plano: pt-BR (ANCESTRALIDADE, LINHAGEM, ANTECEDENTE, CLASSE)
  e "NÍVEL N" — corretos (só os nomes ABC ficam EN, ver #1).
- **PlanDetailsDialog — corpo/descrição**: já vem em pt-BR (resolve o doc do pack por
  nome). Só o título está EN (#3).
- **Números derivados**: HP 19/36, CA 19, Perception +5, saves +9/+8/+7, atributos
  STR 8/DEX 16/CON 14/INT 18/WIS 10/CHA 12, CD magia 19, ataque +9, perícias (Crafting
  +13 Master). Hero Points (1/3) e Focus (1/1) presentes na ficha.
- **Chips de cadeado de features do Magus**: "Arcane Spellcasting (Magus)", "Arcane
  Cascade", "Spellstrike", "Conflux Spells" — aparecem como 🔒 (features futuras).
- **Cobertura da aba Feats pelo Plano**: tudo que a aba Feats lista (ABC + Bon Mot,
  Basic Concoction, Alchemist Dedication, Magus's Analysis, Fleet, Rat Familiar) está
  no Plano → **nada se perde** ao remover a aba Feats.

---

## 5. Notas técnicas para os prompts dos batches

### B1 (pt-BR em todo lugar + grid de boosts + remoção aba Feats)

- **Fato central**: `system.slug` é `undefined` em **todos** os items embutidos **e nos
  próprios docs de pack** (confirmado em feats-core/class-features-core/spells-core). O
  dedupe/join por slug NUNCA casa para conteúdo importado. O join confiável disponível é
  **`flags.fusion.sourceId`** (id original do Foundry, presente tanto no item embutido
  quanto no doc de pack) e, como fallback, **nome normalizado** (accent/case-insensitive,
  padrão do `buildSpellNameTranslator`).
- **Tradutor de nomes de conteúdo no Plano**: indexar feats-core / class-features-core /
  ancestries-core / heritages-core / backgrounds-core / spells-core por `sourceId`→`{namePt,
  nameEn}` (via i18n.pt-BR entries), cache on-demand como o de spells. Aplicar em `planVM.ts`
  ao montar o `name` dos slots ABC e de feats/features. Passar pt-BR como `name` e EN como
  novo prop de subtítulo para `PlanSlot.svelte` (que hoje só recebe/exibe `{name}`).
- **`SLOT_TYPE_LABELS`** (`planVM.ts:420-431`) — traduzir para pt-BR + manter EN de
  subtítulo. Sugestão: Ability Boosts→Aumentos de Atributo, Class Feat→Talento de Classe,
  Skill Feat→Talento de Perícia, Archetype Feat→Talento de Arquétipo, General Feat→Talento
  Geral, Ancestry Feat→Talento de Ancestralidade, Hybrid Study→Estudo Híbrido, Skill
  Training→Treino de Perícia, Skill Increase→Aumento de Perícia.
- **PlanDetailsDialog** (`:112`): usar o `namePt` do entry resolvido por
  `findEntryUuidByName` (já disponível no dialog) como título principal + `request.name`
  (EN) como subtítulo.
- **Aba Actions** (`actionsVM.ts`): estender a fonte de tradução além de `actions-core`.
  Ao mesclar rows embutidas cujo `slug`/nome não casa com actions-core, resolver
  `namePt` **e** `fallbackUuid` a partir de **feats-core** (join por `flags.fusion.sourceId`
  do item embutido, ou nome normalizado). Isso conserta simultaneamente o nome (#4) e a
  descrição EN do painel (#5). Ver `loadActionEntries:768-780` (hoje só actions-core).
- **Grid de boosts** (#6): o VM já tem o build; líquido real do Tobias (nível 3) =
  **FOR -1, DES +3, CON +2, INT +4, SAB +0, CAR +1** (bate com os modifiers da ficha).
  Renderizar grid 3×2 no slot preenchido em vez da string de boosts crua.
- **Remoção aba Feats**: seguro — Plano cobre 100% (ver §4). A aba mostra níveis errados
  (usa `system.level`, não o slot), mais uma razão para removê-la.

### B4 (magia clicável na aba Spells)

- Nome da magia hoje é **inerte**: `div.focus-spell-row__name` (foco) e
  `span.spell-chip__name` (truques/preparadas/grimório) — sem `role`, `tabindex`,
  `cursor:pointer` ou handler. **Clicar não dispara rolagem** (não há risco de conflito
  com rolagem de ataque — não existe). Basta tornar o nome um botão que abre o
  DocumentDetailsPanel (doc do pack por nome/sourceId, cache; embutida sem par → descrição
  embutida; pt-BR preferido). Não colide com botões Lançar/Trocar/Preparar (separados).

### B2 (grants fixos automáticos)

- **Alchemist Dedication** deve materializar, ao aplicar no builder: GrantItem
  `Compendium.pf2e.feats-srd.Item.Alchemical Crafting` (feat → chip de cadeado aninhado)
  e `Compendium.pf2e.actionspf2e.Item.Quick Alchemy` (ação). UUIDs vêm dos `system.rules`
  do doc feats-core (sourceId `CJMkxlxHiHZQYDCz`), campo `unconvertedRules` no item
  embutido preserva os mesmos REs (`SpecialResource` versatile-vials, `CraftingAbility`
  quick-alchemy) — mas os GRANTS (uuid) estão só no doc do pack.
- **Shooting Star**: **NÃO** é concedida por Starlit Span (REs vazios no doc). Se o
  usuário espera automação, o granter tem de ser outro (verificar se alguma feature do
  Magus/hybrid study declara o UUID). Hoje está na Foco por adição manual — aceitável.
- Todos os spells embutidos têm `location: undefined`; a entry de Foco associa por trait
  `focus`. As preparadas aparecem por patamar mesmo sem `location` — o VM infere a entry.

### Limpeza de dado (fora de batch de código)

- Entry **"arcane Spells"** (id `sAbd2jdXSJVrTtkX`) é uma duplicata vazia de "Magias
  Arcanas" (id `BNyJ0gsmNlULtcai`). Não encontrei origem em código — é dado do mundo. Opções:
  dedupe defensivo no VM (esconder entries arcanas prepared vazias sem magias/grimório) ou
  orientar o usuário a removê-la. Como o mundo é do usuário, **não** alterei o dado.

---

### Anexos de dados (para os implementadores)

- **sourceIds** (join key, `flags.fusion.sourceId`): Magus's Analysis `0yPbPVEESwB6Bdfw` ·
  Bon Mot `0GF2j54roPFIDmXf` · Alchemist Dedication `CJMkxlxHiHZQYDCz` · Basic Concoction
  `h5ZT9i79BFVJ0VfE` · Starlit Span `Pew7duAozEeAemif` · Rat Familiar `W2LmEXJH75tyeCSn` ·
  Fleet `Ux73dmoF8KnavyUD` · Shooting Star `nVfP43Xbs6I1PO8v`.
- **Spellcasting entries**: Magias Arcanas `BNyJ0gsmNlULtcai` (arcane/prepared) · arcane
  Spells `sAbd2jdXSJVrTtkX` (FANTASMA, arcane/prepared, vazia) · Focus Spells
  `BBh1OYFXx33dm2Sh` (isFocusPool:true).
- **Não verificável ao vivo**: familiar/pet (sem UI — B5 é pesquisa); efeito numérico dos
  REs de Rat Familiar (+2 familiar abilities) e Fleet (+5 speed) não checados contra a
  ficha nesta passada.
