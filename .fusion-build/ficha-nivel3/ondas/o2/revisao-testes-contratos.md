# Revisão adversarial — o2 (Conjuração) — lente: teste não-circular + contratos

Escopo lido: `git diff origin/main...ficha3/o2` (satélite, 13 arquivos) e `git diff origin/alfa/app...ficha3/o2`
(core: pin + 5 chaves i18n em en/pt-BR). Relatórios das 3 lanes + gate. Plano em `docs/design/ficha-nivel3/`.
Fonte "livro" usada: o TEXTO das features no próprio pack (`class-features-core/documents.json`,
`system.description`) — é o texto do Player Core, e não o dado estruturado que o código consome, por isso
serve de oráculo não-circular. Nada foi editado; nenhuma suíte rodada (só leitura de código/pack e uma
consulta read-only ao `world.db` do teste_xande).

Veredito: **não mergear.** 2 bloqueantes, 5 importantes, 3 menores.

---

## B1 — BLOQUEANTE — T2.5 não chega à produção: o `focusPoints.max` derivado é jogado fora

- `systems/pf2e/src/derivations/build.ts:724` escreve `system.resources.focusPoints` (campo AUTORAL).
- Contrato do servidor: `packages/server/src/documents/derive.ts:123` persiste/transmite **só**
  `{ system: { derived: derivedPatch } }`; a derivação roda num `structuredClone` de `system` e todo o
  resto é descartado (docstring de `net/derive-runner.ts`: "only `doc.system.derived` is ever read back
  out and written to storage").
- A ficha lê o campo cru: `characterSheetVM.ts:920-923` (`this._system.resources.focusPoints`).
- **Cenário:** criar um Bard nv1 → `buildFocusEntryOp` cria a entrada `isFocusPool:true` → servidor roda
  a derivação, calcula max=1 no clone, persiste só `system.derived` → ficha mostra foco **0/0**; o
  "Descansar" (`restAll`) também não enche porque `max` é 0. O Vivo da onda ("Bard nv3 … foco = 1")
  falha.
- **Teste que esconde:** `derivations-build.test.ts:846+` chama `runCharacterPipeline(doc)` e lê o
  próprio objeto mutado — exercita a função pura, não o caminho real (create → recompute → persist →
  broadcast → VM). Os 6 casos novos passariam com o recurso quebrado em produção.
- Conserto: ou a derivação escreve em `system.derived.focusPoints` e a VM lê de lá (com fallback), ou o
  `max` é gravado como campo autoral pelo op do builder (junto com `value` — resolve a #111 de quebra).

## B2 — BLOQUEANTE — conjurador espontâneo perdeu o único caminho para adicionar truques

- `SpellsTab.svelte`: o bloco `{#if entry.prepared === "spontaneous"} … {:else}` (≈1009/1071–1191)
  passou a envolver também a seção "Grimório", cujo botão `openAddPicker(entry)` (1165) era o **único**
  gatilho para adicionar magia de qualquer círculo, inclusive truque (rank 0).
- A nova seção "conhecidas" itera `entry.slots.filter((s) => !s.isCantrip)` e o picker "known" trava
  `minRank = rank ≥ 1`. A seção de truques (983) só renderiza se já houver truque, e não tem botão.
  `planVM` não tem etapa de escolha de truque (só usa `cantripsKnown` para dimensionar o slot).
- **Cenário:** Bard/Sorcerer/Oracle/Psychic recém-criado → aba de magias → não existe botão para
  adicionar nenhum dos 5 (Psychic: 3) truques do livro. Antes da o2 dava (pelo Grimório). É regressão
  e bate direto no Vivo "Bard nv3 … repertório escolhido".
- Nenhum teste pega: não há teste de componente e o relatório da lane declara "sem efeito de UI em
  truques".

## I1 — IMPORTANTE — "Descansar" não recupera os usos do conjurador espontâneo

- `characterSheetVM.ts:3004`: `restAll` só olha `slots.<rank>.prepared`; se o array não existe
  (`continue`), ignora a entrada. A entrada espontânea agora grava `spellsKnown` + `value`, sem
  `prepared`.
- **Cenário:** Bard nv3 lança 3 magias de 1º círculo (`expendKnownSlot` → `value` 0) → clica Descansar →
  HP e foco voltam, o 1º círculo fica **0/3**; só volta clicando "Recuperar" 3 vezes, círculo a círculo.
- Nenhum teste novo de `restAll` com entrada espontânea (o bloco "restAll" existente só cobre `prepared`).

## I2 — IMPORTANTE — teto do repertório (`slot.max`) está errado para Bard e Psychic; a pendência aponta na direção oposta

Texto do livro no pack (`Spell Repertoire`, `Muses`, `Conscious Mind`):
- **Bard:** "At 1st level, you learn two 1st-rank spells" **+** "your 1st-level muse … adds a spell to your
  repertoire", e "If a feat or other ability adds a spell to your spell repertoire, it wouldn't give you
  another spell slot". Repertório de 1º círculo = 3 no nv1 (4 no nv2-3); `slot.max` = 2 (3).
- **Psychic:** "you learn one 1st-rank occult spell" **+** as magias concedidas pela mente consciente
  ("such as the spells you gain from your conscious mind, it wouldn't give you another spell slot").
  Ex.: The Distant Grasp concede Kinetic Ram no 1º. Repertório = 2; `slot.max` = 1.
- **Sorcerer:** "two 1st-rank spells … as well as an additional spell … from your bloodline" = 3 = slots;
  nv3: "a new spell from your bloodline and two other 2nd-rank spells" = 3 = slots. **Exato.**
- **Oracle:** "you learn three 1st-rank divine spells"; nv3 "three 2nd-rank spells" = slots. Exato.
- **Cenário:** Bard Maestro nv1 escolhe 2 magias → `KnownFull` aparece → não dá para registrar a magia da
  musa. Psychic Distant Grasp nv1 escolhe 1 → não dá para registrar Kinetic Ram.
- A pendência DEC-T2.1-01 (relatório T2.1-T2.2 e comentário em `characterSheetVM.ts:2768`) propõe
  `SPONTANEOUS_REPERTOIRE_OVERRIDES` **reduzindo** Sorcerer/Oracle — isso introduziria bug onde hoje está
  certo e deixaria Bard/Psychic errados. A decisão foi tomada "por recordação", com o texto do livro
  disponível no pack.
- O teste `planVM.test.ts:2276` rotula "(book: 2 known == 2 slots)" — afirmação falsa pelo próprio texto.

## I3 — IMPORTANTE — pool de foco ignora Witch, Druid, Animist e Psychic; teste novo cimenta o erro na Witch

- Detecção em `planVM.ts:3676` (`featuresByLevel` nv1 terminando em " Spells"). Texto do pack que
  concede pool no nv1: Bard, Sorcerer, Oracle, Magus, Champion, Summoner (1) — detectados — **e**
  `Hex Spells` (Witch, 1), `Druidic Order` (Druid, 1), `Animist & Apparition Spellcasting` (1),
  `Psi Cantrips and Amps` (Psychic, **2**), `Grave Spells` (Necromancer, **2**).
- A feature nv1 da Witch no `featuresByLevel` chama-se "Hexes", logo não casa. Druid/Animist/Psychic
  também não.
- `countFocusPoolEntries` conta 1 por entrada — Psychic/Necromancer precisariam de 2.
- **Cenário:** Druid nv1, Witch nv1, Animist nv1 → foco max 0 (mesmo depois de consertar B1). Psychic
  → 0 (ou 1), deveria 2.
- **Teste circular novo:** `planVM.test.ts:2629` "does NOT get a Focus Spells entry (… Patron grants no
  focus pool)" afirma o comportamento do código como regra; o livro diz que a Witch começa com pool 1.
  4 das 10 classes do escopo com o número errado.

## I4 — IMPORTANTE — Wizard: slots "do livro" nos testes são os do pack, e o pack está sem o slot de currículo

- `Wizard Spellcasting` (texto do pack): "prepare up to two 1st-rank spells and five cantrips … **as well
  as one extra curriculum cantrip and one extra curriculum spell of each rank** you can cast from your
  arcane school" (exceto Unified Magical Theory).
- `classes-core` Wizard: cantrips 5, slots 2 / 3 / 3+2 — sem o extra. Testes novos
  (`planVM.test.ts:2757+`, "level 3: … (book)") afirmam 5/2 e 3/2 lendo o doc real — circular: pack
  contra o pack, rotulado como livro.
- **Cenário:** Wizard (School of Battle Magic) nv1 → ficha oferece 5 truques e 2 slots; o livro dá 6 e 3
  (nv3: 4 no 1º, 3 no 2º). O Vivo da onda é justamente "Wizard nv3 (preparado, lista do dia)".
- A lane T2.3 declarou que o motor e os slots estavam "corretos nos níveis 1-3" (premissa do
  `tasks.md`) sem conferir contra o texto.

## I5 — IMPORTANTE — gate mecânico da onda não cumprido: 6 das 10 classes sem teste de slots/conhecidas

- `execucao.md` (gate Mecânico da onda 2): "teste de slots/conhecidas por círculo nos níveis 1-3 para as
  10 classes conjuradoras".
- Coberto: Bard (espontâneo), Wizard, Witch, Magus (preparado). **Sem teste:** Sorcerer, Oracle, Psychic
  (espontâneos — onde o teto é diferente, ver I2), Animist, Cleric, Druid. A lane T2.3 dispensou
  Cleric/Druid como "redundantes".
- **Cenário:** justamente Psychic (1 slot vs 2 conhecidas) e Druid/Animist (foco) estão errados e
  nenhum teste os toca. Um teste por classe com número do texto do livro pegaria I2/I3/I4.

## M1 — MENOR — picker "known" trava o círculo exato e impede a versão elevada, que a regra permite

- `SpellPickerDialog.svelte:216` (`rankOf(e) >= minRank`) + `knownSpellsAt` agrupa por `system.level` do
  item. Livro (Spell Repertoire): "When you add spells, you might add a higher-rank version of a spell
  you already have".
- **Cenário:** Bard nv3 quer Soothe (1º) no repertório de 2º círculo → o picker não lista magias de 1º; e
  mesmo que o id entrasse em `spellsKnown["2"]`, a lista do 2º não renderizaria (o item tem nível 1).
  Magias de assinatura (nv3 para Bard/Sorcerer/Oracle) também ausentes. Issue.

## M2 — MENOR — Cleric sem Divine Font (4 slots extras de heal/harm no círculo mais alto)

- `Divine Font` (texto do pack): "You gain 4 additional spell slots each day at your highest rank".
  `classes-core` Cleric: 2 / 3 / 3+2 sem o extra. O gate do `tasks.md` é "Cleric nv3 com os slots
  corretos". Depende da divindade (onda 4), por isso menor. Issue.

## M3 — MENOR — entradas espontâneas antigas sem migração

- Entrada espontânea criada antes da o2 tem `prepared: [...]` e nenhum `spellsKnown`. Com B2/o novo
  ramo, as magias de círculo ≥1 já embutidas ficam invisíveis (Grimório escondido, "conhecidas" vazio) e
  não contam no teto.
- Consulta read-only ao `~/.fusion/worlds/teste_xande/world.db`: único ator espontâneo (Tobias) tem 0
  magias, então hoje não há dado perdido. Vira problema no primeiro mundo com magia já escolhida. Issue.

---

## Conferido e sem achado

- **T2.4** (`spellcasting.ts`): escreve em `system.derived.spellcasting` (persistido); a VM lê
  `derivedEntry.rank` (`characterSheetVM.ts` ~1450). Upgrades de `stat: "spellcasting"` no pack: nv7
  para Bard/Cleric/Wizard/Druid/Witch/Sorcerer/Oracle/Psychic/Animist, nv9 para Magus/Summoner — bate com
  o livro, e no nv1-3 nada muda. O teste usa fixture sintética, mas o consumidor está no caminho real.
- **Schema** `SpellSlotSchema.spellsKnown` opcional: não quebra os docs antigos nem o
  `DocUpdatePayloadSchema` do servidor (validado nos testes novos). SF2e tem schema próprio e não é
  afetado. As chaves i18n usadas pela UI nova existem em en e pt-BR.
- **Slots pack × livro** para Bard (2/3/3+2, 5 truques), Sorcerer e Oracle (3/4/4+3, 5), Psychic
  (1/2/2+1, 3), Magus (1/2/2+1), Druid e Witch (2/3/3+2, 5): conferem. Divergem: Wizard (I4), Cleric
  (M2), Animist (só a metade preparada existe; a metade de aparições não tem entrada — fica com a T4.2).
- **Witch/patron** (`chooseClassChoice`): o gatilho `patron` está certo e é data-driven.
- **Foco `value` 0/1** (issue #111): o `restAll` enche até o `max`, então some depois de consertar o B1.
