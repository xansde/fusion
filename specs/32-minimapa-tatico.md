# 32 — Minimapa Tático

- **Título:** Minimapa tático — overview da cena ativa em escala Local
- **Status:** draft v0.1
- **Data:** 2026-08-07
- **Baseada em:**
  - `docs/design/mapa-isekai.md` — §5 (regras de render herdadas: o mundo escala, a interface não) e a nota de escopo que separou "minimapa" em dois produtos.
  - `06-canvas-e-renderizacao.md` — câmera e navegação programática (REQ-CNV-007/008), flags de re-render (REQ-CNV-073), LOD (REQ-CNV-078).
  - PR #77 — HubLayer (host de overlay do Hub, banda de z `hub`), candidato natural a hospedar o widget.

> **Desambiguação.** "Minimapa" nomeava dois produtos de escalas diferentes. Esta
> spec é o **Minimapa Tático** — escala **Local** (cena de batalha: tokens, régua
> em quadrados, câmera). O mapa de exploração em escala **Região** (POIs, km,
> dias de viagem) é a `34-mapa-de-regiao.md`. As duas herdam a mesma regra de
> render do §5 do design: **o mundo escala, a interface não.**

---

## 1. Objetivo

Dar a cada usuário um widget compacto de orientação espacial sobre a cena ativa:
onde estou, onde estão os aliados e os inimigos visíveis, que parte do mapa a
minha câmera cobre — e navegação de um clique para qualquer ponto. O minimapa é
**orientação e navegação**, não um segundo canvas de jogo: nenhuma ação de jogo
(mover token, atacar, medir) acontece nele.

## 2. Escopo

### 2.1 Inclui

- Widget dockável com projeção reduzida da cena ativa (fundo + marcadores).
- Marcadores de tokens por disposition, destaque do token do próprio usuário.
- Retângulo de viewport da câmera local; navegação por clique e drag.
- Regras de visibilidade (o minimapa nunca mostra mais do que o canvas mostra).
- Comportamento de atualização e custo (coalescing, throttle).

### 2.2 Não inclui

- Mapa de exploração em escala Região (POIs, km) → `34-mapa-de-regiao.md`.
- O chrome do Hub do jogador que o hospeda → spec 28 (em escrita).
- Fog/vision em si → `07-visao-iluminacao-fog.md` (o minimapa apenas consome).

## 3. Conceitos

| Conceito         | Definição                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **Minimapa**     | Projeção 2D reduzida da cena ativa, em widget fixo na tela (não segue a câmera do mundo).         |
| **Marcador**     | Representação de um token no minimapa: um dot/anel de tamanho fixo em pixels de tela.             |
| **Viewport box** | Retângulo no minimapa correspondente à área da cena atualmente enquadrada pela câmera do usuário. |

## 4. Decisões

### DEC-MMT-01 — Desenho leve próprio, não um segundo render da cena

O minimapa desenha `scene.thumb` (thumbnail já persistido na Scene) como fundo e
marcadores vetoriais por cima — não re-renderiza o PrimaryGroup em um segundo
`PIXI.Application` nem usa RenderTexture da cena inteira por frame.

- **Racional:** custo previsível e independente da complexidade da cena (uma
  cena 10k×10k com 50 tokens precisa continuar a 60 fps — REQ-CNV-074+); o
  thumbnail já existe no modelo de dados; e o minimapa é orientação, não
  fidelidade visual.
- **Alternativa rejeitada:** RenderTexture do mundo por frame — paga o custo do
  mundo duas vezes e arrasta efeitos (fog, iluminação) que no minimapa viram
  ruído.

### DEC-MMT-02 — O minimapa consome a visibilidade existente; nunca é canal paralelo

O minimapa desenha exclusivamente o que o cliente **já recebeu e já renderiza**
no canvas principal: tokens redigidos pelo servidor não chegam; tokens fora da
visão (quando `tokenVision` ativo) não aparecem. Nenhuma regra de visibilidade
própria, nenhum dado extra do servidor.

- **Racional:** um widget que mostra mais do que o canvas é vazamento (o pior
  bug possível numa mesa); um que calcula visibilidade própria diverge em
  silêncio. Mesmo princípio que proíbe sistema paralelo de visibilidade em
  Notes (REQ-DOC-058).

### DEC-MMT-03 — Interface não escala

Marcadores e viewport box têm tamanho/espessura fixos em pixels de tela,
independentes do tamanho da cena e do zoom. Herdada do design
(`docs/design/mapa-isekai.md` §5.1): se o marcador escala, cena grande vira
sopa de pontos ilegíveis.

### DEC-MMT-04 — Hospedado como superfície do Hub

