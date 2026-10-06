# Revisão adversarial — O2 (Conjuração): costura, CI, segurança, UI e números do livro

Revisor: lente COSTURA + CI + SEGURANÇA + UI. Somente leitura. Fonte do livro: texto das features
no vendor Foundry pf2e (`tools/importer-pf2e/vendor/pf2e/packs/pf2e/class-features/*.json` e
`static/lang/re-en.json`, `PF2E.SpecificRule.ClassFeatures.SpellRepertoire.*`), cruzado com
`systems/pf2e/packs/classes-core/documents.json`.

## Veredito

**NÃO PODE MERGEAR.** 1 bloqueante e 7 importantes. Costura, CI e higiene estão limpos; o problema
está no comportamento em produção e nos números do livro.

## O que está limpo (verificado)

- Pin: core `ficha3/o2` = `2a8013e3` aponta o submodule para `37df631` = HEAD do satélite `ficha3/o2`.
- Diff do core: só 3 arquivos (pin + 5 chaves i18n em en/pt-BR). As 9 chaves usadas pela UI nova
  existem nas duas línguas. Sem lockfile, data-dir, auth_secret, node_modules, vendor, out/, junction,
  binário ou .env no diff.
- CI verde nos dois repos para os 3 pushes (satélite: `Test sheets/pf2e` 1457 passed, 31 skipped
  (pregen sem vendor); `Test systems/*` 22 arquivos pf2e passaram — os testes novos rodam no CI).
- Segurança: os ops novos são `doc:update` de item embutido do próprio ator (mesmo caminho de
  `prepareSpell`). Nenhum predicado de visibilidade novo, nenhuma redação fora de `net/redaction.ts`.
  O teto do repertório só existe no client, mas o dono já pode editar a própria ficha livremente,
  então isso não abre um vetor novo.

## Achados

### B1 — BLOQUEANTE: o pool de foco (T2.5) não chega à ficha numa sessão ao vivo
- `systems/pf2e/src/derivations/build.ts:714-726` (`stepCharFocusClamp`) escreve em
  `system.resources.focusPoints.max`, que fica **fora** de `system.derived`.
- `packages/server/src/documents/derive.ts:120-125`: `recomputeDerivedIfNeeded` persiste só
  `{ system: { derived: derivedPatch } }`, e o broadcast (`doc-handlers.ts:1607-1612`) manda o
  documento persistido inteiro. O contrato está escrito em `net/derive-runner.ts:29-46`: "only
  `doc.system.derived` is ever read back out".
- `characterSheetVM.ts:920-923` lê `system.resources.focusPoints`, não `derived`.
- Cenário: numa sessão aberta, o Mestre cria um Bardo (a `applyClass` cria a entrada `isFocusPool`).
  O broadcast chega com `focusPoints.max = 0` e a ficha não mostra os pips de foco. Depois de um F5,
  o snapshot de entrada (`sync-handlers.ts:439`, que devolve o clone derivado) mostra `max = 1`. A
  próxima atualização qualquer do ator (HP, por exemplo) rebroadcasta o documento persistido e o valor
  volta a 0. O `restAll` (`characterSheetVM.ts:3034`) compara com o `max` que ele recebeu, então num
  mundo recém-carregado ele às vezes enche o foco e às vezes não. O item "foco em 1" do gate falha em
  produção. O teste unitário da derivação passa porque roda sobre o objeto em memória.
