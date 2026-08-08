# Handoff — System Window do Fusion (specs de mapa + protótipo de log de missões)

> Handoff de sessão (2026-08-08). Próxima sessão: leia este arquivo antes de tocar em
> qualquer coisa da branch `docs/specs-mapas-overlays`. Documento efêmero — apagar
> quando o trabalho for absorvido pelas specs/PR.

## O que esta branch contém (sobre `build/app`)

| Commit    | Conteúdo                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `47950e3` | Specs: Note com ownership próprio (REQ-DOC-056..060), overlays de mapa (REQ-CNV-083..088 + OverlayData), specs novas **32-minimapa-tatico** e **34-mapa-de-regiao** |
| `13d9559` | Protótipo interativo do log de missões (proposta para a spec 28)                                                                                                    |
| `ca3fe09` | Protótipo reestilizado com a linguagem visual da System Window                                                                                                      |
| `fa7a68f` | Janelas de Comitiva e Mapa adicionadas ao protótipo                                                                                                                 |
| `d711b0a` | Este handoff + referência visual do Isekai-Companion copiada para o repo                                                                                            |
| `177caf8` | **Câmera no mapa do protótipo** — zoom/pan com "o mundo escala, a interface não"                                                                                    |
| `6875564` | Spec 34 ganha REQ-MREG-016/017 (traço não escala, zoom ancora no cursor) e os limiares de LOD calibrados                                                            |
| `8426775` | **Revelação em um clique** — Console de Revelação no próprio marcador, com `todos ▸`                                                                                |

## Referência visual do Mario (IMPORTANTE)

- **`docs/design/referencias/04-system-window-interativo.html`** — a "System Window"
  do **Isekai-Companion** (mockup do Mario, origem: `C:\ClaudeApp\Akakoiama\Isekai-Companion\mockups\telas-jogadores\04-system-window-interativo.html`
  na máquina dele; copiado para o repo neste handoff). É a **fonte da linguagem
  visual**: fundo preto + glow ciano `#57c8ff`, janelas com 4 cantos em L (`.br`),
  scanlines, títulos uppercase com letter-spacing largo, notificação central do
  Sistema (`.nt`, variações gold/bad/ok), barra de comando inferior com abas e
  atalhos. O Alexandre pediu explicitamente esta referência ("Usa isso de referencia").
- Demais materiais do Mario: `docs/design/mapa-isekai.md` (design das 4 escalas de
  mapa, PR #79), `docs/design/prototipo-minimapa-regiao.html` (POIs, zoom, regra
  "o mundo escala, a interface não"), `docs/design/fluxo-autoria-campanha.html`
  (mock original do log de missões, §C/§D).

## Estado do protótipo `docs/design/prototipo-log-missoes.html`

System Window completa e interativa (standalone, zero CDN): barra de comando com
`Missões [Q]` / `Comitiva [C]` / `Mapa [M]`; toggle global de papel
(Mestre / Tobias / Comedor); 6 missões mock com matriz de revelação ○→?→● do
Mestre; Comitiva com HP + Pontos de Foco (pips 0–3) + condições PF2e; mapa de
região com 8 POIs vinculados às missões, Console de Revelação por jogador e
"Rastrear no mapa"; sincronização missão→POI; rodapé mapeando cada elemento a REQs.

**Câmera do mapa (feita em `177caf8`)** — a regra do Mario deixou de ser citação e
virou demonstração. Quatro regras do `mapa-isekai.md` §5.1 implementadas e testadas:

- Duas camadas dentro de `.mv`: `world` (com `transform` da câmera, traços em
  `vector-effect="non-scaling-stroke"`) e `nodes` (**sem** transform — o pino
  mantém o tamanho em pixels; só a posição é recalculada por `50 + z*(x - cam.x)`).
- LOD de rótulo: assentamento sempre · demais ≥ 1,3× · categoria/distância ≥ 2,2×.
- Barra de escala em degrau redondo sobre o recorte de 512 km (§6.2).
- Pan travado nas bordas; zoom de roda ancorado no cursor; `clampCam()` centraliza
  a câmera à força em 1×.
- Bônus: "Rastrear no mapa" leva a câmera até o pin a 2,2× (REQ-CNV-008).

**Revelação em um clique (feita em `8426775`)** — o Console de Revelação passou a
morar também no pino: na visão do Mestre, o cursor sobre um marcador abre um botão
por jogador (`T`/`C` com o glifo ○→?→●) e um `todos ▸`, que leva a mesa ao próximo
degrau a partir de quem está mais atrás e nunca rebaixa quem já viu. O console do
painel de detalhe continua sendo a versão com nomes por extenso.

