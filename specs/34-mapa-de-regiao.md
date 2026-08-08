# 34 — Mapa de Região

- **Título:** Mapa de Região — exploração em escala de km sobre Scene, Note e overlays
- **Status:** draft v0.1
- **Data:** 2026-08-07
- **Baseada em:**
  - `docs/design/mapa-isekai.md` — modelo de escalas (§4), os três estados de visibilidade (§3.3), regras de render do protótipo (§5) e issue #78.
  - `docs/design/prototipo-minimapa-regiao.html` — protótipo funcional de referência (geografia real, 17 pinos, zoom 12×, troca de perspectiva, Console de Revelação).
  - `02-modelo-de-dados.md` — Note com ownership próprio (REQ-DOC-056/057/058), Overlay (REQ-DOC-059/060).
  - `06-canvas-e-renderizacao.md` — render de Notes (REQ-CNV-057/058/059) e map overlays (REQ-CNV-083+).
  - `31-base-canonica-de-conteudo.md` — precedente da fronteira por arquivo de dados (Wayfinder).

> **Desambiguação.** Esta spec é o mapa de **exploração em escala Região** —
> POIs, km, dias de viagem. O widget de overview da cena de batalha é a
> `32-minimapa-tatico.md`. **Fronteira com conteúdo:** geradores de mundo e
> motores de campanha (ex.: a "Forja" do isekai) vivem **fora** do Fusion; a
> fronteira é um **arquivo de dados** importado como pack, exatamente como a
> spec 31 fixou para o Wayfinder. Esta spec define o que o **motor** oferece
> para qualquer campanha de exploração — nada aqui é específico do isekai.

---

## 1. Objetivo

Permitir que uma campanha use cenas de **escala geográfica** (uma região com
vilas, ruínas e estradas — distâncias em km) com lugares **reveláveis por
jogador**: o GM despeja dezenas de POIs ocultos no mapa e revela cada um, para
quem quiser, no momento certo — como rumor ("tem algo ali") ou como
conhecimento (ícone, nome, ficha). Exploração deixa de ser narração e vira
estado do mundo, assimétrico entre os jogadores.

## 2. Escopo

### 2.1 Inclui

- Configuração de uma Scene como **cena de região** (sem grid tático, sem fog,
  medição em km).
- POIs como **Notes com ownership** — os três estados (oculto/rumor/conhecido)
  e as operações de revelação, individuais e em lote (Console de Revelação).
- **Overlays temáticos** na mesma cena (mapa político, rotas, territórios).
- Ligação entre escalas (Região ↔ Local ↔ Continente) por **soft reference**.
- Regras de render e legibilidade herdadas do protótipo.

### 2.2 Não inclui

- Motor de campanha (relógios de facção, frentes, geração de conteúdo) — spec
  33, reservada; o motor roda fora do Fusion (§ Desambiguação).
- Importadores de conteúdo (`tools/importer-*`) — spec 16 e specs de pack.
- Journal/fichas de lugar — `12-journal-tabelas-cartas.md` (M4); até lá, a
  ficha do lugar vive no próprio Note (`text`).
- O subsistema de Notes e o de overlays em si — normativos em `02` e `06`;
  esta spec os **consome**.

## 3. Conceitos

| Conceito                 | Definição                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Escalas**              | `[1] Local` (grid tático) · `[2] Região` (km, esta spec) · `[3] Continente` · `[4] Mundo`. Cada escala é uma Scene separada.    |
| **POI**                  | Ponto de interesse — um `Note` da cena de região (vila, ruína, masmorra, marco).                                                |
| **Rumor**                | POI em nível `limited` para um usuário: marcador "?" na posição, sem nome nem conteúdo (REQ-DOC-057).                           |
| **Portal**               | Note que aponta para outra Scene (soft reference) — a ligação entre escalas.                                                    |
| **Console de Revelação** | Painel do GM com a matriz POI × jogador e ações de revelação individuais e em lote.                                             |
| **Overlay temático**     | `Overlay` da cena (REQ-DOC-059) com uma leitura alternativa do mesmo território: político, rotas, territórios de facção, clima. |

## 4. Decisões

### DEC-MREG-01 — Região é uma Scene comum, diferenciada por configuração

Não existe tipo novo de Document. Uma cena de região é uma `Scene` com:
`grid.type = gridless`, `tokenVision = false`, fog desabilitado,
`gridDistance`/`gridUnits` em km (ex.: `4` + `"km"`), e
`flags.fusion.mapScale = "region"` (marcador para a UI adaptar ferramentas).

- **Racional:** todo o encanamento existente (ativação, navegação, permissões,
  packs, importers) funciona sem caso especial; a diferença é semântica de uso,
  não de modelo.
