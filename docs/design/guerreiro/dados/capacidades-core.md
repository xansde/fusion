# Inventário do Guerreiro — capacidades do CORE (packages/server/src + packages/client/src)

Escopo: `C:/Users/xansd/pessoal/fusion`, pastas `packages/server/src` e `packages/client/src`.
NÃO investiguei `external/fusion-systems-2e` — onde um fio levava lá, anotei o ponto de
entrada e parei. Todos os caminhos abaixo são relativos à raiz do core.

---

## WEAPON-STRIKE — Strike com arma equipada ponta a ponta

**Status:** parcial

**Evidência:**
- `packages/server/src/chat/chat-handler.ts:451-507` — o handler do comando `roll` (usado
  por QUALQUER rolagem, não só Strike) rola o dado no servidor (`rollService.roll`,
  anti-cheat), e se `payload.target` veio preenchido e não é um save, resolve a AC do alvo
  (`resolveTargetPortrait`) e grada a rolagem contra ela (`computeAttackDegree`), anexando
  `degreeOfSuccess` (hit/crit/miss) e o `target` portrait à mensagem transmitida.
- `packages/server/src/chat/chat-handler.ts:1586-1612` (`resolveTargetPortrait`) +
  `:1620-1625` (`computeAttackDegree`) — a AC é lida do banco (`readActorAc`), NUNCA aceita
  do payload do cliente; respeita visibilidade (token oculto/cena fora do ar não resolve) e
  ownership (`mayNameActorDirectly`). Testado ponta a ponta com socket.io real em
  `packages/server/src/__tests__/chat-target.test.ts` (REQ-ACH-070..074, 090..092).
- `packages/server/src/net/handlers/doc-handlers.ts` (arquivo inteiro, 105KB): **zero**
  ocorrências de `"hp"` fora de contexto — confirma que não existe handler dedicado de dano;
  HP é campo opaco dentro do JSON `system`, tratado só pelo pipeline genérico de doc:update.
- `packages/client/src` (busca completa por `strike`, case-insensitive): a palavra só
  aparece como formatação "tachado" do editor de rich text (`components/richtext/RichText.svelte:118,199,203`)
  e como strings i18n de exibição (`lib/i18n/pt-BR.json:266,776-782,936-938,1018-1021` —
  labels "Ataques", "Dano", "Crítico", `"{{label}} (MAP {{map}})"`). **Nenhum código no core
  client dispara ou calcula um Strike** — o botão de Strike vive na ficha do satélite
  (fora do meu escopo; ver nota do briefing: `characterSheetVM.ts:2242`/`CharacterSheet.svelte:277`).
- `packages/client/src` (busca completa por `getTargetingState`): só é consumida por
  `lib/canvas/combat/combatCanvasController.ts:166-176` (desenhar retículas). **Nenhum**
  código de envio de chat (`ChatInput.svelte`, `DiceTray.svelte`, `RollBuilderWindow.svelte`,
  `lib/docs/sendOp.ts`) lê o estado de targeting para popular `payload.target`.
- Não existe um `command.kind === "strike"` — o "roll" é genérico
  (`packages/shared/src/chat/command-parser.ts:39,255`, fora do meu escopo mas confirma o
  tipo); "strike" é só um rótulo de exibição (`flags.pf2e.abilityCard.kind`, checado em
  `chat-handler.ts:1810` só para pular a checagem de coerência de DC).

**Gatilho na UI:** nenhum encontrado no core. A engrenagem de graduar ataque-vs-CA é real,
testada e seria acionada por qualquer `/roll` com `payload.target` — mas nada no core client
constrói esse `target`. Se o botão de Strike do satélite dispara isso, é um fio que sai do
meu escopo; meu grep prova que ele não pode estar lendo o targeting.ts do core (nada o expõe
para o envio de chat).