Verificação: 48 asserções em jsdom + um teste de arrasto separado (scripts efêmeros
no scratchpad, não commitados). Cobrem posição/LOD/escala/clamp/zoom-no-cursor, pan,
clique pós-arrasto engolido, o console do pino nos três casos do `todos`, e as
regressões do Console de Revelação e da redação do marcador oculto na visão do
jogador.

**Melhorias identificadas ainda não feitas:**

1. Sem atalho de teclado para zoom (`+`/`-`/`0`) — hoje só roda do mouse e os
   botões do canto. Deliberado: manter a barra de comando com `Q`/`C`/`M` limpa.

## Decisões arquiteturais já tomadas (não reabrir sem motivo)

- **Note = embedded com ownership próprio** (saída A da issue #78): 3 estados de
  pin — `none` oculto (não enviado), `limited` rumor "?" (redigido), `observer`+
  completo; visibilidade efetiva = max(ownership próprio, ownership da
  JournalEntry/Page vinculada). Spec 02, REQ-DOC-056..060.
- **Overlays de mapa**: EmbeddedCollection `overlays` da Scene, `hidden` default
  true, toggle 1 clique do GM, redigido do payload do jogador quando hidden
  (inclusive `src`). Spec 02 (OverlayData) + spec 06 (REQ-CNV-083..088, D14).
- **Spec 32 = minimapa tático / spec 34 = mapa de região**; spec 33 reservada ao
  Motor de Campanha. Redação de visibilidade SEMPRE via
  `packages/server/src/net/redaction.ts` — nunca canal paralelo.
- Board de missões no Hub = território da **spec 28** (em escrita pelo Mario);
  o protótipo é proposta/insumo para ela, não spec.

## Feito (OK do Alexandre em 2026-08-08)

1. **PR #89** — `docs/specs-mapas-overlays` → `build/app`. Só documentação; nenhum
   arquivo em `packages/`. Aguardando review.
2. **Resposta na issue #78** — decisão registrada como saída A, com o porquê, os
   REQs e o recorte do que ficou de fora (a implementação: `NoteSchema` continua
   `z.array(z.unknown())`). Fechar a issue ou abrir uma de implementação é chamada
   do Mario/Alexandre — não foi feito.
3. **Issue #90** — board de missões como insumo para a spec 28, com as 5 perguntas
   que a spec precisa responder e o alerta de que o relógio de missão talvez seja
   da spec 33 (Motor de Campanha), não da 28.
4. **Revelação em um clique** — feita, ver `8426775` acima.

## Ainda em aberto (não é pendência de execução — é decisão de outra pessoa)

- **Resposta do Mario na #78**: as três armadilhas de SVG do `mapa-isekai.md` §5.2
  **não** viraram REQ. Duas são específicas de SVG e não transferem para PIXI; a
  terceira (parser de path precisa cobrir `Q`/`T`/`A`) transfere e vale REQ na 34
  quando formos importar geografia do Azgaar. Se ele pedir, escrever.
- **Destino da #78**: fechar quando o PR #89 entrar, ou manter aberta até a
  implementação? Deixado explicitamente para o Mario/Alexandre no comentário.
- Perguntas abertas do design do Mario (outro momento): escala do mundo (4 km/px),
  onde mora o homebrew isekai.

## Avisos operacionais (aprendidos a caro nesta sessão)

- **Working tree principal (`C:\Users\xansd\pessoal\fusion`) é COMPARTILHADO com
  outras sessões Claude ativas** (hoje: `feat/wi-mapa-jogabilidade-01` com trabalho
  em andamento). NUNCA fazer checkout/commit lá sem checar `git branch --show-current`
  e `git status`. Já houve incidente de commits caindo em branch errada.
  **Use `git worktree add <scratchpad>/wt-docs-specs docs/specs-mapas-overlays`.**
- **Push**: repo `xansde/fusion` é da conta PESSOAL — `gh auth switch --user xansde`
  antes do push e `gh auth switch --user xansde-seazone` depois. Push imediato após
  cada commit verde.
- Protótipo: rodar `npx prettier --write` antes de commitar; validar o `<script>`
  com `node -e "new Function(...)"` e conferir zero refs externas.
- **Protótipo com comportamento (câmera, estado, redação) merece teste de verdade.**
  O monorepo não tem jsdom; instalar no scratchpad (`npm i jsdom`) e carregar o
  arquivo com `JSDOM.fromFile(path, { runScripts: "dangerously", pretendToBeVisual: true })`.
  Dois detalhes que custam tempo: (a) `let`/`const` de topo de script **não** viram
  `window.x` — inspecione o estado com `win.eval("cam.z")`, que é eval indireto e
  enxerga o escopo léxico global; (b) jsdom não faz layout (`clientWidth === 0`) nem
  implementa `setPointerCapture` — por isso o código tem fallback de largura e
  guarda `if (mv.setPointerCapture)`. Os scripts de checagem são efêmeros: não
  commitar, o protótipo não tem suíte.
