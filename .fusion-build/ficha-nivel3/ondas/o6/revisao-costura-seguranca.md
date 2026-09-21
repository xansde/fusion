# Revisão adversarial — O6 (costura + CI + segurança + UI)

Diffs revisados: core `origin/alfa/app...ficha3/o6` (93639fa4) e satélite `origin/main...ficha3/o6` (18c6b7f).
Evidência executada: probe isolado contra o `dist` da própria worktree (servidor real via `boot()`, data-dir em `os.tmpdir()`, apagado ao final) — script salvo em `ficha3-reports/o6/revisao-costura-probe.mjs`. Nenhum arquivo da worktree editado.

Veredito: **NÃO MERGEAR.** 2 bloqueantes, 3 importantes.

## Saída do probe (servidor real)

```
1 GM create char with levelledBoosts[1]: VALIDATION_FAILED BOOST_LEVEL_NOT_MILESTONE levelledBoosts["1"]
2 player create: ok
3 player sets level-1 boosts (real builder shape): VALIDATION_FAILED BOOST_LEVEL_NOT_MILESTONE
4 player create with forged items[]: ok  items = ["definitelyNotAType:Bogus","feat:L20"]
5 player batch [legal, illegal]: VALIDATION_FAILED  -> e mesmo assim "OK1" ficou persistido na tabela actors
```

## B1 — BLOQUEANTE: o validador recusa os 4 aumentos de nível 1, e com isso trava toda ficha montada pelo builder

- Arquivo: `external/fusion-systems-2e/systems/pf2e/src/build-validation.ts:257` (+ chamado em `packages/server/src/net/handlers/doc-handlers.ts:1162` e `:969`).
- O builder grava os 4 aumentos livres do nível 1 em `levelledBoosts["1"]` (`planVM.ts:5237` lê `levelledBoosts["1"]`; `setAbilityBoosts` em `planVM.ts:5054-5060` grava `[String(level)]` com level=1; `derivations/build.ts:167` soma todo nível ≤ nível do personagem). O validador só aceita chaves múltiplas de 5 → `"1"` vira `BOOST_LEVEL_NOT_MILESTONE`.
- Cenário: jogador (ou Mestre) abre o builder, escolhe os 4 aumentos de nível 1 → `doc:update` recusado (probe 3). Pior: a checagem roda sobre o documento MESCLADO em TODO `doc:update` de Actor, para TODO papel. Qualquer personagem que já tenha `levelledBoosts["1"]` no mundo (todos os montados pelo builder, pregens incluídos) passa a ter QUALQUER edição recusada: XP, PV, nome, condições, até pelo Mestre (probe 1 mostra o mesmo corte no create do GM). É a ficha inteira congelada em produção.
- O teste do lane (`player-character-create.test.ts:399`) usa `"2"` como exemplo ilegal e nunca exercita o formato que o builder real escreve — os 10 testes verdes convivem com o defeito.

## B2 — BLOQUEANTE: descer de nível fica impossível, e a descida deixa a ficha pela metade

- Arquivo: `build-validation.ts:174` (`CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL`) e `BOOST_LEVEL_EXCEEDS_CHARACTER_LEVEL`.
- O modelo de dados mantém de propósito escolhas acima do nível atual: `planVM.levelSet` (`planVM.ts:5574-5620`) só troca `system.level.value` e apaga os grants de classFeature, sem mexer em `build.choices`/`levelledBoosts`, e a derivação filtra `level <= charLevel` (`derivations/build.ts:169`, `planVM.ts:4783`). Ou seja, "escolha acima do nível" é estado LEGAL depois de uma descida.
- Cenário: personagem nível 5 com talento de ancestralidade no 5, aumento de perícia no 3 e `levelledBoosts["5"]`; Mestre corrige para nível 3 (campo de nível da ficha → `updateLevel` → `levelSet`). O `doc:update` do nível é recusado (conferido com o validador puro: 3 issues). Mas os `doc:delete` dos grants de classFeature acima do 3, que são ops separadas, passam: a ficha fica nível 5 sem as features de nível 4-5. Corrompe o documento.
- Também o campo de nível dispara `updateLevelDraft` a cada tecla (`characterSheetVM.ts:2560`): digitar "10" a partir de 12 passa por "1", que agora é recusado e aparece como erro.

## I1 — IMPORTANTE: a checagem de talento×slot (o coração da T6.2) nunca roda em produção