- **Alternativa rejeitada:** `RegionScene` como tipo próprio — duplicaria CRUD,
  render e import por uma distinção que três campos de configuração expressam.

### DEC-MREG-02 — Visibilidade de POI é ownership do Note; sem fog, sem sistema paralelo

O terreno aparece inteiro para todos (litoral e rios não são segredo — o
segredo é **o que há nos lugares**). A visibilidade por jogador mora
exclusivamente no `ownership` do Note (REQ-DOC-056): `none` = oculto,
`limited` = rumor, `observer` = conhecido. Nenhuma flag de visibilidade
paralela — o anti-padrão que REQ-DOC-058 e a issue #78 vetaram.

Ganho colateral: a prévia "ver como jogador X" é **exata**, não aproximada —
basta resolver ownership com outro userId.

### DEC-MREG-03 — Terreno é imagem raster por região; o gerador fica fora

O mapa de jogo é uma imagem de verdade (raster) por região — não o SVG cru de
um gerador de mundo (um export vetorial de gerador com milhares de polígonos
trava o pan; o caso medido: 4,7 MB). Conversão vetor→raster acontece na
toolchain de conteúdo, fora do Fusion. As armadilhas de SVG documentadas em
`docs/design/mapa-isekai.md` §5.2 (`<use>` sem width/height, `currentColor` em
`<symbol>`, parser de path sem `Q`) valem para essa toolchain — o canvas PIXI
não parseia SVG de terreno.

### DEC-MREG-04 — O mundo escala, a interface não

Herdada do protótipo (§5.1 do design): terreno e posições escalam com o zoom;
**ícones de POI têm tamanho fixo em pixels de tela** (na InterfaceGroup, com
escala compensada por zoom), rótulos têm LOD por zoom, e a barra de escala
recalcula km em degraus redondos. Se o ícone escala junto, zoom out vira sopa
de manchas.

### DEC-MREG-05 — Escalas ligadas por soft reference; o mapa cresce para fora

Um portal é um Note com `flags.fusion.portal = { sceneId }`. A ligação é
referência, não containment: criar o Continente daqui a seis meses é criar uma
Scene nova apontando um portal para a Região existente — nada construído
quebra. Começar pela escala do meio (Região) é suportado por design.

### DEC-MREG-06 — Overlays temáticos são a leitura alternativa do mesmo território

Mapa político, rotas de comércio, territórios de facção, clima: cada leitura é
um `Overlay` da mesma cena, alternado pelo GM em um clique (REQ-CNV-085), sem
duplicar cenas nem trocar background. Overlay oculto não chega ao jogador
(REQ-DOC-060).

## 5. Requisitos funcionais

### 5.1 Cena de região

- **REQ-MREG-001** [MVP] O cliente DEVE oferecer, na criação/configuração de
  cena, um preset **"Mapa de região"** que aplica DEC-MREG-01 de uma vez
  (gridless, sem vision/fog, unidade km, `flags.fusion.mapScale = "region"`).
- **REQ-MREG-002** [MVP] Em cena de região, a régua (REQ-CNV-060+) DEVE medir
  em km via `gridDistance`/`gridUnits`, com distância euclidiana (gridless).
- **REQ-MREG-003** [V2] A régua PODE exibir, além dos km, a conversão em
  **dias de viagem** por marchas configuráveis na cena
  (`flags.fusion.travelPaces`, ex.: a pé 30 · carroça 40 · cavalo 55 km/dia).
- **REQ-MREG-004** [MVP] A cena de região DEVE suportar overlays temáticos
  (REQ-CNV-083 a 088) sem qualquer comportamento adicional próprio.

### 5.2 POIs reveláveis

- **REQ-MREG-005** [MVP] Um POI é um Note comum (REQ-DOC-056): nasce `none`
  para todos; os três estados por usuário são os de REQ-DOC-057 e o render é o
  de REQ-CNV-058. Nada nesta spec redefine visibilidade.
- **REQ-MREG-006** [MVP] O GM DEVE poder alterar o nível de um POI para
  usuários selecionados a partir do próprio pin (menu de contexto: revelar como
  rumor / revelar / ocultar — por jogador ou para todos).
- **REQ-MREG-007** [MVP] O cliente DEVE oferecer o **Console de Revelação**:
  painel do GM com a matriz POI × jogador exibindo o estado efetivo de cada
  par, com ordenação/filtro por categoria de POI e ações em lote (ex.: revelar
  N POIs selecionados como rumor para dois jogadores).
- **REQ-MREG-008** [MVP] O Console DEVE oferecer a prévia **"ver como"**: a
  cena renderizada com a visibilidade efetiva de um usuário escolhido
  (resolução real de ownership — DEC-MREG-02), claramente sinalizada como
  prévia.
