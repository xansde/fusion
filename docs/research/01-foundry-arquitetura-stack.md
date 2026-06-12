# Foundry VTT — Arquitetura Geral e Stack Tecnológica

> Documento de pesquisa para o projeto Fusion (VTT clean-room).
> Elaborado em junho de 2026. Termos técnicos mantidos em inglês.

---

## 1. Visão Geral do Produto

Foundry Virtual Tabletop (Foundry VTT) é uma plataforma self-hosted de mesa virtual desenvolvida pela Foundry Gaming LLC. A versão estável atual, em junho de 2026, é a **v14, build 14.364** (lançamento estável inicial do v14 em 1° de abril de 2026).

O modelo de negócio é licença perpétua paga uma única vez. O GM (Game Master) hospeda o servidor em sua própria máquina ou em um servidor de nuvem, e os jogadores conectam pelo navegador sem instalar nada.

Distribuição de plataformas (dados de adoção do v13, 2025):

- **68,35%** usam o pacote Electron para Windows
- Os demais usam Node.js headless (Linux, servidores, cloud)

---

## 2. Arquitetura Cliente/Servidor

### 2.1 Modelo Geral

Foundry VTT opera em uma arquitetura cliente-servidor desacoplada:

```
[GM / Servidor]                   [Jogadores / Clientes]
┌──────────────────────────┐      ┌──────────────────────┐
│  Node.js server           │      │  Navegador moderno    │
│  (Express 5 + WS nativo)  │◄────►│  WebGL via PIXI.js    │
│  LevelDB (disco)          │      │  ApplicationV2 / HTML │
│  Sistema de arquivos      │      │  CSS / JS modules     │
└──────────────────────────┘      └──────────────────────┘
           │
    [Electron wrapper]
     (uso desktop do GM)
```

**Servidor (Node.js):** executa toda a lógica de persistência, autenticação, controle de permissões e roteamento de mensagens. Usa Express 5 (migrado no v14) para HTTP e WebSockets nativos do browser (migrado do socket.io no v12) para tempo real.

**Cliente (Navegador):** renderiza a cena em WebGL via PIXI.js, exibe a UI em HTML/CSS via ApplicationV2 e se comunica com o servidor exclusivamente por HTTP e WebSocket.

**Electron:** wrapper que embala o servidor Node.js e um browser Chromium em um único executável desktop. Permite ao GM rodar servidor e cliente na mesma máquina sem configuração de rede. No modo Electron, o servidor ouve em `localhost:30000` por padrão.

### 2.2 Conectividade e Rede

| Mecanismo                  | Descrição                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Porta padrão**           | TCP 30000 (configurável via `options.json` → `port` ou CLI `--port`)                                              |
| **UPnP**                   | Ativado por padrão (`upnp: true`). Permite abertura automática de portas no roteador. Desabilitar com `--noupnp`. |
| **Port forwarding manual** | Alternativa ao UPnP para redes sem suporte automático.                                                            |
| **SSL/TLS direto**         | `sslKey` + `sslCert` em `options.json` para HTTPS nativo.                                                         |
| **Reverse proxy**          | Suportado via `proxySSL: true` + `proxyPort` em `options.json`. Documentação oficial cobre Nginx e Apache.        |
| **Route prefix**           | `routePrefix` permite hospedar em subpasta (`exemplo.com/foundry`).                                               |
| **Invite links**           | Gerados pela UI do setup screen; codificam host + porta + token de acesso.                                        |
| **Hosting partners**       | The Forge, Molten Hosting, Sqyre (serviços gerenciados que hospedam Node.js headless).                            |

**Requisitos de rede do GM:** mínimo 1,5 MB/s de upload (12 Mbps recomendado); suporte a IPv4 com port forwarding.

---

## 3. Stack Tecnológica

### 3.1 Backend (Servidor)

| Componente            | Tecnologia                                         | Notas                               |
| --------------------- | -------------------------------------------------- | ----------------------------------- |
| Runtime               | **Node.js 20+** (22 recomendado; 23+ incompatível) | glibc 2.28+ no Linux                |
| Framework HTTP        | **Express 5**                                      | Migrado no v14 (era Express 4)      |
| WebSockets tempo real | **WebSocket nativo do browser** (`ws` no Node)     | Migrado do socket.io no v12         |
| Banco de dados        | **LevelDB** (`classic-level` / `level`)            | Migrado do NeDB no v11              |
| Formato de dados      | JSON/BSON dentro de LevelDB (binary SSTables)      | Sublevels por coleção de documentos |
| Wrapper desktop       | **Electron**                                       | Empacota Node.js + Chromium         |