O widget monta dentro do `HubLayer` (PR #77) como `.hub-surface` — recebe
cliques, enquanto o resto da camada faz pass-through. Posição default: canto da
tela, configurável por usuário (client setting), fora das bandas de
menu/modal/notification.

## 5. Requisitos funcionais

### 5.1 Widget e conteúdo

- **REQ-MMT-001** [MVP] O cliente DEVE oferecer um minimapa da cena ativa como
  widget fixo na tela, com abrir/fechar por botão e por atalho de teclado, e
  estado (aberto/fechado, posição, tamanho) persistido por usuário.
- **REQ-MMT-002** [MVP] O fundo do minimapa DEVE ser o thumbnail da cena
  (`scene.thumb`); na ausência de thumbnail, um retângulo com a
  `backgroundColor` da cena e a proporção correta.
- **REQ-MMT-003** [MVP] Cada token visível para o usuário no canvas principal
  DEVE aparecer como marcador de tamanho fixo em pixels de tela, colorido pela
  disposition (mesmo esquema de cores do token ring — REQ-CNV-027), com o(s)
  token(s) controlado(s) pelo usuário destacado(s).
- **REQ-MMT-004** [MVP] O minimapa DEVE exibir o **viewport box** — o retângulo
  da cena enquadrado pela câmera local — atualizado em tempo real durante
  pan/zoom.
- **REQ-MMT-005** [MVP] O minimapa NÃO DEVE exibir nenhum token, marcador ou
  informação que o canvas principal do mesmo usuário não exiba (DEC-MMT-02).
  Para o GM, vale a visão de GM (tokens hidden aparecem como no canvas do GM,
  com indicação de ocultos).
- **REQ-MMT-006** [V2] Marcadores PODEM exibir estado agregado de HP (ex.: anel
  em três faixas), respeitando a mesma visibilidade das resource bars do token
  (REQ-CNV-028/031).
- **REQ-MMT-007** [V2] Pings (REQ-CNV-063) PODEM ecoar no minimapa como pulso na
  posição correspondente.

### 5.2 Navegação

- **REQ-MMT-008** [MVP] Clique em um ponto do minimapa DEVE centralizar a câmera
  naquele ponto da cena, com a animação da navegação programática
  (REQ-CNV-008).
- **REQ-MMT-009** [MVP] Arrastar o viewport box DEVE fazer pan contínuo da
  câmera; a interação respeita os limites de pan da cena.
- **REQ-MMT-010** [MVP] Clique em um marcador de token controlável pelo usuário
  DEVE centralizar a câmera no token correspondente.
- **REQ-MMT-011** [MVP] Nenhuma interação do minimapa DEVE alterar estado de
  jogo (posição de token, seleção, targeting) — o minimapa é somente câmera.

### 5.3 Atualização e custo

- **REQ-MMT-012** [MVP] O minimapa DEVE se atualizar a partir dos mesmos eventos
  de create/update/delete que o canvas consome, coalescendo múltiplas
  atualizações do mesmo frame (mesma disciplina de REQ-CNV-073).
- **REQ-MMT-013** [MVP] Com o minimapa aberto numa cena de referência de
  performance (REQ-CNV-074), a perda de fps do canvas principal NÃO DEVE
  exceder 5%.
- **REQ-MMT-014** [MVP] Trocar a cena ativa DEVE reconstruir o minimapa para a
  nova cena sem exigir reload do cliente.

## 6. Requisitos não-funcionais

- **REQ-MMT-020** [MVP] O widget DEVE respeitar as bandas de z-index de
  `base.css` (banda `hub`) — nunca cobrir menus, modais ou notificações.
- **REQ-MMT-021** [MVP] Acessibilidade: abrir/fechar acessível por teclado; o
  minimapa é um atalho visual e nenhuma informação DEVE existir apenas nele.

## 7. Critérios de aceitação

- **CA-MMT-01** Um jogador com a cena ativa aberta vê no minimapa: fundo da
  cena, seus tokens destacados, aliados/inimigos visíveis por disposition e o
  retângulo da própria câmera (REQ-MMT-002 a 004).
- **CA-MMT-02** Um token hidden para o jogador não aparece no minimapa do
  jogador, mas aparece no do GM com indicação de oculto (REQ-MMT-005).
- **CA-MMT-03** Clique no minimapa centraliza a câmera; arrastar o viewport box
  faz pan; clicar no marcador do próprio token centraliza nele; nada disso
  altera estado de jogo (REQ-MMT-008 a 011).
- **CA-MMT-04** Mover 5 tokens no mesmo frame produz um único ciclo de
  atualização do minimapa (REQ-MMT-012).

## 8. Dependências (specs irmãs)

- `02-modelo-de-dados.md` — `SceneDocument.thumb`, tokens embedded.
- `06-canvas-e-renderizacao.md` — câmera/navegação (REQ-CNV-007/008), cores de
  disposition (REQ-CNV-027), coalescing (REQ-CNV-073), performance (REQ-CNV-074+).
- `07-visao-iluminacao-fog.md` — visibilidade de tokens consumida (DEC-MMT-02).
- Spec 28 (Hub do jogador, em escrita) — hospedagem do widget (DEC-MMT-04).

## 9. Questões em aberto

1. Tamanho/posição default do widget e interação com o chrome do Hub — fecha
   junto com a spec 28.
2. Minimapa em cenas de Região (`34-mapa-de-regiao.md`): a princípio
   desnecessário (a cena de região já é um "mapa"); reavaliar se cenas de
   região muito grandes pedirem orientação própria.
