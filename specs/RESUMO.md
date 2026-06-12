# Fusion — Resumo das Especificações

> Gerado em 2026-06-12 a partir das 28 specs de `specs/`. Cada seção abaixo resume uma spec; o link ao final de cada uma leva ao documento completo.

## Sumário executivo

O **Fusion** é um VTT web próprio, inspirado no comportamento do Foundry VTT mas reimplementado do zero em **clean-room** (nenhum código proprietário copiado). O GM roda um servidor local (porta 33000) e os jogadores entram pelo navegador, em LAN ou internet. Três sistemas nascem com ele: **Pathfinder 2e** e **Starfinder 2e** — ambos sobre um núcleo comum (`systems/engine-2e`), com dados mecânicos abertos (ORC/OGL) importados do projeto open-source `foundryvtt/pf2e` — e **Etmos**, construído a partir do SRD oficial, tendo como peça central o compositor de magias por Partículas.

- **Stack**: TypeScript · Node.js 22+ · monorepo pnpm · Fastify + socket.io v4 · better-sqlite3 · Svelte 5 · PIXI.js v8 · TipTap · Howler.js · Tauri v2 (fase 2).
- **Princípios**: servidor autoritativo (toda validação, permissão e RNG no servidor), automação sempre com equivalente manual, pt-BR como idioma primário, sistemas compilados no monorepo (sem plugins dinâmicos no MVP).
- **Tamanho**: 28 specs, ~1.400 requisitos numerados (`REQ-*-NNN`) com tags **[MVP]** / **[V2]**.
- **Roadmap**: M0 fundação → M1 mesa mínima → M2 visão/fog + combate → M3 system API + PF2e + importer (**primeira sessão jogável**) → M4 SF2e + qualidade → M5 Etmos → M6 distribuição.

Leitura sugerida das specs completas: `00` → `01` → `27`, depois por área de interesse.

---

## 00 — Visão e Escopo

**O que define:** O contrato de produto do Fusion — por que construir um VTT próprio, para quem, o que entra no MVP e o que fica para V2.

**Decisões-chave:**
- Abordagem **clean-room**: reimplementação sem copiar código proprietário do Foundry VTT, usando apenas comportamento observável e documentação pública.
- Servidor **self-hosted** na máquina do GM; jogadores acessam apenas pelo navegador (sem instalação), em LAN ou internet.
- Três sistemas-alvo compilados junto ao app: **PF2e** (validação do MVP), **SF2e** e **Etmos** — sem plugins dinâmicos de terceiros no MVP.
- Importação restrita a campos mecânicos abertos (ORC/OGL) do repositório `foundryvtt/pf2e`; arte, lore e marcas Paizo são linha vermelha.
- **Automação opcional**: toda automação tem equivalente manual; UI e documentação em **pt-BR** como idioma primário (8 decisões de produto, 20 requisitos funcionais).

**No MVP:** O grupo consegue jogar uma sessão completa de PF2e — mapa+grid, tokens com movimento, visão/fog básicos, fichas, rolagens, chat e combat tracker — sem o Foundry.

**Fica para V2:** SF2e, Etmos, carregamento dinâmico de plugins e wrapper desktop (Tauri).

> Spec completa: [00-visao-e-escopo.md](00-visao-e-escopo.md)

---

## 01 — Arquitetura Geral

**O que define:** Como os componentes do Fusion se encaixam — monorepo, modelo de processo, boot sequence, lifecycle de world, configuração e versionamento.

**Decisões-chave:**
- **Processo único Node.js** com Fastify (HTTP/REST/static) e socket.io v4 (tempo real) montados no mesmo `http.Server`; servidor autoritativo valida e persiste antes de fazer broadcast.
- **Monorepo pnpm** com pacotes `server`, `client`, `shared`, `system-api`, `systems/*` e `tools/*`; fronteiras de dependência impostas por lint no CI (`client` não importa `server` e vice-versa).
- **Porta default 33000** (distinta da porta 30000 do Foundry); configuração em camadas — CLI > env `FUSION_*` > `fusion.json` > defaults.
- Sistemas compilados juntos no MVP (`systems/pf2e`, `systems/sf2e`, `systems/etmos`), com núcleo compartilhado `systems/engine-2e` para mecânicas 2e comuns.
- **Versionamento triplo** independente: engine (SemVer), sistema (range de compatibilidade) e schema do world (inteiro monotônico); protocolo WebSocket tem sua própria versão de handshake (45 requisitos funcionais e não-funcionais).

**No MVP:** Boot frio < 5 s; round-trip de token em LAN < 100 ms; exatamente um world por vez; WebGPU com fallback automático para WebGL.

**Fica para V2:** Múltiplos worlds simultâneos, canais de release (stable/testing) e wrapper desktop Tauri.

> Spec completa: [01-arquitetura-geral.md](01-arquitetura-geral.md)

---

## 02 — Modelo de Dados (Documents)

**O que define:** O catálogo de Documents do Fusion e as regras transversais — identidade, schema Zod, ownership, herança token→actor, ciclo CRUD e migrações.

**Decisões-chave:**
- **Schema runtime com Zod** (não o `DataModel`/`DataField` do Foundry); tipos TypeScript derivados via `z.infer`; validação autoritativa no servidor, opcional no cliente.
- **`_id` de 16 chars** gerado com nanoid (alfabeto `[A-Za-z0-9]`, ~95 bits de entropia) — compatível com ids dos JSONs importados do `foundryvtt/pf2e`; **UUID hierárquico próprio** codifica o caminho de embedding.
- **Catálogo enxuto**: 13 Documents primários e 16 embedded no MVP; Cards, Region, Level, Adventure, CombatantGroup e FogExploration como Document de primeira classe são [V2].
- **Herança token→actor simplificada**: `actorDelta` é um merge patch parcial (não o `EmbeddedCollectionDelta` item-a-item do Foundry); delta item-granular fica para V2.
- **`_stats` exclusivo do servidor** (timestamps, `lastModifiedBy`, versões de engine e system); **versionamento duplo e independente** por Document: engine (`schemaVersion`) e system (55 requisitos).

**No MVP:** CRUD completo com diff mínimo, hooks pré/pós canceláveis, preparação de dados derivados (`prepareData` + `ActiveEffect`) e migrações idempotentes por Document.

**Fica para V2:** Delta item-granular de token, validação de flags por schema registrado e write-back de migração em lote.

> Spec completa: [02-modelo-de-dados.md](02-modelo-de-dados.md)

---

## 03 — Persistência e Mundos

**O que define:** Como o Fusion armazena dados — schema SQLite completo, layout em disco, operações de gerenciamento de worlds (criar, duplicar, exportar, importar) e estratégia de backup.

