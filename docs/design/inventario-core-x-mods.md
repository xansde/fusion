# Inventário: o que é núcleo, o que é sistema embutido, o que é mapa

> Base para a discussão "o que é ou não é mod" no Fusion. Levantado em 2026-08-15 sobre a
> `build/app`/`alfa/app` (ponta `f2143ad`, 13/08). Fatos, não decisões — as decisões vão
> nascer da discussão e virar spec (provavelmente revisão da `15-api-de-sistemas.md` +
> `01-arquitetura-geral.md` DEC-ARQ-06).

## 1. Por que este documento existe

Desde o fim de semana de 08–09/08 a `build/app` recebeu a onda de mapa/hub (`#86`–`#110`):
minimapa, mapa de região, System Window, comitiva, avatar, quest board, map-package-io.
O Alexandre avaliou que o resultado ficou "vibecodado" e que se perdeu a possibilidade de
essas coisas serem **mods/addons** em vez de partes do núcleo. Resposta imediata: modelo de
branches `alfa/beta/stable` (ver `CLAUDE.md` § Branches) — a `stable/app` nasceu do estado
pré-mapa. Resposta de fundo: definir a fronteira núcleo × mod. Este inventário é o insumo.

## 2. Tamanho das peças (linhas versionadas, `git ls-files | wc -l`)