**O que falta:** (a) um gesto no client (clique/tecla num token do canvas, ou token HUD) que
chame `combatActions.target(socket, tokenId, true)`; (b) código que leia
`getTargetingState()`/`isTargetedByUser()` ao montar o payload de uma rolagem e anexe
`{ tokenId }` como `payload.target`; (c) confirmar no satélite se o botão de Strike já faz
algo equivalente por fora do core (item para o outro agente).

---

## TARGET-OTHER — marcar alvo (mira) no canvas

**Status:** parcial

**Evidência:**
- `packages/server/src/combat/target-handler.ts:92-114` (`buildCombatTargetHandler`) —
  handler real: qualquer usuário autenticado marca/desmarca um token como seu alvo; userId
  é server-authoritative (nunca vem do payload); transmite `token:targeted` só quando o
  estado muda.
- `packages/server/src/combat/target-handler.ts:169-180` (`registerTargetingCleanup`) +
  `packages/server/src/combat/combat-handlers.ts:523` (`emitLifecycle({type:"turnEnd"...})`)
  — a mira é limpa automaticamente quando termina o turno de quem mirou (REQ-CBT-055),
  ligado de verdade no lifecycle bus.
- `packages/server/src/net/socket-manager.ts:460` —
  `registry.register("combat:target", buildCombatTargetHandler(targetDeps))`: confirma que o
  handler está registrado no dispatcher ao vivo (não é código morto).
- `packages/client/src/lib/canvas/combat/TargetingMarker.ts` (arquivo inteiro) — camada PIXI
  real: retícula de 4 cantos por token mirado, cor diferente para mira própria vs. de outro
  usuário, sincronizada por `sync()`.
- `packages/client/src/lib/canvas/combat/combatCanvasController.ts:88-91,158-176` — todo
  frame (`tick()`), reconcilia a mira lendo `getTargetingState()` e resolvendo a posição do
  sprite do token via `TokenLayer`.
- `packages/client/src/lib/combat/combatStore.svelte.ts:391-410` (`combatActions.target`) —
  a ÚNICA função client que envia `combat:target` ao servidor.
- `packages/client/src/components/combat/__tests__/CombatQueue.test.ts:405-436` — teste
  EXPLÍCITO (REQ-CBA-076/DEC-CBA-05) provando que o painel de combate deliberadamente NÃO
  oferece controle de "marcar alvo" ("mirar é gesto espacial e vive no canvas"), e que nem
  `CombatQueue.svelte` nem `CombatPanel.svelte` chamam `combatActions.target`. A chave i18n
  `FUSION.Combat.TargetToken` não existe em nenhum bundle (o teste confirma que `t()` devolve
  a própria chave).
- Busca completa em `packages/client/src` por `combatActions.target(`: zero ocorrências fora
  de testes. Busca em `lib/canvas/tokens/TokenInteractionManager.ts` e `token-interaction.ts`
  por qualquer gesto de mira (clique direito, tecla): zero.

**Gatilho na UI:** nenhum encontrado. Servidor + broadcast + limpeza automática + renderização
da retícula são reais e funcionam SE alguém chamar `combatActions.target()` — mas nenhum
código do core hoje faz essa chamada fora dos testes.

**O que falta:** o gesto no canvas que DEC-CBA-05 promete (clique num token para mirar) nunca
foi implementado — `TokenInteractionManager.ts` trata clique/drag/seleção/duplicação de
token, mas não mira. É um roteiro de produto documentado (a decisão de mover mira pro canvas)
que ficou pela metade.

---

## APPLY-DAMAGE — aplicar dano/cura ao alvo

**Status:** ausente

**Evidência:**
- `packages/server/src/net/handlers/doc-handlers.ts` (arquivo completo, 105KB): zero
  ocorrências de `"hp"` — nenhum handler dedicado de dano/cura; HP só existe como campo
  opaco dentro do doc genérico.
- Busca completa (case-insensitive) em `packages/server/src` e `packages/client/src` por
  `applyDamage`, `apply-damage`, `ApplyDamage`, `apply dano`, `TokenHUD`/`Token HUD`: **zero
  arquivos** em qualquer um dos dois pacotes.
