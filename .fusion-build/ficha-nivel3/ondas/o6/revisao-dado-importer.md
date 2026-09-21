# Revisão adversarial O6 — lente DADO + IMPORTADOR + INTEGRIDADE

Escopo lido: core `git diff origin/alfa/app...ficha3/o6` (doc-handlers.ts + teste novo + pin), satélite
`git diff origin/main...ficha3/o6` (build-validation.ts + teste + export). Nenhum pack, importador ou
tradução foi tocado nesta onda, então a parte "dado/importador/idempotência" não tem o que regredir.
O foco foi a autoridade do servidor.

Como verifiquei: rodei o `build-validation.ts` da branch direto (node --experimental-strip-types, cópia no
scratchpad) contra documentos sintéticos e contra os 3 atores reais do mundo `teste_xande` (cópia do world.db
no scratchpad, somente leitura). Nenhum arquivo da worktree foi editado e nenhuma suíte foi rodada.

## A1 — BLOQUEANTE — o nível não desce mais, e a descida deixa o ator sem as features de classe
- Onde: doc-handlers.ts:1162-1166 (valida o documento MERGEADO inteiro em todo doc:update de Actor, qualquer
  papel) + build-validation.ts:174 e :266 (escolha/boost acima do nível do personagem = rejeição).
- Cenário: o personagem real `MVZPT17ybspil2yu` (nível 5, com a escolha `classLevel-2` no nível 2) no teste_xande.
  O Mestre ou o jogador muda o campo Nível para 1 (CharacterSheet.svelte:448 -> `updateLevel` -> `levelSet`,
  planVM.ts:5574). O `levelSet` manda VÁRIOS ops separados: (1) doc:update `system.level.value=1`, (2) um
  update embutido por rank de magia que trunca o `prepared` (syncSlotMaxOp), (3) um doc:delete embutido para cada
  feature de classe acima do nível novo. O op (1) agora volta com VALIDATION_FAILED
  (CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL; confirmei executando o validador sobre o documento real), mas o
  updateScheduler envia os ops um a um, e (2) e (3) passam pelo caminho embutido, que não valida o build.
  Resultado: o ator continua no nível 5, sem as features de classe acima do nível 1 e com os slots preparados
  truncados. Perda de dado que o heal-on-open não recupera (characterSheetVM.ts:2550 documenta que os slots
  truncados não voltam). O mesmo vale para boosts: qualquer ator com `levelledBoosts["5"]` não desce abaixo de 5.
- Ninguém limpa `system.build.choices`/`levelledBoosts` acima do nível novo. Então o validador contradiz a
  descida de nível que a O0/C6 projetou explicitamente. Nenhum teste da lane cobre descer de nível.

## A2 — IMPORTANTE — o validador julga o documento inteiro, não o delta: um estado inválido congela o ator para todos
- Onde: doc-handlers.ts:1162-1166.
- Cenário: a validação lê o `system.level` e o `system.traits` dos itens embutidos, mas o caminho embutido
  (handleEmbeddedCreate/Update, doc-handlers.ts:1525/1737), o compendium:importToActor e os deletes embutidos
  não validam o build. Exemplo: o Mestre corrige na ficha do item o `system.level` de um talento para 4 num PC
  nível 3 que o escolheu no slot de nível 2. A partir daí, TODO doc:update primário do ator volta
  VALIDATION_FAILED, para o Mestre também: PV, condições, nome, XP, `system.level` e até a própria correção
  do build (FEAT_LEVEL_EXCEEDS_CHARACTER_LEVEL). A única saída é apagar o item. Em mesa, isso significa que o
  Mestre não consegue aplicar dano pela ficha.
- Correção esperada: rejeitar só os problemas que o diff INTRODUZ (comparar as issues de existing e merged), ou
  só validar quando o diff toca `system.build`/`system.level`.

## A3 — IMPORTANTE — a validação de talento confia em dado escrito pelo próprio jogador e é contornável em 2 ops
- Onde: build-validation.ts:184-189 (item ausente = passa) e :191-195 (categoria/nível/traços lidos do item
  embutido, que é do jogador).