- **REQ-MREG-009** [MVP] Revelação DEVE propagar em tempo real: o jogador que
  ganhou `limited`/`observer` vê o pin nascer/completar-se na cena aberta, sem
  reload (delta de REQ-DOC-058).
- **REQ-MREG-010** [V2] Categorias de POI (assentamento, marco, masmorra, ...)
  PODEM ter conjunto de ícones e cores padronizado por pack, com fallback
  neutro do engine.

### 5.3 Navegação entre escalas

- **REQ-MREG-011** [MVP] Um Note com `flags.fusion.portal` DEVE oferecer ao GM
  a ação "ir para a cena" (ativar/visualizar a Scene alvo); a referência é
  soft — cena alvo ausente degrada para aviso, nunca erro.
- **REQ-MREG-012** [V2] Jogadores com nível `observer` no portal PODEM receber
  a ação de navegação quando a cena alvo lhes for navegável (`navigation`),
  mantendo toda checagem no servidor.

### 5.4 Render e legibilidade

- **REQ-MREG-013** [MVP] Ícones de POI DEVEM ter tamanho fixo em pixels de tela
  sob qualquer zoom (DEC-MREG-04); rótulos DEVEM ter LOD por zoom (sempre para
  assentamentos-chave; demais nomes e categoria em limiares crescentes,
  calibrados na implementação).
- **REQ-MREG-014** [MVP] A cena de região DEVE exibir uma **barra de escala**
  em km com degrau redondo (5/10/25/50/100...) adequado ao zoom corrente.
- **REQ-MREG-015** [MVP] O pan DEVE travar nas bordas do mapa (o recorte da
  região é a fronteira do que existe).

## 6. Requisitos não-funcionais

- **REQ-MREG-020** [MVP] Uma cena de região com ≥ 100 POIs (dos quais a maioria
  `none` para um dado jogador) DEVE manter o custo de render do lado do
  jogador proporcional ao que ele **vê** — POIs `none` não chegam ao cliente
  (REQ-DOC-058), portanto não custam.
- **REQ-MREG-021** [MVP] O Console de Revelação DEVE operar por operações
  embedded normais na Scene (REQ-DOC-026) — sem endpoint privilegiado próprio.

## 7. Critérios de aceitação

- **CA-MREG-01** Uma cena criada com o preset de região mede distâncias em km
  com a régua e não exibe grid nem fog (REQ-MREG-001/002).
- **CA-MREG-02** Um POI revelado como rumor para o jogador A aparece como "?"
  para A, completo para o GM, e não existe no payload do jogador B
  (REQ-MREG-005/009, REQ-DOC-057/058).
- **CA-MREG-03** Pelo Console, o GM revela 10 POIs de uma vez para dois
  jogadores e ambos veem os pins nascer em tempo real; a prévia "ver como"
  bate exatamente com o que o jogador vê (REQ-MREG-007/008/009).
- **CA-MREG-04** Alternar o overlay "mapa político" muda a leitura do
  território para todos os jogadores em um clique do GM (REQ-MREG-004,
  REQ-CNV-085).
- **CA-MREG-05** Zoom de 1× a 12× mantém ícones de POI no mesmo tamanho de
  tela, rótulos com LOD e a barra de escala com degraus redondos
  (REQ-MREG-013/014).

## 8. Dependências (specs irmãs)

- `02-modelo-de-dados.md` — Note com ownership (REQ-DOC-056/057/058), Overlay
  (REQ-DOC-059/060).
- `06-canvas-e-renderizacao.md` — render de Notes e overlays, régua, grid
  gridless.
- `05-usuarios-e-permissoes.md` — resolução de ownership.
- `12-journal-tabelas-cartas.md` — ficha de lugar via JournalEntry (M4; até lá,
  `Note.text`).
- `16-compendiums-e-importacao.md` — entrada de POIs em lote via pack.
- Spec 33 (reservada) — motor de campanha; consome esta spec, não a define.

## 9. Questões em aberto

1. **Escala do mundo** (km/px) é decisão de conteúdo, tomada **antes** de
   publicar os POIs de uma região — irreversível depois (registrada em
   `docs/design/mapa-isekai.md` §10.4). O motor não opina; a cena só carrega
   `gridDistance`.
2. **Tempo de jogo** (`world.time`, spec 14 [M4]): enquanto não existir, dias
   de viagem (REQ-MREG-003) são exibição de régua, não estado do mundo.
3. Limiares exatos de LOD de rótulos (REQ-MREG-013) — calibrar na
   implementação com o protótipo como referência.
