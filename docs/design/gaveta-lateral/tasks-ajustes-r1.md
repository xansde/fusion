# Gaveta lateral — plano de ajustes r1 (33 divergências do teste do Alexandre)

Origem: teste manual do Alexandre em `alfa/app`, depois de mergeadas as 9 fases da gaveta
lateral (specs 36–44, PRs #147/#150/#152/#155/#156/#157/#158/#161/#172/#175 — ver
[`tasks.md`](tasks.md)). Ele listou **33 divergências** entre o que foi implementado e o que
a spec/protótipo mandava, algumas com forte insatisfação registrada ("Decepção.", "MAIOR ÁREA
DE FRUSTRAÇÃO", "coisíssima nenhuma"). Este documento **compila** essas 33 divergências —
não corrige nenhuma linha de código.

Cada item foi investigado por leitura de código (worktree `wt-c`, branch
`docs/gaveta-ajustes-r1`, base `alfa/app`, 2026-08-16/17) contra a spec e o protótipo
correspondentes. Onde a investigação mostrou que o código **já** faz o que a spec manda —
isso é registrado explicitamente, com a recomendação de confirmar com o Alexandre antes de
tratar como bug (3 dos 33 itens caem nesse caso: 2/32, 6 e a metade de 8).

Base de trabalho: `alfa/app`. Uma fase = um PR. Promoção `alfa → beta → stable` é sempre ato
humano.

**Escopo de linha:** vale só para `alfa`/`beta`/`stable`, como o plano-mãe.

**Fronteira com a frente de Token (spec 41):** este plano não mexe em `actorLink`/
`actorDelta`/forma da peça — isso é [`../spec-41-token/tasks.md`](../spec-41-token/tasks.md)
(prefixo `TK###`). Onde uma divergência daqui é, na raiz, um problema do **modelo da peça**
(não da tela da gaveta), a tarefa aqui aponta para a tarefa de lá em vez de duplicar — é o
caso do item 11 (ver A031).

---

## Como ler estas tarefas

- `A###` — id estável deste plano (`A` de ajustes). Não colide com `G###` (tasks.md) nem
  `TK###` (spec-41-token/tasks.md). Não renumerar; tarefa cancelada vira `~~A###~~` com o
  motivo.
- Cada tarefa registra: **(a)** o que a spec/protótipo/decisão manda, com citação exata;
  **(b)** o estado atual do código, com paths e trechos; **(c)** causa provável, quando é
  bug; **(d)** a tarefa proposta, com critério de aceite verificável.
- **Achado que não é bug** — quando a investigação mostrou que o código já cumpre a spec,
  a tarefa vira "confirmar com o Alexandre", não "corrigir".
- Toda tarefa cita arquivo real (paths na árvore, sem prefixo de worktree).

Comandos do repo: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` ·
`pnpm build` · `pnpm spec:report`

---

## Ordem das fases

**Fase 0 — bugs bloqueantes** (itens 9, 13, 14, 22, 24, 28, 31, nesta ordem, conforme
instrução) primeiro: são os que impedem testar o resto da mesa ou corrompem dado. Depois,
uma fase por área/aba, na ordem em que o Alexandre relatou: Rail → Chat → Contatos/NPCs →
Compêndio → Cenas → Configurações → Processo.

| PR  | Fase                           | Itens                          |
| --- | ------------------------------ | ------------------------------ |
| K   | Fase 0 — bugs bloqueantes      | 9, 13, 14, 22, 24, 28, 31      |
| L   | Fase 1 — Rail (36)             | 1, 2/32                        |
| M   | Fase 2 — Chat (38)             | 3, 4, 5, 6, 7, 8               |
| N   | Fase 3 — Contatos/NPCs (39/42) | 10, 11, 17, 18, 19, 20, 21, 23 |
| O   | Fase 4 — Compêndio (43/16)     | 12, 15, 16                     |
| P   | Fase 5 — Cenas (44)            | 25, 26, 27                     |
| Q   | Fase 6 — Configurações (37/05) | 29, 30                         |
| R   | Fase 7 — Processo              | 33 (P1–P4)                     |

Fase 0 não é cortável. Da Fase 6 para trás, pode-se cortar por tempo — exceto Fase 7
(processo), que é o que evita repetir esta rodada inteira.

---

## Fase 0 — Bugs bloqueantes ⚠️ primeiro, sem exceção

### A001 — Editar o próprio título trava com `expectedVersion is required` (item 9)

`packages/client/src/components/contacts/ContactsPanel.svelte:341-347` ·
`packages/client/src/lib/docs/sendOp.ts` · `packages/server/src/net/handlers/doc-handlers.ts:1015-1020`

**(a) Manda:** G062 (`tasks.md:629-630`) — "Título livre sob o nome, editável no próprio
cartão por quem tem posse e pelo Mestre". REQ-CTT-024/085.

**(b) Estado atual:** `commitTitle()` em `ContactsPanel.svelte:341-347` monta o `doc:update`
e chama `sendOp()` **diretamente**, sem passar por `toEnvelope()`/`makeSendOpFn()` —
os únicos pontos que preenchem `expectedVersion` a partir do `DocumentMirror`
(`sendOp.ts`, `fillExpectedVersion` linhas 361-377, `normalizeDocUpdate` linhas 556-584).
No servidor, `doc-handlers.ts:1015-1020` recusa qualquer update de não-privilegiado sem
`expectedVersion`, com a mensagem exata reportada: `"expectedVersion is required for
${documentType}/${upd._id} — reload the document and retry"`.

**(c) Causa:** `ContactsPanel.svelte` é um caso que não passou pelo funil padrão de escrita
de documento — `contactTitleDiff(next)` monta o diff certo, mas falta envelopar a chamada
como `toEnvelope({ type: "doc:update", documentType: "Actor", id: card.id, diff })` antes de
`sendOp`, igual a todo outro call site do repo.

**(d) Tarefa:** trocar a chamada de `commitTitle()` para o funil `toEnvelope`/`sendOp`
padrão (o mesmo usado pelos demais componentes do repo), preenchendo `expectedVersion` a
partir do `DocumentMirror`. **Pronto quando:** um jogador OWNER edita o título do próprio
personagem e a mudança persiste sem erro, com teste que reproduz a tentativa antiga (chamada
crua sem `expectedVersion`) e prova a recusa antes do fix / o sucesso depois.

---

### A002 — Preview do compêndio trava em "Carregando documento…" (item 13)

`packages/client/src/components/compendium/CompendiumPreviewWindow.svelte:120-135` ·
`packages/client/src/lib/compendium/compendiumApi.ts:41-58,173-176` ·
`packages/server/src/compendium/handlers.ts:196-221`

**(a) Manda:** REQ-CPD-051 — "carregar o documento completo sob demanda... exibir estado de
carregamento, erro com nova tentativa". G094 (`tasks.md:942-949`).

**(b) Estado atual:** `load()` chama `getDocument()` → `sendQuery(socket, "compendium:get",
...)`, timeout 10s. O handler do servidor sempre resolve o ack (inclusive em exceção, via
try/catch do dispatcher genérico em `net/socket-manager.ts:862-870`). `requireConnectedSocket`
(`compendiumApi.ts:41-58`) já tem um guard comentado como fix de um bug de classe conhecida:
_"socket.io buffers `emit()` calls on a disconnected/replaced Socket instance silently: the
ack callback never fires... endless spinner with ZERO ops reaching the server"_ — mas esse
guard só cobre o caso `socket.connected === false` no momento da chamada.

**(c) Causa provável:** o cenário documentado no próprio comentário do código — socket
"congelado" (trocado/reconectado sem que `getSocket()` reflita isso) — ainda pode ocorrer se
o servidor descartou a sessão do lado dele antes do cliente perceber (timeout assimétrico).
Não há um segundo caminho de código que prenda `loadState` em `"loading"` fora dessa classe
de bug — o `$effect` só reexecuta `load()` enquanto `status === "loading"`.

**(d) Tarefa:** reproduzir ao vivo com DevTools abertos (console + Network) no momento da
trava, confirmando se `SocketUnavailableError` é lançado e capturado por `load()`'s catch, ou
se o emit trava sem erro nenhum (silêncio total = reconexão inconsistente entre cliente e
servidor). Se for o segundo caso, adicionar timeout explícito no lado do handler de preview
que force `loadState = "error"` mesmo quando o socket "parece" conectado. **Pronto quando:**
teste manual com socket forçadamente obsoleto (reconectar no meio de um preview) resulta em
estado de erro com retry, nunca em spinner infinito.

---

### A003 — Tela trava depois de abrir preview ou clicar "Trazer para o mundo" (item 14)

`packages/client/src/components/compendium/{CompendiumBrowser,CompendiumPreviewWindow}.svelte` ·
`packages/client/src/components/WindowHost.svelte:129,136`

**(a) Manda:** DEC-CPD-03 — pré-visualização é janela **não-modal**, não bloqueia o painel
(`Window.svelte:175`, `aria-modal="false"`). REQ-CPD-060 — retorno visível de sucesso/falha
de "trazer para o mundo" sem destruir a lista.

**(b) Estado atual:** não há overlay capturando `pointer-events` — `WindowHost.svelte:129`
define `pointer-events: none` no host, `pointer-events: all` só dentro de cada janela.
`bringOver()` em `CompendiumBrowser.svelte:658-685` e em `CompendiumPreviewWindow.svelte:148-175`
estão os dois em `try/catch/finally`, com `finally` sempre limpando o estado de "importando".
O dispatcher do servidor sempre chama `ack`.

**(c) Causa:** inconclusiva por leitura estática — o código deste fluxo específico está bem
defendido. É consistente com o mesmo "frozen-socket" do item A002 se propagando para outro
componente que assina o mesmo socket sem guard, ou com `worldMirror.subscribe` em
`CompendiumBrowser.svelte:328-341` reentrando em loop se o broadcast do próprio import
disparar o efeito de novo.

**(d) Tarefa:** reproduzir com DevTools (console + Network) ligados, no MESMO teste do A002
(águia): se o console mostrar erro JS não tratado no momento do travamento, isso aponta a
causa exata; se não mostrar nada, suspeitar de loop reentrante em `worldMirror.subscribe`.
**Pronto quando:** clicar "Trazer para o mundo" ou abrir/fechar o preview da águia repetidas
vezes não deixa a UI sem responder, com teste manual documentado no PR.

---

### A004 — Adicionar baú falha: `tokens: Expected array, received object` (item 22)

`packages/client/src/lib/npcs/npcsFooter.ts` (`buildPlaceChestTokenOp`) ·
`packages/client/src/components/scenes/TokenAddDialog.svelte` (mesmo padrão) ·
`packages/server/src/net/handlers/doc-handlers.ts:2154-2184` (`applyDotPathDiff`) ·
`packages/shared/src/scene.ts:426`

**(a) Manda:** schema real: `tokens: z.array(TokenDocumentSchema).default(() => [])` — é
array. G076 (`tasks.md:763`) — "Rodapé fixo com o controle do baú... arraste que cria
presença".

**(b) Estado atual:** `buildPlaceChestTokenOp` em `npcsFooter.ts` monta o diff como
`{ tokens: { $push: { _id: ..., name, actorId, ... } } }` — um pseudo-operador estilo
MongoDB `$push` que **não existe em lugar nenhum do código-fonte** (`grep -rn "\$push"
packages/server packages/shared` não retorna nada). `TokenAddDialog.svelte` usa exatamente o
mesmo padrão incorreto — não é um bug introduzido só pela aba NPCs.

**(c) Causa exata:** `applyDotPathDiff` (`doc-handlers.ts:2154-2184`) só faz atribuição
direta por dot-path — para a chave `"tokens"` (sem ponto), `result.tokens = { $push: {...} }`
substitui o array inteiro por um objeto, e o Zod rejeita com a mensagem exata reportada.

**(d) Tarefa:** trocar o diff de `npcsFooter.ts` (e `TokenAddDialog.svelte`, mesmo padrão,
mesmo bug) para enviar o **array completo** com o novo token concatenado ao final,
calculado a partir do estado atual conhecido pelo cliente (via `DocumentMirror`) — nunca um
pseudo-operador que o merge genérico não entende. **Cobre:** REQ-NPC-060..063. **Pronto
quando:** colocar um baú na cena funciona sem erro, com teste que reproduz o payload antigo
(`{ $push: ... }`) e prova a recusa, e o payload novo (array completo) e prova o sucesso.
Como o mesmo bug existe em `TokenAddDialog.svelte`, o fix deve cobrir os dois call sites no
mesmo PR.

---

### A005 — Cenas não carregam para PLAYERS: tela preta (item 24) ⚠️ mais crítico

`packages/client/src/lib/canvas/scene-orchestrator.ts:288-310` ·
`packages/client/src/lib/canvas/sceneLoader.ts:70-79` ·
`packages/shared/src/scene.ts:340` (`backgroundColor` default `"#000000"`) ·
`packages/server/src/net/redaction.ts:396` (`redactSceneDocsForNonPrivileged`)

**(a) Manda:** REQ-CNV-070 (`specs/06-canvas-e-renderizacao.md:396`) — ativar cena grava
fonte única e transmite a todos; cada cliente recarrega com os placeables e aplica a
initial view. REQ-CEN-072 (`specs/44-aba-cenas.md`) — o jogador continua recebendo os
dados da cena no ar necessários para renderizá-la. G086 (`tasks.md:876`) cobre exatamente
isso: lista de cenas não sai para não-privilegiado, mas a cena **no ar** continua fluindo.

**(b) Estado atual — pipeline de redação revisado a fundo, sem defeito encontrado nele
mesmo:** `redactSceneDocsForNonPrivileged` filtra mantendo o doc `active===true`, usada
pelos três caminhos de emissão (snapshot de join em `sync-handlers.ts:397`, broadcast ao
vivo em `doc-handlers.ts:1958`, replay de delta em `sync-handlers.ts:229`) — os comentários
no código citam explicitamente o bug histórico já corrigido ("a LIMITED filter used to drop
EVERY scene from a player's join snapshot"). No cliente, `worldSync.ts:205-210` aplica o
mirror antes de setar `activeSceneId`, e `activeScene.svelte.ts` deriva reativamente.
Existem testes dedicados (`scene-list-redaction.test.ts`, `scene-on-air.test.ts`,
`e2e-resync.test.ts`). **A trilha servidor→mirror→estado ativo não mostrou lacuna.**

**(c) Causas prováveis, em ordem de probabilidade (nenhuma confirmada — precisa
reprodução ao vivo):**

1. **Fog/visão sem token controlado pelo jogador.** `scene-orchestrator.ts:288-310`:
   `fogEnabled = !this._isGm` — o GM ignora fog, o jogador não. Se o jogador não tem
   nenhum token próprio na cena ativa, a visão computada é vazia e o `LightingRenderer`
   cobre a cena inteira de escuridão — visualmente indistinguível de tela preta, sem erro
   no console. **Teste decisivo:** reproduzir com um PLAYER com token próprio na cena vs.
   um sem token.
2. **Fallback silencioso para preto puro em falha de carregamento da imagem de fundo.**
   `sceneLoader.ts:70-79`: se `resolveAssetUrl`/`Assets.load` falhar (401/403/timing), cai
   em `catch` e pinta um retângulo sólido com `scene.backgroundColor`, cujo default no
   schema é `"#000000"` (`packages/shared/src/scene.ts:340`). Só emite
   `console.error("[sceneLoader] background load failed:", ...)`. **Teste decisivo:** abrir
   o console do PLAYER no momento da tela preta e procurar essa string.
3. **Regressão de renderer WebGPU** — a memória do projeto (`project_fusion_mapa_preto.md`)
   documenta esse padrão de sintoma, mas o fix histórico (`isRenderGroup` não pintando sob
   WebGPU) já está presente em `alfa/app` (`FusionCanvas.ts:355` usa `Container()` simples).
   Menos provável como causa nova, mas não descartar sem teste ao vivo.
4. **Corte por G083/G086 na própria gaveta** — revisão do pipeline (item b) não encontrou
   lacuna; só reconsiderar se as hipóteses 1 e 2 forem descartadas.

**(d) Tarefa:** reproduzir com um PLAYER real, DevTools abertos, testando primeiro a
hipótese 1 (token próprio presente/ausente) e depois a 2 (procurar a string de erro no
console). **Pronto quando:** a causa raiz está identificada com evidência de console/rede
citada no PR, e o jogador vê a cena no ar (não necessariamente tudo corrigido no mesmo PR,
mas a causa não pode continuar "inconclusiva" — se a correção for maior que este PR, abrir
issue nomeando a causa confirmada).

---

### A006 — Papel "Confiável" (TRUSTED) aparece; suspeita de ASSISTANT extinto (item 28)

`packages/server/src/auth/user-store.ts:20-25` (`enum Role`) ·
`packages/server/src/documents/ownership.ts:24-30,50-54` (`enum UserRole`) ·
`packages/client/src/lib/settings/{usersSection,permissionsSection}.ts` ·
`specs/05-usuarios-e-permissoes.md` (DEC-USR-01, REQ-USR-005) ·
`specs/37-configuracoes.md:193-197` (nota de implementação da DEC-CFG-10)

**(a) Manda:** DEC-USR-01/REQ-USR-005 — quatro papéis ativos: `PLAYER`, `TRUSTED`,
`ASSISTANT`, `GAMEMASTER`. **`TRUSTED` é canônico da spec 05 — não é invenção da
implementação.** O que **foi** extinto (issue #133, 2026-08-15) é um enum **diferente**:
`ASSISTANT_GM`, usado internamente em `packages/server/src/documents/ownership.ts`. A spec
37 já registra a distinção por escrito (linha 193-197): _"o predicado de hoje é
`isRolePrivileged`, que inclui `ASSISTANT_GM`... enquanto a issue não roda, guardar
explicitamente por GAMEMASTER"_.

**(b) Estado atual:** há **dois enums de papel** que não são o mesmo: `Role` em
`user-store.ts` (espelha a spec 05: `PLAYER=1, TRUSTED=2, ASSISTANT=3, GAMEMASTER=4`) e
`UserRole` em `ownership.ts`, que **ainda tem `ASSISTANT_GM=3`** apesar da issue #133 —
usado em `combat-handlers.ts:22`, `chat-handler.ts:162/1041`, `world-permissions.ts` etc.
`isGamemasterStrict` foi criada como contorno pontual só para a aba Configurações. O
seletor de papel do cliente (`usersSection.ts:22`, `USER_ROLE_OPTIONS = [1,2,3,4]`) itera
sobre o `Role` de `user-store.ts` — **não** sobre `UserRole` — então o "Confiável" (TRUSTED)
que o Alexandre viu é papel 2 (spec 05, legítimo), não `ASSISTANT_GM`.

**(c) Causa:** confusão de nomenclatura entre dois papéis parecidos (`ASSISTANT` da spec 05,
vivo e correto; `ASSISTANT_GM` do código, extinto pela issue #133 mas **ainda presente** em
`ownership.ts` e consumido por handlers fora da aba Configurações). A issue #133 não rodou
por completo — só a aba Configurações foi isolada do problema via `isGamemasterStrict`.

**(d) Tarefa — duas frentes distintas:**

1. **Confirmar com o Alexandre** que `TRUSTED` é papel legítimo da spec 05 (REQ-USR-005) e
   não deve ser removido do seletor — só registrar a citação exata para fechar a dúvida.
2. **Concluir a issue #133 de verdade:** remover `ASSISTANT_GM` de `ownership.ts` e migrar
   os handlers que ainda o consomem (`combat-handlers.ts`, `chat-handler.ts`,
   `world-permissions.ts` e outros achados por `grep -rn "ASSISTANT_GM" packages/server/src`)
   para o predicado `isGamemasterStrict` ou equivalente, eliminando o enum divergente.
   **Pronto quando:** `grep -rn "ASSISTANT_GM" packages/server/src` volta vazio e
   `isRolePrivileged` não referencia mais um papel extinto.

---

### A007 — Regressão: sem arma equipada não dá para atacar (falta punho) (item 31)

`systems/pf2e/src/derivations/equipment.ts`

**(a) Manda:** todo personagem deve ter sempre o ataque desarmado de "Punho" disponível
como fallback — regra RAW básica de PF2e, corrigida uma vez (issue #62) e presente em
`build/app`, ausente em `alfa/app`.

**(b) Estado atual em `alfa/app`:** `equipment.ts` só inclui na lista de armas os itens de
`category === "unarmed"` que já existirem explicitamente no ator — sem sintetizar um "Fist"
quando nenhum existe. Confirmado: `git log origin/alfa/app --oneline -i --grep="punho|
fist|unarmed|desarmad"` só retorna commits anteriores à divergência das duas linhas
(02/08).

**(c) Commits candidatos em `origin/build/app`, em ordem, todos tocando só
`systems/pf2e/`:**

1. **`e8fc80c`** — `feat(pf2e): todo personagem ganha o ataque desarmado de Punho por
regra (#62)` (12/08 19:03) — `systems/pf2e/src/derivations/equipment.ts` (+23/-8),
   `systems/pf2e/src/__tests__/derivations-equipment.test.ts` (+85/-4). Introduz a síntese
   do "Fist" (1d4 contundente) quando o scan não encontra nenhuma arma desarmada.
2. **`3a420f9`** — `fix(pf2e): garra concedida deixa de comer o Punho do personagem`
   (12/08 21:14) — mesmos dois arquivos (+53/-8 e ajustes). Corrige dedupe do Punho
   sintético (trocou `category === "unarmed"` por `category === "unarmed" && name ===
"Fist"`), permitindo Claw+Fist coexistirem. **Nota do próprio commit:** documenta duas
   falhas pré-existentes e não corrigidas ali ("Fighter level 5 — Strike (Longsword)" e
   "Agile weapon strike MAP") — avisar o Alexandre de que o cherry-pick não é 100%
   fechado mesmo depois desses três commits.
3. **`2beab12`** — `test(pf2e): derivations.test.ts absorve o Punho sintético — 2 strikes
com arma equipada` (12/08 21:45) — `systems/pf2e/src/__tests__/derivations.test.ts`
   (+13/-2). Ajusta duas asserções que esperavam 1 strike para 2 (o Punho sintético agora
   sempre entra na lista, por último).

**(d) Tarefa:** cherry-pick dos três commits em sequência (o 2º corrige um bug introduzido
pelo 1º; o 3º ajusta testes afetados pelo 1º) para `alfa/app`, resolvendo conflitos se
houver (as duas linhas divergiram em `ab4966f`, 02/08 — conferir se `equipment.ts` mudou de
forma incompatível desde então). **Pronto quando:** `pnpm test` verde em
`systems/pf2e/src/__tests__/{derivations,derivations-equipment}.test.ts`, e um personagem
sem arma equipada e sem item desarmado próprio tem "Punho" disponível na lista de strikes.

---

## Fase 1 — Rail de ícones (spec 36)

### A010 — Rail preenchido como coluna, protótipo mostra ícones soltos (item 1)

`packages/client/src/components/sidebar/SidebarRail.svelte:136-149` ·
`packages/client/prototypes/sidebar-rail.prototype.html` (variante C, `.C .tabs`)

**(a) Manda:** REQ-GAV-001 (`specs/36-gaveta-lateral.md:198-201`) — "coluna vertical de
botões só-ícone". A variante C do protótipo implementa isso como botões individuais
flutuantes: `.C .tabs` (linha 111) define `width:44px; display:flex; flex-direction:column;
gap:3px; align-items:flex-end` — **sem `background`**. Cada botão (`.C .tabs .tabbtn`)
carrega a própria forma: `width:40px; height:44px; border-radius:var(--radius) 0 0
var(--radius); background:var(--surface-alt)`, com o botão ativo crescendo a 44px e
"grudando" no painel — o efeito de "marcador de livro".

**(b) Estado atual:** `.sidebar-rail` (linhas 136-149) tem `background: var(--fusion-surface-
alt)` cobrindo os 44px inteiros da coluna, mais `border-left` — um fundo sólido contínuo,
diferente do protótipo, que não tem fundo de contêiner algum. Os botões
(`.sidebar-rail__button`, linhas 172-186) também são menores (36×36→40×40) e transparentes
por padrão, resultando em ícones soltos sobre uma placa de fundo, não em "abas físicas"
isoladas.

**(d) Tarefa:** remover o `background`/`border-left` de `.sidebar-rail` (o contêiner passa a
não pintar fundo nenhum); redimensionar `.sidebar-rail__button` para 40×44 com
`border-radius` só no lado esquerdo (`var(--radius) 0 0 var(--radius)`) e `background:
var(--fusion-surface-alt)` no próprio botão (não no contêiner); alinhar à direita
(`align-items: flex-end`); manter o crescimento do botão ativo para 44px. **Cobre:**
REQ-GAV-001. **Pronto quando:** captura de tela lado a lado com `sidebar-rail.prototype.html?
variant=C` mostra a mesma ausência de preenchimento contínuo — critério visual: nenhum pixel
de fundo do rail visível fora da área dos próprios botões.

---

### A011 — Ordem GM/Configurações no rodapé (itens 2 e 32) — achado: já implementado corretamente

`packages/client/src/lib/sidebar/registry.ts:296-315` (`getVisibleSidebarTabs`) ·
`packages/client/src/components/sidebar/SidebarRail.svelte:109-131`

**(a) Manda:** DEC-GAV-01 emendada por DEC-GAV-09 e REQ-GAV-003 — três blocos separados:
grupo "all", depois grupo "gm", depois **Configurações sozinha, ancorada no rodapé**. O
protótipo confirma: `.C .tabs .grp.gm{margin-top:14px}` e `.C .tabs .foot{margin-top:auto}` —
GM e Configurações não ficam colados.

**(b) Estado atual:** `getVisibleSidebarTabs` já separa em três buckets (`all`, `gm`,
`footer`), com `SETTINGS_TAB_ID` sempre roteado para `footer` independente do `group`
declarado. `SidebarRail.svelte` renderiza os três blocos em divs separadas, com
`.sidebar-rail__group--gm` (`margin-top:6px`) e `.sidebar-rail__group--footer`
(`margin-top:auto`) — a mesma estrutura do protótipo.

**Achado:** a investigação **não encontrou divergência** entre o código e DEC-GAV-01/
DEC-GAV-09 — o código já implementa GM no bloco do meio e Configurações isolada no rodapé,
com vão entre eles. O pedido do Alexandre ("abas de GM deveriam ficar no rodapé, junto da
aba de Configurações, começando de baixo pra cima") descreve um agrupamento diferente do
que a spec 36 manda hoje.

**(d) Tarefa:** **não é tarefa de código — é tarefa de confirmação.** Levar ao Alexandre a
citação de DEC-GAV-01/DEC-GAV-09 e a captura de tela do estado atual; se ele confirmar que
quer mudar a decisão (GM colado a Configurações, crescendo de baixo para cima), isso é
emenda de spec 36 (`CONVENCOES.md` §2: spec muda antes do código) antes de qualquer PR de
UI. Se ele confirmar que o estado atual já está certo e a observação foi sobre uma build
desatualizada, fechar sem código.

---

## Fase 2 — Aba Chat (spec 38)

### A020 — Ícones de visibilidade não ocupam a barra inteira (item 3)

`packages/client/src/components/chat/RollModeSelector.svelte:71-81` ·
`packages/client/prototypes/chat-tab.prototype.html:261` (`.modes`)

**(a) Manda:** DEC-ACH-04 (`specs/38-aba-chat.md:98-104`) — "faixa com quatro ícones
desenhados... indicador deslizante". No protótipo, `.modes{display:grid;grid-template-
columns:repeat(4,1fr);height:26px}` dentro de `.composer` (flex-column) — estica para a
largura total do composer. Há também `.modes .thumb`, indicador deslizante animado
(`transition:left .14s`).

**(b) Estado atual:** `.roll-mode` é `display: inline-flex; flex-shrink: 0; align-self:
center` — grupo compacto autodimensionado, não um grid de 4 colunas a 100% de largura. Não
há elemento "thumb" deslizante; o modo ativo é marcado só por `box-shadow: inset 0 0 0 1px
var(--fusion-accent)` no próprio botão.

**(d) Tarefa:** reescrever `.roll-mode` como `display: grid; grid-template-columns: repeat(4,
1fr); width: 100%`, dentro do fluxo de `ChatInput.svelte` (que já o posiciona "sua própria
linha abaixo da caixa" — só o CSS interno precisa mudar). Adicionar o indicador deslizante
(`.roll-mode__thumb`, `position: absolute`, `transition: left .14s`) atrás dos 4 botões.
**Cobre:** DEC-ACH-04, REQ-ACH-040. **Pronto quando:** captura lado a lado com
`chat-tab.prototype.html` mostra a faixa ocupando 100% da largura do composer, com indicador
deslizante visível na troca de modo.

---

### A021 — Menu "⋯" não fecha ao clicar fora (item 4)

`packages/client/src/components/chat/ChatPanel.svelte:77,140-149,205-274`
(`.chat-panel__menu-anchor`)

**(a) Manda:** comportamento padrão esperado de menu popover — REQ-ACH-015/G033
pressupõem um menu que se comporta como menu (fecha ao perder foco fora dele).

**(b) Estado atual:** `menuOpen` só é alternado por `toggleMenu()` (clique no próprio botão
"⋯") e fechado por `handleMenuKeydown()` só para `Escape`. **Causa confirmada:** não há
nenhum listener de `click`/`pointerdown` fora do menu em todo o arquivo — busca por
`document.addEventListener`, `window.addEventListener`, `use:clickOutside` não retorna nada.

**(d) Tarefa:** adicionar um listener de outside-click (padrão já usado em outros
componentes do repo, se existir uma diretiva `use:clickOutside` compartilhada — senão criar
uma pequena e reutilizável em `lib/ui/`) que fecha `menuOpen` ao clicar fora de
`.chat-panel__menu-anchor`. **Pronto quando:** teste (ou verificação manual documentada)
prova que clicar em qualquer ponto fora do menu o fecha, e que `Escape` continua funcionando.

---

### A022 — Chat muito diferente do protótipo: cores e agrupamento (item 5) — "Decepção."

`packages/client/src/components/chat/ChatMessage.svelte:462,715` ·
`packages/client/src/lib/chat/chatGrouping.ts` ·
`packages/client/prototypes/chat-tab.prototype.html:410,592,623-624`

**(a) Manda:** protótipo define cor por remetente — `const COLOR = {Gamemaster:'#ff5c5c',
Fofurinha:'#7c5cfc', Tobias:'#3ddc84'}` — aplicada ao nome e à borda esquerda de cada
mensagem (`style="border-left-color:${bcolor}"`). Tipos especiais têm cor própria: sussurro
= roxo accent + fundo tintado (`.m--whisper`), cega = âmbar/warn + fundo tintado
(`.m--blind`), card de sistema = azul fixo `#2f7fa8` (`.m--sys`). G036/REQ-ACH-025 exige
agrupamento de mensagens consecutivas do mesmo autor (cards, sussurros, invalidadas nunca).

**(b) Estado atual — agrupamento JÁ EXISTE:** `chatGrouping.ts` implementa
`groupChatMessages` e `collectContinuations`, consumido por `ChatLog.svelte`/
`ChatMessage.svelte` (`continuesPrevious`), com teste dedicado
(`chatGrouping.test.ts:221`, "invalidada nunca agrupar"). **Não é lacuna.**

**Estado atual — cores por autor FALTAM:** `ChatMessage.svelte` não tem nenhuma referência
a cor por remetente. A única regra de borda esquerda encontrada é fixa para qualquer
mensagem: `border-left: 2px solid var(--fusion-accent-dim)` (linhas 462 e 715) — a mesma cor
para todo mundo. Não há mapeamento nome→cor nem diferenciação de sussurro/cego/card por cor
de borda como no protótipo — só por classes de tipo, sem a paleta.

**(d) Tarefa:** implementar paleta determinística por remetente (hash do `speaker.alias`/
`authorId` → cor de uma paleta fixa de acento, respeitando tema claro/escuro), aplicada ao
nome e à borda esquerda da mensagem; cores fixas por tipo especial (sussurro, cega, card de
sistema) conforme o protótipo. **Cobre:** DEC-ACH-02/03 (barra e caixa, G033). **Pronto
quando:** captura lado a lado com `chat-tab.prototype.html` mostra a mesma distinção visual
por remetente e por tipo de mensagem.

---

### A023 — Busca em popout "fora da barra" (item 6) — achado: não confirmado no código atual

`packages/client/src/components/chat/ChatPanel.svelte:162-183,282-296,356,479-485`

**(a) Manda:** G033 (`tasks.md:347-358`) — "Barra superior fixa com pesquisa ocupando a
largura". DEC-ACH-07 — clicar num **resultado** (não a busca em si) abre uma janela de
contexto.

**(b) Estado atual:** `.chat-panel__search` está dentro de `.chat-panel__bar` (barra fixa do
topo), `flex: 1`. Os resultados (`.chat-panel__results`) substituem o log **inline**, dentro
do próprio painel — não é modal/popup. O que abre em janela flutuante é o **contexto** de um
resultado clicado (`lib/chat/chatContext.svelte.ts`), comportamento correto de DEC-ACH-07.

**Achado:** nesta leitura, não há busca em popout — a implementação bate com G033.

**(d) Tarefa:** **confirmação, não código.** Esclarecer com o Alexandre se a observação é
sobre o popup de **contexto** de um resultado (correto por spec) sendo confundido com a
busca em si, ou se há comportamento diferente no ambiente testado (build desatualizada de
antes do PR de chat consolidar, ou outro componente). Se confirmado que é sobre o contexto,
fechar sem código; se houver de fato um caminho de busca em popup que a leitura não
encontrou, reabrir com repro específica.

---

### A024 — Não dá para invalidar uma mensagem (item 7)

`packages/server/src/chat/chat-handler.ts:1004+` (`chat:invalidate`, completo) ·
`packages/client/src/components/chat/ChatMessage.svelte` (sem botão) ·
`packages/client/prototypes/chat-tab.prototype.html:614-616` (`invBtn`)

**(a) Manda:** REQ-CHT-005, REQ-ACH-080..086 (G032, `tasks.md:333-345`) — invalidar em vez
de deletar, GAMEMASTER e autor podem invalidar, revalidar é regra do Mestre. O protótipo tem
o botão `⊘`/`↺` que dispara a ação.

**(b) Estado atual:** o **servidor** implementa o handler completo, com a regra de quem pode
invalidar/revalidar e a gravação de `invalidatedBy`/`invalidatedAt`. O **protocolo**
(`packages/shared/src/chat/protocol.ts:253+`) já existe. O **cliente só consome**:
`ChatMessage.svelte` lê `isInvalidMessage`/`invalidatedBy` para exibir riscado, mas **não
há nenhuma chamada `socket.emit("chat:invalidate", ...)` em lugar nenhum do cliente** — o
botão do protótipo nunca foi implementado.

**(c) Causa:** lacuna de escopo — G032 entregou a metade servidor; a metade cliente (botão +
gesto em `ChatMessage.svelte`) nunca teve task dedicada em nenhuma das G030-G041.

**(d) Tarefa:** adicionar o botão de invalidar/revalidar em `ChatMessage.svelte`, visível
conforme a regra (autor vê botão nas próprias mensagens não invalidadas pelo Mestre; Mestre
vê em qualquer mensagem), chamando `chat:invalidate` pelo funil padrão de socket.
**Cobre:** REQ-ACH-080..086 (metade cliente). **Pronto quando:** um jogador invalida a
própria mensagem e vê o risco aplicado; uma tentativa de revalidar mensagem que o Mestre
invalidou é recusada (servidor já cobre — só falta o cliente expor os dois gestos).

---

### A025 — Dados favoritos "pioraram muito"; seletor de modo nos favoritos (item 8)

`packages/client/src/components/chat/{DiceTray,FavoriteDiceEditor,RollBuilderWindow}.svelte`

**(a) Arqueologia git — "tela boa que sumiu":** varredura de `git log --all` em
`DiceTray.svelte`/`FavoriteDiceEditor.svelte`/`RollBuilderWindow.svelte` encontrou **um
único commit** que cria esses arquivos: `8f0f441` ("servidor e libs da Aba Chat — estágio
servidor-e-libs", 2026-08-16). Confirmado com `git show 8f0f441^:.../DiceTray.svelte` →
`fatal: path ... exists on disk, but not in '8f0f441^'` — **o arquivo nasceu inteiro nesse
commit**. Os três commits seguintes da Fase 3 (`7517792`, `6ef33e0`, `dc2d7af`) nunca voltam
a tocar esses três arquivos. **Não existe, em nenhum ref alcançável, uma versão anterior
diferente da atual.** Se a "tela boa" existiu, foi um estado transitório dentro de uma
sessão/worktree nunca commitado — não é recuperável por git, e **não há commit que
regrediu** para apontar. Isso precisa ser dito ao Alexandre tal como é: a evidência não
sustenta a hipótese de regressão via commit.

**(b) Seletor de modo dentro do editor de favoritos — achado: a spec pede o OPOSTO do que
foi relatado como proibido, mas só para a JANELA DE MONTAGEM, não para o editor de
favoritos:**

- DEC-ACH-06 (`specs/38-aba-chat.md:142-149`) — a **janela de montagem** "não tem seletor
  de modo — apenas informa em que modo a rolagem vai sair". REQ-ACH-061 confirma.
- G035 (`tasks.md:377-390`) — "A janela compõe o que se rola e não escolhe a plateia: só
  informa o modo do seletor" — isso é sobre a **janela**, não sobre o editor de favoritos.
- Verificado: `RollBuilderWindow.svelte` (a janela de montagem) **não tem** seletor de
  modo — só um aviso somente-leitura (`.roll-builder__mode`), citando REQ-ACH-061 no
  cabeçalho do arquivo. Correto.
- O seletor que **existe** está em `FavoriteDiceEditor.svelte` (`<select>` com as 4 opções +
  "segue o seletor") — e a spec **exige** isso ali: REQ-ACH-052
  (`specs/38-aba-chat.md:336`) — "O modo de um favorito DEVE ser 'segue o seletor' (padrão)
  ou **travado** em um dos quatro roll modes"; REQ-ACH-055 (linha 344) — "O editor de
  favoritos DEVE... permitir alterar rótulo, fórmula e modo de cada um dos três".

**Achado:** pela letra da spec 38 hoje, o código está correto nos dois pontos — falta um
componente novo (a "tela boa" que o Alexandre viu não existe em nenhum commit) e o seletor de
modo é **exigido** no editor de favoritos por REQ-ACH-052/055, não proibido.

**(d) Tarefa — três frentes:**

1. **Confirmar com o Alexandre**, citando REQ-ACH-052/055/DEC-ACH-06 literalmente, se ele
   quer **mudar a decisão** (proibir modo travado por favorito também) — isso seria emenda
   de spec 38 antes de qualquer código, não correção de bug.
2. Se a resposta for "sim, quero ver de novo a tela boa" mas ela não existe em nenhum
   commit: pedir a ele para descrever com mais detalhe o que viu (print, se houver, ou
   descrição da sessão/data) — sem isso, não há alvo concreto de reconstrução.
3. Se nenhuma emenda for aprovada, revisar visualmente `DiceTray.svelte`/
   `FavoriteDiceEditor.svelte` contra o protótipo `chat-tab.prototype.html` (fileira de
   favoritos + botão de montagem) e alinhar o layout — isso é ajuste de UI normal, não
   arqueologia.

---

## Fase 3 — Contatos e NPCs (specs 39/42)

### A030 — Granularidade de "o que se sabe quando entrevisto" (item 10) — lacuna de spec, registrar para o futuro

`specs/39-contatos.md` (REQ-CTT-070..076, DEC-CTT-04) · `specs/42-aba-npcs.md`
(REQ-NPC-030..036)

**(a) Manda:** o modelo atual é binário por bloco — 3 estados (oculto/entrevisto/
conhecido) por par contato×personagem, e DEC-CTT-04/REQ-CTT-081 escondem nome+título+
retrato **juntos**, como bloco único, quando `entrevisto`. Não há granularidade por
atributo em nenhuma das duas specs — ambas excluem a ficha do personagem do escopo
(DEC-CTT-09, DEC-NPC-13), empurrando qualquer refinamento para uma "spec de ficha" futura.

**(b) Estado atual:** confirma a lacuna — não existe campo de configuração "o que se sabe
da ficha quando entrevisto" em nenhum documento nem em nenhuma das duas specs.

**(d) Tarefa:** **não implementar agora** (fora de escopo das specs 39/42 vigentes) — só
registrar, na spec 39 ou 42 (seção de "o que este documento não fecha"), a intenção
explícita do Alexandre de que cada NPC tenha, no futuro, controle granular de quais campos
da ficha aparecem em `entrevisto` (ex.: mostrar nome mas não atributos, ou vice-versa) — como
**apontamento para spec futura de ficha**, sem mexer no modelo de 3 estados hoje. **Pronto
quando:** a nota está escrita numa das duas specs, citando este item como origem, e nenhum
código foi tocado.

---

### A031 — Tokens não são arrastáveis para o canvas (item 11)

`packages/client/src/components/npcs/NpcsPanel.svelte:593-594` ·
`packages/client/src/components/TableScreen.svelte:264,292-310,582-589`

**(a) Manda:** G076 (`tasks.md:763`) — "Arrastar a linha para o canvas cria uma presença do
ator na cena". **Nota de fronteira:** a forma final da peça criada (arte lida do ator,
footprint derivado do tamanho) é tarefa da frente de Token —
[`TK040`/`TK041`](../spec-41-token/tasks.md) — este item aqui é só sobre o **gesto de
arrastar em si** funcionar, que é G076/gaveta, não Token.

**(b) Estado atual — achado: o gesto ESTÁ implementado, contrariando a premissa "coisíssima
nenhuma":** `NpcsPanel.svelte:593-594` tem `draggable="true"` + `ondragstart`, gravando
`NPC_DRAG_MIME` (`"application/fusion-actor"`). `TableScreen.svelte:582-589` tem
`ondragover`/`ondrop` lendo o mesmo MIME e criando o token via `buildTokenFromActorFields`.
Há teste dedicado (`npcDragToCanvas.test.ts`).

**(c) Causa provável do sintoma relatado:** `handleCanvasDragOver`/`handleCanvasDrop`
(`TableScreen.svelte:292-310`) exigem `isGm() === true` **e** `canvasScene` não-nulo (cena
preparada/ativa carregada). Se `isGm()` não reconheceu o papel no momento do teste, ou não
havia cena carregada no canvas, o `dragover` não chama `preventDefault()` e o navegador
rejeita o drop **silenciosamente**, sem erro visível — indistinguível de "não funciona".

**(d) Tarefa:** **antes de qualquer código**, reproduzir com papel de Mestre confirmado
(checar `isGm()` no console) e uma cena efetivamente carregada no canvas (não só ativa no
servidor — carregada localmente). Se o drag continuar falhando nessas condições, é bug novo
a investigar com mais profundidade (não coberto por este levantamento); se funcionar, o
item fecha como "já implementado, checar pré-condições" — sem código.

---

### A032 — Barra de topo: um único "+" e busca, "adicionar pasta" igual ao protótipo (item 17)

`packages/client/src/components/npcs/NpcsPanel.svelte:792-820` ·
`packages/client/prototypes/npcs-tab.prototype.html:2254-2255,2440-2446`

**(a) Manda:** protótipo (`npcsHead()`, linhas 2440-2446): busca + **um** botão "+" (só
ícone, sem texto) na barra de topo. "Adicionar pasta" **não está na barra de topo** — é um
link textual discreto dentro da seção "pastas" do corpo (`<button class="add" data-
newfolder="">${UI.folderPlus} nova</button>`, linha 2254-2255), ao lado do rótulo "pastas",
mais um botão de "nova subpasta" por pasta ao hover.

**(b) Estado atual:** `NpcsPanel.svelte:792-820` tem **três** controles na mesma linha:
busca + botão "Novo não-jogável" (com texto) + botão "Nova pasta" (com texto) — os dois
botões deveriam ser um só "+" na barra, com "nova pasta" movido para dentro da seção
"pastas" como no protótipo.

**(d) Tarefa:** reduzir a barra de topo a busca + um botão "+" (ícone só, `aria-label`
"Novo não-jogável"); mover "Nova pasta" para dentro da seção de árvore de pastas, como link
textual discreto junto ao rótulo "pastas" (mesmo padrão do protótipo), com uma ação
equivalente por pasta ao hover para "nova subpasta". **Cobre:** REQ-NPC-020..029 (G070/G071
já cobrem a árvore — isto é só reposicionamento de UI). **Pronto quando:** captura lado a
lado com `npcs-tab.prototype.html` mostra a mesma barra de topo (busca + "+" só) e "nova
pasta" no mesmo lugar do protótipo.

---

### A033 — Nome do NPC truncado sem legibilidade (item 18)

`packages/client/src/components/npcs/NpcsPanel.svelte:1315-1326`

**(a) Manda:** nome legível na linha, truncando com reticências quando necessário.

**(b) Causa exata:** `.npcs-row__name` tem `overflow: hidden; text-overflow: ellipsis;
white-space: nowrap` mas **falta `min-width: 0`**. É filho de `.npcs-row__name-line` (flex,
com `min-width: 0` no pai), mas o próprio `.npcs-row__name`, como item flex, tem
`min-width: auto` por padrão — não encolhe abaixo do tamanho do conteúdo, então
`text-overflow: ellipsis` nunca atua; em vez disso o texto empurra os irmãos
(`.npcs-row__level`, `.npcs-row__attitude`, botão de ciclar atitude — todos `flex: 0 0
auto`) para fora ou estoura a linha.

**(d) Tarefa:** adicionar `min-width: 0` (ou `flex: 1 1 0`) em `.npcs-row__name`. **Pronto
quando:** um NPC com nome longo (ex. 40+ caracteres) trunca com reticências dentro da
largura da coluna, sem empurrar os elementos vizinhos.

---

### A034 — Nome do NPC importado em inglês, "Eagle" (item 19)

`packages/client/src/lib/npcs/npcRowVM.ts:297,342`

**(a) Manda:** nome exibido em pt-BR sempre que houver tradução.

**(b) Estado atual:** `name: text(doc.name)` — lido direto do campo `name` do documento do
ator, sem fallback de tradução. **Depende da raiz do problema, que é do import do
compêndio** (ver A041 — item 15): o documento importado grava `name` em inglês por decisão
deliberada de "mundo EN-puro" (`packages/server/src/compendium/service.ts:696-713`, issue
#43 do código). Este componente (`npcRowVM.ts`) só exibe o que o documento tem.

**(d) Tarefa:** **fica pendurada em A041.** Depois que A041 decidir se o `name` do
documento importado passa a ser gravado em pt-BR (ou se a exibição em toda a UI passa a
resolver tradução por `flags.fusion.sourceId`), este item se resolve automaticamente sem
mudança em `npcRowVM.ts` — ou, se a decisão for "exibição resolve, dado permanece EN", este
componente ganha o mesmo mecanismo de resolução que a listagem do compêndio já tem
(G093, "nome traduzido em destaque").

---

### A035 — Criação de NPC: nome embaixo, sem formulário dinâmico (item 20)

`packages/client/src/components/npcs/NpcCreateDialog.svelte` ·
`packages/client/prototypes/npcs-tab.prototype.html:2308-2338`

**(a) Manda:** REQ-NPC-041/043, DEC-NPC-06 — "janela de criação abre com dois caminhos
**lado a lado**". No protótipo, abas (`.wtabs`) "Do bestiário"/"Criar do zero" alternam o
corpo visível — só um bloco por vez; no modo "do zero", ordem é Tipo (pills) → Nome (input).

**(b) Estado atual:** não há `{#if}` alternando os dois blocos — **ambos são renderizados
sempre, simultaneamente, empilhados**: (1) Pasta+Atitude, (2) bloco "Do bestiário" completo
(título, busca, botão, resultados), (3) bloco "Do zero" (Subtipo → Nome → Preset). O campo
Nome já vem depois do Subtipo dentro do bloco "do zero" (não invertido literalmente), mas
fica muito abaixo na tela porque **quatro blocos inteiros** o precedem sem forma dinâmica —
tudo aparece de uma vez, sem pergunta inicial "quero fazer o quê?" que oculte o resto.

**(d) Tarefa:** reestruturar `NpcCreateDialog.svelte` como abas reais (`Do bestiário` /
`Criar do zero`), renderizando só o bloco ativo — igual ao protótipo. Dentro de "Criar do
zero", manter a ordem Tipo → Nome → Preset → Pasta/Atitude, com Nome em posição alta
(logo após escolher o tipo), não no fim da pilha. **Cobre:** REQ-NPC-040..048.
**Pronto quando:** captura lado a lado com `npcs-tab.prototype.html` mostra as mesmas duas
abas alternando o corpo, e o campo Nome visível sem scroll ao escolher "Criar do zero".

---

### A036 — Rodapé: botão do baú ocupa metade do espaço (item 21)

`packages/client/src/components/npcs/NpcsFooter.svelte:123-134` ·
`packages/client/prototypes/npcs-tab.prototype.html:2466-2468`

**(a) Manda:** protótipo: `<button class="hbtn chestb">` (baú, sem classe `wide`) +
`<button class="hbtn wide" id="matrix">` (Quem conhece) — só o segundo cresce
(`.hbtn.wide{flex:1}`); o baú fica do tamanho do próprio conteúdo (ícone + palavra "Baú").

**(b) Estado atual:** `.npcs-footer__row{display:flex}` com **os dois** botões usando a
mesma classe `.npcs-footer__btn{flex:1 1 0}` — dividem o rodapé meio a meio.

**(d) Tarefa:** dar ao botão do baú (`data-action="place-chest"`) uma classe própria sem
`flex: 1` (tamanho por conteúdo, `flex: 0 0 auto`), mantendo `flex: 1 1 0` só no botão
"Quem conhece" (`data-action="open-knowledge"`). **Cobre:** G076. **Pronto quando:**
captura lado a lado com o protótipo mostra o baú ocupando só o espaço do ícone/rótulo, com
o botão "Quem conhece" absorvendo o resto da largura.

---

### A037 — "Quem conhece quem" muito diferente do protótipo (item 23) — "MAIOR ÁREA DE FRUSTRAÇÃO"

`packages/client/src/components/contacts/KnowledgeGridWindow.svelte` ·
`packages/client/prototypes/{contacts-tab,npcs-tab}.prototype.html` (seção "conhece")

**(a) Manda:** REQ-CTT-060..067, G065 — grade contatos×personagens, célula cicla 3
estados, nome do contato cicla regra geral, nome do personagem cicla coluna, exceção
distinta visualmente, nunca só por cor (REQ-CTT-094). O protótipo usa **símbolos
compactos de um caractere** por célula (`SYM = ["·","◐","✓"]`, oculto/entrevisto/
conhecido), `font-size: 0.75rem`, célula mínima — matriz densa e estreita.

**(b) Estado atual:** `KnowledgeGridWindow.svelte` implementa estruturalmente **todos** os
requisitos funcionais: tabela com cabeçalho/coluna fixos (`position: sticky`), célula que
cicla, nome de linha cicla regra geral, nome de coluna cicla coluna, exceção marcada com
borda mais grossa + ícone SVG + palavra "Exceção", legenda dos 3 estados, estados vazios
tratados. **A lógica não é o problema.**

**Diferença real:** cada célula exibe o **rótulo textual completo** ("oculto"/"entrevisto"/
"conhecido") e, em exceção, ainda a palavra "Exceção" embaixo — `width: 100%; padding:
0.15rem 0.3rem` por célula. Isso produz uma grade muito mais larga e "pesada" por célula do
que o protótipo (símbolo único), que é provavelmente a razão da percepção de "completamente
diferente" mesmo com a estrutura funcional equivalente. A janela também abre em 720×460,
maior que os ~600px do protótipo (não contradiz spec, mas contribui à sensação de
"diferente").

**(d) Tarefa:** redesenhar as células da grade para o padrão compacto do protótipo — símbolo
de um caractere/ícone pequeno por estado (mantendo acessibilidade: `aria-label` com o nome
completo do estado, já que REQ-CTT-094 proíbe só cor mas símbolo+texto-invisível-para-tela
resolve), exceção marcada por contorno distinto sem precisar da palavra "Exceção" escrita
(usar o mesmo padrão do protótipo: contorno + o próprio símbolo visualmente destacado).
Reduzir o tamanho de abertura da janela para próximo do protótipo. **Cobre:** REQ-CTT-060..
067, RNF-CTT-04. **Pronto quando:** captura lado a lado com a seção "conhece" do protótipo
mostra densidade e simbologia equivalentes, mantendo os 4 comportamentos de ciclagem já
corretos hoje.

---

## Fase 4 — Aba Compêndio (specs 43/16)

### A040 — Botões fora do padrão planejado (item 12)

`packages/client/src/components/compendium/{CompendiumBrowser,CompendiumResultLine}.svelte` ·
`packages/client/prototypes/compendium-tab.prototype.html`

**(a) Manda:** o "print aprovado" descrito pelo Alexandre bate, quase item a item, com o
que **já existe** no componente real `CompendiumBrowser.svelte` (confirmado por i18n key):
"Pack: {{pack}}" com "‹ Estante" (`FUSION.Compendium.BackToShelf`/`Scope.Pack`), "Trazer
para" com `<select>` de destino, "Trazer as {{count}} entradas listadas"
(`Import.Batch.other`), "Buscar em todo o acervo" (`WidenSearch`), facetas Raridade/Nível
mín./máx., chips de ordenação Nome/Tipo com seta, 3 ícones por linha de resultado (pin/
preview/import em `CompendiumResultLine.svelte:197-277`). **Nota importante:** o arquivo
`compendium-tab.prototype.html` em si, na leitura literal, tem um layout **mais simples**
(cabeçalho "‹ Compêndios", sem a linha "Trazer para", facetas reduzidas a 6 chips fixos) —
ou seja, o "print aprovado" que o Alexandre descreveu de memória é mais parecido com o
**componente real implementado** do que com o arquivo `.prototype.html` desta branch (pode
ser uma variante de grill mais recente que não ficou salva no HTML, ou uma tela intermediária
vista durante a implementação).

**(b) Divergências reais encontradas (não "fora do padrão", mas inconsistências):**

1. As facetas de tipo de documento só aparecem na **raiz** (`openPackId === null`);
   raridade e nível aparecem sempre (dentro e fora de pack) — assimetria sem explicação
   na UI.
2. Ordenação (Nome/Tipo) só existe **dentro de um pack aberto** — o resultado agregado da
   busca geral não pode ser reordenado.

**(d) Tarefa:** **antes de qualquer código, alinhar com o Alexandre** qual print exatamente
ele validou (pedir se possível o print/vídeo da tela "boa" que ele descreveu, ou confirmar
que é o componente atual e a queixa é sobre as duas inconsistências acima). Se confirmado
que o componente atual já bate, tratar só os dois pontos do (b): decidir se tipo de
documento deveria aparecer também dentro do pack, e se ordenação deveria existir no
resultado agregado. **Cobre:** REQ-CPD-010..046 (parcial). **Pronto quando:** a
confirmação está registrada e, se houver ajuste, captura lado a lado prova a paridade.

---

### A041 — Ator importado ("Águia") fica com nome "Eagle" em inglês (item 15)

`packages/server/src/compendium/service.ts:623-754` (`importToWorld`)

**(a) Manda:** nenhuma das duas specs decide isto explicitamente. REQ-CMP-021 (spec 16)
só fala de clonar `data`, gerar novo `_id`, preservar `system`/`flags` — **não menciona
nome**. DEC-CPD-06 (spec 43) só decide o nome na **listagem** ("nome traduzido em
destaque, nome original abaixo") — não no documento importado em si.

**(b) Estado atual — causa exata:** `importToWorld` (linha 690) copia `...doc` (com
`doc.name` = nome EN do pack) para o novo documento do mundo, e **deleta** o campo `i18n`
(linha 712) que carregava a tradução como overlay separado (`i18n.ptBR`, anexado só na
leitura via `getDocument()`, nunca persistido no `name` raiz). O comentário do próprio
código (linhas 696-713) documenta que isso é **deliberado**: _"This EN-pure decision is
DELIBERATE and must not be reverted (issue #43) — the world document is a snapshot, not a
live view of the pack overlay."_

**Gap real:** essa decisão "EN-pure" foi tomada no nível de implementação (issue #43 do
código), **sem que a spec 43/16 jamais tenha discutido explicitamente** se `name` do
documento trazido para o mundo deveria vir traduzido.

**(d) Tarefa:** decisão de spec antes de código (`CONVENCOES.md` §2) — escrever em
`specs/16-compendiums-e-importacao.md` (junto de REQ-CMP-021) ou `specs/43-aba-compendio.md`
uma decisão explícita: (opção 1) manter EN-pure no `name` e resolver tradução só na
**exibição** em toda superfície que mostra ator (NPCs, Contatos, ficha) via
`flags.fusion.sourceId` — mesmo mecanismo de G093 generalizado; ou (opção 2) `name` do
documento importado grava a tradução pt-BR direto (reverte a decisão do issue #43 do
código, com risco documentado: "mundo deixa de ser espelho puro do pack"). **Pronto
quando:** a decisão está escrita como REQ/DEC numa das specs, e a implementação (se
opção 1) estende o mecanismo de resolução de nome para `npcRowVM.ts` (ver A034) e outros
consumidores; ou (se opção 2) altera `importToWorld` para persistir o nome traduzido.

---

### A042 — Layout do compêndio confuso, refazer aparência mantendo funcionalidades (item 16)

`packages/client/src/components/compendium/CompendiumBrowser.svelte`

**(a) Manda:** nenhuma spec exige um layout específico além dos REQ funcionais já cobertos
(G090-G096) — este é pedido de UI/UX, não de funcionalidade ausente.

**(b) Pontos de confusão estrutural encontrados na leitura do código real (base para o
redesign):**

- Densidade tipográfica extrema (0.65rem–0.85rem em quase tudo), sem hierarquia visual
  entre "escopo corrente", facetas e linhas de resultado.
- Facetas assimétricas (ver A040-b).
- Sem botão de alternar modo — **confirmado correto** (DEC-CPD-01/G091 cumpridos à risca) —
  mas a ausência de qualquer pista visual de "por que a lista mudou", além do rótulo de
  escopo no topo, é fácil de não notar em 300px.
- Ordenação inconsistente (ver A040-b).
- Cabeçalho fixo (destino de import + lote + notificações) empilha muito conteúdo antes da
  busca, em 300px de largura.

**(d) Tarefa:** redesenho visual de `CompendiumBrowser.svelte`/`CompendiumResultLine.svelte`
mantendo toda a lógica atual (que já cumpre G090-G096) — aumentar hierarquia tipográfica
entre escopo/facetas/resultado, resolver as duas assimetrias de A040, e comprimir o
cabeçalho fixo. **Pronto quando:** captura lado a lado com o print que o Alexandre validou
(ou com `compendium-tab.prototype.html` como piso mínimo) mostra hierarquia visual clara nos
três níveis (estante / resultado agregado / pack aberto), sem nenhuma funcionalidade de
G090-G096 removida.

---

## Fase 5 — Aba Cenas (spec 44)

### A050 — Remover controles de visão/névoa/luz da cabeça (item 25) — decisão, não bug

`packages/client/src/components/scenes/ScenesTab.svelte:421-519` (`.scene-head__perception`,
`.scene-head__env`)

**(a) Estado atual:** a cabeça exibe hoje, sobrepostos à imagem de fundo: canto superior-
esquerdo, botão de percepção (abre `ScenePerceptionDialog`); canto superior-direito, grupo
com três botões — alternar escuridão, alternar névoa, resetar névoa (REQ-CEN-020..025,
DEC-CEN-06, G081). **A implementação bate com a spec** — esta é decisão nova do Alexandre
("fora por enquanto"), não correção de gap.

**(d) Tarefa:** remover os quatro controles (`.scene-head__perception` e os três botões de
`.scene-head__env`) da cabeça, sem apagar a lógica de servidor por trás (`toggleDarkness`/
`toggleFog`/`resetFog` continuam existindo para uso futuro — só a UI sai). **Cobre:** emenda
de REQ-CEN-020..025 (marcar como "retirado temporariamente" na spec 44, não apagar o
requisito, já que a decisão é "por enquanto"). **Pronto quando:** a cabeça da cena não exibe
nenhum dos quatro controles, e a spec 44 registra a retirada com data e motivo.

---

### A051 — Remover tamanho de imagem e de grade do preview do acervo (item 26)

`packages/client/src/lib/scenes/sceneShelf.ts:246-259` (`entryOf`) ·
`packages/client/src/components/scenes/ScenesTab.svelte:668-679` (`.scene-row__meta`)

**(a) Estado atual:** a linha do acervo exibe `entry.dimensions` (largura×altura da imagem,
via `scene.width`/`scene.height`) seguido das marcas de ambiente. Tamanho de **grade** não
aparece na linha hoje — só na cabeça. REQ-CEN-035 manda "nome, dimensões e marcas de
ambiente" — ou seja, **remover dimensões vai além do que a spec 44 pede hoje.**

**(d) Tarefa:** decisão de spec antes de código — emendar REQ-CEN-035 (`specs/44-aba-
cenas.md`) para remover "dimensões" do que a linha do acervo deve mostrar, deixando só
nome + marcas de ambiente; depois remover `entry.dimensions` do template de
`.scene-row__meta`. **Pronto quando:** a emenda está na spec 44 e a linha do acervo não
exibe mais tamanho de imagem nem de grade.

---

### A052 — Badge "no ar" deve ficar no topo da imagem, separado do nome (item 27)

`packages/client/src/components/scenes/ScenesTab.svelte:398-546,833-976` (`.scene-head`)

**(a) Manda:** protótipo (`scenes-tab.prototype.html`, `liveHead()` linhas 503-521) —
layout **lado a lado**: miniatura pequena (74×52px) à esquerda, coluna à direita com
`.lbl` ("no ar", com ponto pulsante) no **topo** dessa coluna, seguida do nome e meta.
Nunca sobrepõe texto na imagem em tela cheia.

**(b) Estado atual:** `.scene-head{display:flex;flex-direction:column;justify-content:flex-
end}` empurra todo o conteúdo para o **rodapé** da caixa. Dentro de `.scene-head__info`
(gradiente escuro de baixo para cima), em ordem vertical: `.scene-head__flag` ("no ar"),
depois `.scene-head__name`, depois `.scene-head__meta` — **"no ar" e nome estão no MESMO
bloco, ambos ancorados no rodapé**, empilhados um sobre o outro. O nome já está embaixo,
correto ("como já está"), mas o badge "no ar" está colado a ele, não isolado no topo da
imagem como pedido.

**(c) Causa estrutural:** a implementação optou por overlay em gradiente sobre a imagem de
fundo em tela cheia (interpretação de "imagem de fundo escalada" de DEC-CEN-04), diferente
da miniatura pequena lateral do protótipo — isso é o motivo de "no ar" e nome estarem
colados no mesmo bloco de rodapé em vez de o badge ficar isolado.

**(d) Tarefa:** mover `.scene-head__flag` para fora de `.scene-head__info` (o bloco de
rodapé), reposicionando-o como elemento próprio ancorado ao **topo** de `.scene-head`
(`position: absolute; top: 0`), com o texto "no ar" e o indicador visual (ponto/pulso), sem
mexer no bloco de nome/dimensões, que permanece no rodapé como está hoje. **Cobre:**
REQ-CEN-010..015. **Pronto quando:** captura da cabeça mostra "no ar" isolado no topo da
imagem e o nome continua embaixo, sem mudar de altura entre os dois estados (com/sem cena
no ar).

---

## Fase 6 — Aba Configurações (specs 37/05)

### A060 — Auditoria de origem das permissões (item 29) — registro para revisão futura

`packages/server/src/net/handlers/*.ts`

**(a) Manda:** REQ-CFG-040 (G104) — "permissões configuráveis de REQ-USR-008, uma por
linha". O Alexandre pediu, para revisão **futura** (não implementar agora), que cada chave
de permissão tenha sua origem documentada.

**(b) Lista-base levantada** (handlers que hoje fazem checagem de papel/permissão):

| Arquivo                              | Uso                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor-delete-handlers.ts:33`        | `isRolePrivileged` — exclusão de ator (REQ-NPC-050)                                                                                                              |
| `doc-handlers.ts`                    | `isRolePrivileged` (linhas 70, 287, 1878); `isGamemasterStrict` (1891, seções de mesa da Config.); `role >= minRole` (780, permissões configuráveis REQ-USR-010) |
| `fog-handlers.ts:78,120,154`         | `isRolePrivileged` — fog of war                                                                                                                                  |
| `folder-handlers.ts:88`              | `isRolePrivileged` — CRUD de pastas                                                                                                                              |
| `knowledge-handlers.ts:55`           | `isRolePrivileged` — conhecimento/contatos                                                                                                                       |
| `settings-handlers.ts:201`           | comentário aponta REQ-CFG-070 (role===GAMEMASTER no servidor)                                                                                                    |
| `sync-handlers.ts:74,665`            | `isRolePrivileged` — sincronização/redação de snapshot                                                                                                           |
| `vision-handlers.ts` (6 ocorrências) | `isRolePrivileged` — visão/iluminação                                                                                                                            |

Nota: a maioria usa o predicado genérico `isRolePrivileged` (limiar por papel, não por
`Permission Key` individual) — a granularidade fina de REQ-USR-008/009 (papel mínimo por
permissão, configurável) parece concentrada em `doc-handlers.ts:780`/`world-permissions.ts`.

**(d) Tarefa (futura, não deste PR):** mapear cada `Permission Key` de REQ-USR-008
(`ACTOR_CREATE`, `DRAWING_CREATE`, `FILES_BROWSE` etc.) ao(s) handler(s) que efetivamente a
consomem, usando a tabela acima como ponto de partida, e decidir item a item se o gate
deveria ser por `Permission Key` (granular) ou continuar em `isRolePrivileged` (binário).
**Pronto quando:** existe uma tabela completa (permissão → handler(s) → gate atual) anexada
à spec 05 ou 37, sem mudança de comportamento neste PR.

---

### A061 — Sem autoatendimento de troca de senha (item 30) — lacuna de spec confirmada

`specs/37-configuracoes.md` · `specs/05-usuarios-e-permissoes.md` ·
`packages/client/src/components/settings/PreferencesSection.svelte`

**(a) Manda:** nem a spec 37 nem a 05 mencionam "alterar a própria senha" (self-service). O
único fluxo de senha documentado é reset **pelo GM sobre outro usuário**: REQ-CFG-051/053
("resetar senha... exibida uma única vez"), REQ-USR-027 ("o GM deve poder resetar a senha de
qualquer usuário"), endpoint `POST /api/users/:id/reset-password` exige `Bearer (GM)`. **É
lacuna de spec, não só de implementação.**

**(b) Estado atual:** `PreferencesSection.svelte` (seção "Minhas preferências", G101) não
tem nenhuma menção a senha — só volume e notificações locais (REQ-CFG-020..022). Não existe
campo de senha em nenhuma seção da aba.

**(d) Tarefa:** escrever um novo REQ em `specs/37-configuracoes.md` (seção "Minhas
preferências" ou nova subseção) e `specs/05-usuarios-e-permissoes.md` (endpoint) para
autoatendimento de troca de senha — qualquer usuário logado (GM ou player) troca a própria
senha, exigindo a senha atual como confirmação, sem depender de outro usuário. Só depois
implementar o campo em `PreferencesSection.svelte` e o endpoint correspondente. **Pronto
quando:** a spec tem o REQ novo citado, e a implementação (PR seguinte) permite qualquer
usuário trocar a própria senha com teste que prova que a senha atual errada é recusada.

---

## Fase 7 — Processo: para não repetir esta rodada (item 33)

A raiz comum da maioria dos 33 itens não é falta de spec (a maior parte já estava bem
especificada) — é implementação que não foi conferida visualmente contra o protótipo
aprovado antes do merge. Quatro hábitos, todos obrigatórios a partir desta rodada:

### P1 — Lente de revisão "protótipo" obrigatória

Todo `code-review`/`esteira-validar` de uma tarefa de UI da gaveta (ou de qualquer aba)
**deve** abrir o `.prototype.html` correspondente lado a lado com o componente renderizado
antes de aprovar — não é opcional, é gate. Se não houver protótipo para o componente em
questão, registrar essa ausência explicitamente em vez de pular a checagem.

### P2 — Roteiro `tutorial-e2e` por fase

A skill `tutorial-e2e` (sendo portada em paralelo para `.claude/skills/tutorial-e2e/`) roda
o roteiro completo de uso da aba (não só o teste unitário) ao final de cada fase de UI, com
prints capturados e olhados por um humano ou por um revisor que sabe comparar contra o
protótipo — não só rodar e conferir "não quebrou".

### P3 — Screenshot lado a lado no corpo do PR

Nenhuma fase de UI mergeia sem uma captura lado a lado (protótipo × implementação) anexada
no corpo do PR. Isso é o que teria pego a maior parte dos itens 1, 3, 12, 17, 20, 21, 23,
25-27 antes do merge — todos são divergências visuais que um diff de código não mostra.

### P4 — Smoke como GM e como player antes do merge

Cada PR de UI é testado manualmente nos dois papéis antes do merge — não só como GM. Os
itens 9 (edição de título como player), 11 (drag, precisa de papel correto), e 24 (cena
preta **só** para player) são exatamente a classe de bug que só aparece testando como o
papel errado nunca foi testado. Documentar no PR: "testado como GM: sim/não; testado como
player: sim/não".

**Pronto quando:** as quatro práticas estão escritas num lugar persistente (este documento
já serve; se a skill `tutorial-e2e` for concluída antes, mover para lá) e o próximo PR de UI
da gaveta ou de qualquer outra frente já as segue, sem precisar ser lembrado.

Aplicado em 2026-08-17: `docs/design/PROCESSO-UI.md` (+ remissões em CONTRIBUTING.md e CLAUDE.md).