**Decisões-chave:**
- **Um `world.db` SQLite por world** (better-sqlite3, WAL mode) em vez de LevelDB; banco único portátil, queryable e com backup online sem downtime via `Database.backup()`.
- **Documents embedded armazenados como JSON** no campo `data` do pai (sem tabela própria); colunas extraídas (`name`, `type`, `folder_id`, `sort`) para indexação eficiente.
- **PRAGMAs obrigatórios** em toda conexão: `WAL`, `synchronous=NORMAL`, `busy_timeout=30000`, `foreign_keys=ON`, `cache_size=-16000`.
- **Process lock** via `world.lock` (PID + timestamp) para garantir single-writer; `integrity_check` automático na abertura com restauração de backup em caso de corrupção.
- **Export `.fwzip`** (ZIP com `world.db` + assets referenciados + manifesto SHA-256) resolve o ponto de dor documentado do Foundry (backups sem assets causam paths quebrados).

**No MVP:** CRUD transacional, backups automáticos a cada 30 min (retenção de 10), export/import de `.fwzip`, criação/duplicação/exclusão de worlds via REST (`/api/worlds`); abertura de world < 3 s, CREATE/UPDATE < 10 ms P99.

**Fica para V2:** Import de worlds do Foundry VTT (LevelDB via `foundryvtt-cli`), export JSON versionável em git e integração com Litestream para replicação contínua.

> Spec completa: [03-persistencia-e-mundos.md](03-persistencia-e-mundos.md)

---

## 04 — Rede e Sincronização

**O que define:** A camada de rede em tempo real do Fusion: protocolo de mensagens sobre socket.io v4, divisão de autoridade, modelo de concorrência, reconexão/resync de estado, presença e controles de robustez.

**Decisões-chave:**
- **socket.io v4** como transporte (reconexão automática, ACK callbacks, namespaces e rooms out-of-the-box; migração para `ws` nativo adiada para V2 via `Envelope` transporte-agnóstico).
- **Envelope unificado** `domain:action` (ex.: `doc:update`, `token:move`) com apenas 4 eventos socket.io de baixo nível (`op`, `query`, `ephemeral`, `system`); tipos em `packages/shared`.
- **Servidor autoritativo**: valida permissão + schema, persiste, atribui `seq` monotônico e faz broadcast — nunca o cliente.
- **Concorrência cirúrgica**: otimista com rollback apenas para movimento de token; pessimista (await ack) para todo o restante (documentos, fichas, chat).
- **Resync por delta via buffer circular** (default N=1000 ops) ao reconectar; snapshot completo como fallback. Conta 82 requisitos [MVP].

**No MVP:** Dois clientes sincronizando doc:update com seq, movimento otimista de token com rollback, presença (cursor, ping, force pan, lista online, RTT), resync delta/snapshot, rate limiting e tamanho máximo de mensagem.

**Fica para V2:** Query roteada a cliente específico (GM interativo) e compressão de mensagens/payload binário.

> Spec completa: [04-rede-e-sincronizacao.md](04-rede-e-sincronizacao.md)

---

## 05 — Usuários e Permissões

**O que define:** O modelo completo de identidade do Fusion: estrutura de dados do `User`, quatro roles e matriz de permissões configurável pelo GM, ownership de documentos por nível, fluxo de autenticação JWT + refresh token e administração de usuários.

**Decisões-chave:**
- **Quatro roles** (`PLAYER` < `TRUSTED` < `ASSISTANT` < `GAMEMASTER`) com comparação numérica; usuários bloqueados usam `active: false`, não um role especial.
- **Argon2id** (pacote `@node-rs/argon2`) para hashing de senhas desde o MVP; senhas opcionais por usuário (flexibilidade para LAN fechada).
- **JWT de 15 min + refresh token opaco de 30 dias** em cookie `httpOnly`; rotação com reuse detection; kick revoga sessão em < 3 s.
- **18 Permission keys** com `defaultRole` configurável pelo GM (ex.: `DRAWING_CREATE` default `TRUSTED`) armazenado em `world_settings`; verificação O(1) em memória.
- **Ownership por documento** com 4 níveis (NONE/LIMITED/OBSERVER/OWNER) e chave `"default"`; GM tem OWNER implícito em tudo.

**No MVP:** Login, refresh, logout, kick, CRUD de usuários pelo GM, URL de convite LAN/internet, presença online, matriz de permissões configurável em tempo real.

**Fica para V2:** Ownership em batch, link de convite com token de uso único, latência por usuário no painel, SSO/OAuth externo.

> Spec completa: [05-usuarios-e-permissoes.md](05-usuarios-e-permissoes.md)

---

## 06 — Canvas e Renderização

**O que define:** A camada de renderização 2D do Fusion: hierarquia de grupos PIXI v8, abstração de grade (square/hex/gridless), modelo visual e de interação de todos os objetos posicionáveis (tokens, tiles, drawings, templates, notes, ruler) e metas de performance.

**Decisões-chave:**
- **4 grupos PIXI** do fundo ao topo — `PrimaryGroup`, `EffectsGroup`, `InterfaceGroup`, `OverlayGroup` — com um **Render Group** cobrindo os três primeiros para pan/zoom acelerado por GPU; OverlayGroup (ruler, pings, cursores) fica fora do transform de câmera.
- **Interface `GridStrategy`** com 3 implementações (Square, Hex via `honeycomb-grid` MIT, Gridless); regra de diagonal configurável por cena (`alternating_1` = PF2e 5-10-5 como default).
- **Movimento de token cirúrgico**: ghost durante drag → posição otimista no originador ao confirmar → peers animam apenas a partir do broadcast canônico (alinha `04` REQ-NET-050/051/052).
- **4 formas de MeasuredTemplate**: circle, cone (90° default para PF2e — a confirmar em `17`), line/ray, emanation; geram highlight de células por `GridStrategy`.
- **Performance**: culling manual (PIXI não faz culling automático), cache/atlas de barras e ícones, LOD de nameplates por zoom; meta ≥ 60 fps com 50 tokens em mapa 10k×10k.

**No MVP:** Todos os placeables acima, 3 tipos de grade, oclusão de tiles overhead (none/fade/radial), drawings, notes, ruler com waypoints, flags de re-render coalescidas por frame.

**Fica para V2:** Token ring dinâmico, tile de vídeo, custo de movimento com SceneRegions, drag com waypoints avançados, rotação de cena.

> Spec completa: [06-canvas-e-renderizacao.md](06-canvas-e-renderizacao.md)

---

## 07 — Visão, Iluminação e Fog of War

