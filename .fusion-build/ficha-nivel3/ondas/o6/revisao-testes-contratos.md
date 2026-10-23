# Revisão adversarial O6 — lente: teste não-circular + contratos

Diffs: core `origin/alfa/app...ficha3/o6` (93639fa4), satélite `origin/main...ficha3/o6` (18c6b7f).
Somente leitura. Evidência executada: validador (`systems/pf2e/dist/build-validation.js`) rodado
contra (a) cópia do `world.db` do mundo `teste_xande` e (b) documentos no formato que o
`planVM` realmente grava (scripts em `scratchpad/rev-o6db/check2.mjs` e `check3.mjs`).

Veredito: **NÃO MERGEAR** — 1 bloqueante, 2 importantes, 1 menor.

---

## B1 — BLOQUEANTE: baixar o nível passa a ser recusado, e a recusa é parcial (a ficha fica corrompida)

- Arquivos: `packages/server/src/net/handlers/doc-handlers.ts:1162-1165` (valida TODO `doc:update`
  de Actor contra o documento mesclado, para qualquer papel, inclusive o GM) +
  `systems/pf2e/src/build-validation.ts:174` (`CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL`) e `:266`
  (`BOOST_LEVEL_EXCEEDS_CHARACTER_LEVEL`).
- Contrato quebrado: `planVM.levelSet` (`sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:5574`) baixa o
  nível mas **não** remove as entradas de `system.build.choices` / `levelledBoosts` acima do novo
  nível (só remove os itens `grantedSlot classFeature:N`). A derivação foi feita tolerante a isso
  de propósito (`derivations/build.ts:167-170` filtra `lvl <= level`). O validador novo trata esse
  estado, que é legítimo e produzido pelo próprio client, como build ilegal.
- Cenário: um Monge nível 3 com `generalFeat-3` preenchido (o `chooseFeat` grava
  `{level:3, slot:"generalFeat-3", type:"generalFeat"}`). O jogador (ou o Mestre) baixa para 2 no
  campo de nível da ficha (`CharacterSheet.svelte` → `handleLevelCommit` → `vm.updateLevel` →
  `levelSet`). Conferido: o validador devolve
  `CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL (system.build.choices[1])` → `doc:update` responde
  `VALIDATION_FAILED`. Mas o `updateScheduler.commitNow` (`updateScheduler.ts:69-73`) dispara as ops
  do `levelSet` em sequência, sem aguardar o ack: os `doc:delete` embutidos (retirada dos
  class-features acima do nível) e o sync de slots de magia **passam**. Resultado em produção: o
  personagem **continua nível 3** e **perde os itens de classe do nível 3** (o mesmo caso do Monge da
  O0 C6, agora pior). O mesmo acontece para qualquer personagem da variante de níveis de classe
  (`classLevel-N` a cada nível; ex. `MVZPT17ybspil2yu`, nível 5, do `teste_xande`, recusado ao baixar
  para 1).
- Agravante: como a validação roda sobre o documento inteiro em QUALQUER update de Actor, um
  documento que já esteja nesse estado (por dado antigo ou por esse caminho) recusa também edições
  que nada têm a ver com build (PV, nome, xp) — inclusive as do Mestre.
- Os testes não pegam porque nenhum exercita baixar nível nem um update de outro campo sobre um
  ledger com escolha acima do nível.

## I1 — IMPORTANTE: a checagem de talento×slot (o miolo do T6.2) nunca dispara em produção; os testes usam um formato que o app não grava

- Arquivos: `systems/pf2e/src/build-validation.ts:182-189` (só checa escolha com `itemId`);
  testes `systems/pf2e/src/__tests__/build-validation.test.ts:108` e
  `packages/server/src/__tests__/player-character-create.test.ts:219-226`.
- Contrato real: o `chooseFeat` (`planVM.ts:4414-4421`) grava a escolha **sem `itemId`**
  (`{level, slot, type}`), e o talento vive como item embutido marcado com
  `flags.fusion.build = {level, slot}` (`resolveSlot`, `planVM.ts:1980-1984`). Nenhum escritor do
  planVM põe `itemId` em `choices`. No `teste_xande`, 0 de 6 escolhas têm `itemId`.