**Nota sobre o socket.io:** até o v11 o Foundry usava socket.io v4, expondo `game.socket` para módulos enviarem eventos com namespace `module.{nome}`. A partir do v12 a migração para WebSockets nativos do browser foi iniciada; o v12 marcou a deprecação e o v13/v14 concluíram a remoção.

**Nota sobre o LevelDB:** antes do v11 o banco de dados usado era o NeDB (arquivos `.db` de texto plano). No v11 migrou para LevelDB, que armazena dados em arquivos binários (SSTables). Cada compendium pack é uma pasta separada (não mais um arquivo `.db`). Os arquivos binários não são diff-áveis pelo git.

### 3.2 Frontend (Cliente)

| Componente             | Tecnologia                                        | Notas                                                                |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Renderização de canvas | **PIXI.js v7** (WebGL)                            | Migração para PIXI v8/WebGPU adiada do v13 para futura versão        |
| Templating HTML        | **Handlebars** (via `HandlebarsApplicationMixin`) | Legado AppV1 e mixin opcional no AppV2                               |
| Framework de UI        | **ApplicationV2**                                 | Introduzido no v12, 100% migrado no v13                              |
| Manipulação DOM        | **jQuery** (em depreciação)                       | Removido progressivamente a partir do v13 (migração para CSS Layers) |
| Animações              | **GreenSock (GSAP)**                              | Disponível via API do FVTT para módulos                              |
| Editor de rich text    | **ProseMirror**                                   | Substituiu TinyMCE (removido no v14)                                 |
| CSS architecture       | **CSS Layers**                                    | Adotado no v13 para controle de especificidade de estilos de módulos |

#### PIXI.js — Papel e Versão

O PIXI.js é o coração do canvas de cena. Toda a renderização de mapas, tokens, iluminação, visão e efeitos visuais passa pelo PIXI. O Foundry extende `PIXI.Container` para criar suas camadas de canvas (`CanvasLayer`, `PlaceablesLayer`).