**O que define:** O subsistema de percepção espacial: modelo de walls com quatro restrições independentes, algoritmo de visibility polygon por angular sweep, iluminação dinâmica (AmbientLight + token.light, darkness, global illumination), modos de visão/detecção por token e fog of war com três estados e persistência por usuário.

**Decisões-chave:**
- **Wall com 4 restrições independentes** (`move`/`sight`/`light`/`sound`) e presets de conveniência (normal, terrain, invisible, ethereal, door); persistido expandido, nunca como enum de preset.
- **Visibilidade calculada no cliente** (performance; o servidor só valida colisão de `move`); algoritmo **angular sweep O(n log n)** implementação própria baseada em Red Blob Games/Nicky Case, com quadtree de poda espacial.
- **Fog de 3 estados** (não-explorado/explorado-fora-de-visão/atualmente-visível) por par (usuário, cena); exploração acumulada com `clipper2` + RenderTexture PIXI; persistência throttled (nunca por frame).
- **GM vê tudo**; jogador vê a união dos vision polygons de todos os tokens que controla; cálculo pesado pode migrar para Web Worker (D9).
- **Iluminação** composta em RenderTextures/shaders PIXI; operam em coordenadas contínuas de pixel (grid-agnóstico); darkvision em MVP, modos avançados (monochromatic, tremorsense) em V2.

**No MVP:** Walls normais/terrain/invisible/ethereal/door, portas com estado e invalidação em tempo real, bright/dim/unlit, global illumination + darkness level, modos `basic` e `darkvision`, fog completo com reset pelo GM.

**Fica para V2:** Proximity/reverse_proximity, animações de luz, darkness sources, detection modes adicionais, pré-revelar/reocultar fog, elevação/multi-andar.

> Spec completa: [07-visao-iluminacao-fog.md](07-visao-iluminacao-fog.md)

---

## 08 — Motor de Rolagens

**O que define:** A sintaxe de fórmulas suportada, a arquitetura de parsing/execução, o protocolo de autoridade do servidor (RNG anti-cheat), o resultado estruturado para o chat e a API para sistemas registrarem hooks e interceptarem rolagens.

**Decisões-chave:**
- Parser (`FusionRoller`) em `packages/shared` usando `@dice-roller/rpg-dice-roller` v5.5.1 como núcleo; execução do RNG exclusivamente no servidor via `crypto.getRandomValues` (CSPRNG).
- `RollResult` estruturado com AST completa serializada: fórmula expandida, breakdown por dado (`DiceResult`), flavor e campo opcional `degreeOfSuccess` — suficiente para render rico sem re-avaliar no cliente.
- Roll modes (`public`/`gmroll`/`blindroll`/`selfroll`) mapeados em campos `whisper[]` e `blind` do `ChatMessage`, sem dado de visibilidade no `RollResult` em si.
- API de sistemas com `RollHook` (`preRoll`/`postRoll`) e `DegreeOfSuccess` genérico (string); `systems/engine-2e` fornece helper de 4 graus para PF2e/SF2e; Etmos define o seu próprio.
- Dados 3D via `@3d-dice/dice-box` (Web Worker + OffscreenCanvas), client-side, sincronizados com os valores reais do servidor; lazy-loaded; desabilitado por padrão. Total de 55 requisitos.

**No MVP:** Parser e execução autoritativa no servidor, todos os 13 tipos de notação (`NdX`, keep/drop, explode, reroll, pools, `dF`, funções), `@attr`, inline/deferred rolls, 4 roll modes, `RollAuditLog` com seed, API de `RollHook` e integração básica de dados 3D.

**Fica para V2:** Dados físicos externos (GoDice), entropia de serviço externo (dddice), `RollTable` na system API, rolagens verificáveis públicas e purga agendada do audit log.

> Spec completa: [08-motor-de-rolagens.md](08-motor-de-rolagens.md)

---

## 09 — Chat e Mensagens

**O que define:** O modelo de dados do documento `ChatMessage`, os tipos de mensagem, os comandos de chat, o sistema de chat cards declarativos, as regras de visibilidade, sanitização, paginação e notificações.

**Decisões-chave:**
- `ChatMessage` é um Document persistido em SQLite (não estado efêmero), sincronizado via socket.io como qualquer outro Document do Fusion.
- Chat cards usam schema JSON declarativo `CardData` (sem HTML arbitrário); o cliente renderiza via componente Svelte `<ChatCard>` controlado, eliminando a superfície de XSS do modelo Foundry.
- Comandos de chat registrados em `CommandRegistry` extensível: sistemas adicionam comandos próprios via `SystemAPI.registerChatCommand()`.
- Sanitização por allowlist feita no servidor antes de persistir; paginação por cursor (não offset) para O(log n) em históricos grandes; busca full-text via SQLite FTS5.
- Inline rolls avaliados e embutidos no Document pelo servidor antes de persistir; deferred rolls armazenados como metadata e renderizados como botão pelo cliente.

**No MVP:** 5 tipos de mensagem, 8 comandos built-in, chat cards com botões desabilitáveis, @UUID com tooltip, markdown leve, virtual scroll, busca FTS5, export de log, notificações com badge, chat bubbles (5 s, 120 chars).

**Fica para V2:** Pop-out do chat em janela separada, edição de mensagens, reações emoji e threads.

> Spec completa: [09-chat-e-mensagens.md](09-chat-e-mensagens.md)

---

## 10 — Combate e Iniciativa

**O que define:** O modelo de dados de encontros (`Combat`/`Combatant`), o fluxo de iniciativa configurável por sistema, a progressão de turnos e rodadas, os eventos de ciclo de vida e a interface visual do tracker.

**Decisões-chave:**
- `Combat` é Document first-class persistido no `world.db` com array embedded de `Combatant`; estado recuperável após reconexão.
- Fórmula de iniciativa totalmente delegada à system API via `registerInitiativeFormula(combatType, fn)` — núcleo não hardcoda nenhuma fórmula além de `1d20` como fallback.
- Desempate fornecido pelo sistema via `tiebreaker(combatant): number` (simples, numérico) e/ou `compare(a, b): number` (comparador total para regras não-monotônicas como "jogadores vencem NPCs" do Etmos).
- Eventos de ciclo de vida (`combatStart`/`turnStart`/`turnEnd`/`roundStart`/`roundEnd`/`combatEnd`) emitidos pelo servidor via EventBus interno; handlers do sistema rodam server-side para expirar condições sem depender de clientes conectados.
- Combat turn marker implementado em PixiJS (overlay `Graphics`/`Sprite` com pulso animado) sobre o token ativo; targeting limpo por `userId` ao fim do turno.

**No MVP:** Um único encontro ativo por cena, rolagem individual e em massa, reordenação por drag-and-drop, skip de defeated, visibilidade de NPCs ocultos, tracker sidebar com pan automático, targeting de tokens e todos os hooks de turno/rodada para automação de condições PF2e/Etmos.

