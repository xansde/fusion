# Gaveta lateral — plano de tarefas (specs 36 → 44)

Origem: as oito specs da gaveta lateral, escritas e mergeadas em `alfa/app` entre
2026-08-15 e 2026-08-16 — a mãe [`36`](../../../specs/36-gaveta-lateral.md) e as sete
filhas, uma por aba: [`37` Configurações](../../../specs/37-configuracoes.md),
[`38` Chat](../../../specs/38-aba-chat.md), [`39` Contatos](../../../specs/39-contatos.md),
[`40` Combate](../../../specs/40-aba-combate.md), [`42` NPCs](../../../specs/42-aba-npcs.md),
[`43` Compêndio](../../../specs/43-aba-compendio.md) e
[`44` Cenas](../../../specs/44-aba-cenas.md). PRs #141 a #144.

São **422 requisitos [MVP]** e **zero citação de teste ou de código** (RASTREABILIDADE,
2026-08-16). Este documento é o caminho de 0% até a mesa jogando com a gaveta nova.

Base de trabalho: `alfa/app`. Uma fase = um PR. Promoção `alfa → beta → stable` é sempre
ato humano.

**Escopo de linha:** vale para a linha `alfa`/`beta`/`stable` e só para ela. `build/app` e
`main` são a linha geral, paralela desde `ab4966f` (02/08), sem convergência planejada —
nada daqui chega lá sozinho.

**Escopo de frente — banco de dados fica de fora.** Schema, migrations e caminho de escrita
do `world.db` são outra frente, tocada em paralelo. **Nenhuma tarefa deste plano cria
migration nem altera schema**, e isso não é uma restrição inventada: as próprias specs dizem
onde cada dado mora, e tudo o que elas pedem cabe no que já existe — conhecimento, título e
atitude são **campos do próprio documento do ator** (`39` §7, `42` §7), setting de mundo é
`Setting` (REQ-DOC-018, já existe), plateia de pack é **manifesto**, e todo o resto é
ergonomia local no aparelho (G-2). Se alguma tarefa parecer precisar de coluna nova, é sinal
de que ela está lendo a spec errado — pare e confira, não escreva migration.

---

## O que muda no produto, em uma frase

A sidebar de hoje (`AppSidebar.svelte`: cinco abas em texto corrido, estado só em memória,
painel de cenas embutido no próprio componente) vira um **trilho de ícones + gaveta de
largura fixa** com **sete abas registradas por API pública**, e cada aba passa a ter dona,
regra de badge, estado vazio e predicado de servidor declarados por escrito.

---

## Decisões fechadas que regem o plano

Nenhuma é invenção deste documento: todas saem das specs, e mudar qualquer uma delas é
mudar spec antes de mudar código (`CONVENCOES.md` §2).

| #   | Decisão                                                                                                        | Consequência para o plano                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | O núcleo registra as sete abas pelo **mesmo** `registerSidebarTab` que um mod usaria (DEC-GAV-07, REQ-GAV-030) | A Fase 1 bloqueia todas as outras. `{#if}` no componente não é registro — se o núcleo não passa pela API pública, a API está errada          |
| G-2 | Ergonomia local mora no cliente, por **mundo + usuário** (DEC-UIF-10, repetida em 6 das 7 filhas)              | Favoritos, categorias, pastas fixadas, escopo de busca, grupos recolhidos e `open`/`activeTab` **nunca** viram Document nem tocam o servidor |
| G-3 | Esconder na tela não é proteger (REQ-GAV-034), e cada filha nomeia o predicado do servidor                     | Toda aba tem tarefa de servidor. Uma delas (Fase 2) é defeito **vivo**, não trabalho novo                                                    |
| G-4 | O que não cabe em 300px abre janela flutuante — exceto a `37`, que decidiu o oposto para si                    | DEC-ACH-01 × DEC-CFG-04 não é contradição: a 36 §7 manda cada filha declarar. Não uniformizar na implementação                               |
| G-5 | Condição é contrato declarado pelo sistema (REQ-SYS-043 + `tone`/`help`/`critical`)                            | Três abas (39, 40, 42) consomem o mesmo contrato. Ele ainda **não existe** na spec 15 — G001 é pré-requisito real                            |
| G-6 | Token não tem spec dona (`41` reservada, DEC-CBA-06)                                                           | Três pontos ficam pendurados de propósito: candidatos do encontro, presença ao arrastar, conteúdo do baú. Não improvisar modelo              |
| G-7 | A dívida da DEC-CTT-01 é declarada, não descuido                                                               | Enquanto a Fase 6 não fechar, **não se remove** `ActorDirectory.svelte`: seria deixar o cliente sem criar nem excluir ator                   |

**Princípio que rege a ordem:** primeiro o que já está errado em produção (Fase 2), depois
o contêiner que destrava tudo (Fase 1), depois uma aba por PR — e nenhuma aba entra sem a
sua metade de servidor.

---

## Como ler estas tarefas

- `G###` — id estável (`G` de gaveta). Não renumerar; tarefa cancelada vira `~~G###~~` com
  o motivo.
- `[P]` — pode ser feita em paralelo com as outras `[P]` da mesma fase.
- **Pronto quando** — critério verificável. Sem comando ou teste que prove, a tarefa não fecha.
- **Cobre** — os requisitos que a tarefa entrega. O teste **DEVE citar esses ids**: é assim
  que a cobertura de `RASTREABILIDADE.md` sobe (`CONVENCOES.md` §8). Requisito entregue sem
  citação não afirma nada e o relatório continua marcando 0%.
- Toda tarefa cita arquivo real.

