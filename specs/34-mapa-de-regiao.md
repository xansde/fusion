# 34 — Mapa de Região

- **Título:** Mapa de Região — exploração em escala de km sobre Scene, Note e overlays
- **Status:** draft v0.1
- **Data:** 2026-08-07
- **Baseada em:**
  - `docs/design/mapa-isekai.md` — modelo de escalas (§4), os três estados de visibilidade (§3.3), regras de render do protótipo (§5) e issue #78.
  - `docs/design/prototipo-minimapa-regiao.html` — protótipo funcional de referência (geografia real, 17 pinos, zoom 12×, troca de perspectiva, Console de Revelação).
  - `docs/design/prototipo-log-missoes.html` — janela Mapa da System Window: câmera de duas camadas, LOD calibrado, barra de escala e pan travado (origem dos limiares em REQ-MREG-013 e do REQ-MREG-016).
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

### DEC-MREG-08 — O mapa de região é um documento próprio, NÃO uma Scene

> **Substitui DEC-MREG-01.** A decisão original (região = Scene com preset)
> está mantida abaixo como registro do que foi tentado e por que caiu.

Uma cena é **o lugar onde a mesa está**, e existe uma só ativa por vez. Um mapa
de região é **referência que se consulta** — abre-se, olha-se, fecha-se. Modelar
os dois como a mesma coisa obriga a mesa inteira a sair do mapa de batalha para
alguém conferir onde fica a estrada, e a voltar reativando o encontro e
recompondo a câmera de todo mundo.

O mapa de região é, portanto, o documento `RegionMap` (tabela `region_maps`):
`image` + `imageWidth`/`imageHeight`, escala opcional para a barra de escala, e
`pins: MapPin[]`. Ele vive no painel **Mapa** da System Window (spec 28), nunca
no canvas da cena, e nada nele participa de ativação de cena, iniciativa,
tokens, vision, fog ou grid.

Duas consequências de forma:

- **Coordenadas de pino são normalizadas** (0..1 em cada eixo), não pixels. A
  imagem de um mapa é trocada com frequência (um render melhor, um scan maior,
  outro corte da mesma costa) e coordenadas em pixel espalhariam todos os pinos
  na primeira troca.
- **Todo o encanamento de Scene que a DEC-MREG-01 queria reaproveitar era peso
  morto** (tokens, paredes, luzes, combate) e cada um desses subsistemas
  precisaria de um caso especial "isto é uma cena de região" para sair do
  caminho.

- **Custo aceito:** um tipo de documento a mais — migration, schema, redação por
  espectador e espelho no cliente. A redação foi a parte reaproveitada: é a
  mesma função por espectador dos Notes de cena, aplicada aos quatro caminhos de
  emissão.
- **Alternativa rejeitada:** guardar o mapa como `JournalEntry` com os pinos em
  `flags`. Economizaria a tabela e devolveria um documento sem forma tipada,
  com os pinos fora de qualquer schema — exatamente o que o servidor apaga em
  silêncio na primeira escrita.

### DEC-MREG-01 — Região é uma Scene comum, diferenciada por configuração

> **SUPERADA por DEC-MREG-08 (2026-08-11).** Mantida para registro: o preset de
> cena de região não é mais o caminho, e REQ-MREG-001 foi reescrito.

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

### DEC-MREG-07 — O mapa viaja como pacote {JSON + imagem}, e a revelação não viaja junto

Uma região preparada em um mundo DEVE poder ser levada para outro mundo — outra
aventura, outro servidor, a mesa de outro GM. O transporte é um **pacote de
mapa**: um arquivo JSON com a cena e seus pins ao lado do arquivo de imagem do
terreno. O JSON referencia a imagem por **nome de arquivo**, não por caminho
absoluto nem por id de asset do mundo de origem.

O que **não** viaja: `ownership`. Todo pin importado nasce oculto
(REQ-DOC-056), exatamente como um pin recém-criado.

- **Racional (formato leve, e não pack):** um pack (`16`) é `pack.db` SQLite +
  manifesto + licença, feito para conteúdo publicado e versionado. Um mapa de
  campanha é conteúdo do GM que ele quer copiar, editar num editor de texto e
  mandar por mensagem. O custo do pack não se paga aqui — e o pacote leve não
  impede que uma região vire pack depois.
- **Racional (a revelação ficar para trás):** `ownership` é um mapa de `userId`,
  e userId não é portável entre servidores — o "tobias" de lá não é o "tobias"
  de cá. Importar o mapa de revelação ou daria visibilidade a quem não devia,
  ou (na melhor hipótese) apontaria para ninguém. Além disso, o que a comitiva
  descobriu é história daquela mesa; a mesa nova recomeça a descoberta. Custo
  aceito: um GM que rode a mesma aventura duas vezes revela de novo.

## 5. Requisitos funcionais

### 5.1 O documento de mapa

- **REQ-MREG-001** [MVP] O GM DEVE poder criar um mapa de região pelo painel
  **Mapa** do Hub, escolher sua imagem pelo seletor de arquivos comum
  (`/api/assets/upload`) e renomeá-lo — sem passar por criação de cena
  (DEC-MREG-08). Criar e apagar o mapa é privilégio de GM.
- **REQ-MREG-025** [MVP] O mapa de região DEVE ser o documento `RegionMap`, com
  `image`, `imageWidth`/`imageHeight`, escala opcional e `pins[]` em
  coordenadas normalizadas (0..1). Abrir o mapa NÃO DEVE alterar a cena ativa
  nem a câmera de ninguém.