**Fica para V2:** Múltiplos encontros simultâneos, ações Delay/Ready, cinematic starship scenes SF2e como `CombatType` nativo.

> Spec completa: [10-combate-e-iniciativa.md](10-combate-e-iniciativa.md)

---

## 11 — UI Framework e Fichas (Sheets)

**O que define:** O shell da aplicação, o window manager próprio em Svelte 5, o sistema de Sheets registradas por `(documentType, subtype)`, a biblioteca de componentes base, o editor rich text TipTap, theming dark/light e i18n pt-BR/en.

**Decisões-chave:**
- UI 100% Svelte 5 (Runes): nenhuma reimplementação de ApplicationV2/Handlebars; janela é um componente Svelte com contrato de props (`SheetContext`), não uma classe.
- Window manager próprio para janelas flutuantes empilháveis (z-index unificado, singleton por `singletonKey`); `<dialog>` nativo reservado apenas para modais bloqueantes (focus trap grátis).
- Sheets resolvidas na ordem `(documentType, subtype)` → `(documentType, "*")` → sheet default genérica da engine — resolução nunca falha.
- Autosave com debounce de 400 ms emitindo diff parcial do Document via protocolo de `04`; sem botão "Salvar"; atualizações remotas concorrentes não derrubam o foco do campo em edição.
- Drag & drop unificado sobre Pointer Events com payload tipado `{ uuid, documentType, subtype, origin }`; drop zones validam tipo e permissão antes do drop. Total de 64 requisitos funcionais + 10 não-funcionais.

**No MVP:** Shell completo (canvas, sidebar com 8 tabs, scene controls, hotbar 10 slots × 5 páginas, player list, Token HUD), window manager, sheets com autosave, dialogs, FilePicker, ColorPicker, editor TipTap com @links/@secrets/inline rolls, theming dark/light WCAG AA, i18n, player mode tablet.

**Fica para V2:** Pop-out de janela em browser separado, edição colaborativa em tempo real no rich text e skins de tema por sistema.

> Spec completa: [11-ui-framework-e-fichas.md](11-ui-framework-e-fichas.md)

---

## 12 — Journal, Tabelas e Cartas

**O que define:** O subsistema de conteúdo documental do Fusion: journal multi-página com editor rico, tabelas aleatórias procedurais e modelo conceitual de decks de cartas.

**Decisões-chave:**
- Editor de texto usa **TipTap v2** (wrapper ProseMirror) com extensões customizadas para `SecretBlock` e `@UUID` chips; colaboração em tempo real via autosave por socket.io a cada 30 s (CRDT/Yjs é [V2]).
- `SecretBlock` com estado `revealed` autoritativo no servidor — conteúdo não revelado é filtrado server-side antes de qualquer transmissão ao cliente (validado por testes de integração).
- `RollTable` com draw com/sem replacement, pesos, normalização automática de fórmula e tabelas aninhadas; draw acessível via comando de chat `/table`.
- Busca global em índice em memória (< 200 ms para até 5.000 docs) com fallback para **SQLite FTS5** em mundos grandes; índice atualizado em tempo real via socket.
- Cards/Decks (`CardStack`, `Card`) definidos apenas como tipos em `packages/shared` — UI e lógica são [V2].

**No MVP:** Journal com páginas text/image/video, SecretBlocks, @UUID links, RollTables com draw/reset/normalize, comando `/table` no chat e busca global por nome.
**Fica para V2:** PDF pages, CRDT colaborativo, backlinks entre documents, UI completa de Cards/Decks.

> Spec completa: [12-journal-tabelas-cartas.md](12-journal-tabelas-cartas.md)

---

## 13 — Áudio e Playlists

**O que define:** O subsistema de áudio do Fusion: modelo de playlists, modos de reprodução, fade/crossfade, canais de volume por cliente, sincronização de playback, sons ambientes espaciais no canvas e política de autoplay de browser.

**Decisões-chave:**
- **Howler.js** (MIT) como única abstração de áudio cliente — resolve cross-browser AudioContext, loop sem gap via Web Audio native looping e spatial audio HRTF sem código manual.
- Servidor é fonte de verdade do `PlaybackState` (play/pause/stop/skip); volume master de canal (music/environment/interface) fica exclusivamente no `localStorage` do cliente, nunca no banco.
- Posição temporal estimada com tolerância de ±2 s (`positionMs + (Date.now() - updatedAt)`) — sincronização sample-accurate é [V2].
- `AmbientSound` placeables com falloff linear/logarítmico calculado client-side, spatial audio via `pannerAttr HRTF`, ativação por nível de escuridão; oclusão por paredes é [V2].
- Streaming HTTP range requests via `@fastify/static` para arquivos > 5 MB; formatos OGG (recomendado), MP3, WebM, OPUS, FLAC, WAV.

**No MVP:** Playlists com 4 modos (sequential, shuffle, simultaneous, soundboard), fade/crossfade seamless, AmbientSounds, cena com playlist vinculada e badge de desbloqueio de autoplay.
**Fica para V2:** Oclusão acústica por paredes (raycasting), sincronização precisa de posição.

> Spec completa: [13-audio-e-playlists.md](13-audio-e-playlists.md)

---

## 14 — Macros e Automação

**O que define:** O sistema de macros, hotbar por usuário, ações rápidas data-driven (QuickActions), controle de WorldTime, automações de rotina de mesa e modelo conceitual de Scene Regions.

**Decisões-chave:**
- Script macros executadas exclusivamente pelo GM em **`isolated-vm`** (V8 Isolates reais) no servidor — `node:vm` e `vm2` rejeitados por escapabilidade documentada; timeout de 10 s e log obrigatório.
- **QuickActions** declarativas (schema Zod + handler server-side tipado) são o mecanismo de automação para jogadores, cobrindo ~90% dos casos sem código arbitrário; validadas com Zod antes de qualquer execução.
- `WorldTime` como `bigint` de segundos desde a época do mundo; calendário (nomes de meses, dias) é camada de apresentação separada — [V2].
- `ExecuteAsGM` com conjunto fixo de operações registradas, schema Zod por operação e rate limit de 30 chamadas/min — sem proxy genérico de código arbitrário.
- Hotbar de 50 slots (5 páginas × 10), persistida por usuário no servidor, atalhos 1–0 por página ativa.

**No MVP:** Chat macros, hotbar, QuickActions, WorldTime com relógio na UI, automações de rotina (dano/cura em massa, toggle de condições), ExecuteAsGM seguro.
**Fica para V2:** Script macros, calendário visual, Scene Regions com behaviors.