A versão atual é **PIXI v7**. A migração para PIXI v8 (que traz suporte nativo a WebGPU além de WebGL2) foi planejada mas adiada do v13 para uma versão futura, priorizando estabilidade. Um issue aberto no GitHub (foundryvtt/foundryvtt #11183) detalha a migração como épico de longo prazo.

#### ApplicationV2 — Arquitetura de UI

O ApplicationV2 substitui o antigo sistema AppV1 (baseado em jQuery + Handlebars puro):

- **Classe base:** `foundry.applications.api.ApplicationV2`
- **Mixin Handlebars:** `HandlebarsApplicationMixin` — permite usar templates `.hbs` com AppV2
- **Formulários:** suporte nativo (configure `tag: "form"` e define `form.handler`), sem necessidade de subclasse separada
- **Sheets de documentos:** `DocumentSheetV2` → `ActorSheetV2`, `ItemSheetV2`
- **Temas (Theme V2):** suporte a dark/light mode com detecção de preferência do OS; configurável no nível do world
- **Pop-out (v14):** aplicações podem ser destacadas em janelas separadas do browser
- **100% migrado no v13:** toda a UI do core foi convertida, eliminando dívida técnica

---

## 4. DataModel — Arquitetura de Dados

### 4.1 Evolução Histórica

| Versão          | Mudança                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| v9 e anteriores | `DocumentData` como objeto interno (acesso via `actor.data.data.str`)            |
| **v10**         | Introdução do `DataModel` — `Document` passou a estender `DataModel` diretamente |
| v12             | Fim do período de retrocompatibilidade com API v9/v10                            |
| **v13**         | `actor.data.data` completamente removido; somente `actor.system`                 |
| v14             | Pipeline unificado de cleaning/validation; batch transactions no banco           |

### 4.2 DataModel Atual (v14)

`DataModel` é a classe base abstrata para toda estrutura de dados persistida:

- Esquema declarado via `static defineSchema()` retornando campos (`StringField`, `NumberField`, `ArrayField`, `SchemaField`, etc.)
- Pipeline unificado: `DataModel.cleanData()` + `updateSource()` fazem cleaning, migration, sanitization e validation em uma única passagem
- Melhorias de performance no v14: criação de documentos 25,86% mais rápida, updates persistidos 9,69% mais rápidos
- `SchemaField#extendFields` e `SchemaField#removeFields` para modificação dinâmica de schema (v14)
- Suporte a batch transactions: múltiplas operações em uma única transação serializada de banco (v14)

`TypeDataModel` é a subclasse usada para dados de sistema (o campo `system` de Actors, Items, etc.) — é aqui que sistemas RPG definem seus próprios campos.

**Renames críticos do v10:**

- `actor.data.data.*` → `actor.system.*`
- `actor.data.permission` → `actor.ownership`
- `Actor#token` → `Actor#prototypeToken`

---

## 5. Estrutura de Pacotes e Ciclo de Vida

### 5.1 Tipos de Pacote

Foundry VTT organiza todo conteúdo em três tipos de pacote:

| Tipo       | Arquivo manifest | Diretório       | Função                                                    |
| ---------- | ---------------- | --------------- | --------------------------------------------------------- |
| **System** | `system.json`    | `Data/systems/` | Define regras, schema de dados, UI para um RPG específico |
| **Module** | `module.json`    | `Data/modules/` | Plugin independente que estende funcionalidades           |
| **World**  | `world.json`     | `Data/worlds/`  | Campanha com dados criados pelo usuário                   |

### 5.2 Manifests

Os manifests são JSON com campos obrigatórios como `id`, `title`, `version`, `compatibility` (com `minimum`, `verified`, `maximum` para versões do Foundry). Systems têm campos adicionais como `initiative`, `primaryTokenAttribute`, `documentTypes`.

A URL de manifest estável é usada para instalação automática e verificação de updates pelo setup screen.

### 5.3 Diretório de Dados do Usuário (User Data)

```
{userDataPath}/
├── Config/
│   └── options.json          ← configuração do servidor
├── Data/
│   ├── systems/
│   │   └── {system-id}/      ← arquivos do sistema instalado
│   ├── modules/
│   │   └── {module-id}/      ← arquivos do módulo instalado
│   └── worlds/
│       └── {world-id}/
│           ├── world.json     ← manifest do world
│           ├── data/          ← documentos do world em LevelDB
│           └── packs/         ← compendium packs em LevelDB
└── Logs/
    └── *.log                 ← logs do servidor
```

**Nota:** O diretório `Data/` é servido estaticamente pelo servidor Express — seus arquivos são publicamente acessíveis via URL relativa pelos clientes.

### 5.4 Tela de Setup e Inicialização

O fluxo de startup do servidor segue estas fases:

1. Carga do `options.json`
2. Apresentação da **tela de Setup** (`/setup`) — gerencia instalação de sistemas, módulos e worlds
3. Lançamento de um World → carrega sistema + módulos habilitados → inicializa banco LevelDB → abre a sessão de jogo

As três camadas de configuração, em ordem de precedência:

1. **CLI flags** (maior precedência; temporários)
2. **`options.json`** (persistentes; editados via Setup UI ou diretamente)
3. **Setup UI** (interface gráfica que escreve no `options.json`)

### 5.5 Compendium Packs

- Armazenados em LevelDB (uma pasta por pack, com arquivos binários SSTables)
- Tipos suportados: Actor, Item, JournalEntry, Macro, Playlist, RollTable, Scene, Adventure (multi-tipo)
- **Lazy loading:** só metadados e índice são carregados na inicialização; dados completos são buscados sob demanda
- `getIndex()` → retorna lista leve (id + name); `importDocument()` → clona para o world
- O CLI oficial (`foundryvtt-cli`) permite fazer unpack/repack de LevelDB para JSON/YAML para versionamento em git

---

## 6. Canvas e Renderização

### 6.1 Arquitetura do Canvas

O canvas é um elemento `<canvas>` HTML5 controlado pelo PIXI.js. Toda cena é um conjunto de **camadas PIXI** (cada uma é uma `PIXI.Container` extendida):

| #   | Camada                      | Conteúdo                                             |
| --- | --------------------------- | ---------------------------------------------------- |
| 1   | Background Image            | Imagem de fundo da cena                              |
| 2   | Standard Tiles              | Tiles "underfoot" (chão, mobília, obstáculos)        |
| 3   | Token / Actors Layer        | Tokens dos personagens e NPCs                        |
| 4   | Overhead Tiles              | Tiles com flag Overhead (telhados, copas de árvores) |
| 5   | Foreground Image            | Imagem de primeiro plano (sempre visível)            |
| 6   | Weather Layer               | Efeitos de clima                                     |
| 7   | Effects / Lighting & Vision | Iluminação, visão, fog of war                        |
| 8   | Template Layer              | Medições e templates de magia                        |
| 9   | Sound Layer (GM)            | Emissores de som ambiente                            |
| 10  | Walls Layer (GM)            | Paredes bloqueando luz, visão, som                   |

Há também camadas de controle/interface (régua, seleção, HUD) sobre todas as acima.

### 6.2 Scene Regions (v12+)

Introduzidas no v12 como camada adicional do canvas:

- Geometria: formas retangulares, elípticas ou poligonais; suporte a "holes" (geometria negativa)
- Elevation ranges: tokens podem passar acima ou abaixo de uma Region sem ativá-la
- **Behaviors** (comportamentos): subscritos a eventos, executados quando o evento ocorre
- Eventos suportados: TokenEnters, TokenExits, TokenMovesIn/Out, TokenStartsTurn/EndsTurn, TokenStartsRound/EndsRound, etc.
- Behaviors built-in: AdjustDarknessLevel, SuppressWeather, ModifyMovementCost, ExecuteMacro, PauseGame, TeleportToken, ToggleBehavior, DisplayScrollingText
- API: `RegionDocument`, `RegionBehavior`, `RegionLayer`

### 6.3 Scene Levels (v14)

Suporte nativo a múltiplos andares em uma única cena:

- Paredes e fontes de luz podem ser específicas por nível ou compartilhadas
- Visão, movimento e combate funcionam através dos níveis de elevação
- Completa o último item da whiteboard de features original (2018)

### 6.4 Rendering Pipeline

- **WebGL 2.0** (alvo para shaders; PIXI v7 usa WebGL 1/2 conforme disponibilidade)
- Anti-aliasing: **SMAA** (Subpixel Morphological AA) — substituiu FXAA no v12
- Iluminação: sistema de prioridade de fontes de luz (v13); animações de luz reativas a áudio (v13)
- **WebGPU:** avaliado para adoção futura junto com a migração para PIXI v8 (adiada do v13)

---

## 7. Comunicação em Tempo Real

### 7.1 Evolução do Protocolo

| Versão  | Tecnologia                                                        |
| ------- | ----------------------------------------------------------------- |
| v9–v11  | socket.io v4 (`game.socket`; eventos `module.{name}`)             |
| v12     | Deprecação do socket.io; início da migração para WebSocket nativo |
| v13–v14 | WebSocket nativo do browser (API `WebSocket`) + `ws` no Node.js   |

### 7.2 Padrão de Mensagens

No sistema atual (v12+), as mensagens são enviadas como JSON comprimido (avaliação de envio binário também ocorreu). O servidor roteia mensagens para:

- **Document operations:** creates, updates, deletes sincronizados entre todos os clientes
- **Canvas operations:** movimentos de token, drawing, ruler, etc.
- **Chat:** mensagens, rolls de dados
- **Eventos de sistema/módulo:** cada sistema/módulo pode declarar `"socket": true` no manifest para receber namespace próprio

O objeto `game` no cliente é o ponto central de acesso: `game.socket`, `game.users`, `game.scenes`, `game.actors`, etc.

---

## 8. Histórico de Versões e Mudanças Arquiteturais

| Versão  | Data Stable | Principais mudanças arquiteturais                                                                                                                                |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v9**  | Ago 2022    | Base estável pré-modernização                                                                                                                                    |
| **v10** | Jun 2023    | **DataModel** substitui DocumentData; `actor.system`                                                                                                             |
| **v11** | Nov 2023    | **LevelDB** substitui NeDB; suporte a Sublevels; PIXI v7 com events engine reimplementada                                                                        |
| **v12** | Mai 2025    | **ApplicationV2** (preview); **migração socket.io → WS nativo**; Scene Regions; SMAA; ProseMirror improvements                                                   |
| **v13** | Abr 2025    | **ApplicationV2 100%** migrado; **Theme V2**; jQuery em deprecação; CSS Layers; Token Drag Measurement; Win Portable build; Node.js 20+ obrigatório              |
| **v14** | Abr 2026    | **Express 5**; Scene Levels; Active Effects V2; batch DB transactions; pop-out windows; TinyMCE removido; Measured Templates → Scene Regions; performance +3–25% |

**Versão estável atual (junho 2026): v14, build 14.364**

---

## 9. Requisitos de Hardware e Performance

### 9.1 Servidor (GM / host)

| Recurso       | Mínimo                           | Recomendado        |
| ------------- | -------------------------------- | ------------------ |
| CPU           | 1 vCPU                           | 2 vCPUs            |
| RAM           | 2 GB                             | 4 GB               |
| Armazenamento | 1 GB                             | —                  |
| Upload        | —                                | 1,5 MB/s (12 Mbps) |
| OS            | Suporte a Node 20+ + glibc 2.28+ | —                  |
| Node.js       | 20+                              | 22                 |

Hardware suportado adicionalmente: Raspberry Pi 4 Model B, Pi 5 e Compute Module 4.

### 9.2 Cliente (Jogadores)

| Recurso   | Mínimo                                                     | Recomendado                |
| --------- | ---------------------------------------------------------- | -------------------------- |
| RAM       | 8 GB                                                       | 16 GB                      |
| GPU       | GPU integrada com aceleração de hardware                   | GPU dedicada com WebGL 2.0 |
| Resolução | 1366×768                                                   | 1920×1080+                 |
| Browser   | Chrome, Firefox, Opera, Edge (hardware acceleration ativa) | Chrome ou Chromium         |

**Nota de performance:** o desempenho depende fortemente do conteúdo da cena (número de tokens, complexidade de iluminação/visão, tamanho do mapa). A maior limitação do cliente é a GPU para renderização WebGL.

---

## 10. Licença e Limites para Implementação Clean-Room

### 10.1 O que a licença do Foundry VTT proíbe

A licença (EULA da Foundry Gaming LLC) proíbe:

- Vender, distribuir, sublicenciar ou transferir o software
- Engenharia reversa, decompilação ou desassemblagem para obter código-fonte
- Implementar mecanismos que repliquem funcionalidades do Foundry sem o software licenciado
- Usar o nome "Foundry VTT" ou marcas da Foundry Gaming LLC sem aprovação

### 10.2 O que é permitido para clean-room

- **Estudar o comportamento observável** do software (UI, fluxo de dados, API pública)
- **Ler documentação pública:** Knowledge Base (`foundryvtt.com/kb`), API docs (`foundryvtt.com/api`), artigos de desenvolvimento
- **Criar produto concorrente independente** com funcionalidades equivalentes, desde que desenvolvido sem referenciar o código-fonte proprietário
- **Usar repositórios open-source da comunidade** com licenças permissivas (ex.: `foundryvtt/pf2e` sob OGL/ORC/Apache-2.0) para dados e referência de implementação de sistema

### 10.3 Estratégia recomendada para o Fusion

1. Nunca copiar código do software Foundry VTT proprietário
2. Usar apenas a documentação pública e a observação de comportamento como referência
3. Para dados de sistema (PF2e, SF2e): usar os compendiums open-source oficiais
4. Desenvolver API própria para sistemas (não copiar a API do Foundry)
5. Adotar tecnologias similares (Node.js, WebGL, WebSocket) é legal — elas são genéricas

---

## 11. Análise para o Projeto Fusion

### 11.1 Decisões de stack validadas pela pesquisa

| Decisão para o Fusion                | Validação pelo Foundry                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| Node.js como servidor                | Confirmado como única opção viável para performance                  |
| WebSocket nativo (não socket.io)     | Foundry migrou para isto no v12 — socket.io é overhead desnecessário |
| LevelDB ou similar para persistência | LevelDB provado em produção no Foundry v11+                          |
| PIXI.js para canvas WebGL            | Única lib WebGL de alto nível com maturidade suficiente para VTT     |
| Express como HTTP server             | Express 5 confirmado no Foundry v14                                  |
| Electron para desktop do GM          | Abordagem validada; 68% dos usuários do Foundry usam Electron        |
| DataModel com schema declarativo     | Padrão provado para VTTs; simplifica validação e serialização        |
| Compendiums em JSON para git         | CLI oficial do Foundry faz exatamente isso                           |

### 11.2 Lições arquiteturais do Foundry

- **Separar Data do runtime:** User Data em diretório separado facilita backup, migração e multi-instância
- **ApplicationV2 vs AppV1:** adotar desde o início um framework de UI moderno (sem jQuery global) evita dívida técnica que custou ao Foundry dois ciclos de versão (v12–v13) para migrar
- **LevelDB tem custo em git:** usar o padrão JSON/YAML intermediário + build para LevelDB desde o início
- **Node.js 22+ incompatibilidade:** fixar versão Node no projeto e testar em CI
- **WebGPU ainda não é o momento:** PIXI v7/WebGL 2 é o alvo seguro para 2026; WebGPU pode ser roadmap
- **Lazy loading de compendiums:** crítico para performance — não carregar tudo na memória na inicialização

---

## Fontes

- [Hosting Options | Foundry VTT (DeepWiki)](https://deepwiki.com/foundryvtt/foundryvtt/2.2-hosting-options)
- [Hardware and Software Requirements | Foundry VTT (DeepWiki)](https://deepwiki.com/foundryvtt/foundryvtt/2.1-hardware-and-software-requirements)
- [Minimum Requirements | Foundry Virtual Tabletop](https://foundryvtt.com/article/requirements/)
- [Frameworks and Libraries | Foundry Virtual Tabletop](https://foundryvtt.com/article/frameworks/)
- [Foundry VTT Overview | DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/1-overview)
- [Software License | Foundry Virtual Tabletop](https://foundryvtt.com/article/license/)
- [Release Notes | Foundry Virtual Tabletop](https://foundryvtt.com/releases/)
- [Version 12 Feature Preview | Foundry Virtual Tabletop](https://foundryvtt.com/article/v12-preview/)
- [Version 10 Data Model Changes | Foundry Virtual Tabletop](https://foundryvtt.com/article/v10-data-model/)
- [Version 11 LevelDB Packs | Foundry Virtual Tabletop](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Versioning and Releases | Foundry Virtual Tabletop](https://foundryvtt.com/article/versioning/)
- [Application Configuration | Foundry Virtual Tabletop](https://foundryvtt.com/article/configuration/)
- [Managing User Data | Foundry Virtual Tabletop](https://foundryvtt.com/article/user-data/)
- [Scene Regions | Foundry Virtual Tabletop](https://foundryvtt.com/article/scene-regions/)
- [Canvas Layers | Foundry Virtual Tabletop](https://foundryvtt.com/article/canvas-layers/)
- [Sockets | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/sockets)
- [ApplicationV2 | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/applicationv2)
- [Introduction to PIXI in Foundry VTT | Community Wiki](https://foundryvtt.wiki/en/development/guides/pixi)
- [DataModel | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.abstract.DataModel.html)
- [Release 13.341 | Foundry Virtual Tabletop](https://foundryvtt.com/releases/13.341)
- [Release 14.349 | Foundry Virtual Tabletop](https://foundryvtt.com/releases/14.349)
- [Release 14.359 | Foundry Virtual Tabletop](https://foundryvtt.com/releases/14.359)
- [Year in Review 2025 | Foundry Virtual Tabletop](https://foundryvtt.com/article/year-in-review-2025/)
- [Adopt PIXI v8 — Issue #11183 | GitHub foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/11183)
- [Compendium Packs | DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/4.3-compendium-packs)
- [Package Releases and Version History | Community Wiki](https://foundryvtt.wiki/en/development/guides/releases-and-history)
- [Foundry VTT v14 Released | foundryvtt.store](https://www.foundryvtt.store/news/2026-04-01-foundry-vtt-v14)
- [Foundry VTT Wikipedia](https://en.wikipedia.org/wiki/Foundry_VTT)
