# 15 — VTTs Open-Source Existentes e Bibliotecas Reutilizáveis

> Documento de pesquisa para o projeto Fusion — VTT web proprietário com abordagem clean-room.
> Data de elaboração: 2026-06-11

---

## Índice

1. [VTTs Open-Source: panorama e lições](#1-vtts-open-source-panorama-e-lições)
   - 1.1 MapTool
   - 1.2 Owlbear Rodeo 1.x (Legacy)
   - 1.3 Owlbear Rodeo 2.x
   - 1.4 Mythic Table
   - 1.5 Tableplop
   - 1.6 Outros projetos menores
2. [Foundry VTT: referência de comportamento (clean-room)](#2-foundry-vtt-referência-de-comportamento-clean-room)
3. [Bibliotecas Candidatas — Renderização 2D](#3-bibliotecas-candidatas--renderização-2d)
4. [Sincronização em Tempo Real](#4-sincronização-em-tempo-real)
5. [Parsing e Rolagem de Dados](#5-parsing-e-rolagem-de-dados)
6. [Visibilidade, Sombras e Fog of War](#6-visibilidade-sombras-e-fog-of-war)
7. [Grids Hexagonais e Pathfinding](#7-grids-hexagonais-e-pathfinding)
8. [Dados 3D no Browser](#8-dados-3d-no-browser)
9. [Editores de Rich Text](#9-editores-de-rich-text)
10. [Empacotamento Desktop](#10-empacotamento-desktop)
11. [Persistência de Dados no Servidor Local](#11-persistência-de-dados-no-servidor-local)
12. [Framework Frontend para UI de VTT](#12-framework-frontend-para-ui-de-vtt)
13. [Servidor HTTP e Framework Node.js](#13-servidor-http-e-framework-nodejs)
14. [Áudio](#14-áudio)
15. [Dados PF2e Open-Source (OGL/ORC)](#15-dados-pf2e-open-source-oglorc)
16. [Tabela de Decisão: Stack Recomendada](#16-tabela-de-decisão-stack-recomendada)
17. [Fontes](#17-fontes)

---

## 1. VTTs Open-Source: panorama e lições

### 1.1 MapTool

**Repositório:** https://github.com/RPTools/maptool  
**Licença:** AGPL-3.0  
**Versão atual:** 1.18.6 (outubro 2025)  
**Linguagem:** Java 99.4% — a maior parte do codebase é Java; UI em JavaFX

**Arquitetura:**
- Aplicação desktop, não browser-native. Requer JRE embutido no instalador.
- Modelo servidor integrado: o host GM executa um servidor embutido ao qual players conectam via LAN/internet.
- Sistema de scripting proprietário (MTScript) para automação de regras.
- Suporte a Dynamic Lighting, Vision, Fog of War — tudo implementado em Java 2D/Swing/JavaFX.

**Lições para o Fusion:**
- MapTool prova que é possível construir um VTT completo (iluminação dinâmica, visão, fog of war) sem plataforma externa.
- A escolha de Java impõe friction para contribuidores web-first e bundle pesado; para Fusion, Node.js + browser é o caminho superior.
- AGPL-3.0 implica que qualquer fork distribuído deve liberar o source — não reutilizável comercialmente sem compliance total.
- A abordagem "servidor embutido na aplicação" é exatamente o modelo que Fusion adota (GM roda o servidor, players conectam pelo browser).

**O que NÃO reutilizar:** código Java, sistema de scripting proprietário.  
**O que estudar:** comportamento do Vision/LOS, fog of war incremental, protocolo de rede cliente-servidor.

---

### 1.2 Owlbear Rodeo 1.x (Legacy)

**Repositório:** https://github.com/owlbear-rodeo/owlbear-rodeo-legacy  
**Licença:** Non-profit, non-commercial, private use only (não é OSI-aprovada).  
**Linguagem:** TypeScript (99.3%)

**Arquitetura:**
- Frontend: React com TypeScript. Gerenciamento de estado via React Contexts — os próprios devs admitem que foi uma má decisão ("React contexts is a bad idea").
- Sync em tempo real: WebRTC peer-to-peer para transferência de imagens customizadas. Os devs igualmente lamentaram a escolha: "every time I've decided to use WebRTC in a project I've regretted it".
- Persistência: IndexedDB client-side para imagens; sem backend cloud em 1.0.
- Detecção de grid: modelo TensorFlow customizado treinado em battle maps.
- Dados 3D: physics-driven 3D dice roller embutido.
- Interpolação de rede para sincronização do ponteiro.
- **Sem resolução de conflitos** para edições simultâneas.

**Lições para o Fusion:**
- WebRTC peer-to-peer traz problemas de NAT traversal e confiabilidade; preferir WebSocket com servidor autoritativo.
- React Contexts para estado de canvas é problemático; usar Svelte stores ou Zustand é mais performático.
- IndexedDB é adequado para cache de assets no cliente; a fonte da verdade deve ficar no servidor (SQLite local do GM).
- A detecção automática de grid por ML é um diferencial de UX — candidata a feature futura do Fusion.

**O que NÃO reutilizar:** o código (licença proíbe uso comercial).  
**O que estudar:** estrutura de cenas, tokens, overlays e ferramentas de desenho.

---

### 1.3 Owlbear Rodeo 2.x

**Status:** Proprietário — código não público.  
**Arquitetura conhecida (via dev logs):**
- Backend serverless em AWS; cada sala (game) roda em servidor isolado (sandbox model).
- Players roteados via load balancer + proxy para o servidor de sua sala.
- Estado da sala mantido em banco de dados centralizado (AWS-managed).
- Latência de criação de sala: 10–15 segundos para provisionar o servidor de jogo.

**Lições para o Fusion:**
- Para Fusion (servidor local do GM), o modelo serverless AWS não é aplicável, mas o conceito de isolamento por sala/mundo é útil.
- A transição 1.0 → 2.0 foi motivada pelos problemas de WebRTC e React Contexts — confirmando as lições acima.

---

### 1.4 Mythic Table

**Repositório:** https://gitlab.com/mythicteam/mythictable  
**Licença:** Open-source (verificar licença específica no GitLab)  
**Stack:**
- Frontend: Vue.js
- Backend: .NET/C#
- Banco de dados: MongoDB + Redis
- Real-time: Redis SignalR Backplane para escalar WebSocket connections entre múltiplos servidores web
- Dados: JSON human-readable para objetos

**Arquitetura:**
- Stack orientado a cloud com Docker support.
- Redis SignalR Backplane é uma solução de scaling horizontal — complexa para o caso de uso local-first do Fusion.
- Dados em JSON são facilmente inspecionáveis e versionáveis.

**Lições para o Fusion:**
- JSON como formato de dados para documentos de jogo é uma boa prática (facilita debug e migração).
- A stack .NET + MongoDB + Redis é mais complexa do que necessário para um servidor local single-GM; SQLite + Node.js é mais adequado.
- O Vue.js frontend mostra que qualquer framework moderno pode servir — escolha deve ser por performance e ergonomia.

---

### 1.5 Tableplop

**Status:** Produto SaaS com templates disponíveis como open-source na comunidade.  
**Tecnologia core:** não documentada publicamente de forma detalhada.  
**Diferencial:** sistema de character sheets configurável por JSON templates — abordagem que Fusion pode adotar para sistemas customizáveis (PF2e, SF2e, Etmos).

---

### 1.6 Outros Projetos Menores

| Projeto | Tech | Licença | Nota |
|---|---|---|---|
| **virtualtabletop** (ArnoldSmith86) | JavaScript vanilla | MIT | Board/card games; não RPG |
| **libre-vtt** (archevel) | Não especificada | - | Em estado inicial |
| **Open-VTT** (Khazlor) | Godot Engine | - | Desktop-only; não browser |
| **skyloutyr/VTT** | C# .NET | - | 3D/2D self-hosted; .NET |

Nenhum desses projetos representa uma base de código reutilizável para Fusion por questões de licença, stack incompatível ou imaturidade.

---

## 2. Foundry VTT: referência de comportamento (clean-room)

> **AVISO CLEAN-ROOM:** O Foundry VTT é software proprietário. Esta seção descreve comportamentos, conceitos e estruturas arquiteturais observáveis publicamente (Knowledge Base, API docs, artigos técnicos). Nenhum código proprietário é reproduzido.

### 2.1 Arquitetura Geral

- **Servidor:** Node.js (modo headless) ou Electron (modo desktop com wrapper). Porta default: 30000.
- **Renderização:** PixiJS para canvas WebGL do mapa; Handlebars para UI HTML.
- **Comunicação:** socket.io v4 para WebSocket entre servidor e clientes.
- **Persistência:** LevelDB (migrou de NeDB na versão 11) — banco key-value binário, eficiente por documento.

### 2.2 Modelo de Dados (Document Model)

Tudo que é persistido é um **Document**. Hierarquia:

- **Primary Documents** (mantidos em banco próprio, acessíveis globalmente):
  - `Actor` — personagem, NPC, criatura
  - `Item` — equipamento, magia, habilidade
  - `Scene` — mapa com tokens, iluminação, paredes
  - `JournalEntry` — notas e rich text
  - `RollTable` — tabelas de resultado aleatório
  - `Playlist` — áudio ambiente
  - `Macro`, `ChatMessage`, `Folder`, `User`, etc.

- **Embedded Documents** (vivem dentro de um parent document):
  - `Token` dentro de `Scene`
  - `Item` dentro de `Actor`
  - `Tile`, `Wall`, `AmbientLight`, `AmbientSound` dentro de `Scene`

Cada documento tem:
- Schema tipado (DataModel) com validação automática
- CRUD via API com propagação automática via WebSocket para todos os clientes
- Sistema de `Hooks` (event bus global) para interceptação

### 2.3 Canvas e Camadas (Layer Stack)

O canvas usa PixiJS com camadas ordenadas de baixo para cima:

| # | Camada | Propósito |
|---|---|---|
| 1 | Background Image | Imagem de fundo da cena |
| 2 | Standard Tiles | Tiles sob os tokens |
| 3 | Token Actors | Personagens e NPCs |
| 4 | Overhead Tiles | Elementos acima dos tokens (telhados, copas) |
| 5 | Foreground Image | Overlay de cena inteiro |
| 6 | Weather | Efeitos ambientais (chuva, neve) |
| 7 | Effects/Lighting | Visão e iluminação |
| 8 | Template Layer | Áreas de magia e habilidades |
| 9 | Sound Layer (GM) | Emissores de som ambiente |
| 10 | Walls Layer (GM) | Paredes para visão/luz/som |

**Implication para Fusion:** reproduzir esta hierarquia de camadas com PixiJS é viável e deve ser o modelo de referência para o canvas do Fusion.

### 2.4 Sistema de Plugins (Packages)

Três tipos de pacote:
- **Game System** — define schema de dados e regras para um RPG específico
- **Module** — plugin independente que estende funcionalidade
- **World** — instância de campanha com dados criados pelo usuário

**Implication para Fusion:** Fusion deve ter uma API de sistemas semelhante — um "sistema" define schemas de Actor/Item, fórmulas de dados e componentes de ficha. PF2e, SF2e e Etmos seriam sistemas separados.

### 2.5 Sincronização via socket.io

- Cada Document update emite um evento socket com o delta de mudança
- O servidor é autoritativo: valida e persiste antes de broadcast
- Módulos podem registrar handlers customizados via `game.socket.on()`/`game.socket.emit()`
- Dados grandes (imagens) são servidos via HTTP estático, não pelo socket

---

## 3. Bibliotecas Candidatas — Renderização 2D

### 3.1 PixiJS v8 (RECOMENDADO)

**NPM:** `pixi.js` — https://pixijs.com  
**Licença:** MIT  
**Status:** v8.16.0 (2025); desenvolvimento ativo

**Arquitetura v8:**
- Dois renderers: WebGPU (primário, futuro) + WebGL (fallback automático)
- Renderer Canvas experimental (v8.16.0) para ambientes sem GPU
- **Render Groups:** containers podem usar GPU para transformações, habilitando câmera 2D hardware-accelerated — fundamental para pan/zoom em mapas grandes
- Scene graph com propriedades herdáveis (blend mode, tint cascadeiam para filhos)
- **GraphicsPath:** shapes compartilháveis e reutilizáveis
- **Render Layers (v8.7.0):** controle de ordem de renderização independente da hierarquia do scene graph
- ParticleContainer: suporta 100K+ sprites sem degradação

**Performance (benchmarks oficiais vs v7):**
- Sprites estáticos: CPU +17.417%, GPU +1.700%
- Sprites em movimento: CPU +233%, GPU +350%

**Bundle:** ~200KB minificado

**Prós para Fusion:**
- Usado pelo próprio Foundry VTT — prova de adequação ao domínio
- WebGPU-ready sem reescrita de código
- MIT — sem restrições comerciais
- Render Groups = câmera 2D eficiente para mapas grandes
- Ecossistema maduro, boa documentação

**Contras:**
- Não é um game framework — colisão, pathfinding, etc. devem ser implementados separadamente
- WebGPU ainda não é universal (~27% de suporte de mercado em 2025, mas crescendo)

### 3.2 Phaser (alternativa)

**Bundle:** ~500KB  
**Modelo:** game framework completo (câmera, tilemaps, física, tweens)  
**Avaliação para VTT:** excessivo — um VTT precisa de renderização flexível, não de um game engine de arcade. A câmera e tilemaps do Phaser podem conflitar com as necessidades de layers customizadas do VTT. **Não recomendado.**

### 3.3 Three.js (alternativa)

**Modelo:** renderização 3D primariamente, suporte a 2D  
**Avaliação:** overhead para 2D isométrico/top-down. Adequado apenas se Fusion precisar de perspectiva 3D no mapa. **Não recomendado** para a camada principal.

### 3.4 Canvas Puro

**Avaliação:** performance inferior ao WebGL para cenas complexas (iluminação dinâmica com muitos polígonos). Adequado para prototipagem mas inviável para produção com fog of war e visão dinâmica. **Não recomendado** como solução final.

---

## 4. Sincronização em Tempo Real

### 4.1 socket.io (RECOMENDADO como base)

**NPM:** `socket.io` (servidor) + `socket.io-client` (cliente)  
**Licença:** MIT  
**Status:** v4.x; ativo

**Modelo:** cliente-servidor autoritativo com WebSocket (fallback HTTP long-polling)  
**Usado por:** Foundry VTT, muitos jogos web  

**Prós:**
- Fallback automático para ambientes com proxy que bloqueiam WebSocket
- Rooms e namespaces para isolamento de sessões (mundos diferentes)
- Broadcast para todos os clientes ou para subsets
- Mature e battle-tested para o caso de uso de VTT local

**Contras:**
- Não resolve conflitos automaticamente — o servidor deve ser autoritativo e aplicar delta manualmente
- Overhead de protocolo vs. WebSocket nativo (mas irrelevante para LAN)

### 4.2 Colyseus (alternativa para servidores de jogo)

**NPM:** `colyseus` + `@colyseus/schema`  
**Licença:** MIT  
**Modelo:** framework autoritativo para jogos multiplayer — sincronização de estado via delta-encoding binário (@colyseus/schema)  

**Prós:**
- Schema com delta encoding binário — eficiente para estado de jogo que muda frequentemente
- Room-based architecture com matchmaking e reconnect out-of-the-box
- Suporta múltiplas linguagens (C#, Lua, Haxe) se Fusion evoluir para clientes nativos

**Contras:**
- A estrutura de Room do Colyseus assume fluxos de jogo em tempo real (FPS, estratégia em tempo real) — para VTT onde a maioria das mudanças é assíncrona e document-oriented, pode ser over-engineering
- Curva de aprendizado adicional

**Recomendação:** socket.io é mais adequado para o modelo document-oriented do VTT. Colyseus brilha em jogos com estado altamente dinâmico (posição de 100 entidades por segundo). Para um VTT, as atualizações são esparsas e semânticas (mover token, atualizar HP).

### 4.3 Yjs / Automerge (CRDT)

**Modelo:** CRDT — sem servidor autoritativo, conflitos resolvidos automaticamente  

**Prós:**
- Edição colaborativa de texto sem conflito (ideal para JournalEntries)
- Funciona offline + sync posterior

**Contras:**
- Para estado de jogo (posição de token, HP), CRDTs geram overhead desnecessário — um VTT precisa de servidor autoritativo para evitar "teleporte" de tokens contraditório
- Yjs + Tiptap é a combinação certa apenas para o subsistema de **editores de texto colaborativo** dentro do Fusion

**Recomendação:** usar Yjs/Tiptap apenas para o editor de JournalEntries colaborativo; para estado do canvas usar socket.io com servidor autoritativo.

---

## 5. Parsing e Rolagem de Dados

### 5.1 @dice-roller/rpg-dice-roller (RECOMENDADO)

**NPM:** `@dice-roller/rpg-dice-roller`  
**Licença:** MIT  
**Versão:** 5.5.1  
**Status:** ativo (último release há ~1 ano em 2025)

**Notações suportadas:**
- Standard: `2d6`, `d20+5`
- Exploding dice: `4d6!` (explodem no máximo)
- Reroll: `4d6r<2` (rerola resultados menores que 2)
- Drop/Keep: `4d6dl1` (dropa o menor — usado em D&D/PF2e para ability scores)
- Compound: `4d6!!` (exploding compounded)
- Penetrating: `4d6!p`
- Fate/Fudge dice: `4dF`
- Math expressions: `floor((2d6+3)/2)`

**Relevância para PF2e/SF2e:** as notações de reroll, exploding e expressões matemáticas cobrem os casos de uso dos sistemas Pathfinder.

**Ecossistema relacionado:**
- `@3d-dice/dice-box` — integração 3D (ver seção 8)
- `@dice-roller/rpg-dice-roller` exporta AST do resultado, permitindo custom renderers

### 5.2 Alternativas

| Biblioteca | Notas |
|---|---|
| `rpgdice` (Morgul) | Mais simples, menos notações suportadas |
| `rpgdicejs` | Desatualizada |
| Implementação própria | Necessária apenas para notações muito específicas do Etmos |

---

## 6. Visibilidade, Sombras e Fog of War

### 6.1 Conceito: Visibility Polygon

O algoritmo de visibilidade 2D funciona lançando raios para as extremidades de cada segmento de parede, mais dois raios offset de ±0.00001 rad, ordenando os pontos de interseção por ângulo e conectando-os para formar o polígono de visão.

Referência canônica: [Red Blob Games — 2D Visibility](https://www.redblobgames.com/articles/visibility/) e o tutorial interativo de Nicky Case em https://ncase.me/sight-and-light/.

### 6.2 visibility-polygon-js

**Status:** arquivada/legada — foi usada no jogo "Nothing to Hide"  
**Algoritmo:** O(n log n)  
**Recomendação:** não usar diretamente (desatualizada); usar como referência de implementação ou adotar solução mais moderna

### 6.3 Clipper2 — Operações de Polígonos

Para fog of war que "revela" áreas progressivamente, são necessárias operações booleanas em polígonos (union, difference, intersection).

**Opções em JS/npm:**

| Pacote | Notas |
|---|---|
| `@countertype/clipper2-ts` | TypeScript port do Clipper2; 1.5.4; ativo (5 meses); 258 testes |
| `clipper2-wasm` | WebAssembly do Clipper2; v0.2.1 |
| `js-angusj-clipper` | Clipper v1 em WASM; fallback para Asm.js |

**Recomendação:** `@countertype/clipper2-ts` para operações de polígono em fog of war explorado (union progressivo de áreas vistas). Para performance crítica, `clipper2-wasm`.

### 6.4 Estratégia recomendada para Fusion

1. **Paredes** como segmentos (linhas) armazenados no servidor
2. **Visibility polygon** calculado no servidor ou no cliente a cada movimento de token
3. **Fog of war "nunca visto"** (opaco total) vs. **"já visto mas fora de visão"** (semi-transparente): duas texturas no PixiJS com alpha diferente
4. **PixiJS RenderTexture** para "pintar" o fog de forma persistente
5. **Clipper2** para union das áreas reveladas ao longo do tempo

---

## 7. Grids Hexagonais e Pathfinding

### 7.1 honeycomb-grid (RECOMENDADO)

**NPM:** `honeycomb-grid`  
**Versão:** 4.1.5 (última atualização ~3 anos atrás; estável)  
**Licença:** MIT  
**Linguagem:** TypeScript

**Funcionalidades:**
- Hexágonos pointy-top e flat-top
- Quatro shapes: rectangle, triangle, hexagon, parallelogram
- Coordenadas cúbicas, offset e axial
- Framework-agnostic (não renderiza — apenas math e grid)
- Funciona em Node.js ≥ 16 e browsers modernos

**Limitações:** não inclui pathfinding nativo — integrar com A* customizado ou `pathfinding` npm.

### 7.2 Pathfinding

**PathFinding.js** (qiao) é a biblioteca mais conhecida para grids 2D, mas voltada a grids quadrados. Para hexagonais, recomenda-se implementar A* customizado usando o sistema de coordenadas do honeycomb-grid (distância cúbica como heurística).

**Alternativa para grids quadrados:** `@cetfox24/pathfinding-js` — A* com diagonal, path smoothing, busca bidirecional.

**Nota para Fusion:** PF2e usa grid quadrado 5ft; SF2e e alguns sistemas usam hexagonal. Fusion precisa suportar ambos. Implementar uma camada de abstração de grid que possa ser quadrado, hexagonal ou sem grid (gridless).

---

## 8. Dados 3D no Browser

### 8.1 @3d-dice/dice-box (RECOMENDADO)

**NPM:** `@3d-dice/dice-box`  
**Tecnologia:** BabylonJS + AmmoJS (física), Web Workers + OffscreenCanvas  
**Bundle:** <1 MB comprimido  
**Licença:** MIT  

**Funcionalidades:**
- Alta performance via web workers — a física roda em thread separada, sem bloquear UI
- OffscreenCanvas — renderização GPU independente do thread principal
- Suporte a notação avançada: `4d6dl1`, `4d6!r<2`
- Integrável com `@dice-roller/rpg-dice-roller` via módulo `@3d-dice/dice-parser-interface`
- Ecosistema: `@3d-dice/dice-box-threejs` (Three.js backend), `@3d-dice/fdp` (fantasy dice parser)

**Alternativa:** `@3d-dice/dice-box-threejs` — mesma interface, Three.js como renderer. Útil se Fusion já usar Three.js em outra parte.

---

## 9. Editores de Rich Text

### 9.1 TipTap (RECOMENDADO)

**NPM:** `@tiptap/core`  
**Base:** construído sobre ProseMirror  
**Licença:** MIT (core); extensões Pro são pagas  
**Downloads:** 1.8M/mês no npm (2025)

**Prós:**
- Abstrai a API complexa do ProseMirror em interface amigável
- Headless — sem CSS opinativo, fácil estilização customizada para o tema de VTT
- Tree-shakable packages — só importar o que usar
- Colaboração via Yjs built-in (extensão `@tiptap/extension-collaboration`)
- TypeScript first
- Suporta Svelte, Vue, React e vanilla

**Contras:**
- Extensões avançadas (Comments, Track Changes) são pagas (TipTap Pro)
- Para VTT, o nível free é suficiente

### 9.2 ProseMirror (alternativa de baixo nível)

**Prós:** máximo controle, usado por Asana e NYT  
**Contras:** curva de aprendizado steep; TipTap já é uma wrapper de alta qualidade sobre ele  
**Recomendação:** usar TipTap em vez do ProseMirror diretamente, exceto se precisar de comportamento muito customizado

---

## 10. Empacotamento Desktop

### 10.1 Tauri v2 (RECOMENDADO)

**Tecnologia:** Rust core + WebView do sistema operacional  
**Versão:** 2.x (lançado final de 2024); +35% de adoção em 2025  

**Métricas de comparação com Electron:**

| Métrica | Tauri | Electron |
|---|---|---|
| Bundle size | ~5–10 MB | ~100–165 MB |
| RAM idle | 30–40 MB | 200–300 MB |
| Startup | <0.5s | 1–2s |
| Segurança | Rust bridge com permissões explícitas | Node.js com acesso total |
| WebGPU | Via WebView do SO | Via Chromium bundled |

**Funcionamento com Fusion:**
- Tauri v2 não suporta SSR — frontend deve ser SPA (Svelte/Vite static build)
- Rust backend pode expor APIs de filesystem e rede local ao frontend via comandos seguros
- O servidor Node.js do GM pode rodar como processo filho dentro do binário Tauri (via `tauri-plugin-shell`)
- **Atenção:** o VTT precisa de um servidor HTTP/WebSocket para que players conectem pelo browser — isso é uma restricão importante. O servidor Node.js deve rodar *separadamente* do processo Tauri, ou Tauri deve expor uma porta ao localhost.

### 10.2 Electron (alternativa)

**Prós:** ecossistema maduro (VS Code, Slack, Discord); Node.js built-in facilita servir HTTP/WS diretamente  
**Contras:** bundle enorme, RAM pesada, sem Rust para operações críticas  

**Recomendação para Fusion:** dado que Fusion é primariamente um servidor web (players acessam pelo browser), a necessidade de empacotamento desktop para o GM é secundária. A prioridade inicial deve ser um executável Node.js CLI (`node server.js`) ou NPM script. O wrapper Tauri pode ser adicionado depois para melhorar a UX do GM (ícone na bandeja, iniciar/parar servidor com clique).

---

## 11. Persistência de Dados no Servidor Local

### 11.1 better-sqlite3 (RECOMENDADO)

**NPM:** `better-sqlite3`  
**Licença:** MIT  
**Modelo:** SQLite com API síncrona (não-async) — paradoxalmente mais rápida por evitar overhead de event loop para queries locais

**Métricas:**
- Upward of 2.000 queries/segundo em joins 5-way em banco de 60 GB
- WAL mode para acesso concorrente (leitura simultânea enquanto escreve)
- ACID transactions completas

**Vantagens para Fusion (servidor local do GM):**
- Banco de dados = um arquivo `.db` por mundo — fácil backup e portabilidade
- Sem servidor externo (MongoDB, PostgreSQL) — zero configuração para o GM
- Queries síncronas simplificam o código do servidor VTT
- SQLite é embedded no processo Node.js — sem dependência externa
- Node.js v22+ tem SQLite nativo (`node:sqlite`) como alternativa sem dependências

**Schema sugerido:**
```
worlds/
  {slug}/
    world.db     — actors, items, scenes, journals (tabelas por tipo de Document)
    assets/      — imagens, áudio (servidos como static files)
```

### 11.2 LevelDB / ClassicLevel (alternativa)

**Usado por:** Foundry VTT (desde v11)  
**Modelo:** key-value store binário; cada Document é uma entrada separada  
**Vantagem:** update de um Document não reescreve o banco inteiro (relevante para mundos gigantes)  
**Desvantagem:** não é queryable com SQL; requer índices manuais para queries complexas  

**Recomendação:** SQLite com better-sqlite3 é mais ergonômico para Fusion, dado que é relacional e permite queries. Para escala extrema (10.000+ actors), considerar migração para LevelDB no futuro.

---

## 12. Framework Frontend para UI de VTT

### 12.1 Svelte 5 (RECOMENDADO)

**Métricas vs React:**
- Bundle: 3 KB (Svelte runtime) vs 45 KB (React runtime)
- First contentful paint: 800ms vs 1.200ms
- Abordagem compilada — zero runtime overhead de virtual DOM

**Por que Svelte para VTT:**
- UI de VTT é altamente reativa (tokens movem, HP atualiza, chat rola) mas não é uma SPA convencional — Svelte's fine-grained reactivity é superior
- Svelte Stores são ideais para estado do canvas (token positions, lighting state)
- SvelteKit com `@sveltejs/adapter-static` é compatível com Tauri v2
- Svelte 5 (Runes API) melhorou ainda mais a reatividade granular

**Integração com PixiJS:**
- PixiJS ocupa um `<canvas>` dedicado; Svelte gerencia a UI overlay (HUD, chat, sidebar)
- Não há conflito — PixiJS e Svelte coexistem sem problema

### 12.2 React (alternativa)

**Prós:** maior ecossistema, mais devs disponíveis  
**Contras:** bundle maior, React Contexts péssimos para estado de canvas (Owlbear 1.0 prova isso), JSX pode conflitar com a mentalidade de componentes do Svelte  

### 12.3 Vue 3 (alternativa)

**Prós:** Composition API similar ao Svelte, boa ergonomia  
**Contras:** runtime mais pesado que Svelte, menos ganho de performance compilado  

---

## 13. Servidor HTTP e Framework Node.js

### 13.1 Fastify (RECOMENDADO)

**Métricas:** 30.000–40.000 req/s vs 15.000 do Express  
**Licença:** MIT  
**Prós:**
- Validação de schema built-in (JSON Schema/Zod) — útil para validar Document updates
- Serialização pré-compilada de respostas JSON
- Plugin system similar ao Foundry VTT (registros com decorators)
- TypeScript first com boa inferência

**Para Fusion:** Fastify gerencia as rotas HTTP (login, static assets, API REST) enquanto socket.io é montado no mesmo server instance.

### 13.2 Hono (alternativa emergente)

**Prós:** ultra-leve, edge-ready, cross-runtime (Node/Deno/Bun/Cloudflare Workers)  
**Contras:** ecossistema menor; para servidor local Node.js, a portabilidade edge é irrelevante  

### 13.3 Express (legacy)

**Nota:** ainda funciona, mas Fastify supera em performance e DX sem custo de migração.

---

## 14. Áudio

### 14.1 Howler.js (RECOMENDADO)

**NPM:** `howler`  
**Licença:** MIT  
**Status:** maduro e estável

**Funcionalidades:**
- Padrão Web Audio API com fallback HTML5 Audio
- Audio sprites para múltiplos samples em um arquivo
- Loop, fade, seek, rate, spatial audio
- Cross-browser (IE11+, mobile Safari)

**Uso em Foundry VTT:** Foundry refatorou seu sistema de áudio para usar a Web Audio API nativa em v8; Howler.js abstrai exatamente esse comportamento.

**Para Fusion:** Howler.js para playlists de ambiente, efeitos sonoros de dados, e áudio posicional (sons vinculados a tokens no mapa).

---

## 15. Dados PF2e Open-Source (OGL/ORC)

### 15.1 Repositório foundryvtt/pf2e

**URL:** https://github.com/foundryvtt/pf2e  
**Licença do código:** Apache License v2.0  
**Licença das mecânicas:** OGL v1.0a (Open Game License)  
**Status:** mantido pela comunidade; sistema oficial PF2e para Foundry

**Estrutura de dados:**
- Compendiums em `/packs/` — dados em formato JSON (intermediário human-readable) compilados para LevelDB na build
- Cada Actor/Item é um objeto JSON com campo `type` (discriminante) e `system` (dados específicos do sistema)
- CLI oficial `foundryvtt-cli` permite extrair (`extractPacks`) e reempacotar (`packPacks`) os compendiums

**O que Fusion pode usar:**
- Os JSONs dos compendiums são dados abertos sob OGL — podem ser importados para a base SQLite do Fusion
- A estrutura de um `Actor` de PF2e é: `{ _id, name, type: "character"|"npc"|..., system: { attributes, skills, saves, ... }}`
- O schema TypeScript completo está disponível no código-fonte (Apache 2.0) como referência

**Atenção clean-room:** o código TypeScript do sistema (regras, automatizações) é Apache 2.0 e **pode ser referenciado**, mas Fusion deve implementar suas próprias regras e não simplesmente copiar a lógica de regras sem adaptar.

### 15.2 Sistema sf2e

O arquivo `system.sf2e.json` no mesmo repositório indica que Starfinder 2e também está sendo desenvolvido no mesmo codebase, com os mesmos padrões de dados.

---

## 16. Tabela de Decisão: Stack Recomendada

| Camada | Escolha Recomendada | Alternativa | Motivo |
|---|---|---|---|
| Renderização 2D | PixiJS v8 | — | Usado pelo Foundry; WebGPU-ready; MIT; Render Groups para câmera |
| Sincronização real-time | socket.io v4 | Colyseus | Document-oriented; modelo autoritativo simples |
| Edição colaborativa de texto | Yjs + TipTap | ProseMirror | CRDT para journals; TipTap abstrai ProseMirror |
| Parsing de dados | @dice-roller/rpg-dice-roller | Implementação própria (Etmos) | MIT; notações avançadas; AST exportável |
| Dados 3D | @3d-dice/dice-box | dice-box-threejs | BabylonJS+AmmoJS; web workers; <1MB |
| Visibilidade/LOS | Implementação própria + clipper2-ts | visibility-polygon-js (referência) | Algoritmo simples; clipper2 para fog union |
| Grid hexagonal | honeycomb-grid | Implementação própria | TypeScript; MIT; estável |
| Pathfinding | A* customizado com honeycomb | pathfinding.js | Hex nativo requer coordenadas cúbicas |
| Rich text | TipTap | ProseMirror direto | Headless; MIT; colaborativo via Yjs |
| Desktop wrapper | Tauri v2 (fase 2) | Electron | 10x menor; mais rápido; Rust bridge segura |
| Persistência | better-sqlite3 | node:sqlite (Node 22+) | Arquivo único; ACID; síncrono; zero config |
| Frontend UI | Svelte 5 | Vue 3 | Menor bundle; Svelte Stores para estado canvas |
| Servidor HTTP | Fastify | Express | 2x mais rápido; schema validation built-in |
| Áudio | Howler.js | Web Audio API raw | Cross-browser; audio sprites; fade/spatial |

---

## 17. Fontes

- [MapTool — RPTools/maptool (GitHub)](https://github.com/RPTools/maptool)
- [Owlbear Rodeo Legacy (GitHub)](https://github.com/owlbear-rodeo/owlbear-rodeo-legacy)
- [Owlbear Rodeo Legacy Edition — blog](https://blog.owlbear.rodeo/owlbear-rodeo-legacy-edition/)
- [Owlbear Rodeo 2.0 Dev Log 4](https://blog.owlbear.rodeo/owlbear-rodeo-2-0-dev-log-4/)
- [Mythic Table — GitLab](https://gitlab.com/mythicteam/mythictable)
- [Foundry VTT — Overview (DeepWiki)](https://deepwiki.com/foundryvtt/foundryvtt/1-overview)
- [Foundry VTT — Canvas Layers (KB oficial)](https://foundryvtt.com/article/canvas-layers/)
- [Foundry VTT — Data Model (Community Wiki)](https://foundryvtt.wiki/en/development/api/DataModel)
- [Foundry VTT — System Data Models (KB oficial)](https://foundryvtt.com/article/system-data-models/)
- [Foundry VTT — Version 10 DataModel Changes](https://foundryvtt.com/article/v10-data-model/)
- [Foundry VTT — v11 LevelDB Packs](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Foundry VTT — Sockets (Community Wiki)](https://foundryvtt.wiki/en/development/api/sockets)
- [foundryvtt/pf2e (GitHub)](https://github.com/foundryvtt/pf2e)
- [PixiJS v8 Launch Blog](https://pixijs.com/blog/pixi-v8-launches)
- [PixiJS v8.16.0 Update](https://pixijs.com/blog/8.16.0)
- [PixiJS — Renderers Guide](https://pixijs.com/8.x/guides/components/renderers)
- [Phaser vs PixiJS comparison — generalistprogrammer.com](https://generalistprogrammer.com/tutorials/phaser-vs-pixijs-renderer-comparison)
- [Web Game Engines Comparison 2026 — cinevva.com](https://app.cinevva.com/guides/web-game-engines-comparison.html)
- [socket.io — Beyond CRDTs (DEV Community)](https://dev.to/endel/full-stack-state-sync-with-socketio-beyond-crdts-54mg)
- [Colyseus — Docs](https://docs.colyseus.io/)
- [Colyseus/schema (GitHub)](https://github.com/colyseus/schema)
- [Yjs (GitHub)](https://github.com/yjs/yjs)
- [Best CRDT Libraries 2025 — Velt](https://velt.dev/blog/best-crdt-libraries-real-time-data-sync)
- [@dice-roller/rpg-dice-roller (GitHub)](https://github.com/dice-roller/rpg-dice-roller)
- [@3d-dice/dice-box (GitHub)](https://github.com/3d-dice/dice-box)
- [Fantastic Dice Docs](https://fantasticdice.games/docs/0.6/intro)
- [Red Blob Games — 2D Visibility](https://www.redblobgames.com/articles/visibility/)
- [Sight and Light — Nicky Case](https://ncase.me/sight-and-light/)
- [@countertype/clipper2-ts (GitHub)](https://github.com/countertype/clipper2-ts)
- [Clipper2 — AngusJohnson (GitHub)](https://github.com/AngusJohnson/Clipper2)
- [honeycomb-grid (npm)](https://www.npmjs.com/package/honeycomb-grid)
- [Red Blob Games — Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/)
- [PathFinding.js (GitHub)](https://github.com/qiao/PathFinding.js/)
- [TipTap (GitHub)](https://github.com/ueberdosis/tiptap)
- [Which rich text editor to choose 2025 — Liveblocks](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025)
- [Tauri vs Electron 2026 — tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/)
- [Tauri vs Electron — DoltHub Blog (2025)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [better-sqlite3 (GitHub)](https://github.com/WiseLibs/better-sqlite3)
- [SQLite in Node.js — Node.js v26 Docs](https://nodejs.org/api/sqlite.html)
- [Svelte 5 vs React 19 vs Vue 4 — usama.codes](https://usama.codes/blog/svelte-5-vs-react-19-vs-vue-4-comparison)
- [Fastify vs Express vs Hono — BetterStack](https://betterstack.com/community/guides/scaling-nodejs/fastify-vs-express-vs-hono/)
- [howler.js (GitHub)](https://github.com/goldfire/howler.js/)
- [Tauri + SvelteKit — Tauri Docs](https://v2.tauri.app/start/frontend/sveltekit/)