> Spec completa: [14-macros-e-automacao.md](14-macros-e-automacao.md)

---

## 15 — API de Sistemas (contrato engine ↔ game systems)

**O que define:** O contrato TypeScript-first entre a engine do Fusion e os game systems (PF2e, SF2e, Etmos) — a superfície completa pela qual um sistema declara dados, comportamentos e UI.

**Decisões-chave:**
- Sistemas definidos via `defineSystem(manifest, registrar)` em TypeScript com manifest validado por **Zod** — sem `system.json` cego nem monkey-patching; compilados junto no monorepo (carregamento dinâmico é [V2]).
- Derivação de dados com **`DeriveStep`s nomeados e dependências explícitas** (`reads`/`writes`) ordenados por sort topológico — substitui o `prepareData hell` do Foundry com detecção de ciclos em build.
- Motor de effects data-driven unificado, discriminado por `type` (MVP: `flatModifier`, `setProperty`, `damageDice` estático, `note`, `iwr`); modificadores são factory functions deferidas avaliadas no momento do roll com predicados sobre roll options (`Set<string>`).
- Sheets são **componentes Svelte 5 (Runes)** registrados por `(documentType, subtype)` com contexto tipado — sem ApplicationV2/Handlebars.
- Contract test (`validateSystemModule`) como gate de CI obrigatório para os três sistemas; toda a superfície pública é sem `any`.

**No MVP:** Manifest, `SystemDataModel` Zod, derivação topológica, motor de effects com 5 tipos canônicos, hooks tipados de lifecycle/combate/roll, sheets Svelte, condições, QuickActions, settings Zod, i18n e migrações versionadas.
**Fica para V2:** Effects plugáveis por sistema, carregamento dinâmico de sistemas de terceiros, tipos `rollOption`/`adjustDegreeOfSuccess`/`grantItem`.

> Spec completa: [15-api-de-sistemas.md](15-api-de-sistemas.md)

---

## 16 — Compendiums e Importação de Dados

**O que define:** O subsistema de compendium packs do Fusion — formato de armazenamento, indexação lazy, browser de UI e o pipeline offline `tools/importer-pf2e` que converte os JSONs do repositório `foundryvtt/pf2e` (Apache-2.0/ORC) para packs Fusion versionados.

**Decisões-chave:**
- Um arquivo SQLite `pack.db` por pack (mesmo schema do `world.db`), com índice leve em memória via `json_extract` para browse sem carregar documentos completos; swap atômico no re-import.
- `_id` de origem preservado nos packs do sistema para UUID de compendium estável (`Compendium.<packId>.<Type>.<id>`); novo `_id` gerado apenas ao importar para o mundo.
- Pipeline 100% offline (build-time): extrai JSON do repo `foundryvtt/pf2e` ou usa `foundryvtt-cli unpack`, converte schema campo a campo, mapeia Rule Elements para `ModifierDescriptor` com tabela de cobertura declarativa (`supported/partial/unsupported`); REs sem conversor preservados em `flags.fusion.unconvertedRules`.
- Nenhuma arte da Paizo é copiada — toda referência de imagem recebe placeholder livre (Game-icons.net/Kenney); manifesto `pack.json` carrega licença por pack (ORC/OGL/CC0).
- Packs do Etmos são criados à mão (sem importador automático) e empacotados pelo mesmo packer.

**No MVP:** Packs PF2e gerados pelo importer com cobertura de REs de alto valor (FlatModifier, AELike, RollOption, GrantItem, Note, Sense, BaseSpeed, TempHP, MartialProficiency); browser com busca textual e filtros por tipo/traits/level; drag para canvas e fichas; importação com remapeamento de links internos.

**Fica para V2:** Índice persistido no `pack.db`, importação recursiva automática de árvore de grants, filtros avançados compostos, suporte completo a REs complexos (Aura, BattleForm, DamageAlteration), e importação de mundos completos do Foundry.

> Spec completa: [16-compendiums-e-importacao.md](16-compendiums-e-importacao.md)

---

## 17 — Sistema Pathfinder 2e (Remaster)

**O que define:** O pacote `systems/pf2e` do Fusion — schemas Zod por `(documentType, subtype)`, automação mecânica do PF2e Remaster e fichas Svelte 5 — mais o núcleo `systems/engine-2e` compartilhado com SF2e.

**Decisões-chave:**
- Núcleo `systems/engine-2e` separado (degree of success, modifier stacking de 7 tipos, TEML, condições base, dying/wounded, IWR, MAP) consumido por PF2e e SF2e sem fork; o que é PF2e-específico (16 skills, runas, traditions) fica em `systems/pf2e`.
- Dados derivados calculados em `prepareData` em 4 fases (`prepareBaseData → prepareItems → collectModifiers → prepareDerived`), nunca persistidos no `_source`; determinismo garantido e execução idêntica no servidor (autoritativo) e no cliente (UX reactivo).
- Motor de modifiers reduzido no MVP: `Effect/Feat/Condition` carrega array `modifiers[]` estáticos (FlatModifier-like) e `grantedConditions[]`; motor completo de Rule-Elements-like (GrantItem, ChoiceSet, Aura, BattleForm) é [V2].
- Apply damage com pipeline IWR centralizado no servidor (Immunity → Weakness → Resistance) com breakdown auditável; condições como itens embedded com `slug` e `value` e efeitos mecânicos automáticos para ~15 condições priorizadas.
- 4 Actor subtypes MVP (`character`, `npc`, `hazard`, `loot`) e ~16 Item subtypes MVP, com 36 requisitos funcionais cobrindo proficiência/AC/HP/strikes/MAP/saves/dying/spellcasting/IWR/runas/bulk.

**No MVP:** Sessão jogável de PF2e completa: character sheet em abas, NPC sheet enxuta, strikes com MAP, saves básicos, condições mecânicas, dying/recovery, spellcasting por slots, iniciativa por Perception, runas fundamentais e apply damage com IWR.

**Fica para V2:** Motor de RE completo (GrantItem/ChoiceSet/Aura/BattleForm), AdjustDegreeOfSuccess dinâmico, heightening manual automático, counteract, runas de propriedade, character builder com ChoiceSet, exploração/downtime/crafting.

> Spec completa: [17-sistema-pf2e.md](17-sistema-pf2e.md)

---

## 18 — Sistema Starfinder 2e

**O que define:** O pacote `systems/sf2e` — segundo sistema do Fusion, desenvolvido após o MVP global de PF2e, construído sobre o mesmo `systems/engine-2e` com delta de entidades e mecânicas exclusivas do Starfinder Second Edition.

