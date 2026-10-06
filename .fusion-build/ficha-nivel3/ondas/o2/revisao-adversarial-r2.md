# O2 (Conjuração) — Revisão adversarial, rodada 2

Alvo: satélite `ficha3/o2` `31d80d0..f3d810d` (ce8e4ba C5, f3d810d C3) + core `35ebbae8` (repin).
Nada editado na worktree. Prova extra rodada FORA da árvore: `scratchpad/proof-o2r2/` (teste + config vitest).

Veredito: **REPROVADA** — 1 bloqueante novo (C3 fechou o sintoma, não o fluxo) + 1 importante (parte do conserto pedido não feita).

## Achados da rodada 1

### C3 — FECHADO (sintoma literal)
`filterSpellPicker` ganhou `cantripOnly` por traço (`characterSheetVM.ts:3195-3198`, `:3330-3331`);
`SpellsTab.svelte:80` + `:1323-1327` param de mandar `maxRank/minRank/initialRank=0` no picker de truque.
Teste sobre o índice real (69 truques; filtro antigo `[]`, novo 69) roda verde (`-t cantripOnly`).
Conferido no índice: níveis dos truques `{1:63, 2:2, 3:2, 5:1, 7:1}`; com tradição `occult` sobram 32 → picker do Bardo não fica vazio.
Mas ver N1: o truque escolhido some depois de aprendido.

### C5 — FECHADO
`repertoireBonusMap` modo `every-rank` para o Psychic (`planVM.ts:3679-3691`) + resync em `levelSet` (`:5822-5840`).
Os testes novos falham sem o conserto (código antigo devolvia só `{ "1": 1 }` → `repertoireBonus["2"]` undefined; e `levelSet` não emitia op). Verde agora (`-t Psychic`, 11 testes).
A regra está certa: Conscious Mind › Granted Spells ("2nd-rank spell at 3rd level") → teto 1+1=2 no círculo 2 no nv3. A pendência nº 2 do fix-r1 foi retirada corretamente.

## Achados novos

### N1 — BLOQUEANTE — truque aprendido pelo espontâneo fica invisível (vai para o balde do círculo 1)
- `spellcastingEntries` agrupa magias por `system.level` (`characterSheetVM.ts:1494-1515`) e a seção Truques lê só o balde de rank 0 (`SpellsTab.svelte:864-867` `cantrips()` → `slot.isCantrip` = `rank === 0`, `:1536`).
- O documento do pack mantém `system.level: 1` (Daze em `documents.json`: `level 1`, traço `cantrip`). `addSpellToEntry` copia o doc como está.
- Fluxo: Bardo nv1 → "Aprender truque" → escolhe Daze → `doc:create` com level 1 → `pendingKnown` rank 0 → `addKnownSpellToRank(…, 0, id, cap=5)` grava `slots.0.spellsKnown=[id]`.
  Resultado: a seção Truques continua vazia (balde 0 sem nada). Na seção de círculo 1 o feitiço também não aparece, porque `knownSpellsAt(entry, 1)` filtra por `spellsKnown[1]`. Sem botão Lançar e sem Remover.
  A guarda de duplicata (`knownSpellsAt(entry, 0)`) sempre volta vazia, então cada clique cria mais um item invisível até o teto.
- Prova executada (`scratchpad/proof-o2r2/cantrip.proof.test.ts`, VM real + Daze real do pack): `rank0 spells: []`, `rank1 spells: ['Daze']`, `rank1 known: []` → FALHA `expected [] to include 'Daze'`.
- Conserto: classificar como truque pelo TRAÇO também no agrupamento do VM (item com traço `cantrip` vai para o balde 0 e recebe `heightening` de truque). Teste com o doc real do pack.

### N2 — IMPORTANTE — o picker de círculo ≥1 do PREPARADO continua listando truques
- O conserto pedido era "excluir truques dos pickers de círculo ≥1". Só o modo `known` recebeu `cantripOnly=false` (`SpellsTab.svelte:1327`: `cantripOnly={pickerMode === "known" ? … : undefined}`).
- O modo `prepare` (`openPreparePicker`, `maxRank=initialRank=rank`) fica sem filtro de truque.
- Cenário: Mago nv1, espaço vazio de 1º círculo → "Buscar no compêndio" → o chip 1 vem pré-selecionado e lista os 63 truques de nível 1 (Daze, Detect Magic…) como magias de 1º círculo. Escolher um deles prepara um truque num espaço de círculo 1, o que é contra a regra.
- Conserto: passar `cantripOnly=false` também em `pickerMode==="prepare"`.

### N3 — MENOR — resync do `repertoireBonus` usa a 1ª classe para todas as entradas
- `levelSet` pega `className` de `findFirstItemByType(doc,"class")` e escreve o bônus em TODA entrada não-foco (`planVM.ts:5802`, `:5831-5839`).
- No multiclasse por níveis, Bardo(1ª)+Feiticeiro faria a entrada do Feiticeiro ganhar `{1:1}`, e Feiticeiro(1ª)+Psychic zeraria o bônus do Psychic.
- É o mesmo padrão que `syncSlotMaxOp` já tinha antes (herdado). Vale issue junto com a pendência nº 3 do fix-r1.

## Rodado
- `vitest planVM.test.ts characterSheetVM.test.ts -t "Psychic|cantripOnly"` → 16/16 verdes.
- Prova N1 (fora da árvore) → falha pelo motivo descrito.
- Suíte inteira não rodada (por instrução).