- `packages/client/src/components/chat/ChatMessage.svelte:438-452` — existe um ponto de
  extensão (`cardExtension`, via `lib/chat/chatCardExtensionRegistry.svelte.ts`) onde "a
  system" pode montar um card de chat rico com "save/damage buttons" — mas o componente real
  é registrado pelo sistema (satélite) no boot; o core só define a interface do plugue
  (`ChatCardExtension { recognize, component }`) e mantém a lista (`registry.svelte.ts:22-46`).
  Não encontrei nenhum componente desse tipo dentro do core.
- `packages/client/src/components/chat/DiceTray.svelte`: zero ocorrências de "target"/"dano".
- Nenhum componente do core (`components/combat/*`, `components/chat/*`,
  `components/npcs/NpcsPanel.svelte`) tem um botão de aplicar dano/cura a outro ator — os
  únicos elementos relacionados a HP no core são de LEITURA (ver TEMP-HP abaixo).

**Gatilho na UI:** nenhum.

**O que falta:** tudo — (a) um handler de servidor que receba `{targetActorId, amount,
type}` e escreva `system.attributes.hp.value` com clamp e resistências/fraquezas (o
`applyIwrMultiple` já existe testado no satélite, mas sem chamador — nota do briefing); (b)
um botão real em algum lugar (chat card do rolamento de dano, ou um Token HUD que não existe
no core hoje) que chame esse handler.

---

## Combate e turnos — NEW-TURN-CYCLE (iniciativa, ordem, começar/terminar turno)

*ID novo: nenhum mecanismo do catálogo ou do vocabulário novo cobre o ciclo de turno em si
(MAP-TRACK é só o contador de penalidade, não o ciclo).*

**Status:** funciona

**Evidência:**
- `packages/server/src/combat/combat-handlers.ts:548-1598` — conjunto completo de handlers
  reais: `buildCombatCreateHandler`, `buildCombatStartHandler`,
  `buildCombatAddCombatantHandler`/`buildCombatRemoveCombatantHandler`,
  `buildCombatRollInitiativeHandler`/`buildCombatSetInitiativeHandler`/`buildCombatResetInitiativeHandler`,
  `buildCombatNextHandler`/`buildCombatPreviousHandler`, `buildCombatToggleDefeatedHandler`,
  `buildCombatSetHiddenHandler`, `buildCombatReorderHandler`, `buildCombatEndHandler`.
- `packages/server/src/combat/combat-event-bus.ts:1-27` — bus de eventos de ciclo de vida
  documentado e real: `turnEnd→[roundEnd→roundStart]→turnStart` a cada `nextTurn`;
  `combatStart→turnStart` ao iniciar; `turnEnd→combatEnd` ao encerrar. Emitido de verdade em
  `combat-handlers.ts:523,532,536,540,665-666,1589,1598`.
- `packages/server/src/__tests__/combat-own-turn.test.ts:1-22` (G054) — teste de integração
  com socket real: um jogador NÃO privilegiado avança o PRÓPRIO turno via `combat:nextTurn`
  quando é dono do combatente ativo; rewind/end continuam exclusivos de papel privilegiado
  (REQ-CBA-071..081), e a checagem é no SERVIDOR (um op forjado de um player é recusado, não
  só escondido na tela).
- `packages/client/src/components/combat/CombatPanel.svelte:400-445` — botões reais de GM:
  Começar (`combatActions.start`), Anterior (`combatActions.previousTurn`), Próximo
  (`combatActions.nextTurn`), Encerrar (`combatActions.end`), todos atrás de `isGm && controls`.
- `packages/client/src/components/combat/CombatPanel.svelte:172,187,548` — `isMyTurn`
  (`activeCombatantIsOwnedBy`), `canEndOwnTurn = !gmControls && isMyTurn`, e
  `canAdvance={gmControls || canEndOwnTurn}` passado ao `TurnHead` — espelha exatamente a
  regra do servidor: GM sempre, jogador só no próprio turno.