**Decisões-chave:**
- Motor 2e unificado sem fork: SF2e é extensão pura de `systems/engine-2e`; mecânicas compartilhadas (three-action economy, TEML, degrees of success, condições base) são herdadas integralmente sem sobrescrita.
- Armas Tech usam tiers de qualidade (Commercial→Paragon) em vez de runas para bônus de ataque e dados de dano; armas Analog mantêm o sistema de runas PF2e; armas Tech rastreiam `charges` com ação de Reload.
- Augmentações modeladas como tipo de item `augmentation` dedicado com `bodySlot` obrigatório e limite de 4 não-apex validado via hook `preCreateItem` no servidor (não como EffectRule custom — effects plugáveis são [V2]).
- Moeda como `currency.credits: number` único (sem cp/sp/gp/pp); species = ancestry com `displayName` sobrescrito via i18n; skills exclusivos Computers (INT) e Piloting (DEX) adicionados via `DeriveStep`.
- 8 packs de compendium MVP processados pelo importer `pf2e` estendido (prefixo `sf2e-`): classes, species, equipment, feats, spells, condições, actions e bestiário Alien Core.

**No MVP (SF2-CORE):** Personagens com as 6 classes do Player Core e 10 species, ficha Svelte com aba Augmentations e barra de charges de armas Tech, combate básico via engine 2e, rastreador manual de atunement Solarian.

**Fica para V2:** Ação Aim (Operative) com effects condicionais, automação de atunement Solarian, zonas zero-g no canvas, Starship Combat cinemático (`CombatType = "starship"`), 18 packs restantes, veículos e hacking como hazard.

> Spec completa: [18-sistema-sf2e.md](18-sistema-sf2e.md)

---

## 19 — Sistema Etmos RPG

**O que define:** O pacote `systems/etmos` — terceiro sistema do Fusion (pós-MVP global), implementando o RPG narrativista brasileiro Etmos da Editora Balde Galáctico, com foco no diferencial de combinar Partículas em frases mágicas negociadas GM↔jogador.

**Decisões-chave:**
- Rolagem `2d6+Atributo` com conjunto de graus binário próprio (`success/failure`) — não usa o helper de 4 graus do engine-2e; margem (`total − dc`) e classe de dificuldade (Simples/Fácil/Mediano/Árduo/Difícil) são metadados separados.
- Compositor de Magias como máquina de estados (`proposta → arbitrada → rolada → resolvida`) sobre `ChatMessage` com flag de estado; Complexidade da Frase é sempre **arbitrada pelo Narrador** (9 parâmetros subjetivos do SRD), nunca inferida automaticamente; custos de Estresse e estados de Fadiga são 100% determinísticos e automatizados.
- 81 Partículas canônicas (18 Funções, 19 Objetos, 34 Características, 10 Complementos) como compendium criado à mão — sem importador automático; glifos rúnicos proprietários substituídos por placeholders tipográficos no MVP (questão de licença aberta com a editora).
- Iniciativa `2d6+Corpo` com desempate implementado em `compare(a, b)` da `InitiativeFormula` (jogadores sempre vencem NPCs em empate; entre jogadores, maior Corpo vence) — não como `tiebreaker` numérico monotônico.
- Lacunas de regra degradam para controles manuais editáveis, nunca para regra inventada (Complexidade, Pontos de Importância, efeito de Origens custom).

**No MVP (ETM-CORE):** Ficha de Orador com atributos/derivados/trilhas de Marcos clicáveis, trackers de Ferimentos/Estresse/Fadiga, Compositor de Magias completo (proposta→resolução), rolagens 2d6, iniciativa e combate básico, compendium de Partículas.

**Fica para V2:** Modo baralho de Grimório (cartas arrastáveis), calculadora de Encantamento com tracker de progresso, mecânica de Descanso automatizada, frases mágicas salvas como favoritos.

> Spec completa: [19-sistema-etmos.md](19-sistema-etmos.md)

---

## 20 — Assets e Mídia

**O que define:** O subsistema de armazenamento, upload, processamento e serving de arquivos de mídia (imagens, vídeo, áudio), incluindo o Asset Browser na UI e a integração com Documents via `AssetRef`.

**Decisões-chave:**
- **Dois escopos de storage**: biblioteca compartilhada (`fusion-data/assets/`) e pasta privada por world (`fusion-data/worlds/<slug>/assets/`), indexados em um único banco `assets.db` de instalação.
- **Deduplicação por SHA-256** com nome amigável preservado — sem CAS puro; thumbnails 256×256 WebP gerados server-side com `sharp` no momento do upload.
- **Cache HTTP imutável** via digest SHA-256 no path (`Cache-Control: immutable, max-age=31536000`); serving via `@fastify/static` com proteção automática contra path traversal.
- **SVG sanitizado** obrigatoriamente (remove `<script>`, event handlers, refs externas) antes de armazenar — fonte de verdade delegada à spec 21.
- Conversão automática para WebP é **opt-in** (`autoConvertWebp` em `fusion.json`); limites de upload configuráveis (imagem 50 MB, vídeo 500 MB, áudio 100 MB).

**No MVP:** Upload com validação por magic bytes, deduplicação, thumbnail, serving estático, Asset Browser com drag-and-drop, busca full-text, catálogo de placeholders livres (Game-icons.net CC BY 3.0 / Kenney CC0) com `placeholders.map.json`.

**Fica para V2:** S3/CDN remoto, upload via URL, thumbnail de vídeo via ffmpeg, conversão automática WebP, tags no Asset Browser e sincronização entre GMs co-autores.

> Spec completa: [20-assets-e-midia.md](20-assets-e-midia.md)

---

## 21 — Segurança

**O que define:** O modelo de ameaça transversal do Fusion e as defesas em profundidade que todas as demais specs devem honrar — autenticação, autorização, sanitização, filesystem, exposição à internet, sandbox e logging de segurança (92 requisitos + 13 critérios de aceitação).

**Decisões-chave:**
- **Servidor autoritativo + AuthZ server-side por operação**: zero confiança no cliente; nenhum proxy genérico `executeAsGM`; toda permissão revalidada no momento de execução.
- **Argon2id** para senhas (memory≥65536 KiB, iterations≥3) + refresh token `httpOnly SameSite=Strict` com rotação e reuse detection; lockout 5 falhas/15 min.
- **Sanitização dupla**: `sanitize-html` server-side + `DOMPurify` client-side em todo HTML rico; chat sem HTML arbitrário (cards declarativos + markdown).
- **Uploads**: renome aleatório + magic bytes (`file-type`) + `path.resolve` confinado + diretórios segregados por papel + limites de tamanho e quota.
- **CSP estrita** com nonce criptográfico por request; sem `unsafe-inline`/`unsafe-eval` em produção; CSWSH mitigado por validação de `Origin` + token explícito; macros via `isolated-vm` **[V2]**, desabilitadas por padrão.