- Cenário 1: o jogador manda doc:update com a choice `{type:"classFeat", itemId:"X"}` ANTES de o item X
  existir -> passa (item ausente). Em seguida cria o item embutido X com um talento de dedicação -> nenhum gate de
  build roda no caminho embutido -> build "ilegal" persistido.
- Cenário 2: o jogador cria o item embutido da dedicação com `system.traits.value` sem "archetype" (ou com
  `system.level` 1) -> o slot `classFeat` aceita. O validador certifica metadados que o próprio requisitante
  escreveu. Então a promessa da T6.2 ("uma op montada à mão não persiste dedicação num classFeat") não se sustenta.
- Correção esperada: resolver o talento pelo `flags.fusion.sourceId`/`ref` contra o pack do servidor (a
  identidade é o sourceId, nunca o dado embutido) e validar também no caminho embutido.

## A4 — IMPORTANTE — a regra endurecida no servidor está errada pela regra do PF2e
- Onde: build-validation.ts:219-233 (`classFeat` recusa o traço archetype; `generalFeat` aceita só category general).
- Regra PF2e (Player Core): talentos de arquétipo, dedicação incluída, são tomados NO LUGAR de talentos de classe.
  Sem a variante Free Archetype, o slot de classe é a ÚNICA forma de pegar um arquétipo. Talento de perícia é
  subconjunto de talento geral e pode ocupar slot geral.
- Cenário (executado no validador): um personagem nível 5 com uma dedicação de Wizard em `classFeat-4` recebe
  FEAT_SLOT_MISMATCH, e um talento de perícia em `generalFeat-3` também recebe FEAT_SLOT_MISMATCH. As duas builds
  são legais.
- O `isFeatEligible` documenta a si mesmo como "non-blocking" e a memória do projeto registra
  `regra:dedicacao-nao-cabe-em-slot-de-classe` como uma lacuna RAW em aberto (ficha-alvo Fofurinha). A lane
  transformou essa lacuna conhecida em recusa autoritativa no servidor. Consertar a Fofurinha agora exige
  mexer em dois lugares, e qualquer ator que chegar com uma dedicação em slot de classe (importado, editado pelo
  Mestre) cai no congelamento da A2.

## A5 — IMPORTANTE — o jogador agora cria ator com `items` arbitrário, sem a validação de item embutido
- Onde: doc-handlers.ts:877-893 (nova exceção para PLAYER) + 954-979 (o caminho de create não recusa `items`)
  + documents/types.ts (Actor.items = array de registros livres).
- Cenário: um PLAYER manda `doc:create Actor [{name:"A", type:"character", items:[{_id:"x", type:"bogus"}]}]`
  -> ok:true. Isso ignora o `validateEmbeddedItemForSystem` (R10-C) e a checagem de "nome não vazio" do
  handleEmbeddedCreate:1683. É exatamente o formato que o doc:update recusa (comentário em doc-handlers.ts:347-353:
  "a player ... replaced items with an entry of an unknown type ... got ok:true", tratado como bug). Antes
  desta onda só um privilegiado alcançava esse caminho. O mesmo payload também pode trazer um item de classe
  com PV/nível forjados, que a derivação consome direto.
- Correção esperada: na exceção do jogador, recusar `items` no payload de create (ou passar cada item pelo
  mesmo validador do caminho embutido).

## A6 — MENOR — `system.build` nulo/ausente desliga a validação
- Onde: build-validation.ts:133-134.
- Cenário: diff `{"system.build": null, ...}` -> deepMerge substitui -> `validateCharacterBuild` retorna ok
  (confirmado executando). Não confirmei se o schema do sistema aceita o null na escrita. Se aceitar, qualquer
  dono apaga o build e cai no modo manual r9, sem gate nenhum.

## Não achados (verificados)
- A ownership forçada no create (ownershipForCreator) ignora o `ownership` forjado, e NPC/hazard/loot continuam
  restritos a GM/ASSISTANT.
- Os 3 atores reais do teste_xande passam no validador no estado atual, então não há congelamento imediato no
  mundo existente.
- Concorrência GM x jogador: a checagem de versão otimista roda antes da escrita, e a gravação é síncrona. Não
  achei corrida nova.