- `packages/client/src/components/combat/TurnHead.svelte:60,72,90-94,292-298` — botão real
  de avançar (`onAdvance`) gated por `canAdvance`.

**Gatilho na UI:** GM: botões no cabeçalho do `CombatPanel` ou no `TurnHead`. Jogador: botão
de avançar no `TurnHead` quando é a vez do seu combatente (`canEndOwnTurn`).

---

## MAP-TRACK — contagem de penalidade de ataque múltiplo

**Status:** ausente

**Evidência:**
- Busca (case-sensitive, para não pegar "map" de mapa/cartografia) por `\bMAP\b` em
  `packages/server/src` e `packages/client/src`: **zero** ocorrências.
- Busca por `multiple.?attack|attack.?penalty` (case-insensitive) nos mesmos dois pacotes:
  **zero** ocorrências.
- `packages/server/src/combat/combat-handlers.ts` — o turno avança (`buildCombatNextHandler`)
  sem guardar nenhum histórico de quantas ações/ataques o combatente já fez nesta rodada (ver
  também achado transversal do catálogo, `NEW-LAST-ACTION`, reconfirmado aqui).
- `packages/server/src/combat/target-handler.ts:169-180` é o ÚNICO consumidor de
  `onLifecycle("turnEnd", ...)` em todo `packages/server/src` (grep confirma — só aparece ali
  e nos testes). Ou seja: mesmo que existisse um contador de MAP em algum lugar, não há hoje
  NENHUM listener de `turnStart` que o zeraria automaticamente.
- `packages/client/src/lib/i18n/pt-BR.json:936` tem o rótulo pronto
  `"FUSION.Sheet.Chat.StrikeMap": "{{label}} (MAP {{map}})"`, mas busquei
  `StrikeMap` em todo `packages/client/src` e o ÚNICO lugar onde a chave aparece é nos dois
  bundles (`pt-BR.json`/`en.json`) — nenhum `t("FUSION.Sheet.Chat.StrikeMap")` é chamado no
  core. Se existe uma contagem de MAP, ela vive inteira no satélite (fora do meu escopo) e,
  pelo achado acima, não tem como ser resetada automaticamente pela troca de turno hoje.

**Gatilho na UI:** nenhum.

**O que falta:** um contador por combatente-por-rodada (estado novo, hoje inexistente), um
consumidor de `turnStart` que o zere, e a lógica de aplicar -5/-10 (ou -4/-8 agile) na
próxima rolagem — nada disso existe no core.

---

## REACTION-TRIGGER — servidor detecta gatilho e oferece a reação

**Status:** ausente

**Evidência:**
- Busca por `\breaction\b|\breactions\b` (case-insensitive) em `packages/server/src`: as
  únicas ocorrências são em `compendium/service.ts:1303,1304,1602,1605,1631-1632` — formatação
  do CUSTO de ação de um documento de compêndio para exibição ("1", "2", "reaction", "free"),
  puramente descritivo, sem relação com conceder/consumir/oferecer uma reação; e
  `net/ephemeral-handlers.ts:381`, um comentário em inglês usando "reaction" no sentido comum
  (resposta do servidor a um envelope), não a mecânica de PF2e.
- Mesma busca em `packages/client/src`: só aparecem como rótulo/glifo de exibição no browser
  de compêndio (`lib/compendium/documentDetails.ts:143,297,311,353,831,856,859,918,1227-1228`,
  `lib/i18n/*.json:817` "Reação"/"Reaction") — ou seja, a aba de Ações sabe DESENHAR o ícone
  ⟳ quando um documento tem `actionType: "reaction"`, mas isso é só metadado de navegação
  (confirma achado do catálogo para `CRAFT-ACT`: a aba é um browser de descrição).
- Busca por `\btrigger(ed)?\b|\binterrupt\b|\bprompt\b` em `packages/server/src`: nenhum hit
  relacionado a oferecer/perguntar por uma reação ao jogador — os hits de "trigger" são de
  outros domínios (updater, tunnel, etc.), sem relação com combate.
