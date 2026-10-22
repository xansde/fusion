# Revisão adversarial da O6 — julgamento

Veredito: **REPROVADA** (2 bloqueantes, 5 importantes, 2 menores; 0 refutados — 24 achados das lentes deduplicados em 9).

Verificação do juiz: li build-validation.ts, doc-handlers.ts (create 870-980, update 1150-1170), planVM.ts (chooseFeat 4400, boosts 5225-5300, levelSet 5574), updateScheduler.ts e a spec 05. Rodei o validador compilado (dist) sobre uma cópia do world.db do teste_xande e sobre docs sintéticos no formato real do planVM: `scratchpad/judge-o6/probe.mjs`.
- Os atores reais (uPI3…, MVZPT…) passam hoje. Nenhum dos dois tem levelledBoosts.
- Um doc com `levelledBoosts{"1":[4 slugs]}` gera **BOOST_LEVEL_NOT_MILESTONE**.
- Uma descida 3→2 com choice generalFeat-3 gera **CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL**.
- Um talento de nível 20 embutido com flags.fusion.build classFeat-2 e choice sem itemId dá **ok:true**.
- `system.build: null` dá **ok:true**.
- Uma dedicação em classFeat-4 e um talento de perícia em generalFeat-3 com itemId geram **FEAT_SLOT_MISMATCH** ×2.
- updateScheduler: `SendOp` devolve void, então o commitNow manda todas as ops sem esperar o ack.
- O create em lote não tem transação.

## Confirmados

| id | sev | título | dono | conserto |
|---|---|---|---|---|
| C1 | bloqueante | O validador recusa `levelledBoosts["1"]` (os 4 aumentos livres do nível 1 que o builder grava) e congela todo update do ator | fusion-systems-2e `systems/pf2e/src/build-validation.ts:257` | Aceitar os marcos 1/5/10/15/20. Testar com o formato gravado pelo planVM (5296), não com "2". |
| C2 | bloqueante | Descer de nível: o update do nível é recusado e as ops seguintes (delete de classFeature:N, syncSlotMax) passam, o que deixa a ficha corrompida | `build-validation.ts:174,266` + `planVM.ts:5574` levelSet | Não tratar como ilegal uma choice ou um boost acima do nível (a derivação filtra de propósito, build.ts:167), ou podar no mesmo diff do levelSet. Teste: levelSet → validador. |
| C3 | importante | Validar o documento inteiro a cada update trava o ator que já está ilegal (legado, ou edição pela porta embutida), inclusive para o GM | core `packages/server/src/net/handlers/doc-handlers.ts:1162` | Recusar só as issues que o diff introduz, comparando validate(existing) com validate(merged). |
| C4 | importante | A checagem talento×slot/nível da T6.2 é inerte em produção: o chooseFeat não grava itemId, item ausente passa, o caminho embutido não valida e `build:null` desliga tudo | `build-validation.ts:133,182` + core doc-handlers (embedded create/update) | Resolver o talento pelo `flags.fusion.build.slot` dos itens embutidos, validar também no create/update embutido e recusar build nulo em character. Testes no formato real. |
| C5 | importante | O doc:create de character por PLAYER persiste `items[]` arbitrário sem validateEmbeddedItemForSystem | core `doc-handlers.ts:954-975` | Validar cada item com validateEmbeddedItemForSystem, ou recusar items[] para quem não é privilegiado. |
| C6 | importante | A exceção de create para o player não tem emissor no client, contradiz a emenda da spec 05 ("único endereço" = criação do usuário), não tem teto, e a T6.1 "pelo Hub" não foi entregue | core `doc-handlers.ts:876-893` + `specs/05-usuarios-e-permissoes.md` | Ou remover a exceção (a edição do próprio ator já funciona) e registrar a decisão, ou entregar o gatilho no Hub com emenda na spec e um limite. |
| C7 | importante (processo) | O smoke GM/player do gate não exercitou o builder (subir/descer nível, aumentos do nível 1), que é onde está a regressão da O6 | gate da O6 (`o6/gate.md`, evidência viva) | Refazer o smoke pelo builder como player e como GM depois de C1/C2. |
| C8 | menor | Uma recusa de build no meio de um lote de create deixa os itens anteriores gravados, sem broadcast | core `doc-handlers.ts:966-970` | Validar o build de todos os itens num pre-flight antes do loop de store.create. |
| C9 | menor | FEAT_SLOT_MISMATCH recusa um talento de perícia em slot geral (RAW) e uma dedicação em slot de classe. Hoje está dormente (C4) e espelha o client | `build-validation.ts:219-232` (+ isFeatEligible) | generalFeat aceitar category skill. Para a dedicação em slot de classe, seguir a decisão de produto já registrada, sem torná-la mais dura no servidor. |

Deduplicação:
- C1: costura-B1.
- C2: regra-B1, dado-A1, testes-B1, costura-B2.
- C3: regra-I1, dado-A2.
- C4: regra-I2, dado-A3, dado-A6, testes-I1, costura-I1.
- C5: regra-I3 (parte), dado-A5, costura-I2.
- C6: regra-I3 (parte), testes-I2, costura-I3.
- C7: regra-I4, costura-I3 (parte do smoke).
- C8: regra-M1, testes-M1, costura-M1.
- C9: regra-M2, dado-A4. Rebaixado para menor porque hoje não dispara e o servidor espelha o client.

Evidência viva: todos os checks deram ok (create/edit próprio, PERMISSION_DENIED alheio, STALE_WRITE, 8 prints). Ela não cobriu o builder, e é daí que vem o C7.
