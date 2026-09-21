# Revisão adversarial O6 — lente REGRA PF2e + CAMINHO DE PRODUÇÃO

Revisor: somente leitura. Core `ficha3/o6` (93639fa4) × `origin/alfa/app`; satélite `ficha3/o6` (18c6b7f) × `origin/main`.
Evidência executada: sonda `scratchpad/o6rev/probe.mjs` (validator do `dist` do satélite contra documentos no formato que o planVM grava) e `scratchpad/o6rev/val.mjs` (validator contra a cópia do `world.db` real de `teste_xande`: Novo Ator L3 e Tobias L5, ambos OK hoje). Nenhum arquivo do worktree foi alterado.

Veredito: **NÃO MERGEAR**. Um bloqueante: é regressão de produção, e baixar o nível passa a quebrar e corromper a ficha. Além disso, a validação de talentos da T6.2 não funciona em produção, porque os testes montam um formato de dado que o client nunca grava.

---

## B1 — BLOQUEANTE — Baixar o nível de um personagem montado é recusado pelo servidor, e o resto do lote corrompe a ficha

- Arquivos:
  - `packages/server/src/net/handlers/doc-handlers.ts:1162-1165`: a checagem roda no update, também para o GM.
  - `external/fusion-systems-2e/systems/pf2e/src/build-validation.ts:174`: `CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL`.
  - `build-validation.ts:266`: `BOOST_LEVEL_EXCEEDS_CHARACTER_LEVEL`.
- Causa:
  - `levelSet` (`sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:5577`) só grava `system.level.value` e `system.details.level`.
  - Ele não poda `system.build.choices` nem `levelledBoosts` acima do nível novo. Só poda os grants de class-feature.
  - O servidor agora valida o documento MERGEADO e recusa qualquer escolha com `level > nível`.
- Cenário: um personagem nível 3 com o plano preenchido. Todo nível 3 tem `generalFeat-3` e `skillIncrease-3`, e com Arquétipo Livre ligado também `archetypeFeat-2` e `classFeat-2`. O jogador (ou o GM) muda o nível para 2 e confirma (`handleLevelCommit` → `vm.updateLevel` → `levelSet`). Resultado:
  1. O `doc:update` do nível volta `VALIDATION_FAILED: Illegal character build — CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL ...`, e o nível fica 3.
  2. O `updateScheduler.flush` (`updateScheduler.ts`) envia as ops seguintes sem olhar o ack:
     - os `doc:delete` embutidos dos grants `classFeature:3:*` passam, porque o delete não passa pelo validator;
     - os `syncSlotMaxOp` (`documentType: "Item"`) cortam o `prepared` dos slots de magia para a tabela do nível 2.
  3. **A ficha fica em nível 3, sem as class-features de nível 3 e com os slots de magia de nível 2.** É a mesma perda que o fixer r3/r4 da O0 fechou (`characterSheetVM.ts:2540`), reaberta por outro caminho.
- Sonda:
  - `{level:1, choices:[classLevel-1@1, classLevel-2@2, skillFeat-2@2]}` → `CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL ×2`.
  - `{level:4, levelledBoosts:{"5":[...]}}` → `BOOST_LEVEL_EXCEEDS_CHARACTER_LEVEL`.
  - Tobias (mundo real, L5, com `classLevel-2@2`) não consegue mais descer para o nível 1.
- Antes da O6 a mesma operação funcionava: as escolhas acima do nível ficavam dormentes no plano.
- Conserto provável:
  - não tratar "escolha acima do nível" como ilegal (é o estado normal depois de descer de nível, e o planVM já ignora essas escolhas); ou
  - fazer o `levelSet` podar no mesmo diff.
  - Em qualquer dos dois casos, cobrir com um teste que desce de nível.

## I1 — IMPORTANTE — Validar o documento inteiro a cada update congela o ator que já está "ilegal", inclusive para o GM