Comandos do repo: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` ·
`pnpm build` · `pnpm spec:report`

Dois hábitos que o repo já cobra:

- **`pnpm spec:report` roda em todo PR que acrescenta teste citando requisito** — o
  relatório é comparado com o repo por um teste, e o piso de `COBERTURA-MINIMA.json` sobe
  sozinho. Esquecer derruba o CI depois do merge.
- **Teste de servidor nunca hardcoda porta** — use
  `packages/server/src/__tests__/helpers/ports.ts` (`reserveFreePort`, `listeningPort`).
  `port: 0` não funciona: `boot()` injeta `currentPort` antes do `listen()`.

---

## Fase 0 — Fechar as emendas que as specs obrigam (sem uma linha de código) ⚠️ pré-requisito

Cada filha registrou, na própria §12, o que ela obriga a mudar em spec alheia — a catraca
que impede spec contrariada em silêncio. **Seis dessas emendas não foram aplicadas**
(conferido arquivo a arquivo em 2026-08-16, na ponta de `alfa/app`). Enquanto não forem, há
requisito citando um contrato que não existe.

Já aplicadas, não mexer: `09` (invalidação em REQ-CHT-005, `/roll` obedece o seletor em
REQ-CHT-017, REQ-CHT-050/051 criados), `11` (nota da 36 sob REQ-UIF-002), `13`
(REQ-AUD-015 aponta para REQ-CFG-020), `30` (REQ-MCL-001/004 como setting de mundo), `36`
(emendada em cada PR de filha).

### G001 — `15`: `ConditionDefinition` ganha `tone`, `help` e `critical`

`specs/15-api-de-sistemas.md` (REQ-SYS-043, ~linha 390)

Obrigada pela `39` §12 e consumida por **três** abas: REQ-CTT-030..038, REQ-CBA-050 e
REQ-NPC-033. Campos opcionais no schema, com a degradação já escrita em REQ-CTT-035
(sem `tone` → situação; sem `help` → sem tooltip; nunca esconder a condição), para não
invalidar sistema já registrado.

**Pronto quando:** REQ-SYS-043 define os três campos e `pnpm test` (spec-lint) passa com as
citações das specs 39/40/42 resolvendo.

### G002 [P] — `10`: iniciativa só na montagem, vida conforme o papel

`specs/10-combate-e-iniciativa.md` (REQ-CBT-041, ~linha 252; REQ-CBT-040)

Hoje REQ-CBT-041 manda cada linha do tracker exibir **iniciativa e HP** — o oposto de
DEC-CBA-03 e DEC-CBA-04. Emenda obrigada pela `40` §12: iniciativa só na montagem, vida
por papel, e REQ-CBT-040 ("aba da sidebar") declarado concretizado pela 40. REQ-CBT-053..055
(targeting) continuam válidos, fora do painel.

### G003 [P] — `16`: `audience` no manifesto e busca sobre todos os packs

`specs/16-compendiums-e-importacao.md` (REQ-CMP-013, ~linha 358; manifesto de pack)

Três emendas da `43` §12, nenhuma aplicada: (1) irmã de REQ-CMP-013 para busca **sobre
todos os packs visíveis ao solicitante**, no servidor; (2) `audience` no manifesto, ao lado
de `license`; (3) o overlay de nome traduzido, que existe em produção e não estava em spec
nenhuma, vira exigência de exibição e de busca.

### G004 [P] — `17`: packs de criatura e perigo nascem `audience: "gm"`

`specs/17-sistema-pf2e.md`

REQ-CPD-072. É mudança de publicação, não de conteúdo — e é a spec que sustenta a fechadura
da Fase 2.

### G005 [P] — `05`: usuário criado nasce com personagem

`specs/05-usuarios-e-permissoes.md` (REQ-USR-025, ~linha 324)

DEC-NPC-02 decidiu que personagem nasce colado ao player; a `42` §12 emenda REQ-USR-025 e
REQ-CFG-051 para dizê-lo. O personagem nasce com o usuário como `OWNER`
(REQ-DOC-027..029) — administração de usuários passa a ter consequência sobre documents,
o que ela não tinha. Conferir de passagem se REQ-CFG-051 na `37` já carrega a exigência.

### G006 [P] — `06`: `REQ-CNV-070` racha em ativar e navegar

`specs/06-canvas-e-renderizacao.md` (REQ-CNV-070, ~linha 396)

Emenda da `44` §12: **ativar** é global, com escritor único e recusa no caminho genérico
(REQ-CEN-041/042); **navegar sem ativar** existe apenas como preparo local do Mestre
(DEC-CEN-03), nunca como navegação por usuário.

### G007 — Conferência da fase

**Pronto quando:** `pnpm test` verde (spec-lint inclusive), `pnpm spec:report` sem diff, e
`DEBITO-CITACOES.txt` **sem entrada nova** — a catraca só encolhe.

---

## Fase 2 — A fechadura que já está aberta (43 §5.8) 🔓 independente, pode ir primeiro

Não depende do contêiner nem de UI nenhuma. É o único item deste plano que conserta algo
que está errado **agora**, no mundo que roda na 33000.

**Evidência:** `packages/server/src/compendium/handlers.ts:8-11` documenta, no cabeçalho do
próprio arquivo, `compendium:list`, `:index`, `:search` e `:get` como **"all roles"** — só
`compendium:import` chama `isRolePrivileged` (`:200`). Ou seja: hoje o jogador abre o stat
block do monstro da sessão de hoje. Ninguém decidiu isso; é o default de quem implementou
(DEC-CPD-04).

### G020 — Plateia de pack imposta no servidor

`packages/server/src/compendium/{handlers,service}.ts` · manifesto de pack

`audience: "all" | "gm"`, ausência tratada como `"all"`. Pack `gm` não é listado, não é
buscável e não é legível para quem não satisfaz `isRolePrivileged`, e a **recusa é
indistinguível de "não existe"** (REQ-SEC-020) — não vazar a existência do pack pelo erro.

**Cobre:** REQ-CPD-070, REQ-CPD-071, REQ-CPD-074.
**Pronto quando:** teste com socket de PLAYER prova que `list` não traz o pack, `search` não
retorna documento dele e `get` por uuid conhecido responde como inexistente; o mesmo teste
com GM passa. Depende de G003 (a spec que cria `audience`).

### G021 [P] — Packs de criatura e perigo do PF2e publicados como `gm`

`systems/pf2e/` (manifestos dos packs de bestiário e perigos)

**Cobre:** REQ-CPD-072.
**Pronto quando:** o manifesto declara, e o teste de G020 usa o pack real de bestiário —
não um pack sintético.

---

## Fase 1 — O contêiner (spec 36) 🧱 bloqueia as sete abas

Novo: `packages/client/src/lib/sidebar/` (registro + estado) e
`packages/client/src/components/sidebar/` (trilho, gaveta).
Substitui: `packages/client/src/components/chat/AppSidebar.svelte` (hoje 597 linhas com
trilho, abas, painel de cenas e diálogos de cena tudo junto).
Entra em: `packages/client/src/components/TableScreen.svelte`.

### G010 — O registro de abas

`lib/sidebar/registry.ts`

`registerSidebarTab({ id, icon, label, group, component, badge? })`, com `id` único,
`label` como chave i18n, `group ∈ {"all","gm"}`, `component` Svelte e `badge` como store
reativo de `number | boolean | null`. Registrar id repetido **falha com erro explícito** —
nunca substitui em silêncio. Sistemas de jogo não registram aba no MVP.

**Cobre:** REQ-GAV-030, REQ-GAV-032, REQ-GAV-033 (e REQ-GAV-031 fica declarado [V2]).
**Pronto quando:** teste registra uma aba de teste `group: "gm"`, vê o ícone no fim do grupo
GM para o GM e a ausência para o jogador, e o segundo registro do mesmo id lança.

### G011 [P] — Trilho só-ícone, três blocos, sem um texto

`components/sidebar/SidebarRail.svelte`

Coluna vertical à esquerda da gaveta, movendo-se com ela; 44px; `aria-label` + tooltip como
único texto; grupo de todos → grupo GM → **Configurações ancorada no rodapé** (DEC-GAV-09);
aba ativa visualmente contínua com o painel (a "aba física" do protótipo C).

**Ícones desenhados, nunca emoji** (REQ-NPC-094 eleva DEC-ACH-04 a princípio da gaveta
inteira). Hoje o `AppSidebar` usa `❯`/`☰` no toggle e `⚔` no badge de combate: os três saem.

**Cobre:** REQ-GAV-001..005, REQ-NPC-094.
**Pronto quando:** teste prova a ordem dos três blocos para GM e para jogador, ausência de
rótulo textual no trilho e ausência de caractere emoji no markup renderizado.

### G012 — Gaveta: um gesto, uma largura, uma montagem

`components/sidebar/SidebarDrawer.svelte`

Clicar na aba abre/troca; clicar na **ativa** recolhe — e é o **único** controle de
recolher: sem chevron, sem ✕ no cabeçalho, e `Esc` não recolhe (ele é o cancelamento do
canvas). Largura fixa por token (`--fusion-sidebar-width`: 300px de painel + 44px de
trilho), igual para todas as abas, não redimensionável. Sobreposta ao canvas, sem reservar
layout. Só o painel ativo fica montado; trocar de aba desmonta o anterior, e o estado que
precisa sobreviver vive fora do componente.

**Cobre:** REQ-GAV-010..013, REQ-GAV-017, RNF-GAV-01, RNF-GAV-02 (import dinâmico por aba).
**Pronto quando:** teste prova que trocar de aba não altera largura, que `Esc` não recolhe,
que não existe segundo controle de recolher no DOM, e que abrir a gaveta **não** dispara
resize no canvas. RNF-GAV-02 se prova por chunk: o bundle do painel de uma aba não ativa
não é carregado ao montar o trilho.

### G013 — Persistência local e primeiro acesso por papel

`lib/sidebar/preferences.ts` (`ClientUIPreferences`, DEC-UIF-10)

`open` e `activeTab` por usuário e dispositivo, restaurados no reload, **nunca** enviados ao
servidor. Sem preferência salva: GM abre em **Cenas**, jogador abre em **Chat**. `activeTab`
salvo que o usuário não pode mais ver → cai para **Chat**, sem aviso.

**Cobre:** REQ-GAV-014..016, REQ-CEN-002.
**Pronto quando:** teste cobre os três casos, inclusive o do dispositivo compartilhado (GM
salva `"scenes"`, jogador entra no mesmo navegador e abre em Chat sem erro).

### G014 [P] — Contrato de badge, e um trilho sem regra de negócio

`lib/sidebar/badges.ts`

Um badge por aba, de um de dois tipos: **contador** (`99+` acima de 99) ou **ponto de
estado**. Renderizado no canto do ícone sempre que existir — inclusive na aba ativa e com a
gaveta recolhida. **O trilho nunca altera badge nenhum**: quem acende e apaga é a filha. Sem
som, sem piscar.

**Cobre:** REQ-GAV-020..024.
**Pronto quando:** teste prova que abrir, trocar e recolher **não** mexem no valor de badge
algum, e que a filha (fake, no teste) mexe.

### G015 [P] — Tela estreita e teclado

Abaixo de 900px a gaveta aberta ocupa toda a largura à esquerda do trilho, por cima do
canvas; o trilho continua com 44px e o mesmo gesto de recolher. Substitui, para a gaveta, o
FAB/swipe de REQ-UIF-062 e da spec 23. Sem atalho global de aba no MVP.

**Cobre:** REQ-GAV-040, REQ-GAV-041.

### G016 — As abas de hoje entram pelo caminho público (ponte, sem redesenho)

`ChatPanel`, `CombatPanel`, `ActorDirectory`, `CompendiumBrowser` e o painel de cenas
passam a ser registrados por `registerSidebarTab`, **sem redesenho de conteúdo** — cada um
ganha o seu PR de aba nas fases seguintes. O painel de cenas, que hoje mora **dentro** do
`AppSidebar` (lista, diálogos de criar/editar/excluir e `handleActivate`), sai para
`components/scenes/ScenesTab.svelte`.

**Pronto quando:** a mesa continua fazendo tudo o que fazia — abrir chat, combate, atores,
compêndio, ativar cena — com o contêiner novo, e nenhum teste existente de painel foi
reescrito para passar.

### G017 — Enterrar o `AppSidebar` e tirar o estado da gaveta de dentro de cenas

Remover `components/chat/AppSidebar.svelte`; remover `sidebarState`/`toggleSidebar` de
`lib/scenes/scenesState.svelte.ts` — o estado da gaveta deixa de morar no módulo de cenas,
que é onde ele está hoje por acidente de história.

**Pronto quando:** `pnpm build` e `pnpm test` verdes sem nenhuma referência remanescente, e
o `grep` por `AppSidebar` no repo volta vazio.

---

## Fase 3 — Aba Chat (38)

A aba mais usada da mesa, e a que tem mais servidor por baixo. Três dos requisitos de
servidor já têm spec escrita na `09` (G001 da Fase 0 não os toca: REQ-CHT-005/050/051 já
foram emendados no PR da 38).

### G030 — Busca do log para qualquer papel, com o predicado do histórico

`packages/server/src/chat/chat-handler.ts` · rota `GET /api/worlds/:wid/chat/search`

A busca é do servidor (FTS5), vale para **todos** os papéis, e o servidor devolve só o que
aquele usuário poderia ver no histórico — **mesmo predicado**, sem segunda regra de
visibilidade.

**Cobre:** REQ-CHT-050, REQ-ACH-011, REQ-ACH-012.
**Pronto quando:** teste em que o jogador procura um termo e **não** acha o sussurro do
Mestre para outro jogador, enquanto o Mestre acha os dois.

### G031 — Consulta de contexto: ±N **visíveis**, não ±N do log

`packages/server/src/chat/chat-handler.ts`

Dado o `_id` de uma mensagem visível e um limite `N`, devolve as `N` visíveis anteriores e
posteriores. Mensagem invisível **não ocupa lugar na contagem** e não é sinalizada de forma
alguma — contar mensagem invisível deixaria deduzir que houve conversa privada ali.

**Cobre:** REQ-CHT-051, REQ-ACH-013.
**Pronto quando:** teste com sussurros intercalados prova que o jogador recebe 5 visíveis de
cada lado, sem buraco e sem pista.

### G032 — `chat:invalidate`: nada é apagado do log

`packages/server/src/chat/chat-handler.ts` · `@fusion/shared` (protocolo)

Invalidar em vez de deletar. Podem invalidar o **GAMEMASTER** e o **autor**; revalidar é do
Mestre sempre e do autor **só o que ele mesmo invalidou** — invalidação do Mestre é palavra
final. Grava `invalidatedBy`/`invalidatedAt`, propaga como atualização de documento, e
**não desfaz efeito nenhum** fora do log.

**Cobre:** REQ-ACH-080..086, REQ-CHT-005.
**Pronto quando:** teste cobre a matriz (autor invalida → revalida; Mestre invalida → o
botão do autor some e a tentativa forjada é recusada) e prova que dano já aplicado continua
aplicado.

### G033 — O painel: barra fixa, log, fileira, caixa, seletor

`components/chat/ChatPanel.svelte` (reenquadrado)

Barra superior fixa com pesquisa ocupando a largura e um `⋯` à direita, **sem título
textual** (o ícone ativo do trilho já diz onde se está). Caixa de escrita ocupando a largura
inteira, crescendo de 1 a 5 linhas; **Enter** envia, **Shift+Enter** quebra; a instrução
mora no tooltip do botão de enviar, não dentro do campo. `⋯` oferece o editor de favoritos
a todos e, só ao GAMEMASTER, exportar e limpar o log.

**Cobre:** REQ-ACH-010, REQ-ACH-015 (**metade**: o editor de favoritos para qualquer papel e
o corte por papel dos dois itens de log), REQ-ACH-020, REQ-ACH-030..034.
**Não cobre:** exportar e limpar de fato — não existe operação de servidor para nenhuma das
duas. G033 entrega o lugar, desabilitado e com o motivo; a operação é **G041**, e enquanto
ela não existir REQ-ACH-015 fica aberto pela metade.

### G034 — Seletor de modo: um lugar decide a plateia

`components/chat/RollModeSelector.svelte` · `lib/chat/rollModePreference.ts` (já existe)

Quatro **ícones desenhados** (público · ao Mestre · cega · só eu), indicador do ativo, ajuda
no hover/foco. Persiste por **mundo + usuário** no aparelho. Vale para **todas** as
rolagens — fileira, janela, ficha, card e digitadas, inclusive `/roll`. Precedência:
comando que nomeia o modo > favorito travado > seletor. E não muda visibilidade de **texto**:
texto sem comando continua público; privado por texto é `/w`.

**Cobre:** REQ-ACH-040..045, REQ-CHT-017.
**Pronto quando:** teste com o seletor em "cega" prova que `/roll 1d20` sai cego e
`/gmroll 1d20` sai ao Mestre **sem alterar o seletor**.

### G035 [P] — Dados favoritos e a janela de montagem

`lib/chat/favoriteDice.ts` · `components/chat/DiceTray.svelte` · `RollBuilderWindow.svelte`

Três favoritos na fileira + um quarto botão que abre a montagem. Favorito é rótulo +
fórmula em texto + modo ("segue o seletor" ou travado). Gravado **no aparelho, por mundo +
usuário, com chave na identidade do mundo e não no endereço** — trocar LAN por túnel não
pode perder favorito, e dois jogadores no mesmo navegador não herdam um do outro. No MVP a
fórmula é **pura** (dados e números): referência a atributo falha com mensagem legível.
Favorito **não é macro** — sem Document, sem permissão, sem hotbar, sem script. A janela
compõe **o que** se rola e **não** escolhe a plateia: só informa o modo do seletor.

**Cobre:** REQ-ACH-050..057, REQ-ACH-060..063.

### G036 [P] — Os dados aparecem sempre, sem clique

`components/chat/ChatCard.svelte` · `ChatMessage.svelte`

Fórmula, **valores de cada dado** e modificador visíveis sem interação (`2d4+4 → [3, 2] + 4`),
inclusive nas rolagens filhas e em **cada salvaguarda de alvo**. Salvaguardas uma por linha,
teto de 4 com "ver todas (N)". Mensagens consecutivas do mesmo autor agrupadas — cards,
sussurros e invalidadas nunca.

**Cobre:** REQ-ACH-021..025.

### G037 — Não-lidas: abrir é o gesto de ler

`lib/chat/chatStore.svelte.ts` · `scrollState.ts`

Badge contador; mensagem recebida com a aba fechada incrementa, com a aba aberta não. Abrir
zera **e** posiciona o log na **primeira não lida**, com o marcador "N novas" acima dela —
não no fim, que faria perder exatamente as mensagens que o contador prometia. Com a aba
aberta e o log rolado para cima, mensagem nova **não rouba o scroll**: aparece "↓ N novas" e
o badge do trilho não acende. Rascunho, posição e histórico de entrada sobrevivem à troca de
aba, vivendo fora do componente.

**Cobre:** REQ-ACH-002..006, REQ-ACH-026, RNF-ACH-02, REQ-CHT-039.

### G038 — Janela de contexto, uma por vez

`components/chat/ChatContextWindow.svelte` (window manager, REQ-UIF-009)

Acionar um resultado abre a janela com a mensagem alvo e ±5 visíveis, com "mais 5" para cada
lado. Uma janela por vez: acionar outro resultado reaproveita a mesma. O log ao vivo não se
move.

**Cobre:** REQ-ACH-013, REQ-ACH-014.

### G039 — Alvo: retrato do momento, e a CA fora do payload do jogador

`packages/server/src/chat/roll-service.ts` · `net/redaction.ts` · `@fusion/shared`

Rolagem de ataque **pode** carregar alvo: nome + a CA usada para graduar, como **retrato**,
nunca referência viva ao token — o log tem que continuar verdadeiro depois que o token morre
ou é renomeado. Sem alvo, **não existe grau**: sai o total e nada mais. O payload entregue a
quem não é Mestre **não contém a CA**; o grau, já calculado no servidor, vai.

A mecânica de seleção não existe hoje (DEC-ACH-09) — esta tarefa entrega **a forma do campo
e a redação**, para que ligar a seleção depois seja preencher um opcional, não redesenhar o
card.

**Cobre:** REQ-ACH-070..074, REQ-ACH-090..092.
**Pronto quando:** teste inspeciona o **payload** recebido pelo jogador (não a tela) e prova
que a CA não está lá e o grau está.

### G040 [P] — O dice-box sai do painel

`lib/chat/diceBoxBridge.ts` · `ChatPanel.svelte`

Dado 3D rolando em 300px é animação que ninguém vê; onde os dados rolam é decisão de um mod
futuro. A dependência pode ficar no repositório, desligada.

**Cobre:** RNF-ACH-03 (DEC-ACH-12).
**Pronto quando:** abrir a aba não monta canvas de dado e **não carrega o chunk** do
dice-box.

### G041 — Limpar e exportar o log: o "⋯" do Mestre precisa de servidor

`packages/server/src/chat/chat-handler.ts` · `@fusion/shared` (protocolo) · `ChatPanel.svelte`

Lacuna encontrada na revisão da Fase 3, registrada aqui para não passar por entregue.
Limpar o log (REQ-CHT-006 — trunca a tabela principal e a FTS5 e emite `chat:flush` para
todos os clientes limparem o painel) e exportar o log (REQ-CHT-037 — JSON com a estrutura
completa dos documentos, e texto plano `timestamp | speaker.alias | content`) **não existem
no servidor**: não há handler nem rota para nenhuma das duas. Sem elas, a metade do "⋯" que
é do Mestre em REQ-ACH-015 fica desenhada e desabilitada — G033 entrega o lugar, não a
operação — e nenhum teste do painel pode contar REQ-CHT-006/REQ-CHT-037 como provados.
As duas são verificadas **no servidor** (REQ-ACH-090): esconder o item no cliente não é
proteção. Ao entregar, o painel troca os dois itens desabilitados por ações reais, e é aí
que REQ-ACH-015 fecha.

**Cobre:** REQ-CHT-006, REQ-CHT-037, e a metade de REQ-ACH-015 que G033 não entrega.
**Pronto quando:** teste em que o jogador tenta limpar e é recusado, o Mestre limpa e o log
fica vazio para todos os clientes; e o export do Mestre traz a mensagem sussurrada que o
jogador não podia ver, enquanto a mesma operação é recusada ao jogador — asserção sobre o
**payload**/resposta do servidor, não sobre a tela.

---

## Fase 4 — Aba Combate (40)

A `40` é **WIP declarado** (§11): economia de ações, aplicar dano, `Delay`/`Ready` e resumo
pós-combate estão fora de propósito. Não os implemente por conta própria.
Alvo atual: `components/combat/CombatPanel.svelte` e
`lib/combat/{combatStore.svelte.ts,combatTracker.ts,combatVisibility.ts}`.

> **Pendência herdada — resolver ANTES de retomar esta fase** (levantada na sessão da spec
> `41`, 2026-08-16; registro em `docs/design/spec-41-token/decisoes.md`).
>
> A `40` cita o painel de **Comitiva** da `28` (`REQ-HUB-044`) como a referência de que vida
> de personagem é exibida — em `40:104` e em `40:478`. **Esse painel não existe nesta linha**:
> foi substituído pelas telas de Combate (`40`) e Contatos (`39`).
>
> Duas consequências para esta fase:
>
> 1. **A referência é órfã.** A regra de exibição de vida da cabeça de turno (G050) se apoia
>    num precedente que não está de pé. Ao retomar, decidir se a `40` passa a ser a dona da
>    regra ou se ela cita outra fonte.
> 2. **O corte mudou.** A visibilidade de vida passou a ser **OWNER** (D3): o jogador vê a
>    vida dos **seus** personagens e sub-personagens; o Mestre vê a de todos. Isso reverte a
>    DEC-CNV-15 (que usava OBSERVER) e afeta `combatVisibility.ts` e a Q-CBA-02.
>
> Decidido e **fechado** na mesma sessão: Contatos (`39`) **não exibe vida**, e está correto
> assim. Vida de personagem aparece em combate e na ficha — não no diretório de contatos.

### G050 — Cabeça de turno de altura fixa, com o botão que não sai do lugar

Bloco fixo no topo, fora da área rolável: participante da vez, retrato, nome, vida e
condições, com o controle de avançar **ancorado no rodapé da cabeça**. Altura fixa por token
de tema: nenhuma mudança de dado — condição nova, nome longo, vida — altera a altura. Ela só
cresce por gesto explícito (expandir "+N"), e **avançar ou recuar devolve à altura padrão**.
O que não couber é truncado de forma legível, nunca cortado no meio de um controle.

**Cobre:** REQ-CBA-020..025, RNF-CBA-03.
**Pronto quando:** teste mede a coordenada do botão de avançar com participantes de 0, 2 e 7
condições e prova que é a mesma; e que avançar descarta a expansão do turno anterior.

### G051 — Fila rotacionada a partir do turno atual

Primeiro quem ainda age nesta rodada, depois quem já agiu — o grupo de quem já agiu é
distinto e **rotulado**, nunca omitido. Derrotado com marcação explícita (não só opacidade),
permanecendo na fila. Oculto aparece para o Mestre marcado como oculto, e não aparece para
os demais. Reordenar por arraste para papel privilegiado, com alternativa por teclado.

**Cobre:** REQ-CBA-030..036.
**Pronto quando:** teste com 20 participantes prova que a fila rola, a cabeça fica fixa, e a
ordem é a rotacionada.

### G052 — Vida por papel, condições por contrato

Mestre vê **barra e número** (`atual/máximo`) de todos, na cabeça e na fila. Jogador vê a
vida dos personagens de jogador e **nunca** a de criatura — sem número, sem barra, sem
fração, sem degrau qualitativo. Vida não resolvível é **omitida**, nunca desenhada como
barra cheia ou zero. Condições pelo contrato de DEC-CTT-11 (depende de G001), com teto de
duas etiquetas + "+N", e **condição de quem você não pode ver a vida continua aparecendo**:
condição é o que a mesa enxerga na ficção, vida é contabilidade.

**Cobre:** REQ-CBA-040..043, REQ-CBA-050..054.
**Pronto quando:** teste prova a assimetria de vida entre os dois papéis — e o comentário do
código **cita Q-CBA-02**: enquanto a vida de criatura chegar ao cliente pelas barras de
recurso do token (REQ-CNV-090), isto é regra de tela, não sigilo (REQ-CBA-083). Não escrever
"por segurança" em lugar nenhum.

### G053 — Montagem dentro da gaveta

Criar encontro, abrir a lista de candidatos que **a cena ativa oferece** (bloco recolhível,
sem janela), adicionar participante, rolar iniciativa de todos / só das criaturas / zerar,
definir manualmente, e começar. Na montagem cada participante exibe seu valor de iniciativa
ou a marca de que não rolou; **em andamento o número some para todo mundo** — a ordem é a
lista. O jogador rola a iniciativa **dos seus** e nunca vê a de criatura, nem na montagem.
Nenhuma tela usa a palavra "token".

**Cobre:** REQ-CBA-010..013, REQ-CBA-060..068, REQ-CBA-070.
**Pendurado na `41`:** de onde vem a lista de candidatos (DEC-CBA-06). O gesto não muda; a
fonte pode mudar.

### G054 — O jogador encerra o próprio turno, e nada além disso

`packages/server/src/net/handlers/` (área dona: spec 10)

Quando a vez é de um participante do usuário, ele encerra o **próprio** turno pela mesma
operação de servidor que avança. Não avança turno alheio, não recua, não encerra o encontro.
O servidor aceita **só** quando o solicitante é dono do participante da vez.

**Cobre:** REQ-CBA-071..074, REQ-CBA-080, REQ-CBA-081.
**Pronto quando:** teste prova que a tentativa forjada de um jogador na vez de outro é
recusada pelo servidor, não só escondida na tela.

### G055 [P] — Badge que acende com o encontro e fica âmbar na sua vez

Ponto de estado aceso enquanto houver encontro ativo na cena — **inclusive na montagem**,
porque é lá que o jogador tem o que fazer. Âmbar quando o participante da vez é dele. Abrir
a aba **não** altera o ponto. Sem som e sem piscar.

**Cobre:** REQ-CBA-002..005.

### G056 [P] — Participante oculto não sai no payload

`packages/server/src/net/redaction.ts`

`hidden: true` não é entregue a usuário sem papel privilegiado — nem em snapshot, nem em
broadcast, nem em replay — pelo módulo único de redação.

**Cobre:** REQ-CBA-082.

---

## Fase 5 — Aba Contatos (39) 🔗 sai emparelhada com a Fase 6

A `39` traz o único **modelo novo** de todo o conjunto: o conhecimento por par contato ×
personagem. É a fase mais pesada de servidor, e a que abre a dívida que a Fase 6 fecha.

### G060 — Modelo de conhecimento: regra geral + exceções

`packages/server/src/documents/` · **campo do próprio documento do ator** — a `39` §7 grava
"no próprio contato, no `world.db`", e a `42` §7 repete. **Sem tabela nova, sem migration**
(ver Escopo de frente): documento é JSON no store, e é onde regra geral e exceções cabem.

Três estados ordenados por contato × personagem: `oculto` (0), `entrevisto` (1),
`conhecido` (2). Cada contato tem uma **regra geral** e um conjunto de **exceções** por
personagem; a exceção prevalece, e gravar exceção **igual** à regra geral a **remove** em
vez de duplicá-la. Personagem criado depois recebe a regra geral vigente sem nenhuma
operação do Mestre. Excluir personagem remove as exceções que o citam, sem tocar em regra
geral alguma. Conhecimento **não é ownership**: ele só restringe, nunca amplia o que o
`ownership` já nega.

**Cobre:** REQ-CTT-070..076.
**Pronto quando:** teste cobre os quatro casos que a spec nomeia — exceção igual à geral
some; personagem novo herda; alteração propaga o delta a cada usuário afetado sem reload;
excluir personagem limpa exceção.

### G061 — Redação do conhecimento no módulo único

`packages/server/src/net/redaction.ts`

Payload de contato `entrevisto` **não contém** nome, título, retrato nem dado de sistema.
Payload de contato `oculto` **não é entregue** de forma alguma. O mapa de conhecimento
(regra geral + exceções) não vai para usuário sem papel privilegiado — ele revela o que os
outros personagens sabem. Tudo pelo **mesmo** módulo que redige token oculto e roll mode:
não pode existir caminho de emissão que contorne.

**Cobre:** REQ-CTT-080..085, REQ-CTT-013.
**Pronto quando:** teste inspeciona o payload (não a tela) nos três estados, e um teste de
cobertura prova que o snapshot, o broadcast e o replay passam pelo mesmo funil.

### G062 — Seção Na mesa

`components/contacts/ContactsPanel.svelte` (novo)

Cartão com retrato, nome, título, presença e condições. **Nenhum ponto de vida, para papel
nenhum**, em forma alguma. Os personagens do próprio usuário primeiro, cada bloco em ordem
alfabética com `localeCompare` pt-BR; presença muda a **apresentação**, nunca a posição.
Título livre sob o nome, editável no próprio cartão por quem tem posse e pelo Mestre
(`Enter` confirma, `Esc` cancela); vazio, cai para classe e nível, visualmente distinto.
Sub-personagem **dentro** do cartão do dono, herdando a visibilidade dele. Duplo-clique abre
a ficha, e há botão alcançável por teclado. Arrastar para o canvas é só do Mestre.

**Cobre:** REQ-CTT-010..028, REQ-CTT-085.

### G063 [P] — Condições por contrato declarado

`components/common/ConditionChip.svelte` (compartilhado com 40 e 42)

Cor por `tone` (benefício / penalidade / situação), **nunca por gravidade**; crítica é ênfase
preenchida, **não uma quarta cor**; valor colado ao rótulo em numeral tabular ("Amedrontado
2"), nunca etiqueta separada; ajuda em tooltip **desenhado**, não `title` nativo; ordem
críticas → penalidades → situações → benefícios, alfabética dentro do grupo; teto de duas +
"+N" que expande no próprio cartão. **Falha aberta:** declaração incompleta degrada a
exibição, **nunca** esconde a condição. Sem ícone — o `img` do registro aponta para arte da
Paizo, proibida no projeto.

**Cobre:** REQ-CTT-030..038 (e serve REQ-CBA-050/051, REQ-NPC-033).
**Depende de:** G001.

### G064 — Conhecidos e categorias do usuário

Seção Conhecidos lista quem está em `entrevisto` ou `conhecido`. `entrevisto` aparece **sem
nome, título ou retrato**, marcado como não identificado, e não oferece categorizar nem
abrir ficha. `oculto` não aparece em lista, contagem, busca nem indicador. Para o Mestre,
cada contato mostra discretamente quantos conhecem e quantos entreviram.

Categorias são **do usuário**, moram no aparelho por mundo + usuário, e ninguém vê nem
administra as de outro. Um contato está em **uma** categoria; excluir categoria devolve os
contatos para "Sem categoria" e **não exclui ator algum**; a ordem é manual, definida por
ele, e persiste.

**Cobre:** REQ-CTT-040..044, REQ-CTT-050..057.

### G065 — Janela "Quem conhece quem"

`components/contacts/KnowledgeGridWindow.svelte` (window manager)

Aberta por um **rodapé fixo** que só o Mestre enxerga (rodapé, não cabeçalho: o cabeçalho é
da busca, que serve aos dois papéis). Grade contatos × personagens; célula cicla
`oculto → entrevisto → conhecido` e distingue visualmente a exceção; acionar o **nome do
contato** cicla a regra geral e alinha a linha inteira descartando exceções; acionar o
**nome do personagem** cicla a coluna, uniformizando em `conhecido` quando estiver mista.
Não cria, não exclui e não edita ator. **Nenhum controle de conhecimento existe nos cartões
da lista** — a edição vive num lugar só.

**Cobre:** REQ-CTT-060..067, RNF-CTT-04.

### G066 [P] — Badge, estados vazios e acessibilidade

Ponto de estado aceso quando um contato **sobe de estado** para qualquer personagem do
usuário com a aba fechada, apagado ao abrir. **O Mestre nunca vê esse ponto** — a novidade é
sempre obra dele. Estado vazio por papel, e **nenhum deles oferece criar ator**. Estado,
presença e "meu personagem" nunca comunicados só por cor.

**Cobre:** REQ-CTT-002..004, REQ-CTT-090..094.

---

## Fase 6 — Aba NPCs (42) ⛔ não atrasar em relação à Fase 5

Enquanto esta fase não fechar, `ActorDirectory.svelte` **fica no lugar**: ele é hoje a única
UI que cria e exclui ator, e a `39` tirou isso da lista do jogador de propósito
(DEC-CTT-01). Entregar a Fase 5 e parar aqui deixa o cliente sem criar nem excluir ator.

### G070 — Árvore de pastas de verdade, com fixação local

`components/npcs/NpcsPanel.svelte` · `Folder` (REQ-DOC-018) no servidor

Criar, renomear, aninhar e excluir pasta. Excluir pasta **não exclui ator**: os atores vão
para "Sem pasta" e as subpastas sobem um nível. Contagem da subárvore por pasta. **Fixar**
sobe a pasta para um bloco no topo, fora da posição dela na árvore, exibindo o caminho da
mãe; **desafixar devolve à ordenação que ela teria se nunca tivesse sido fixada** — nenhuma
posição anterior é guardada. Fixação e estado recolhido/expandido moram no aparelho, por
mundo + usuário, e **não alteram o document `Folder`**.

**Cobre:** REQ-NPC-020..027.
**Pronto quando:** teste prova que um segundo Mestre em outro aparelho não vê as fixações do
primeiro e que o `Folder` está byte-idêntico.

### G071 — Mover tem dois caminhos, e os dois são obrigatórios

Arraste sobre a pasta de destino **e** controle explícito na própria linha, alcançável por
teclado. "Sem pasta" é destino válido dos dois. Escolher só um exclui metade das formas de
operar a mesa.

**Cobre:** REQ-NPC-028, REQ-NPC-029.

### G072 — A linha do não-jogável

Retrato, nome, título editável na linha, nível/identificação do sistema, condições (pelo
contrato de G063), sub-personagens **dentro** da linha do dono, e quantas **presenças na
cena** o ator tem e em quais cenas — sem exibir dado algum da presença individual. **Nenhum
ponto de vida**, por um motivo diferente do da 39: quando a presença não é vinculada ao
ator, a vida do ator-base é **molde**, não valor vivo.

**Cobre:** REQ-NPC-030..036, REQ-NPC-010..014.

### G073 — Atitude: uma só para a party

Atitude gravada **no ator** (`inimigo` · `neutro` · `aliado`), válida para a party inteira —
não existe atitude por personagem, ao contrário do conhecimento. Ciclada na própria linha, a
cada acionamento, também por teclado (mesmo gesto da célula da grade da 39, para não ensinar
dois hábitos). Perigo não tem atitude, e aí nada é exibido. **A atitude não é entregue a
usuário sem papel privilegiado** — saber que o ferreiro é hostil antes de a cena dizer é
metagame —, e a supressão é no módulo único de redação.

**Cobre:** REQ-NPC-037..039, REQ-NPC-082.

### G074 — Criar: duas portas na mesma janela, e nenhum segundo importador

Janela de criação com **do bestiário** (busca por nome sobre os packs de ator, importando
pelo mecanismo da spec 16) e **do zero** (subtipo + nome). Subtipos oferecidos: apenas `npc`
e `hazard` — `character` nasce com o player, `familiar` nasce colado a um dono, `loot` é o
baú, e **veículo não existe no Fusion** (não é subtipo cortado: nunca foi declarado). Preset
**pré-preenche a ficha e não fica gravado** no ator: não há etiqueta de "mercador" na lista
porque não há nada gravado para etiquetar. Pasta e atitude iniciais escolhíveis; criar a
partir de uma pasta já a traz selecionada.

**Cobre:** REQ-NPC-040..048.
**Depende de:** G020 (a busca do bestiário atravessa a fechadura de plateia — o Mestre passa).

### G075 — Excluir mostra o que cai junto, e recusa com combate ativo

Antes de excluir, listar as presenças em cena (quantas e em quais), o conhecimento gravado
sobre o ator e a ficha com seus itens. **Recusar** enquanto o ator participar de combate
ativo, com a recusa dizendo como destravar. Excluído: as presenças somem de todas as cenas e
o conhecimento sobre ele — regra geral e exceções — deixa de existir (o caso espelho de
REQ-CTT-076, que não estava em spec nenhuma).

**Cobre:** REQ-NPC-050..055.

### G076 [P] — Baú no rodapé, e o arraste que cria presença

Rodapé fixo com o controle do baú e o que abre a janela de conhecimento. O baú **não é
ator**: não aparece no diretório, na busca, em contagem nem na janela de conhecimento.
Arrastar a linha para o canvas cria uma presença do ator na cena.

**Cobre:** REQ-NPC-060..063.
**Pendurado na `41`:** se a presença nasce vinculada ou desvinculada (Q-NPC-03), e onde vive
o conteúdo do baú (Q-NPC-05). Não decidir aqui.

### G077 [P] — Conhecimento na linha: leitura, e a mesma janela

A linha exibe "2 conhecem, 1 entreviu" **em leitura** e não oferece controle que altere
nada. O rodapé abre a **mesma** janela "Quem conhece quem" da aba Contatos — não uma
segunda janela, não um segundo modelo.

**Cobre:** REQ-NPC-070..073.

### G078 — Enterrar o `ActorDirectory`

`packages/client/src/components/actors/ActorDirectory.svelte` ·
`packages/client/src/lib/actors/actorDirectory.ts`

Só depois de G070..G077. É aqui que a dívida declarada em DEC-CTT-01 fecha — **pela
metade, de propósito**: criar personagem passa a ser da `37` (G105) e **excluir personagem
segue sem tela nenhuma**, aceito em Q-NPC-06.

**Pronto quando:** `grep` por `ActorDirectory` volta vazio e o mundo `teste_xande` abre com
as duas abas novas sem perder ator.

---

## Fase 7 — Aba Cenas (44)

É a aba em que o **Mestre abre o mundo** (DEC-GAV-02), então ela precisa responder "o que a
mesa está vendo agora" antes de "quais cenas existem". Alvo:
`components/scenes/{ScenesSidebar,SceneCreateDialog,ScenePerceptionDialog,SceneDeleteConfirm}.svelte`
e `lib/scenes/{scenesState.svelte.ts,sceneController.ts}`.

### G080 — A cabeça "no ar", de altura fixa

Topo do painel, fora da área rolável: nome, dimensões, tamanho da grade e a **imagem de
fundo** escalada (o campo `thumb` existe e **nada o preenche** — gerar miniatura é trabalho
de canvas, não de UI). Cena sem fundo mostra a cor de fundo da própria cena **sem mudar a
altura**. Nada muda a altura: nem nome longo, nem ambiente, nem ausência de imagem. Sem cena
no ar, a cabeça diz isso e oferece pôr uma, informando que os jogadores estão na tela de
espera.

**Cobre:** REQ-CEN-010..015, RNF-CEN-02.

### G081 — Ambiente na cabeça: alternar e resetar, só isso

Alternar escuridão, alternar névoa e **resetar a névoa** da cena no ar (com confirmação, por
ser irreversível). Refletem imediatamente o estado do servidor, **sem estado otimista
divergente**, e não aparecem para cena que não esteja no ar. A aba **aciona** os requisitos
da `07`; não define semântica de iluminação, visão nem exploração — ajustar valores é na
janela de percepção.

**Cobre:** REQ-CEN-020..025.

### G082 — Acervo agrupado por pasta

Cenas agrupadas pela pasta, na ordenação **manual do documento** (`folder` e `sort` existem
e nunca tiveram consumidor de UI); cena nova entra ao fim do grupo; sem pasta vai para um
grupo próprio, por último. Grupos recolhidos gravados no aparelho. Busca por nome de cena e
de pasta, ocultando grupo sem resultado. Cada linha com nome, dimensões e marcas de
ambiente. **A cena no ar não se repete no acervo** — ela vive na cabeça. Reordenar por
arraste grava no documento. Rodapé com a linha curta dizendo que o **mapa de região vive no
Hub** (os dois são "o mapa" no vocabulário da mesa, e a linha barata evita a busca
frustrada).

**Cobre:** REQ-CEN-030..037, REQ-CEN-039.

### G083 — Pôr no ar: um escritor só, e isso vira normativo

`packages/server/src/net/handlers/sync-handlers.ts` (`world:activeScene`)

Evento dedicado, restrito a papel privilegiado, que grava a fonte única e transmite a todos.
**Sem confirmação.** Aplica a initial view da cena de destino. Falha aparece como mensagem,
sem deixar a cabeça divergente do servidor.

A recusa de `active` pelo caminho genérico de `doc:update` **já existe no servidor** — mas
vivia só num comentário, e é isso que DEC-CEN-02 promove a normativo. O que falta aqui é o
**teste que a cita como requisito**: regra que só existe no código é regra que a próxima
refatoração desfaz. Esta tarefa **não** toca a guarda; só a amarra ao requisito.

**Cobre:** REQ-CEN-040..046.
**Pronto quando:** teste forja um `doc:update` alterando `active` e prova a recusa, citando
REQ-CEN-042.

### G084 — Preparar é local do Mestre

Abrir qualquer cena no canvas **do próprio Mestre**, sem alterar a cena no ar, sem gravar no
servidor e sem mudar a tela de ninguém. Enquanto durar, o canvas exibe aviso persistente com
o nome da cena no ar e as ações de pôr no ar e sair. Se a cena em preparo for posta no ar por
outra origem, ou for excluída, o preparo **termina sozinho, sem erro**. O acervo distingue a
cena em preparo sem depender só de cor.

**Cobre:** REQ-CEN-050..056, RNF-CEN-03 (entrar e sair do preparo **não** emite escrita
alguma ao servidor), REQ-CEN-003..005 (o badge é consequência direta: ponto aceso enquanto
houver preparo diferente do ar).

### G085 [P] — Os quatro diálogos viram janelas do window manager

Criar, configurar (nome, pasta, dimensões, preenchimento, grade, fundo), percepção
(escuridão, iluminação global, limiar, visão por token) e confirmar exclusão. **Os três
primeiros já existem no cliente** — o trabalho é ligá-los à gaveta, não reescrevê-los dentro
dela. Excluir nomeia o que cai junto (presenças, paredes, luzes, sons, desenhos) e o que não
cai (atores), e **é recusado para a cena que está no ar**, com a razão e o caminho. Criar
cena não a põe no ar.

**Cobre:** REQ-CEN-060..065, REQ-CEN-067.

### G086 [P] — A lista de cenas não sai para o jogador

`packages/server/src/net/handlers/`

Toda ação exige `isRolePrivileged` no servidor. A **lista** de cenas não é entregue a usuário
não privilegiado, e a recusa é indistinguível de inexistência — nome de cena revela lugar que
a campanha ainda não mostrou. O jogador continua recebendo os dados da cena **no ar**
necessários para renderizá-la, com a redação já definida em `02` e `07`.

**Cobre:** REQ-CEN-070..073.

---

## Fase 8 — Aba Compêndio (43)

Esta aba **não nasce de tela em branco**: `CompendiumBrowser.svelte` +
`lib/compendium/{compendiumApi,compendiumBrowser}.ts` + `server/src/compendium/` já cumprem
REQ-CMP-012..018 e REQ-CMP-021. O que muda é o que acontece quando isso vive numa gaveta de
300px, com ~12 mil documentos e um **jogador** do outro lado.

### G090 — Busca sobre o acervo inteiro, no servidor

`packages/server/src/compendium/service.ts`

Requisito **novo** (DEC-CPD-02): o servidor é dono do índice de busca de todos os packs
visíveis ao solicitante e responde já limitado. **Não** implementar como N buscas no cliente
sobre índices baixados — baixar tudo para poder buscar contraria DEC-CMP-02, e um pack
grande já leva 1,5 s só para indexar. Resultado agrupado por tipo, com contagem por grupo,
cada linha nomeando a fonte, e cada grupo truncado dizendo quantos ficaram de fora.

**Cobre:** REQ-CPD-030..032, RNF-CPD-01 (< 300 ms no acervo completo, medido no servidor).
**Depende de:** G003 (spec) e G020 (a busca só enxerga o que a plateia permite).
**Em aberto:** quantos por grupo antes de truncar (Q-CPD-04) — o número só sai de uso real;
escolha um, deixe configurável em um lugar só e anote.

### G091 — Dois modos, derivados do escopo — sem botão de alternar

Raiz + busca vazia → **estante**. Raiz + busca ou faceta → **resultado agregado**. Pack
aberto → índice dele, com a busca filtrando só aquele pack e uma ação explícita de **ampliar
para o acervo inteiro** que preserva o texto e volta à raiz. O escopo corrente aparece
sempre em texto, com caminho de volta. A barra de busca fica fora da área rolável, visível
nos dois modos.

**Cobre:** REQ-CPD-010..017.

### G092 [P] — Estante: packs por tipo, com licença sempre

Grupos colapsáveis por tipo de documento, cada pack com rótulo, contagem e **licença** —
que é a única informação que não pode ser truncada por falta de espaço (é a razão de o
projeto ser clean-room). Pack de plateia `gm` marcado como tal na estante do Mestre, para
ele saber o que o jogador não vê. Packs do mundo nos mesmos grupos, distinguíveis pela
licença.

**Cobre:** REQ-CPD-020..025.

### G093 — Linha de resultado: dois nomes, e o selo que não promete nada

Nome traduzido em destaque e nome original abaixo, quando houver os dois — a mesa fala "Bola
de Fogo", o livro fala "Fireball", e quem digita qualquer um tem que achar. Campos de índice
que o pack declarar, sem carregar o documento completo. Destaque do trecho que casou. **Selo
"no mundo"** quando já existe documento originado daquela entrada — e o selo **não promete
que estejam iguais**: importar clona com `_id` novo e o clone não acompanha o pack. Imagem
quebrada cai para ícone de tipo sem furar o alinhamento.

**Cobre:** REQ-CPD-040..046.

### G094 [P] — Pré-visualização em janela, nunca em lâmina interna

Abre em janela flutuante, carrega o documento sob demanda, mostra carregando e erro com nova
tentativa, e **não substitui a lista** — comparar duas criaturas é uso normal, e a lâmina
interna de hoje o impede. Bloco de licença com a do pack e o override do documento. Mais de
uma janela pode ficar aberta; fechar a gaveta não as fecha.

**Cobre:** REQ-CPD-050..054.

### G095 — Trazer para o mundo × trazer para a ficha

O jogador **não importa para o mundo**, mas **traz para a própria ficha**: o predicado que
protege não é o papel, é o `OWNER` do **destino**, validado no servidor. Arrastar entrada de
ator para a cena traz para o mundo antes de criar a presença; arrastar o que não é ator
sobre a cena é **recusado sem importar nada**. Trazer duas vezes cria dois documentos — o
selo informa, não bloqueia. Importação em lote com progresso e cancelamento que não deixa o
mundo em estado parcial sem aviso. A aba **não** cria documento do zero nem edita documento
de pack: autoria é da `42`.

**Cobre:** REQ-CPD-060..066, REQ-CPD-073.

### G096 [P] — O que sobrevive à troca de aba, fixados e recentes

Pack aberto, texto de busca e facetas restaurados ao voltar — **dentro da mesma sessão do
navegador**; fechar a aba do navegador zera (voltar no dia seguinte a um filtro esquecido é
pior que começar limpo). Tudo no aparelho, por mundo + usuário. Fixados no topo da estante,
mais um bloco curto de usados recentemente com teto fixo e sem configuração; fixado cujo
pack deixou de ser visível **some sem erro** e sem apagar os demais. Badge: ponto de estado
só enquanto **uma importação em lote do próprio usuário** estiver correndo.

**Cobre:** REQ-CPD-002..005, REQ-CPD-080..084.

---

## Fase 9 — Aba Configurações (37)

Última porque depende das outras duas metades: a seção Usuários é quem paga a metade
restante da dívida de criação (G105), e a seção Mundo mexe na ficha de personagem.

### G100 — Índice → seção, e o corte por papel na entrada

Abre num **índice** de seções, uma por linha, com título e uma linha de descrição, **sem
ícone**. O jogador vê **uma** entrada ("Minhas preferências") — índice de um item é honesto.
O Mestre vê cinco. Escolher substitui o índice pelo conteúdo, dentro da mesma gaveta, com
"‹ voltar" no cabeçalho; recolher e reabrir volta ao **índice**, não à última seção.
**Nada nesta aba abre janela flutuante** — é a filha que decide o oposto da 38, e as duas
convivem sob a §7 da 36.

**Cobre:** REQ-CFG-001..005, REQ-CFG-010..013.

### G101 [P] — Minhas preferências: 100% local

Os três canais de volume (`music`, `environment`, `interface`) — que a `13` mandava para uma
"sidebar de áudio" que não existe no trilho — mais as notificações do cliente (som de chat,
aviso de turno). Tudo no `localStorage`, **sem uma operação de rede**. **Sem idioma e sem
tema**: o i18n fica fixo em pt-BR e não há sistema de temas. O campo `preferences` de
REQ-USR-003 segue existindo no modelo e **sem UI**.

**Cobre:** REQ-CFG-020..023, REQ-CFG-072, RNF-CFG-01.

### G102 — Seção Mundo: renderizador puro do que o sistema declarou

Lista exatamente as settings de escopo `world` declaradas pelo sistema ativo, renderizando
cada uma **a partir do schema** (booleano → alternador; enum → seleção; número → campo).
**Nenhum `if pf2e` em lugar nenhum da aba**: nenhuma chave, rótulo ou regra de sistema
aparece no código dela.

**Cobre:** REQ-CFG-030, REQ-CFG-031, RNF-CFG-02.
**Pronto quando:** teste declara uma setting nova num sistema fake e ela aparece na seção
**sem uma linha alterada** na aba.

### G103 — Regra variante vira setting de mundo, e sai da ficha

`systems/pf2e/` (declaração das settings) · ficha de personagem · migração **de dado dos
atores** no servidor (documento, não schema — não é migration)

Arquétipo livre e multiclasse por nível deixam de morar em `system.build` do personagem e
viram **settings de mundo**, operadas só nesta aba — dois personagens da mesma mesa não
podem derivar sob regras diferentes. A ficha perde o controle. **Migração:** ao abrir um
mundo pela primeira vez depois da mudança, se **qualquer** ator tiver a regra ligada, a
setting do mundo nasce ligada; em seguida o campo sai dos atores. Roda uma vez por mundo e
fica em log. Mudar a setting **re-deriva** os personagens afetados e propaga sem recarregar
a página.

Desligar uma regra que deixa personagens com escolhas ilegítimas pede confirmação dizendo
**quantos** são afetados; **ligar nunca confirma** — ligar só concede.

**Cobre:** REQ-CFG-032..035, REQ-CFG-082, REQ-MCL-001, REQ-MCL-004.
**Em aberto:** quem conta os personagens afetados, servidor ou cliente do GM (Q-CFG-03). O
número precisa ser o real, e a conta não pode custar uma varredura completa a cada abertura
da seção.

### G104 [P] — Permissões, uma por linha

As permissões configuráveis de REQ-USR-008, **uma por linha**, com o papel mínimo num
seletor — **nunca** como matriz bidimensional (não cabe em 300px, e a 37 proibiu). Marca de
"alterado" quando o valor difere do default. Escrita validada no servidor; recusa mantém o
valor anterior na tela.

**Cobre:** REQ-CFG-040..042, REQ-CFG-073.

### G105 — Usuários — e é aqui que personagem nasce

Lista com nome, papel, cor e estado de conexão, um por linha. Criar, editar (nome, papel,
cor, avatar, ativo), resetar senha, desativar e desconectar. **Criar usuário cria também um
personagem em branco associado a ele, com o usuário como `OWNER`** (DEC-NPC-02): personagem
sem dono é documento órfão que ninguém opera e que não aparece na aba Contatos, que lista por
plateia. Editar acontece **dentro da gaveta**, como formulário empilhado, não em janela. A
senha de um reset aparece **uma vez**, com ação de copiar, e não é recuperável depois.
Desconectar e desativar pedem confirmação **nominal** ("Tirar \<nome\> da mesa?").

**Cobre:** REQ-CFG-050..054, REQ-USR-025 (com a emenda de G005).
**Fecha:** a outra metade da dívida da DEC-CTT-01. **Excluir personagem continua sem tela**
(Q-NPC-06) — declarado, não esquecido.

### G106 [P] — Mods como endereço vazio, e o gate de escrita

A seção Mods existe **desde o MVP, sem nenhum mod existir**, com estado vazio ("nenhum mod
instalado neste mundo") e o controle de instalar **desabilitado com o motivo legível** —
endereço vazio custa uma seção; endereço inexistente custa uma renegociação de layout no dia
em que o primeiro mod chegar. **Não aparece para o jogador**, nem em leitura.

Toda escrita das seções Mundo, Permissões, Usuários e Mods é verificada no servidor exigindo
`role === GAMEMASTER`. **Nota de implementação da própria spec:** o predicado de hoje é
`isRolePrivileged`, que inclui `ASSISTANT_GM` — papel extinto por decisão de 2026-08-15
(issue #133). Enquanto a issue não roda, guardar explicitamente por GAMEMASTER.

**Cobre:** REQ-CFG-060..064, REQ-CFG-070, REQ-CFG-071, REQ-CFG-080..083.

---

## Mapa de PRs

| PR  | Conteúdo                              | Depende de     | Por que nesta ordem                                                 |
| --- | ------------------------------------- | -------------- | ------------------------------------------------------------------- |
| A   | Fase 0 — emendas de spec (G001–G007)  | —              | Sem G001 não existe o contrato de condição que três abas consomem   |
| B   | Fase 2 — plateia de pack (G020, G021) | A (G003, G004) | Único defeito **vivo** do conjunto; não depende de UI               |
| C   | Fase 1 — contêiner (G010–G017)        | —              | Bloqueia as sete abas. Pode correr em paralelo com B                |
| D   | Fase 7 — Cenas (G080–G086)            | C              | O contêiner já arrancou o painel de cenas de dentro do `AppSidebar` |
| E   | Fase 3 — Chat (G030–G041)             | C              | Painel mais usado; metade do trabalho é servidor e independe de D   |
| F   | Fase 4 — Combate (G050–G056)          | C, A (G001)    | Condições dependem do contrato emendado                             |
| G   | Fase 5 — Contatos (G060–G066)         | C, A (G001)    | Traz o único modelo novo; abre a dívida de criar/excluir ator       |
| H   | Fase 6 — NPCs (G070–G078)             | G, B           | **Não deixar G sem H**: é H que devolve criar e excluir             |
| I   | Fase 8 — Compêndio (G090–G096)        | C, B, A (G003) | A fechadura já está posta; aqui entra a busca agregada              |
| J   | Fase 9 — Configurações (G100–G106)    | C, H, A (G005) | G105 fecha a metade restante da dívida; G103 mexe na ficha          |

Se algo for cortado por tempo, corta-se **da J para trás** — com uma exceção: **G e H andam
juntas**. A Fase 0 e a Fase 2 nunca são cortadas: uma é a catraca das specs, a outra é o
bestiário aberto ao jogador.

---

## Meta de rastreabilidade

Estado em 2026-08-16 (`specs/RASTREABILIDADE.md`, ponta de `alfa/app`): **422 requisitos
[MVP], 0 citações**. Cada PR deste plano tem que mover a linha da sua spec.

| Spec | [MVP] | Hoje | Fase | PR   |
| ---- | ----: | ---- | ---- | ---- |
| 36   |    24 | 0%   | 1    | C    |
| 37   |    39 | 0%   | 9    | J    |
| 38   |    56 | 0%   | 3    | E    |
| 39   |    67 | 0%   | 5    | G    |
| 40   |    59 | 0%   | 4    | F    |
| 42   |    59 | 0%   | 6    | H    |
| 43   |    60 | 0%   | 2, 8 | B, I |
| 44   |    58 | 0%   | 7    | D    |

Cobertura aqui é **reivindicação**, não prova (`CONVENCOES.md` §8): um teste que nomeia o id
afirma cobri-lo, e a afirmação fica auditável. O defeito que a r22 ensinou — 80 testes
verdes convivendo com 60 defeitos porque conferiam a derivação contra a própria tabela de
origem — é o que este plano precisa não repetir: **teste de payload, não de tela**, onde o
requisito fala de payload.

---

## O que este plano NÃO fecha (e as specs sabem disso)

| Assunto                                        | Onde está registrado           | Efeito no plano                                                        |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| **Spec `41` — Token**                          | `CONVENCOES.md` §7, DEC-CBA-06 | G053 (candidatos), G076 (presença e baú) ficam pendurados de propósito |
| Ficha de não-jogável                           | DEC-NPC-13                     | G072 abre a ficha e não diz nada do conteúdo dela                      |
| API de Mods                                    | DEC-CFG-01, REQ-ESC-012        | G106 entrega o endereço vazio; carregar mod é [V2]                     |
| Catálogo de presets de NPC                     | Q-NPC-02, REQ-NPC-048          | G074 fixa o conceito e o ponto de extensão, não a lista                |
| Targeting no painel de combate                 | DEC-CBA-05                     | Fora da aba, no canvas; não implementar por conveniência               |
| Resumo pós-combate                             | REQ-CBA-016, Q-CBA-04          | Depende de apagar ou arquivar o `Combat`                               |
| Miniatura gerada de cena                       | DEC-CEN-04, REQ-CEN-038        | G080 usa a imagem de fundo; a lista fica sem imagem                    |
| Atualizar no mundo o que o pack mudou          | `43` §11                       | G093 entrega o selo, que informa e não promete                         |
| Excluir personagem de jogador                  | Q-NPC-06                       | Segue sem tela — aceito por escrito, não esquecido                     |
| Vida de criatura vazando pelas barras do token | Q-CBA-02, REQ-CNV-090          | G052 é regra de tela e **diz isso no código**                          |

---

## Questões em aberto que travam decisão dentro de uma tarefa

| Questão  | O que ela trava                                                   | Tarefa |
| -------- | ----------------------------------------------------------------- | ------ |
| Q-CFG-03 | Quem conta os personagens afetados ao desligar regra variante     | G103   |
| Q-ACH-02 | Invalidar um card invalida as rolagens filhas junto?              | G032   |
| Q-ACH-03 | O export do log inclui mensagens invalidadas e a marca?           | G041   |
| Q-ACH-04 | Favorito com fórmula inválida: desabilita ou falha ao clicar?     | G035   |
| Q-CTT-02 | Categorias no aparelho se perdem ao trocar de máquina             | G064   |
| Q-CBA-03 | Onde aparece a escolha de estatística de iniciativa               | G053   |
| Q-NPC-01 | Em que pasta cai o importado, e se ele guarda vínculo com o pack  | G074   |
| Q-CPD-04 | Quantos resultados por grupo antes de truncar                     | G090   |
| Q-CEN-01 | Onde se gerencia pasta de cena (a `42` tem árvore, a `44` não)    | G082   |
| Q-CEN-06 | Pôr no ar durante encontro ativo em outra cena: recusar ou avisar | G083   |

Nenhuma delas bloqueia a fase inteira: em todas dá para entregar o caminho principal e
deixar a resposta anotada na spec no mesmo PR (`CONVENCOES.md` §2 — spec muda antes do
código, e divergência descoberta na implementação se corrige na spec no mesmo PR).

---

## Rastreabilidade: decisão da spec → tarefa

| Decisão                                                                | Tarefa                      |
| ---------------------------------------------------------------------- | --------------------------- |
| DEC-GAV-01/09 (sete abas, três blocos, Configurações no rodapé)        | G011                        |
| DEC-GAV-02 (primeiro acesso por papel) · DEC-GAV-03 (um gesto)         | G013 · G012                 |
| DEC-GAV-04 (largura fixa) · DEC-GAV-06 (dois badges) · DEC-GAV-07      | G012 · G014 · G010          |
| DEC-GAV-08 (tela estreita)                                             | G015                        |
| DEC-CFG-04 (drill-in) · DEC-CFG-06 (local) · DEC-CFG-07 (renderizador) | G100 · G101 · G102          |
| DEC-CFG-08 (regra variante é do mundo) · DEC-CFG-09 (escrita imediata) | G103                        |
| DEC-CFG-01 (endereço dos mods) · DEC-CFG-10 (só o Mestre escreve)      | G106                        |
| DEC-ACH-01 (log + janelas) · DEC-ACH-02/03 (barra e caixa)             | G033                        |
| DEC-ACH-04 (seletor manda em tudo) · DEC-ACH-05/06 (favoritos, janela) | G034 · G035                 |
| DEC-ACH-07 (busca do servidor, contexto) · DEC-ACH-08 (invalidação)    | G030/G031/G038 · G032       |
| DEC-ACH-09 (alvo é retrato, CA fora) · DEC-ACH-10 (dados sempre)       | G039 · G036                 |
| DEC-ACH-11 (abrir marca lido) · DEC-ACH-12 (sem dado 3D)               | G037 · G040                 |
| DEC-CTT-03/04 (conhecimento por par, três degraus)                     | G060 · G061                 |
| DEC-CTT-01 (não cria nem exclui) · DEC-CTT-02 (sem vida)               | G062 (dívida fecha em G078) |
| DEC-CTT-05 (um lugar de edição) · DEC-CTT-08 (categorias locais)       | G065 · G064                 |
| DEC-CTT-11 (condição por contrato)                                     | G001 → G063                 |
| DEC-CBA-02 (cabeça de altura fixa) · DEC-CBA-03 (vida por papel)       | G050 · G052                 |
| DEC-CBA-04 (iniciativa só na montagem) · DEC-CBA-08 (encerrar o seu)   | G053 · G054                 |
| DEC-CBA-07 (ponto âmbar) · DEC-CBA-11 (o que é tela, o que é sigilo)   | G055 · G052/G056            |
| DEC-NPC-01/02 (autoria de não-jogável; personagem nasce com o player)  | G074 · G105                 |
| DEC-NPC-03/04 (pastas fixáveis; dois caminhos de mover)                | G070 · G071                 |
| DEC-NPC-07 (preset não é gravado) · DEC-NPC-08 (baú não é ator)        | G074 · G076                 |
| DEC-NPC-09 (atitude da party) · DEC-NPC-12 (excluir mostra o que cai)  | G073 · G075                 |
| DEC-CPD-01/02 (dois modos; busca no servidor)                          | G091 · G090                 |
| DEC-CPD-04 (plateia de pack) · DEC-CPD-05 (mundo × ficha)              | G020/G021 · G095            |
| DEC-CPD-03/07 (janela; licença sempre) · DEC-CPD-12 (selo informa)     | G094 · G093                 |
| DEC-CPD-09/10 (escopo sobrevive; fixados locais)                       | G096                        |
| DEC-CEN-01/04 (cabeça fixa com o fundo) · DEC-CEN-06 (ambiente)        | G080 · G081                 |
| DEC-CEN-02 (um escritor só) · DEC-CEN-03 (preparar é local)            | G083 · G084                 |
| DEC-CEN-05/10 (agrupar por pasta; mapa de região no Hub)               | G082                        |
| DEC-CEN-07/09 (recusa de exclusão; quatro janelas)                     | G085                        |

</content>
</invoke>