**No MVP:** Todos os controles de AuthN/AuthZ, sanitização, filesystem, headers de segurança, rate limiting (≤50 msg/s) e logging estruturado de eventos de segurança.

**Fica para V2:** Sandbox `isolated-vm` para script macros do GM, modo quarentena de packs não-oficiais e allowlist de fetch externo (SSRF).

> Spec completa: [21-seguranca.md](21-seguranca.md)

---

## 22 — Instalação e Distribuição

**O que define:** Como o Fusion é empacotado, distribuído, instalado e atualizado na máquina do GM — desde o binário autocontido até o wizard de primeira execução, auto-update, conectividade de rede e pipeline CI/CD.

**Decisões-chave:**
- **MVP headless**: servidor Node.js compilado em executável autocontido por plataforma via `@yao-pkg/pkg` (Win x64, macOS x64/ARM64, Linux x64); wrapper **Tauri v2** com tray icon adiado para V2.
- **Porta padrão 33000** (evita conflito com Foundry na porta 30000); UPnP desabilitado por padrão; Cloudflare Tunnel (`cloudflared`) como opção de compartilhamento WAN sem port-forwarding.
- **Dois planos de autenticação independentes**: Admin Key (plano de instalação, protege `/setup`, hash Argon2id em `Config/fusion.json`) e JWT de usuário GAMEMASTER (plano de mundo, protege endpoints de jogo).
- **Auto-update headless**: verifica GitHub Releases API ao iniciar; backup de cada world (SQLite Online Backup API) antes de aplicar update; verifica SHA-256 do binário baixado; fallback para `.bak` em caso de falha.
- **Code signing** via Azure Artifact Signing (Windows) e Apple Developer (macOS); sem signing no MVP headless — aplicado na distribuição pública estável.

**No MVP:** Wizard de primeira execução (data directory, porta, Admin Key), detecção de IP LAN com QR code, estrutura canônica do data directory, protocolo de versão no handshake WebSocket e pipeline CI em GitHub Actions.

**Fica para V2:** Wrapper Tauri v2 (NSIS/DMG/AppImage), tray icon, join token com expiração, mDNS/Bonjour, UPnP automático e Cloudflare Tunnel integrado na UI.

> Spec completa: [22-instalacao-e-distribuicao.md](22-instalacao-e-distribuicao.md)

---

## 23 — Acessibilidade e Dispositivos

**O que define:** Metas de conformidade WCAG 2.2 AA para a UI HTML, estratégia de acessibilidade do canvas via overlay DOM do PixiJS, suporte a tablets touch como modo de jogo de primeira classe e toggles de qualidade gráfica para hardware fraco.

**Decisões-chave:**
- **WCAG 2.2 AA para toda UI HTML** (Svelte); canvas adopta "acessibilidade via alternativas" — PixiJS Accessibility System (overlay DOM com `role`/`aria-label`/`tabindex` sobre tokens) + Lista de Tokens navegável + Combat Tracker totalmente operável por teclado.
- **Pointer Events API exclusiva** no canvas (sem `MouseEvent`/`TouchEvent` diretos); `touch-action: none` + listeners `{ passive: false }` para iOS Safari; gestos fundamentais no MVP: arrastar token, pinch-zoom, pan 2 dedos, tap para selecionar.
- **Dois modos de layout** detectados via `MediaQuery` reativa do Svelte 5: desktop (completo) e tablet (`pointer: coarse` + ≤1024px) — canvas fullscreen, sidebar colapsável, sheets como bottom drawers, FAB, hit targets ≥44px.
- **`100dvh` + `viewport-fit=cover`** para altura sem overflow em Safari/iOS; `safe-area-inset-*` para notch/home bar.
- **Toggles de qualidade gráfica** independentes por usuário: `lights.animated`, `fog.quality` (`full`/`simplified`/`off`), `canvas.resolution` (cap 2.0), `canvas.antialias`, portraits animados e partículas; `prefers-reduced-motion` respeitado automaticamente.

**No MVP:** Conformidade AA completa na UI, PixiJS a11y system habilitado, gestos touch fundamentais, layout tablet, toggles de performance, `KeybindingRegistry` com defaults fixos e zero falhas axe-core no CI.

**Fica para V2:** Modo companion para telefones (< 640px), remapeamento de atalhos pelo usuário, suporte a stylus (Apple Pencil) e PWA com Service Worker.

> Spec completa: [23-acessibilidade-e-dispositivos.md](23-acessibilidade-e-dispositivos.md)

---

## 24 — Operação, Backups e Telemetria

**O que define:** Como o Fusion opera de forma contínua e confiável: backups automáticos e manuais do `world.db`, política de retenção e restauração, logging estruturado, auditoria de ações sensíveis, telemetria estritamente local e monitoramento de latência por jogador visível ao GM.

**Decisões-chave:**
- Backup via **SQLite Online Backup API** (`db.backup()` do better-sqlite3): único modo que combina backup online sem bloqueio de escritas e consistência atômica; `VACUUM INTO` e cópia direta rejeitados.
- **Sem telemetria externa por padrão**: `diagnostics.json` permanece local; transmissão a Sentry SaaS é opt-in exclusivo via variável de ambiente `FUSION_SENTRY_DSN`; autossuficiência total sem Docker adicional.
- **Pino + pino-roll** para logging estruturado (2,4× mais rápido que Winston, portátil nos três SOs); log de auditoria em arquivo separado (`audit.log`), inacessível a jogadores.
- **Export JSON** canônico [V2] como camada complementar humano-legível para inspeção e versionamento em git; backup binário `.db` é o caminho de restauração rápido.
- **Litestream** documentado como opção avançada opt-in, sem mudança de código (RPO < 30 min é nicho minoritário).

**No MVP:** Backup automático a cada 30 min, pre-event backup antes de migrations/updates, retenção dos 10 mais recentes, integrity check na abertura, logging com rotação diária, painel de latência por jogador (verde/amarelo/vermelho) e bundle de diagnóstico exportável sem PII.
**Fica para V2:** Export JSON canônico, histogramas de latência por sessão e integração documentada do Litestream.

> Spec completa: [24-operacao-backups-telemetria.md](24-operacao-backups-telemetria.md)

---

## 25 — Testes e Qualidade

**O que define:** Estratégia completa de testes do Fusion: pirâmide unit→integration→E2E, golden tests do motor de regras PF2e/SF2e com casos rastreados ao research doc, suíte de conformidade da system API, testes do importer, pipeline CI/CD e performance budgets.