- Arquivo: `doc-handlers.ts:1162-1165`.
  - A checagem roda para QUALQUER `doc:update` de Actor, toque ele ou não em `system.build` ou no nível, e para qualquer papel.
  - Ela não compara com o estado anterior, então não rejeita só o que o diff introduz.
- Cenário (mundo existente): um personagem que desceu de nível antes da O6, ou um documento legado com slot duplicado.
  - O `levelSet` nunca podou, então as escolhas acima do nível estão persistidas.
  - Slot duplicado: são as formas corrompidas das issues #15/#26 citadas no planVM.
  - Depois do deploy, **toda** edição da ficha é recusada com `VALIDATION_FAILED`: PV, nome, notas.
  - Até o `removeChoice` que tentaria limpar é recusado: ele remove um slot por vez, e o merge ainda carrega os outros.
  - O GM também é recusado. A única saída é subir o nível de volta, e ninguém sabe que é isso.
- A lane não rodou o validator contra mundos existentes. Rodei contra a cópia do `teste_xande` e hoje passa (Novo Ator e Tobias OK). Mas esse mundo quase não tem escolhas de talento, então o teste não prova nada para uma mesa em andamento.
- Conserto:
  - validar só quando o diff toca `system.build` ou `system.level`;
  - rejeitar só issue NOVA (`issues(merged) \ issues(existing)`).

## I2 — IMPORTANTE — A T6.2 não valida talento nenhum em produção: os testes são circulares

- Arquivos:
  - `build-validation.ts:182`: `itemId === undefined → return`.
  - `planVM.ts:4416`: `chooseFeat` grava `{ level, slot, type }` sem `itemId`. O vínculo escolha↔item vive em `item.flags.fusion.build {level, slot}`, que o validator não lê.
  - `build-validation.test.ts:108` e `player-character-create.test.ts:219-226`: os testes montam `choices[].itemId` à mão, um formato que o client nunca produz.
- Cenário: o jogador é dono de um personagem nível 2.
  1. Ele cria por `doc:create` embutido um talento de classe `level: 8` com `flags.fusion.build {level:2, slot:"classFeat-2"}`, ou uma dedicação no `classFeat-2`.
  2. Ele grava `choices:[{level:2, slot:"classFeat-2", type:"classFeat"}]`.
  3. O servidor aceita as duas ops. Sonda: `validateCharacterBuild` sobre esse documento → `{"ok":true,"issues":[]}`.
- O relatório da lane dá como fechados os invariantes de talento `FEAT_SLOT_MISMATCH` e `FEAT_LEVEL_EXCEEDS_CHARACTER_LEVEL`. Com dado real, eles nunca disparam. Só a parte de aumentos de atributo pega alguma coisa.
- Tem mais um bypass: `doc:update {"system.build": null}` apaga o bloco (null dentro de `system` é delete, `merge.ts`), e o validator vira no-op (`build-validation.ts:134`).
- É o antipadrão da #48: teste verde conferindo um formato inventado.
- Conserto:
  - achar o item pelo `flags.fusion.build.slot`, como o planVM faz (`getItemBuildFlag`);
  - validar também no caminho do embutido (`handleEmbeddedCreate`), que é por onde o talento de fato entra;
  - o teste de aceite precisa usar as ops geradas pelo `chooseFeat` real.

## I3 — IMPORTANTE — A exceção nova de `doc:create` deixa o jogador gravar `items[]` arbitrário, sem a validação de item embutido, e nenhuma tela usa esse caminho

- Arquivos:
  - `doc-handlers.ts:888-893`: a exceção.
  - `doc-handlers.ts:969`: o único gate de conteúdo no create.
  - `packages/server/src/documents/types.ts:90`: `items: z.array(z.record(...))`.
