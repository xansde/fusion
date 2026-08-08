# Handoff — System Window do Fusion (specs de mapa + protótipo de log de missões)

> Handoff de sessão (2026-08-08). Próxima sessão: leia este arquivo antes de tocar em
> qualquer coisa da branch `docs/specs-mapas-overlays`. Documento efêmero — apagar
> quando o trabalho for absorvido pelas specs/PR.

## O que esta branch contém (4 commits sobre `build/app`)

| Commit    | Conteúdo                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `47950e3` | Specs: Note com ownership próprio (REQ-DOC-056..060), overlays de mapa (REQ-CNV-083..088 + OverlayData), specs novas **32-minimapa-tatico** e **34-mapa-de-regiao** |
| `13d9559` | Protótipo interativo do log de missões (proposta para a spec 28)                                                                                                    |
| `ca3fe09` | Protótipo reestilizado com a linguagem visual da System Window                                                                                                      |
| `fa7a68f` | Janelas de Comitiva e Mapa adicionadas ao protótipo                                                                                                                 |

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

**Melhorias já identificadas (não feitas):**

1. Mapa é estático — sem zoom/pan; a regra "ícones não escalam com o zoom" (design
   do Mario, `mapa-isekai.md` §5) está creditada no rodapé mas não demonstrada.
2. Revelação de POI é em dois passos (selecionar POI → ciclar no console do
   detalhe). O Alexandre foi avisado; se pedir, trocar por clique único no marcador.

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

## Pendências (aguardando OK do Alexandre — não executar sem ele pedir)

1. **Postar resposta na issue #78** — redigir a partir das decisões acima
   (Note com ownership, REQ-DOC-056..060) apontando os commits/specs. O rascunho
   da sessão anterior se perdeu no compact; reescrever é rápido.
2. **Abrir PR** `docs/specs-mapas-overlays` → `build/app` (PR é ato humano/com OK).
3. **Abrir issue** "board de missões na spec 28" vinculando o protótipo.
4. Perguntas abertas do design do Mario (outro momento): escala do mundo (4 km/px),
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