- Correção: expor o valor como `system.derived.focusPoints` e fazer a VM ler de lá, **ou**
  persistir `max` num op explícito do `planVM` no momento em que concede o pool (que é o mesmo lugar
  sugerido pela issue #111 para o `value`).

### I1 — IMPORTANTE: o Descansar não recupera os espaços das entradas espontâneas novas
- `characterSheetVM.ts` `restAll` (cerca da linha 2990) pula toda entrada sem array `prepared`
  (`if (!Array.isArray(rawPrepared) || rawPrepared.length === 0) continue;`). A T2.1 mudou as
  espontâneas para `{value, max, spellsKnown}`, que gastam por contador (`expendKnownSlot`).
- Cenário: um Bardo nível 1 lança as 2 magias de 1º círculo (`value` vai a 0) e clica em
  "Descansar". A ficha continua em 0/2, porque nenhum op mexe em `slots.1.value`. Isso é uma
  regressão: antes da onda, a espontânea tinha `prepared` e o descanso limpava `expended`. Nenhum
  teste cobre descanso com entrada espontânea.

### I2 — IMPORTANTE: personagem espontâneo criado antes da O2 perde a vista das magias
- `SpellsTab.svelte`: quando `entry.prepared === "spontaneous"`, cada círculo mostra só
  `knownSpellsAt` (que filtra por `spellsKnown`), e a seção Grimório foi para o ramo `{:else}`.
  Nenhuma migration preenche `spellsKnown`.
- Cenário: um Bardo, Feiticeiro, Oráculo ou Psíquico já salvo no mundo (entrada com `prepared`
  antigo e magias embutidas) abre a ficha. Os círculos 1+ mostram "Nenhuma magia conhecida". As
  magias continuam embutidas, mas não aparecem e não dá para removê-las pela UI. Readicionar a mesma
  magia cria um item duplicado. Além disso, o `syncSlotMaxOp` do primeiro level-up sobrescreve o
  círculo com `spellsKnown: []` e apaga o `prepared` legado.

### I3 — IMPORTANTE: o teto do repertório está errado pelo livro, e o DEC-T2.1-01 diz o contrário do que o livro diz
- `SpellsTab.svelte` `knownCap` = `slot.max`. A nota em `characterSheetVM.ts` (DEC-T2.1-01) afirma
  que Bard e Psychic batem certo e que Sorcerer e Oracle ficam acima do livro.
- O livro (`re-en.json`, SpellRepertoire):
  - Sorcerer: "two 1st-rank spells ... as well as an additional spell ... from your bloodline" = 3,
    igual aos 3 espaços. **Certo.**
  - Oracle: "three 1st-rank divine spells" = 3 espaços. **Certo.**
  - Bard: 2 + a magia que a musa "adds a spell to your repertoire" (`muses.json`) = **3 no nível 1**.
    O teto é 2.
  - Psychic: "one 1st-level spell" + "an additional 1st-level spell" da mente consciente = **2 no
    nível 1** (1 espaço). No nível 3 são 3 magias de 1º círculo (espaços: 2) e 2 de 2º (espaços: 1).
- Cenário: um Bardo Enigma nível 1 escolhe 2 magias e tenta adicionar a da musa (Sure Strike). O
  botão vira "Repertório completo". Um Psíquico nível 1 não consegue ter a magia da mente consciente
  junto com a que escolheu. A correção proposta no relatório da lane
  (`SPONTANEOUS_REPERTOIRE_OVERRIDES` reduzindo Sorcerer e Oracle) quebraria as duas classes que
  estão certas. O "repertoire" é concedido por feature (musa, mente consciente) e deve ficar fora
  do teto: `slot.max` + concessões.

### I4 — IMPORTANTE: faltam pools de foco para Wizard, Druid, Witch, Psychic e Animist
- `planVM.ts:3676-3680` (`hasFocusFeature`) só reconhece features de nível 1 cujo nome termina em
  `" Spells"`. No pack, as features de nível 1 dessas cinco classes são "Arcane School", "Druidic
  Order", "Hexes", "Psi Cantrips and Amps" e "Apparition Attunement".
- O livro: `druidic-order.json` diz "you start with a focus pool of 1 Focus Point"; `hex-spells.json`
  também, com 1; `psi-cantrips-and-amps.json` diz "You start with a focus pool of **2** Focus
  Points"; a Witch aprende Patron's Puppet ou Phase Familiar. O plano (plano.md:147, "features que
  concedem magia focal", e o "Destrava" da O2 em tasks.md:81) conta com essas classes.
- Cenário: um Druida, Bruxa ou Psíquico nível 1-3 fica com foco 0/0. O Psíquico não consegue
  amplificar nenhum psi cantrip, e o Druida não consegue lançar a magia de ordem.

### I5 — IMPORTANTE: o Wizard está sem o espaço e o truque de currículo (e o teste novo trava o erro)
- `wizard-spellcasting.json`: "two 1st-rank spells and five cantrips ... **as well as one extra
  curriculum cantrip and one extra curriculum spell of each rank**". O pack tem 5 truques e 2/3/3+2.
  Não existe `curriculum` em `systems/pf2e/src` nem em `sheets/pf2e/src`.
- Cenário: um Wizard nível 1 recebe 2 espaços de 1º círculo e 5 truques, quando o livro dá 3 e 6. No
  nível 3 recebe 3+2, quando o livro dá 4+3. O teste novo do Wizard em `planVM.test.ts` crava 2/3/3+2
  como "regra do PF2e Remaster", e ele é circular com o pack (é a lição da #48). A premissa da T2.3,
  "slots corretos nos níveis 1-3", é falsa para o Wizard.

### I6 — IMPORTANTE: metade espontânea do Animist inexistente
- `animist-apparition-spellcasting.json`: "At first level, you can cast two apparition cantrips and
  one 1st-rank apparition spell per day ... spell repertoire from your attuned apparitions". O pack
  modela só a metade preparada (1/2/2+1, 2 truques), e o mecanismo de repertório da T2.1 só dispara
  quando `spellcasting.type === "spontaneous"`. O comentário do schema cita "the spontaneous half of
  Animist", mas nada cria essa entrada.
- Cenário: um Animista nível 1 tem 1 espaço e 2 truques, quando o livro dá 1+1 espaços e 2+2 truques
  e um repertório de aparição. O plano (plano.md:73) lista o Animist entre as classes travadas pelo
  repertório. Se isso for ficar para a T4.2, falta registrar como issue.

### I7 — IMPORTANTE: não dá para adicionar ao repertório uma versão em círculo acima de uma magia de círculo baixo
- `SpellPickerDialog.svelte` (filtro `minRank`) e `SpellsTab` (`minRank === maxRank === rank`) só
  deixam escolher magias cujo `system.level` nativo é igual ao círculo.
- O livro (Bard, Oracle, Sorcerer, Psychic, PartTwo): "you might add a higher-rank version of a spell
  you already have".
- Cenário: um Feiticeiro nível 3 quer Force Barrage no círculo 2. A magia não aparece no seletor do
  círculo 2, porque o nível nativo dela é 1.

### M1 — MENOR: a pendência DEC-T2.1-01 não virou issue, e o conteúdo proposto está errado
- O gate diz que as issues são só #111 e #59. A busca por "DEC-T2.1-01" e por "repertorio" no
  satélite não acha nada. Isso contraria a regra de que toda pendência vira issue registrada. O texto
  que a lane propôs mandaria "corrigir" Sorcerer e Oracle para baixo (ver I3).

### M2 — MENOR: UI nova sem a lente protótipo, sem prints e sem smoke como GM e como player (PROCESSO-UI.md)
- As duas lanes de UI declaram que isso fica para o fecho da onda. O bloqueante B1 e os importantes
  I1 e I2 só aparecem numa ficha real (depois de reload, depois de descansar, num mundo com
  personagem antigo), e é justamente o que o roteiro tutorial-e2e pegaria. O PR da onda não pode
  sair sem isso.

## Números conferidos (níveis 1-3, espaços por círculo e truques)

| Classe | Pack | Livro | Situação |
|---|---|---|---|
| Bard | 2 / 3 / 3+2, 5 truques | igual; repertório +1 da musa | espaços certos, teto do repertório errado (I3), foco sofre com B1 |
| Sorcerer | 3 / 4 / 4+3, 5 | igual; repertório = espaços (a magia de linhagem já está incluída) | certo (a nota da lane está errada) |
| Oracle | 3 / 4 / 4+3, 5 | igual; repertório 3 | certo |
| Psychic | 1 / 2 / 2+1, 3 | igual; repertório +1 por círculo da mente consciente; foco 2 | teto errado (I3), foco ausente (I4) |
| Animist | 1 / 2 / 2+1, 2 | + metade espontânea de aparição; foco 1 | I6, I4 |
| Wizard | 2 / 3 / 3+2, 5 | +1 espaço de currículo por círculo, +1 truque | I5, I4 |
| Cleric | 2 / 3 / 3+2, 5 | igual + Divine Font com 4 espaços (já existe `stepCharDivineFontExtraCastings`) | espaços certos; o foco depende da onda 4 |
| Druid | 2 / 3 / 3+2, 5 | igual; foco 1 (ordem) | foco ausente (I4) |
| Witch | 2 / 3 / 3+2, 5 | igual; foco 1 (hex) | a entrada agora é criada (conserto do patrono, certo); foco ausente (I4) |
| Magus | 1 / 2 / 2+1, 5 | igual; foco com Conflux | espaços certos, foco sofre com B1 |

Proficiência (T2.4): as primeiras linhas `stat: "spellcasting"` chegam no nível 7 (Cleric: nenhuma
no pack), então tudo fica treinado nos níveis 1-3. Isso bate com o livro. O mecanismo está certo, e
o resultado dele cai em `system.derived.spellcasting`, então é persistido, ao contrário do B1.