- Cenário: um PLAYER emite `doc:create` de Actor `{type:"character", items:[{type:"bogus"}, …]}`, ou, num mundo SF2e, um personagem com 10 augmentations.
  - O item é persistido sem passar por `validateEmbeddedItemForSystem` nem por `augmentationSlotLimitViolation`.
  - Pelo `doc:update`, o `rejectUnwritableField` recusa justamente isso ("verified by execution: a player ... replaced items with an entry of an unknown type").
  - O comentário em `doc-handlers.ts:1653` diz que só DOIS caminhos embutem Item num Actor. Este é um terceiro, sem gate.
  - Não há limite de quantidade: um jogador pode criar quantos personagens quiser.
- Sobra: o personagem do jogador já nasce com o usuário (`auth/service.ts:305-328`, REQ-USR-025), com ownership `{default:NONE, user:OWNER}` e `flags.fusion.playerId`.
  - O client não tem nenhum emissor de `doc:create` de Actor `character`: `NPC_CREATABLE_SUBTYPES = ["npc","hazard"]` (`createNpc.ts:62`).
  - Então a exceção nova é superfície de autoridade sem caminho de produto.
- Conserto, uma das duas:
  - remover a exceção. O T6.1 fica atendido pelo personagem que nasce com o usuário, mais o builder;
  - restringir o payload: sem `items`, ou cada item validado como no caminho do embutido.

## I4 — IMPORTANTE — O gate da onda ("smoke como GM e como player", PROCESSO-UI) não foi executado

- O `tasks.md`, na Onda 6, define: **Gate: smoke como GM e como player**.
- O `gate.md` só roda build, lint e test, e o relatório da lane diz "nenhuma UI nova".
- Cenário: um smoke como player no builder (subir nível, descer nível, trocar talento) teria mostrado o B1 na primeira descida de nível. Sem ele, a onda foi declarada verde com a regressão dentro.

## M1 — MENOR — Uma recusa no meio do lote de `doc:create` deixa os itens anteriores gravados e sem broadcast

- Arquivo: `doc-handlers.ts:966-970`.
  - A validação roda DENTRO do laço de escrita, depois que o `deps.store.create` do item anterior já rodou.
  - O update tem pre-flight justamente para evitar isso (comentário "earlier entries written, skip the broadcast").
- Cenário: o GM cria em lote `[personagem A legal, personagem B com levelledBoosts {"2":[…]}]`.
  - A é gravado e o ack volta erro.
  - Nenhum `doc:create` é transmitido, e os outros clientes só veem A no próximo resync.

## M2 — MENOR — O servidor passa a exigir duas restrições que não são RAW do remaster e que caem nos níveis 1-3 (hoje dormentes por causa do I2)

- Arquivo: `build-validation.ts:219-232`, espelho de `isFeatEligible`.
- `generalFeat` aceita só `category === "general"`.
  - Pelo Player Core, um slot de talento geral aceita talento de perícia: talento de perícia é um talento geral com o traço skill.
  - Cenário: um jogador nível 3 põe Assurance ou Recognize Spell no slot geral do nível 3, a escolha mais comum desse nível. Quando o I2 for consertado, o servidor passa a recusar.
- `classFeat` recusa qualquer talento com traço `archetype`.
  - Pelo RAW, talento de arquétipo, incluindo a dedicação, é pago com slot de talento de classe, mesmo com Arquétipo Livre ligado.
  - O plano aceitou esse comportamento no client (T5.2). Levar a regra para o servidor transforma uma lacuna conhecida do picker (`regra:dedicacao-nao-cabe-em-slot-de-classe`) em regra de autoridade.

## O que está certo (não é achado)

- A ownership forçada `{default:NONE, criador:OWNER}` via `ownershipForCreator` ignora a ownership do payload.
- Um terceiro não edita o personagem: o OWNER check do update já existia.
- NPC, hazard e loot continuam só para o GM.
- A redação do broadcast de Actor por usuário é pré-existente e não foi tocada.
- T6.4: o client já tem retry único em STALE_WRITE (`sendOp.ts:428`), e o teste da lane cobre o cenário GM × jogador corretamente.
- A regra dos aumentos de atributo bate com o remaster: só em nível múltiplo de 5, no máximo 4 por marco, sem repetir atributo, e 1 aumento de classe.