- Arquivo: `build-validation.ts:167-189`.
- A checagem de categoria/nível só acontece quando a escolha tem `itemId`. O builder real NUNCA grava `itemId` em `build.choices`: `chooseFeat` (`planVM.ts:4416`) grava `{level, slot, type}` e liga o talento ao slot pelo `flags.fusion.build` do ITEM embutido, que entra pelo `doc:create` embutido (`chooseFeat`, `planVM.ts:4399-4404`), caminho que o validador não vê.
- Cenário: jogador manda `doc:create` embutido de um talento de classe nível 20 com `flags.fusion.build = {level: 1, slot: "classFeat-1"}` no próprio personagem nível 1 → aceito; o planVM mostra o slot preenchido. `FEAT_SLOT_MISMATCH`/`FEAT_LEVEL_EXCEEDS` só disparam no formato fabricado do teste (`player-character-create.test.ts:226`, com `itemId`). O que a T6.2 diz fechar continua aberto.

## I2 — IMPORTANTE: jogador cria personagem com `items[]` arbitrário, sem a validação de item embutido

- Arquivo: `doc-handlers.ts:954-975` (a exceção nova de create em `:876-893`).
- `validateEmbeddedItemForSystem` ("a única validação em TODA porta para `items[]`", `embedded-item.ts:55-66`) roda só no create/update embutido. O `doc:create` de Actor persiste o `items[]` do payload tal como veio. Antes da O6 só o GM (e o fluxo de familiar) chegava aqui. Agora qualquer PLAYER chega.
- Cenário (probe 4): PLAYER cria personagem com `items: [{type:"definitelyNotAType"}, {type:"feat", system:{level:20}, flags.fusion.build:{level:1,slot:"classFeat-1"}}]` → `ok:true`, os dois itens persistidos. Tipo de item fora do manifesto e `system` sem schema entram no mundo, e isso também contorna o I1.

## I3 — IMPORTANTE: não há gatilho na tela para o jogador criar personagem (T6.1 "pelo Hub" + gate PROCESSO-UI)

- Nenhum emissor no client manda `doc:create` de Actor `character`: `createNpc.ts:13-18` oferece só `npc`/`hazard` e diz textualmente "`character` is born with the player"; não há string i18n de "criar personagem"; o client não mudou nesta onda. O próprio relatório diz: "Nenhuma UI nova".
- Os prints `prints/01-gm-logado-hub.png` e `02-jogador-logado-hub.png` mostram só o login. Não existe smoke do jogador criando, que é o gate da onda (`tasks.md:160`).
- Cenário: jogador entra no mundo e não tem como criar o próprio personagem. A permissão nova no servidor fica inalcançável em produção, e a T6.1 foi cortada para "só servidor". Pela regra do projeto (componente sem gatilho não conta como entregue), falta pelo menos um botão de andaime `SCAFFOLDING` no Hub/Contatos, com o smoke GM + player.

## M1 — MENOR: create em lote recusado deixa itens anteriores gravados sem broadcast

- Arquivo: `doc-handlers.ts:969-970`: `return rejectionBuild` dentro do loop que já chamou `store.create` para os itens anteriores.
- Cenário (probe 5): lote `[OK1 legal, Bad2 ilegal]` → ack `VALIDATION_FAILED`, mas `OK1` ficou na tabela `actors`, sem broadcast. O servidor e os clientes divergem até o próximo resync, e o jogador reenvia e acaba com o personagem duplicado. O `doc:update` já tem pré-voo por esse motivo (`:1086-1092`). O create precisa validar todos os itens antes de gravar.

## Conferido sem achado

- Ownership forçada: `ownershipForCreator` substitui a do payload (`{default: 3}` forjado não vaza). NPC/hazard/loot continuam GM-only. Edição por outro jogador é negada.
- Não há predicado de redação duplicado: `isRolePrivileged`/`ownership.ts` são reusados, e a O6 não mexe em `redaction.ts`.
- Pin do submodule = `18c6b7f` (HEAD do satélite `ficha3/o6`). O lockfile não mudou (nenhuma dependência nova). `spec:report` não gerou diff.
- Higiene: o diff tem só 3 arquivos no core e 3 no satélite. Sem data-dir, `auth_secret`, `.env`, `node_modules`, `out/` ou binário. (`tools/importer-pf2e/` segue untracked e fora do diff.)
- T6.4: o STALE_WRITE do jogador depois da edição do GM está coberto, e a validação roda antes da checagem de versão sobre `existing` atual, sem janela nova.
- CI: os dois testes novos ficam dentro dos globs do vitest de cada repo e passaram no gate. Vão ficar verdes, e isso é justamente parte do problema: nenhum dos dois cobre o formato real do builder (B1/I1).