| Peça                                   | Linhas                  | Observação                                                                                                               |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/client`                      | 138.967                 | `lib/sheets` 41.910 (quase tudo pf2e) · `lib/canvas` 16.479 · `components/sheets` 19.680 · `hub` ~7.800 · `avatar` 2.368 |
| `packages/server`                      | 69.872                  | `__tests__` 30.721 · `net` 8.230 · **`etmos` 3.997** · `combat` 3.289 · `update` 3.694 · `tunnel` 2.335                  |
| `packages/shared`                      | 20.622                  |                                                                                                                          |
| `packages/system-api`                  | 4.849                   | manifest, registries, hooks tipados, effects, derive, combat, validate                                                   |
| `systems/pf2e`                         | 1.055.521               | quase tudo packs (dados); código em `src`                                                                                |
| `systems/sf2e` / `etmos` / `engine-2e` | 17.735 / 10.562 / 3.451 |                                                                                                                          |
| `tools/importer-pf2e`                  | 31.052                  |                                                                                                                          |

## 3. O que já é fronteira formal (e funciona)

- **`packages/system-api`** é real e bem desenhado: `manifest.ts`, `system-module.ts`,
  `registry.ts`/`registries.ts`, `hooks.ts` (bus tipado `on/once/off`, `pre*`/`post*`,
  isolamento de erro de listener), `effects.ts`, `derive.ts`, `combat.ts`.
- **Contrato de dependência** (REQ-ARQ-005, verificado por `tools/boundary-test` no CI):
  `system-api` importa só de `shared`; `systems/*` importam de `shared`, `system-api`,
  `engine-2e`; **`systems/*` não importam de `server` nem de `client`**.
- No client existe o embrião de registro de fichas: `lib/sheets/sheetRegistry.ts`,
  `registerPf2eSheets.ts`, `registerEtmosSheets.ts`.

## 4. Onde a fronteira vaza (lógica de sistema dentro do núcleo)

| Vazamento                                | Onde                                                                                                                                                                        | Tamanho | Por que importa                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Regras do Etmos dentro do server         | `packages/server/src/etmos/` (`conjuracao-handlers.ts` 936, `contestado-handler.ts`, `progressao-handler.ts`, `reacao-handler.ts`)                                          | ~4.000  | um sistema inteiro tem handlers de socket no core, não em `systems/etmos` via hooks            |
| Import direto de pf2e no server          | `packages/server/src/net/handlers/doc-handlers.ts` importa `detectFamiliarGrant` de `@fusion/system-pf2e` e tem `if (deps.systemId !== "pf2e")`                             | pontual | o server "sabe" que pf2e existe                                                                |
| Systems como dependência fixa do server  | `packages/server/package.json` depende dos 4 systems do workspace                                                                                                           | —       | é o DEC-ARQ-06 (compilado junto) — decisão, não acidente, mas é o ponto a rever                |
| Fichas do pf2e dentro do pacote client   | `packages/client/src/lib/sheets/pf2e/` (56 arquivos, 38.324 linhas) + `components/sheets/pf2e/` + `chat/pf2e/AbilityCard.svelte`; 35 arquivos importam por caminho relativo | ~40.000 | o maior módulo do client é código de sistema morando no core; tirar pf2e = reescrever o client |
| Client depende de `@fusion/system-etmos` | `packages/client/package.json`                                                                                                                                              | —       | idem, só que Etmos entra como pacote e pf2e como pasta                                         |

## 5. Área de mapa/cena — como se acopla

- **`packages/client/src/lib/canvas`** (16.479 linhas, ~63 arquivos): `FusionCanvas.ts`
  (orquestrador PIXI), `scene-orchestrator.ts`, grid (`GridRenderer`, calibração),
  `TileLayer`, `NoteLayer`, `PingLayer`, `RulerLayer`, `tokens/`, `walls/`, `vision/`
  (lighting, fog-state, vision-state), `combat/` (targeting, turn marker).
- Entrada é localizada: fora de `lib/canvas/` só 3 arquivos importam dela
  (`TableScreen.svelte`, `GridCalibrationPanel.svelte`, `TokenConfigDialog.svelte`).
- Saída **não** passa por camada de rede: `TokenInteractionManager.ts` e `WallsLayer.ts`
  importam `Socket` de `socket.io-client` e emitem direto.
- Server: `fog/` (218), `net/handlers/vision-handlers.ts`, `region-map-handlers.ts`
  (dentro dos 4.834 de `net/handlers`), testes `vision-m2a`, `fog-m2b`, `region-map`.
- Não há pacote "kernel": `documents`, `net`, `auth`, `ownership`, `redaction`, dice vivem
  em `packages/server/src` lado a lado com `combat`, `etmos`, `compendium`, `fog`. A
  separação canvas ↔ resto do client é de pasta, não de pacote nem de lint.

## 6. O que as specs já dizem

- `00` REQ-ESC-012 [MVP]: sistemas compilados junto; plugins dinâmicos de terceiros são [V2].
  Marketplace rejeitado por escopo. DEC-ESC-05: sem compat com módulos/API do Foundry.
- `01` **DEC-ARQ-06**: "Sistemas compilados junto no MVP (sem plugins dinâmicos de terceiros)".
  REQ-ARQ-008 fase (4) do boot: "registrar sistemas compilados na system API".
- `15`: spec central da extensibilidade — manifest, subtypes, derive, hooks, effects; reitera
  "não há carregamento dinâmico no MVP".
- `27`: plugins dinâmicos = M6. `04`, `19`, `21`, `RESUMO`, `CONVENCOES` repetem a premissa.

Ou seja: a spec nunca prometeu **mod** — prometeu **sistema compilado atrás de uma API**. A
discussão que vem é justamente se "mod" (opcional, desligável, talvez de terceiro) passa a
ser um conceito de primeira classe, distinto de "sistema".

## 7. Ledger: o que só existe na `alfa/app` (candidatos a promoção ou a mod)

Tudo depois de `ab4966f` (02/08), exceto os fixes do r24 que já estão na `stable/app`:

| Bloco                    | PRs / commits                                                                                                                                         | Natureza            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Mapa – itens de trabalho | `#86` mapa-alvo, `#87` mapa-som, `#88` token-ficha, `8faae5a` ping/grid calibrável/cena multi-imagem                                                  | canvas + server     |
| Mapa – specs             | `#89` specs mapas/overlays (32, 34), `#96` metamodelo de specs                                                                                        | docs                |
| Hub / System Window      | `#94` system-window-hub, `#97` hub-comitiva, avatar (`2d1741d`), `#93` camada isekai 2                                                                | client              |
| Ficha-alvo               | `#95` ficha-alvo-fofurinha                                                                                                                            | pf2e sheets         |
| Token/rolagem            | `#98` token-hp-indicator, `#100` multi-token-por-ator, `#99` revelar rolagem secreta                                                                  | canvas + server     |
| Conteúdo r28             | `#101` ancestralidades PC2, `#102` armas, `#103` armaduras/escudos, `#104` PC2 backgrounds/spells, `#105` bestiário, `#106` Druid, `#107` equipamento | packs + importer    |
| Mapa de região / missões | `#108` map-pins-ownership, `#109` map-package-io, `#110` quest-board                                                                                  | documentos + client |
| Fixes                    | `#111` prereq-evaluator, `#112` focus-pool, `#127` rastreabilidade                                                                                    | pf2e                |
| Ondas A/B/D              | `#114` conjuração, `#115` classe/ficha, `#119` ajustes teste ao vivo, `#121` mesa                                                                     | pf2e + client       |
| Docs                     | `#113`, `#116`, `#126`, `#129`                                                                                                                        | docs                |

## 8. Perguntas que a discussão precisa responder

1. **Mod é diferente de sistema?** Hoje só existe "sistema" (`system-api`). Precisa existir um
   segundo tipo de pacote — opcional, desligável por mundo, sem regras de jogo — para coisas
   como minimapa, mapa de região, quest board, avatar, comitiva, túnel, auto-update?
2. **Qual é o kernel mínimo** que nunca é mod: documents + persistence + net/redaction +
   auth/ownership + dice + chat + canvas básico (grid, tokens, movimento) + combat tracker?
   (É o "MVP global" do `specs/README.md`.)
3. **Onde um mod pode se plugar?** Client: registro de painéis/janelas, layers do canvas,
   comandos de chat, tipos de documento. Server: handlers de socket, tipos de documento,
   rotas HTTP. Tudo por registro tipado — nunca import direto (o vazamento do §4).
4. **O que fazer com o que já vazou** (§4): mover `server/src/etmos` para `systems/etmos`;
   pôr as fichas pf2e atrás do `sheetRegistry` de verdade (ou em `systems/pf2e/client`).
5. **Dinâmico ou compilado?** Mod pode continuar compilado no monorepo (como sistema hoje)
   e ainda assim ser "mod" se for opcional e passar só pelos pontos de registro. Carregamento
   dinâmico de terceiro segue [V2]/M6 — não precisa entrar agora.
6. **O que da `alfa/app` (§7) vira mod, o que vira núcleo, o que morre?**

## 9. Conceito 1 — "tudo que é BÁSICO para o VTT" (Alexandre, 2026-08-15)

Primeiro princípio da fronteira: o núcleo é só o **básico**. Régua do Alexandre: o que
"só trouxe problema" no canvas **não é básico** — vai inteiro para fora do núcleo, como
bloco opcional (mod), para ser refeito com calma.

### Básico (núcleo — nunca é mod)

| Bloco          | O que entra                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mundo e dados  | criar/abrir mundo, **documents + schemas, persistência SQLite**, export/import, backups — **próximo foco de trabalho**          |
| Rede           | server autoritativo, snapshot/broadcast/replay/ack, reconexão, presença                                                         |
| Usuários       | login GM/jogador, roles, ownership, redação de visibilidade                                                                     |
| Rolagem e chat | motor de dados no server, roll modes, chat com cards, macros simples                                                            |
| Combate        | combat tracker (iniciativa/turnos); o **cálculo** de iniciativa é do sistema (spec 10)                                          |
| Fichas         | window manager + **contrato** de ficha (`sheetRegistry`) — a ficha em si vem do sistema                                         |
| Compêndio      | browser de packs + contrato de importação — o conteúdo vem do sistema                                                           |
| Distribuição   | CLI `serve`/`world create`, túnel, auto-update, assets/upload                                                                   |
| Cena           | **só** exibir a imagem da cena ativa (sem grid, sem tokens, sem ferramentas em cima) — confirmado 15/08                         |
| Áudio          | playlists/sons (spec 13) — funcionou bem, o Alexandre quer no jogo base                                                         |
| Conteúdo PF2e  | packs e atualização do compêndio do r28 (#101–#107, inclusive Druid) entram na base — conteúdo é dado do jogo, não "coisa ruim" |

### Fora do básico (mod/addon — opcional, desligável por mundo)

- **Canvas de mesa inteiro como um bloco**: tokens, ping, régua, **grid** (calibração incluída),
  templates de área. Classificado pelo Alexandre como parte das "coisas ruins" — sai por inteiro.
- **Visão inteira como um bloco**: walls, visão, iluminação, fog. Sai por inteiro, como um todo.
- Minimapa tático (spec 32) · mapa de região (34) · System Window/hub, comitiva, quest board (28)
  · avatar (35) · pets/companions (29) · multiclasse por níveis (30) · **journal inteiro** (12: journal, roll tables, cartas — decidido 15/08) · dados 3D · **cada sistema de jogo** (pf2e, sf2e, etmos) atrás da
  `system-api`.

### Em aberto

Nada no momento — o recorte do básico está fechado (15/08).

### Próximo passo declarado

Melhorar **documentos e banco de dados** (documents/schemas/store/SQLite) — é o chão em que os
mods vão se plugar (tipos de documento registráveis, campos por mod sem `.extend()` apagando
campo desconhecido — ver `docs/lessons.md` sobre o `grid` que sumia).