- Cenário: o jogador manda `doc:create` de Item embutido (uma dedicação, `category:"class"`, traço
  `archetype`, e um talento geral de nível 19) com `flags.fusion.build.slot` = `classFeat-2` /
  `generalFeat-3`, e depois o `doc:update` da escolha, como o planVM faz. Conferido: o validador
  devolve `{ok:true, issues:[]}`, e o caminho de item embutido nem chama o validador (só
  `doc-handlers.ts:969` e `:1164`, os dois para Actor de nível superior). O próprio teste do core
  (`(setup) embeds a dedication feat…`, `:345`) mostra que o embed da dedicação é aceito.
- Os testes `FEAT_SLOT_MISMATCH`/`FEAT_LEVEL_EXCEEDS` passam contra um formato inventado: validam o
  validador, não o caminho de produção. O relatório da lane anuncia "dedicação em slot de classe"
  como fechado, e não está.

## I2 — IMPORTANTE: a exceção nova de `doc:create` contradiz a spec 05 e não tem gatilho na tela

- Arquivo: `packages/server/src/net/handlers/doc-handlers.ts:646-664` e `:887-893`.
- A spec 05 (emenda de 16/08, `specs/05-usuarios-e-permissoes.md:332-339`, DEC-NPC-02,
  REQ-USR-025/025a) diz que o personagem do jogador nasce **com o usuário** e que esse é "o único
  endereço da criação de personagem". Isso já existe: `auth/service.ts:311-327` cria o ator
  `character` em branco, com o jogador como OWNER e `flags.fusion.playerId`. "O jogador cria"
  (decisão #2) já se cumpre montando esse ator na ficha, que o `doc:update` genérico já permite.
- Nenhum emissor do client cria `type:"character"` (`createNpc.ts` oferece só `npc`/`hazard`; não
  existe botão de jogador). O gate da onda ("smoke como player") não tem o que exercitar, e a
  exceção só é alcançável por op montada à mão.
- Cenário: um jogador emite `doc:create` com `data: [{type:"character"}, …]` × 500 → 500 atores
  aceitos, sem teto, sem `flags.fusion.playerId`, e o jogador não pode apagar nenhum (Actor delete
  segue só para GM). A lista do Mestre fica inundada, e esses atores escapam de qualquer
  administração futura que resolva o personagem pelo `playerId`, que é para isso que REQ-USR-025
  grava o campo.
- Corrigir com: remover a exceção e documentar que T6.1 = ator em branco da REQ-USR-025 + edição
  por OWNER, OU emendar a spec 05 e limitar a um personagem por jogador, gravando `playerId`.

## M1 — MENOR: a recusa de build no create sai no meio do loop que já persistiu itens anteriores

- Arquivo: `doc-handlers.ts:969-970` (a validação roda dentro do loop que chama `store.create` a cada
  item).
- Cenário: um GM manda `doc:create` com 2 personagens em lote, e o 2º tem
  `levelledBoosts:{"2":[…]}`. O 1º já foi gravado, não há broadcast e o ack volta `ok:false`. Os
  clients divergem até o resync, e ao repetir a operação o 1º é duplicado. O `doc:update` evita
  exatamente isso com um pré-voo (comentário em `:1078-1083`). O mesmo padrão já existia para
  `DocumentValidationError`, mas este caminho é novo. Mover a validação para um pré-voo antes do
  loop.

---

## Conferido e sem achado

- Ownership forçada `{default:NONE, criador:OWNER}` via `ownershipForCreator`: não confia no
  payload, e o teste afirma que o `default` forjado é ignorado.
- NPC/hazard/loot seguem só para GM (teste `:266`). Terceiro não edita (teste `:320`).
- T6.4: o client preenche `expectedVersion` para todo papel (`sendOp.ts:333-376`), então a corrida
  GM×jogador tem proteção nos dois sentidos. O teste cobre um sentido, contra o servidor real.
- Nenhuma asserção existente foi enfraquecida ou pulada no diff (só arquivos novos + o handler).
- Contrato de export `@fusion/system-pf2e` (novo `validateCharacterBuild`) é aditivo e não quebra
  consumidor.