**Decisões-chave:**
- **Vitest** como framework unit/integration (suporte nativo a ESM sem transpilação, 2–5× mais rápido que Jest, API compatível); **Playwright** para E2E com múltiplos contextos de browser simultâneos (GM + N jogadores) — Cypress rejeitado por fraqueza com canvas WebGL e múltiplas abas.
- **`window.__fusion_test_api__`** exposto em modo de teste para asserções de estado interno do canvas, eliminado por tree-shaking do Vite em produção (nunca chega ao bundle do usuário).
- **Golden tests PF2e** (~7 arquivos MVP): DoS, MAP, IWR, condições numéricas, Dying/Recovery, persistent damage — cada caso com comentário citando a seção do research doc 13 para rastreabilidade.
- **Cobertura mínima 80%** aplicada a `packages/shared` e `systems/*/src/rules/**`; 60% para `packages/server`; motor de regras puro isolado de DOM/socket por lint rule (`no-restricted-imports`).
- **Artillery + `artillery-engine-socketio-v3`** para carga multiplayer [V2]; regressão visual do canvas com pixelmatch [V2] (não determinística entre GPUs no CI atual).

**No MVP:** CI com lint, typecheck, unit e integration em < 5 min; golden tests PF2e completos; suíte de conformidade para pf2e e sf2e; snapshot do importer; E2E de fluxo completo (GM + 2 jogadores); boot do servidor < 3 000 ms.
**Fica para V2:** Testes de carga Artillery, regressão visual do canvas e golden tests SF2e.

> Spec completa: [25-testes-e-qualidade.md](25-testes-e-qualidade.md)

---

## 26 — Licenças e Aspectos Legais

**O que define:** Postura legal completa e operacional do Fusion em quatro eixos: clean-room frente ao Foundry VTT, uso de mecânicas PF2e/SF2e sob ORC/OGL, regime do sistema Etmos (direitos reservados), e licença da engine com inventário de dependências.

**Decisões-chave:**
- **Clean-room estrita**: equipe estuda apenas documentação pública, comportamento observável e código Apache-2.0 do `foundryvtt/pf2e`; membros que possuem licença do Foundry core não implementam módulos correspondentes.
- **ORC License exclusiva** para mecânicas PF2e/SF2e (prioridade ao remaster); Fan Content Policy e Community Use Policy **expressamente vetadas** (excluem rules compendiums e character generators). Três notices obrigatórios em todo release: ORC Notice (TX 9-307-067) + Attribution + Reserved Material.
- **Arte Paizo proibida** sem exceção; pipeline substitui toda referência por placeholders de fontes livres (Game-icons.net CC-BY, Kenney.nl CC0); lore/setting descartado na importação.
- **Etmos = direitos reservados** presumidos (SRD sem licença aberta): uso privado do grupo OK; distribuição do pacote `systems/etmos` bloqueada por gate técnico no build até autorização escrita da Balde Galáctico.
- **Licença da engine**: privada por padrão; se aberta, MIT apenas para o código — packs de dados excluídos do escopo MIT e separados fisicamente com metadados de licença próprios.

**No MVP:** Postura clean-room declarada, gate técnico do Etmos em builds públicos, checklist legal por release automatizado no CI (brand scan, art audit, NOTICE check).
**Fica para V2:** Auditoria periódica de dependências acompanhando novos releases do `foundryvtt/pf2e`; contato formal com a Balde Galáctico.

> Spec completa: [26-licencas-e-legal.md](26-licencas-e-legal.md)

---

## 27 — Roadmap e Milestones

**O que define:** Fases de entrega M0–M6, grafo de dependências, caminho crítico e Definition of Done verificável de cada marco — convertendo as tags [MVP]/[V2] das 26 specs irmãs em sequência coerente de implementação.

**Milestones:**
- **M0 — Fundação** (G): monorepo, servidor Fastify+socket.io, SQLite WAL, auth, system API mínima, CI base.
- **M1 — Mesa mínima** (GG): canvas PIXI v8, tokens, rede em tempo real, chat, motor de rolagens autoritativo — maior marco de engenharia de base.
- **M2 — Visão, fog e combate** (G): visibility polygon, fog of war, paredes, iluminação, combat tracker e iniciativa via `InitiativeFormula`.
- **M3 — System API + engine-2e + PF2e + importer** (GG): **primeira sessão jogável** — fichas funcionais, strikes/saves/IWR automatizados, condições, spellcasting, compendium importado.
- **M4 — SF2e + qualidade** (G): sistema Starfinder 2e sobre `engine-2e`, golden tests, hardening de segurança, backups e documentação mínima.
- **M5 — Etmos** (G): sistema Etmos RPG do zero + Compositor de Magias; valida generalidade da system API.
- **M6 — Distribuição e polish** (M→G): wrapper Tauri, auto-update, múltiplos worlds, túnel WAN, A/V WebRTC.

**Primeira sessão jogável ocorre em M3** (release `0.1.0`). Caminho crítico linear: `M0 → M1 → M2 → M3`; após M3, M4/M5/M6 ramificam em paralelo.

> Spec completa: [27-roadmap-e-milestones.md](27-roadmap-e-milestones.md)

---

## Questões em aberto (decisões pendentes)

1. **SF2e (M4)** — confirmar status de publicação do Starfinder 2e e disponibilidade dos dados abertos sob ORC no repo `foundryvtt/pf2e`.
2. **Etmos (M5)** — autorização da Editora Balde Galáctico para distribuir o sistema e os glifos rúnicos (bloqueia publicação; uso privado do grupo é livre).
3. **Importer** — validar se todos os `_id` dos JSONs do pf2e cabem no formato nanoid-16 e definir remapeamento estável de `@UUID`.
4. **Performance (M2)** — medir o limiar de paredes/cena a partir do qual o cálculo de visão migra para Web Worker.
5. **Concorrência (antes do M2)** — política para edições simultâneas (combat tracker, movimento do mesmo token); last-writer-wins não basta.
6. **Escopo da 1ª sessão** — o grupo precisa de journals e hotbar de macros já na primeira sessão? (hoje alocados no M4).
7. **Empacotamento (M6)** — better-sqlite3 vs `node:sqlite` nativo; reavaliar antes do wrapper Tauri.
8. **Anti-cheat de visão** — polígono de visão calculado no servidor (seguro) vs no cliente (rápido); compartilhar geometria em `packages/shared`.
9. **Secrets** — filtrar conteúdo secreto no servidor (recomendado) vs apenas ocultar no cliente.
10. **PF2e MVP** — suportar níveis 1–5 ou 1–20 na primeira versão? Darkness por região já no MVP?
11. **Marca** — verificar colisão do nome "Fusion" (INPI/USPTO) antes de qualquer distribuição pública.