- Não existe economia de reação (1 por rodada, resetada no início do turno) em lugar nenhum:
  o `CombatantDocument`/estado de combate não tem campo de reação disponível, e o event bus
  (`combat-event-bus.ts`) não tem um evento do tipo "reactionWindow" nem qualquer coisa
  parecida — a lista de eventos é só `combatStart/turnStart/turnEnd/roundStart/roundEnd/combatEnd`.

**Gatilho na UI:** nenhum.

**O que falta:** tudo — nem o conceito de "reação disponível" existe no modelo de dados, nem
um evento que detecte o gatilho (ex.: alguém sai de uma área ameaçada), nem uma UI que
pergunte "usar Reação de Oportunidade?" a um jogador.

---

## OFF-GUARD-POS — flanqueio / geometria de posição

**Status:** ausente

**Evidência:**
- Busca por `\bflank(ing|ed)?\b|\badjacent\b|off-?guard|offGuard|\breach\b|\bcover\b`
  (case-insensitive) em `packages/client/src/lib/canvas`: os únicos 3 arquivos com match
  (`token-visuals.ts:41`, `token-interaction.ts:395,413`, `TokenInteractionManager.ts:358,871`)
  são falsos positivos — usam "reach"/"adjacent" no sentido comum em inglês ("keys must reach
  the field", "focus-adjacent UI"), sem nenhuma relação com geometria de jogo.
- Mesma busca em `packages/server/src`: os 3 arquivos com match
  (`tokens/tokenValidation.ts:328`, `compendium/service.ts:1256`, `boot.ts:324`) também são
  falsos positivos ("does not cover", "rows cover every pack", "cannot cover").
- `packages/server/src/__tests__/condition-toggle.test.ts:335` — "off-guard" existe SÓ como
  nome de uma condição estática que pode ser alternada manualmente
  (`buildAddConditionOpFixed(actorId, "off-guard", "Off-Guard")`), no mesmo sistema genérico
  de toggle de qualquer condição — nada deriva esse estado de flanqueio.
- Nenhum código em `packages/client/src/lib/canvas` calcula distância, linha entre dois
  tokens, ou adjacência de grid — o grid existe para desenho/movimento (`honeycomb-grid` é
  dependência do projeto, conforme CLAUDE.md), mas não encontrei nenhum consumidor que ligue
  posição a uma regra de combate.

**Gatilho na UI:** nenhum (a condição off-guard pode ser alternada manualmente na ficha —
satélite, fora do escopo — mas não a partir de posição).

**O que falta:** tudo — cálculo de adjacência/linha entre tokens no canvas, e uma regra que
aplique off-guard automaticamente quando dois aliados flanqueiam um inimigo.

---

## CONDITION (em alvo) — aplicar condição a OUTRO ator a partir do mapa/combate/chat

**Status:** ausente

*(O catálogo já registra `CONDITION` como "parcial" pelo toggle na própria ficha, no
satélite — self, não outro ator. Esta seção cobre especificamente o sub-caso pedido: aplicar
a um ALVO a partir do mapa/combate/chat, que é o que falta.)*

**Evidência:**
- `packages/client/src/components/combat/CombatQueue.svelte:37-38,188-190,340-362` — a fila
  de combate MOSTRA os chips de condição de cada combatente (`ConditionChip`), mas é
  leitura pura: não há botão de adicionar/remover ali, só iteração sobre
  `conditionsOf(id)` para desenhar.
- `packages/client/src/components/common/ConditionChips.svelte` (arquivo inteiro) — mesmo
  componente de exibição usado pela fila e pelo painel de NPCs; só tem estado `expanded`
  (mostrar mais/menos), nenhum callback de adicionar/remover.
- `packages/client/src/components/npcs/NpcsPanel.svelte:701,784` — o painel de NPCs também só
  EXIBE condições (`<ConditionChips conditions={row.conditions} .../>`), sem controle de
  edição visível na varredura.
- `packages/server/src/net/handlers/system.ts:122-154` (`buildSystemConditionsHandler`) —
  `system:conditions` devolve só a LISTA de condições registradas pelo sistema (slug + label,
  para pintar o chip), não um handler de aplicar condição a um ator.
- Busca por `condition` em `packages/client/src/components/chat`: só aparece em
  `ChatMessage.svelte`, dentro dos comentários sobre nested rolls/cards — nenhuma ação de
  chat aplica condição a um alvo.
- Nenhum menu de contexto de token (`TokenInteractionManager.ts`) oferece "aplicar condição".

**Gatilho na UI:** nenhum, a partir de mapa/combate/chat/painel de NPCs. (O toggle existente é
self, na ficha, fora deste escopo — ver nota do catálogo.)

**O que falta:** um handler de servidor tipo "condition:apply { targetActorId, slug }" (hoje
só existe o toggle genérico da própria ficha) e uma UI em qualquer um dos três lugares —
token no canvas, linha da fila de combate, ou card de chat — que o chame.

---

## TEMP-HP — pontos de vida temporários

**Status:** ausente

**Evidência:**
- Busca por `temp.?[hH][pP]|temporaryHp|temp_hp` em TODO `packages/` (server, client, shared,
  system-api): **zero arquivos**.
- `packages/client/src/lib/combat/combatVitals.ts:89-122` (`readActorHealth`) — o modelo de
  vida que o combat tracker lê é só `{ current, max }`, lido de
  `system.derived.hp`/`system.attributes.hp` — dois números, sem terceiro campo. O comentário
  do próprio arquivo (linha 97-101) até descarta explicitamente usar
  `flags.combat.trackedResource` como fonte de vida, mas não existe nenhuma menção a "temp"
  em lugar nenhum do arquivo.
- `packages/client/src/lib/combat/turnHead.svelte.ts`, `combatBadge.svelte.ts` (mesma família
  de arquivos de vitals): nenhum hit de "temp" relacionado a HP na varredura.

**Gatilho na UI:** nenhum.

**O que falta:** o campo em si no modelo de dados (nenhum schema do core opina sobre a forma
de HP — isso é responsabilidade do sistema/satélite — mas mesmo lá, busca ampla anterior
desta sessão não achou nada), mais a exibição (barra/número extra) e a lógica de "gasta o
temp primeiro".

---

## NEW-COVER — cobertura

*ID novo: nenhum mecanismo do catálogo cobre cobertura; é puramente ausente e não teria
onde se encaixar em nenhum ID existente.*

**Status:** ausente

**Evidência:**
- Busca por `\bcover\b` (case-insensitive) em `packages/server/src` e `packages/client/src`:
  todas as ocorrências são falsos positivos de "coverage"/"não cobre" em comentários de teste
  (`tokenValidation.ts:328`, `compendium/service.ts:1256`, `boot.ts:324`,
  `ChatPanel.test.ts:182` "LEIA ANTES DE CONTAR COBERTURA").
- Busca por `cobertura` (português) nos dois pacotes: só o mesmo falso positivo de cobertura
  de teste em `ChatPanel.test.ts:182`; zero no server.
- Nenhuma geometria de linha-de-visão bloqueada por obstáculo, nenhum cálculo de "quanto do
  token está visível", nenhum bônus de CA associado.

**Gatilho na UI:** nenhum.

**O que falta:** tudo — não há sequer o conceito de obstáculo opaco a projétil no canvas
(distinto de parede que bloqueia visão/movimento — não confirmei se ESSA existe, pois não foi
perguntado, mas cobertura como regra de combate está 100% ausente).

---

## Achados fora do checklist

1. **A engrenagem de graduar ataque-contra-CA é real, genérica e bem testada — mas
   desconectada de qualquer origem de alvo.** `chat-handler.ts` roda o dado no servidor,
   resolve a CA do alvo pelo próprio banco (nunca confia no cliente) e respeita visibilidade/
   ownership (`resolveTargetPortrait`), com suíte de integração via socket real
   (`chat-target.test.ts`, REQ-ACH-070..092). É a peça de infraestrutura mais sofisticada que
   encontrei no core relacionada a combate — e hoje é inatingível a partir de qualquer UI do
   core, porque nada popula `payload.target`. Vale a pena o outro agente confirmar se o
   satélite faz essa ponte por fora, porque se não fizer, é código morto em produção (mesmo
   padrão já visto com `applyDamagePipeline` no briefing).

2. **MULTI-TARGET-STRIKE está explicitamente EXCLUÍDO por design, não só ausente por
   omissão.** `chat-handler.ts:496-506` e o comentário da REQ-ACH-074
   ("an attack carries exactly ONE target — the message field is a list, which is what a
   save spell with several targets will use") mostram que `messageTargets` é um array só por
   causa de magias de área com múltiplos alvos salvando — um Strike nunca preenche mais de um
   elemento. Talentos do Guerreiro que atingem vários alvos num só ataque (ex. Dual-Handed
   Assault contra várias criaturas, Whirlwind Strike) não têm onde pousar nessa API hoje.

3. **O bus de eventos de combate (`turnStart/turnEnd/roundStart/roundEnd`) é uma
   extensão pronta, quase sem uso.** `combat-event-bus.ts` documenta a própria ordem de
   emissão E o propósito ("system API handlers (M3+) can process automations: expire
   conditions, recovery checks, etc.") mas hoje tem exatamente UM consumidor de produção em
   todo o server: a limpeza de mira no fim do turno (`target-handler.ts:169-180`). ISSO
   significa que dar vida a MAP-TRACK, expiração de condição por duração, ou dano persistente
   no início/fim do turno tem um ponto de extensão já pronto — é "só" escrever o listener, a
   canalização já existe e é testada (`combat-unit.test.ts:298-351` testa a ordem dos 4
   eventos isoladamente).

4. **A decisão de produto DEC-CBA-05 (mover "mirar" para o canvas) ficou pela metade.**
   `CombatQueue.test.ts:405-436` prova, com um teste dedicado (REQ-CBA-076), que o painel de
   combate teve o controle de mira DELIBERADAMENTE removido em favor do canvas — mas minha
   varredura do canvas (`TokenInteractionManager.ts`, `token-interaction.ts`) não achou nenhum
   gesto que implemente a mira lá. Não é "ninguém pensou nisso" — é uma decisão registrada
   que não chegou a ser implementada no novo lugar.

5. **"Terminar o próprio turno" funciona de verdade e é bem testado, incluindo
   anti-cheat.** `combat-own-turn.test.ts` (G054) prova, com sockets reais, que um jogador
   dono do combatente ativo avança seu próprio turno via `combat:nextTurn`, e que um op
   forjado por outro jogador é recusado NO SERVIDOR (não só escondido na tela). O client
   espelha certinho (`CombatPanel.svelte:172,187,548`). Isso importa para o Guerreiro porque é
   uma classe tipicamente jogada por jogador (não NPC), e o ciclo básico "é meu turno → ajo →
   passo" está sólido.

6. **Toda exibição de condição no core é somente-leitura.** Fila de combate, cabeça de
   turno e painel de NPCs (`CombatQueue.svelte`, `ConditionChips.svelte`, `NpcsPanel.svelte`)
   desenham chips de condição mas nenhum deles tem um caminho de escrita — mesmo o Mestre,
   olhando a lista de NPCs, não tem um botão para marcar uma criatura como Off-Guard ou
   Assustada a partir dali.

7. **`chatCardExtensionRegistry.svelte.ts` é o ponto de fronteira exato para os botões de
   "save/damage" do satélite.** (`packages/client/src/lib/chat/chatCardExtensionRegistry.svelte.ts`,
   consumido em `ChatMessage.svelte:85,153-156,438-452`). O core só define a interface do
   plugue; o componente real (com os botões) é registrado por `systems/pf2e` no boot — é o
   fio de entrada para quem for inventariar o que esses botões fazem de verdade no satélite.