- **REQ-MREG-026** [MVP] Qualquer jogador que enxergue o mapa DEVE poder
  colocar um pino nele. Um pino de jogador nasce **visível para a mesa** e
  registra seu autor; um pino de GM nasce **oculto** (REQ-DOC-056). A autoria
  DEVE vir da sessão autenticada, nunca do payload.
- **REQ-MREG-027** [MVP] Um jogador DEVE poder editar e remover **apenas os
  próprios** pinos; o GM, qualquer um. Nenhum caminho de cliente PODE escrever
  `ownership`, `kind` ou `authorId` de um pino — esses três campos são o estado
  de revelação.
- **REQ-MREG-028** [MVP] Um pino DEVE aceitar **comentários** assinados por
  quem os escreveu, exibidos em ordem de escrita. O append DEVE acontecer no
  servidor sobre o documento recém-lido: substituição de array faria dois
  jogadores comentando ao mesmo tempo apagarem um ao outro.
- **REQ-MREG-029** [MVP] Comentar exige nível `observer` no pino. Um pedido de
  comentário sobre pino oculto DEVE responder `NOT_FOUND` (nunca
  `PERMISSION_DENIED`), que confirmaria a existência do pino.
- **REQ-MREG-030** [MVP] O painel do Hub DEVE oferecer a alternância entre o
  mapa de região e o minimapa tático (spec 32) — as duas leituras de "onde
  estamos", num botão só da barra de comando.
- **REQ-MREG-002** [MVP] Em cena de região, a régua (REQ-CNV-060+) DEVE medir
  em km via `gridDistance`/`gridUnits`, com distância euclidiana (gridless).
- **REQ-MREG-003** [V2] A régua PODE exibir, além dos km, a conversão em
  **dias de viagem** por marchas configuráveis na cena
  (`flags.fusion.travelPaces`, ex.: a pé 30 · carroça 40 · cavalo 55 km/dia).
- **REQ-MREG-004** [MVP] A cena de região DEVE suportar overlays temáticos
  (REQ-CNV-083 a 088) sem qualquer comportamento adicional próprio.

### 5.2 POIs reveláveis

- **REQ-MREG-005** [MVP] Um POI é um `MapPin` do `RegionMap` e segue as mesmas
  regras de visibilidade de um Note (REQ-DOC-056/057): um pino de GM nasce
  `none` para todos e os três estados por usuário são os de REQ-DOC-057. Nada
  nesta spec redefine visibilidade — a redação por espectador é a do servidor,
  nos quatro caminhos de emissão.
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
  assentamentos-chave; demais nomes e categoria em limiares crescentes).
  Limiares de partida, calibrados no protótipo: **nome ≥ 1,3× · categoria e
  distância ≥ 2,2×**. A implementação PODE recalibrar, mas não remover o LOD.
- **REQ-MREG-014** [MVP] A cena de região DEVE exibir uma **barra de escala**
  em km com degrau redondo (5/10/25/50/100...) adequado ao zoom corrente.
- **REQ-MREG-015** [MVP] O pan DEVE travar nas bordas do mapa (o recorte da
  região é a fronteira do que existe).
- **REQ-MREG-016** [MVP] Traços do terreno (costa, rios, estradas, trilhas,
  fronteiras) DEVEM manter espessura constante em pixels de tela sob zoom — a
  geometria escala, o traço não. É o mesmo princípio do REQ-MREG-013 aplicado à
  linha: sem isso, aproximar transforma estrada em mancha. No protótipo é
  `vector-effect="non-scaling-stroke"`; no canvas PIXI, espessura dividida pela
  escala da câmera a cada quadro.
- **REQ-MREG-017** [MVP] O zoom por roda do mouse DEVE ancorar no cursor — o
  ponto do mundo sob o ponteiro permanece sob o ponteiro. Zoom que ancora no
  centro obriga o GM a alternar zoom e pan para chegar num POI de canto.

### 5.5 Pacote de mapa portátil

- **REQ-MREG-018** [MVP] O GM DEVE poder **exportar** uma cena de região como
  pacote de mapa: um JSON com nome, dimensões, escala (`gridDistance`/
  `gridUnits`), `flags.fusion.mapScale`, o **nome do arquivo** da imagem de
  terreno e a lista de pins (posição, ícone, rótulo, texto, flags — incluindo
  `flags.fusion.portal`).
- **REQ-MREG-019** [MVP] O pacote exportado NÃO DEVE conter `ownership` de pin
  algum, nem qualquer outro registro de quem viu o quê (DEC-MREG-07).
- **REQ-MREG-022** [MVP] O GM DEVE poder **importar** um pacote de mapa,
  escolhendo a imagem de terreno que o acompanha; a importação DEVE criar uma
  cena com o preset de região aplicado (REQ-MREG-001) e um Note por pin, todos
  nascendo ocultos (`ownership.default = none`).
- **REQ-MREG-023** [MVP] O pacote DEVE carregar um número de versão de formato;
  a importação DEVE recusar, com mensagem clara, versão que não conhece — nunca
  adivinhar campos.
- **REQ-MREG-024** [MVP] A importação DEVE preservar a identidade de origem de
  cada pin em `flags.fusion.sourceId` quando ela existir, para que reimportar o
  mesmo pacote seja reconhecível como o mesmo mapa e não uma segunda cópia.

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
- **CA-MREG-05** Zoom de 1× a 12× mantém ícones de POI e traços do terreno no
  mesmo tamanho de tela, rótulos com LOD e a barra de escala com degraus
  redondos; a roda do mouse mantém sob o cursor o ponto que estava sob ele
  (REQ-MREG-013/014/016/017).

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
