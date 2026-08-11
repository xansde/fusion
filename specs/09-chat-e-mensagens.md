# 09 — Chat e Mensagens

- **Título:** Chat e Mensagens
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/05-foundry-dice-chat.md` — estrutura do ChatMessage, roll modes, comandos, chat cards, flags de sistema, chat bubbles
  - `docs/research/09-foundry-funcionalidades-mesa.md` — expectativas de usuário, notificações, QoL

---

## Objetivo

Especificar o subsistema de chat do Fusion: o modelo de dados do documento `ChatMessage`, os tipos de mensagem e seus estilos de exibição, os comandos de chat (roll, whisper, emote e extensíveis por sistema), o sistema de chat cards declarativos para ações interativas de sistemas, as regras de visibilidade (roll modes), a sanitização de conteúdo, o log persistente, a busca/paginação e as notificações (som, badge).

Esta spec cobre **o canal de comunicação de jogo**, não o protocolo de transporte (ver `04-rede-e-sincronizacao.md`), nem o motor de rolagens em si (ver `08-motor-de-rolagens.md`), nem o sistema de permissões que restringe o envio de whispers ou a leitura de blind rolls (ver `05-usuarios-e-permissoes.md`).

---

## Escopo

### O que inclui

- Modelo de dados do documento `ChatMessage` com todos os campos tipados.
- Cinco tipos de mensagem: `text`, `roll`, `emote`, `whisper`, `system`.
- Quatro roll modes (`public`, `gmroll`, `blindroll`, `selfroll`) mapeados em campos de visibilidade.
- Comandos de chat: `/roll`, `/gmroll`, `/blindroll`, `/selfroll`, `/w`, `/emote`, `/ic`, `/ooc` e mecanismo de registro de comandos customizados por sistema.
- Chat cards declarativos: schema JSON (sem HTML arbitrário), renderização pelo cliente, botões com ações tipadas.
- Inline rolls imediatos `[[fórmula]]` e deferred rolls `[[/r fórmula]]`.
- Referências de documento por `@UUID[...]` com tooltip ao passar o mouse.
- Markdown leve (bold, italic, código inline, links, listas), emoji Unicode, menções de usuário.
- Sanitização de conteúdo (estratégia de allowlist; delegar regras de segurança a `21-seguranca.md`).
- Log persistente por mundo (tabela SQLite), paginação por cursor, virtual scroll no cliente.
- Busca full-text simples no log (SQLite FTS5).
- Export do log em JSON e texto plano pelo GM.
- Flush (limpeza) do log pelo GM.
- Notificações: som ao receber mensagem, badge de mensagens não lidas.
- Chat bubbles sobre tokens in-character/emote [MVP simplificado].
- Pop-out do chat em janela separada [V2].

### O que NÃO inclui

- Motor de parsing de fórmulas de dados — ver `08-motor-de-rolagens.md`.
- Regras de autoridade do servidor e envelope de socket — ver `04-rede-e-sincronizacao.md`.
- Política de permissões (quem pode ver whisper, quem pode fazer blind roll) — ver `05-usuarios-e-permissoes.md`.
- Áudio de playlists e sons ambientes — ver `13-audio-e-playlists.md`.
- Macros (`/macro`) — ver `14-macros-e-automacao.md`.
- Internacionalização de strings de UI — fora do escopo desta spec; `i18n` é assumido como transversal.
- Chat de voz/vídeo (A/V WebRTC) — fora do MVP; ver `00-visao-e-escopo.md`.

---

## Conceitos e terminologia

| Termo              | Definição                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChatMessage**    | Document persistido no `world.db`, representando uma mensagem no log de chat.                                                                                       |
| **MessageType**    | Discriminador semântico do ChatMessage: `text`, `roll`, `emote`, `whisper`, `system`.                                                                               |
| **Roll mode**      | Política de visibilidade de uma rolagem: `public`, `gmroll`, `blindroll`, `selfroll`. Mapeado em `whisper[]` e `blind` no documento.                                |
| **Speaker**        | Objeto embeddido que identifica o remetente efetivo: pode ser o User, um Actor ou um Token alias.                                                                   |
| **Chat card**      | Mensagem do tipo `system` ou `roll` que carrega um payload `CardData` — schema JSON declarativo renderizado pelo cliente como cartão interativo com botões de ação. |
| **CardAction**     | Ação tipada associada a um botão de card. É serializada como string de tipo + payload JSON, executada pelo sistema registrado ao clicar.                            |
| **Inline roll**    | Expressão `[[fórmula]]` avaliada imediatamente ao enviar a mensagem; resultado substituído inline no conteúdo.                                                      |
| **Deferred roll**  | Expressão `[[/r fórmula]]` renderizada como botão clicável que dispara uma rolagem ao clicar.                                                                       |
| **@UUID**          | Referência portável a qualquer Document: `@UUID[ActorType.id]{Label}`. Renderizada como link clicável com tooltip.                                                  |
| **Whisper**        | Mensagem visível apenas a destinatários explícitos (array de User IDs) + todos os GMs.                                                                              |
| **Blind roll**     | Rolagem cujo resultado é visível apenas para GMs; o jogador que rolou vê apenas a mensagem de confirmação.                                                          |
| **Virtual scroll** | Técnica de renderização que mantém somente as mensagens visíveis no DOM, não todo o histórico.                                                                      |
| **FTS5**           | Extensão de full-text search do SQLite, usada para busca no log de chat.                                                                                            |
| **Chat bubble**    | Balão visual temporário exibido acima de um token no canvas para mensagens IC e emotes.                                                                             |

---

## Decisões

### DEC-CHT-01: ChatMessage é um Document persistido, não estado efêmero

**Decisão:** `ChatMessage` segue o padrão Document do Fusion (ver `02-modelo-de-dados.md`): persiste em SQLite, recebe `_id` único, é sincronizado via WebSocket para todos os clientes elegíveis com o mesmo envelope CRUD de outros Documents.

**Alternativas rejeitadas:**

- _Mensagens como eventos efêmeros (não persistidos):_ perderia o histórico ao recarregar; impossibilita export e busca.
- _Tabela separada fora do modelo Document:_ quebraria a consistência do modelo de sincronização e permissões.

**Racional:** Consistência arquitetural com o restante do sistema. Log persistente é expectativa não-negociável de usuários de VTT.

---

### DEC-CHT-02: Roll modes mapeados em campos `whisper` e `blind`

**Decisão:** Os quatro roll modes mapeiam diretamente em dois campos booleanos/array do documento:

| Roll mode   | `whisper`        | `blind` |
| ----------- | ---------------- | ------- |
| `public`    | `[]`             | `false` |
| `gmroll`    | `[...gmUserIds]` | `false` |
| `blindroll` | `[...gmUserIds]` | `true`  |
| `selfroll`  | `[authorId]`     | `false` |

O servidor popula `whisper` com os IDs reais antes de persistir. O campo `blind` instrui o servidor a não incluir o payload de rolagem no broadcast para clientes não-GM.

**Alternativas rejeitadas:**

- _Enum de roll mode persistido:_ seria necessário um campo extra; os dois campos existentes já expressam a semântica completa.

**Racional:** Modelo derivado da pesquisa do Foundry VTT (seção 8 de `05-foundry-dice-chat.md`), representação simples e verificável.

---

### DEC-CHT-03: Chat cards são schemas JSON declarativos — sem HTML arbitrário

**Decisão:** Sistemas registram chat cards via um schema tipado `CardData` em JSON. O cliente Svelte renderiza o card a partir deste schema usando um componente `<ChatCard>` controlado. Sistemas **não** podem injetar HTML arbitrário em `content` — apenas markdown leve sanitizado.

**Alternativas rejeitadas:**

- _HTML arbitrário em `content` (modelo do Foundry):_ vetor de XSS; requer sanitização complexa e frágil com DOMPurify. O Foundry paga esse custo e ocasionalmente tem CVEs relacionados.
- _Web Components por sistema:_ requer execução de código de sistema no cliente sem sandboxing adequado no MVP.

**Racional:** Segurança em primeiro lugar. O schema declarativo é suficiente para 100% dos casos de uso previstos (ver seção API e eventos). Extensões que precisarem de UI mais rica podem usar a API de painel lateral [V2].

---

### DEC-CHT-04: Comandos de chat são registrados em um registry extensível

**Decisão:** Existe um `CommandRegistry` no servidor que mapeia prefixo de string para handler. Comandos built-in (`/roll`, `/w`, etc.) são registrados na inicialização. Sistemas podem registrar comandos adicionais via `SystemAPI.registerChatCommand()` (ver `15-api-de-sistemas.md`).

**Alternativas rejeitadas:**

- _Lista hardcoded de comandos:_ impede que sistemas adicionem ataques rápidos via `/strike`, saves via `/save`, etc.

**Racional:** Extensibilidade necessária para PF2e, SF2e e Etmos. Comandos de sistema rodam no servidor, garantindo que validação e RNG permaneçam autoritativos.

---

### DEC-CHT-05: Sanitização por allowlist no servidor antes de persistir

**Decisão:** Todo conteúdo textual de mensagens passa por uma etapa de sanitização no servidor antes de ser persistido e distribuído. A sanitização usa uma allowlist de elementos/atributos Markdown/HTML leve (parágrafo, bold, italic, código, link http/https, lista não-ordenada). Tags não permitidas são stripped. O card declarativo nunca passa por este pipeline — é renderizado via componente Svelte controlado.

**Racional:** Delegar a regras de segurança detalhadas a `21-seguranca.md`, mas a decisão arquitetural de sanitizar no servidor (não apenas no cliente) é feita aqui para garantir que mensagens persistidas sejam sempre seguras.

---

### DEC-CHT-06: Paginação por cursor, não por offset

**Decisão:** O carregamento do log usa paginação por cursor (campo `_id` como cursor, `ORDER BY timestamp DESC`), não por `LIMIT/OFFSET`. O cliente carrega as N mensagens mais recentes na abertura; ao rolar para cima, solicita o próximo bloco antes do cursor mais antigo visível.

**Alternativas rejeitadas:**

- _OFFSET:_ desempenho degrada com tabelas grandes (O(n) no SQLite).
- _Carregar todo o histórico:_ inviável para mundos com milhares de mensagens.

**Racional:** Eficiência. SQLite com índice em `(worldId, timestamp)` mantém cursor O(log n).

---

### DEC-CHT-07: Busca full-text via SQLite FTS5

**Decisão:** Uma tabela FTS5 (`chat_fts`) é mantida em sincronia com a tabela principal via triggers. Busca de texto livre é roteada para `chat_fts MATCH ?`. Resultados são paginados (máx 50 por página).

**Alternativas rejeitadas:**

- _LIKE '%termo%':_ full table scan; sem ranking de relevância.
- _Motor de busca externo (Meilisearch, etc.):_ dependência extra desnecessária para escala esperada (um mundo de VTT raramente tem mais de 100 k mensagens).

---

### DEC-CHT-08: Inline rolls avaliados no servidor, resultado embutido no documento

**Decisão:** Ao processar uma mensagem com `[[fórmula]]`, o servidor extrai, avalia via motor de rolagens (ver `08-motor-de-rolagens.md`) e substitui a expressão pelo span de resultado antes de persistir. O documento final armazena o resultado; não há reavaliação no cliente.

**Racional:** RNG autoritativo. Clientes recebem o documento já com os resultados embutidos — consistência garantida entre todos os clientes.

---

### DEC-CHT-09: Chat bubbles com duração fixa no MVP

**Decisão:** Chat bubbles são renderizadas no canvas como overlays SVG acima do token, com duração padrão de 5 segundos (não configurável no MVP). Texto truncado após 120 caracteres com `…`. Visibilidade segue a visibilidade do token.

**Alternativas rejeitadas:**

- _Duração configurável por mundo:_ deixada para V2 para simplificar o MVP.
- _Balões com estilo CSS completo:_ SVG controlado é mais simples de integrar com PIXI.js (ver `06-canvas-e-renderizacao.md`).

---

### DEC-CHT-10: Revelação é mutação persistida da mensagem, não reemissão efêmera

**Decisão:** Revelar uma mensagem privada já enviada (rolagem em `gmroll`/`blindroll`/`selfroll`, ou sussurro) **reescreve o documento persistido**: `whisper` volta a `[]`, `blind` volta a `false`, e a mensagem carimba `revealedBy` (quem revelou) e `revealedAt` (quando). Só depois da escrita o servidor reemite a mensagem, socket a socket.

A consequência é a razão da decisão: a visibilidade do chat é lida por **três** caminhos independentes — o broadcast ao vivo, o `chat:history` e o snapshot de entrada no mundo — e todos derivam a mesma resposta dos mesmos dois campos (`whisper`, `blind`). Mudando os campos, os três passam a concordar **sem nenhum predicado novo**: revelação não é um quarto conceito de visibilidade, é o estado `public` que a DEC-CHT-02 já define.

**Alternativas rejeitadas:**

- _Reemitir a mensagem de forma efêmera só no broadcast:_ quem estava conectado veria a rolagem, mas o documento continuaria privado — a mensagem sumiria de novo no primeiro reload, e nunca apareceria para quem entrasse depois. Visibilidade que não sobrevive ao F5 não é revelação, é ilusão.
- _Usar o `doc:update` genérico de documentos:_ o `ChatMessage` do servidor é uma segunda cópia divergente do schema compartilhado; o broadcast de `doc:update` não filtra `whisper`/`blind`, então o próprio update vazaria a rolagem cega para a mesa no instante em que fosse emitido — e o cliente sequer escuta `doc:update` de `ChatMessage`. O chat mantém seu próprio caminho de emissão até que as duas cópias do schema sejam unificadas.
- _Persistir um campo `revealed: boolean` mantendo `whisper`/`blind` intactos:_ criaria um terceiro predicado de visibilidade a ser replicado nos três caminhos de leitura — exatamente o defeito que esta decisão evita.

**Racional:** a revelação tem que valer para o mundo inteiro e para sempre, não para quem estava com a aba aberta. Reaproveitar `whisper`/`blind` mantém um único predicado de visibilidade; os campos de auditoria existem para a UI dizer que aquilo foi revelado pelo narrador, nunca para decidir quem vê.

---

## Requisitos funcionais

### Modelo e persistência

**REQ-CHT-001** [MVP] O servidor DEVE persistir toda `ChatMessage` no `world.db` antes de fazer broadcast para clientes.

**REQ-CHT-002** [MVP] Cada `ChatMessage` DEVE ter um `_id` UUID v4 único, imutável após criação.

**REQ-CHT-003** [MVP] O servidor DEVE sincronizar novas mensagens para todos os clientes elegíveis via evento socket.io `document:create` no namespace do mundo (ver `04-rede-e-sincronizacao.md`).

**REQ-CHT-004** [MVP] O servidor DEVE aplicar as regras de visibilidade (campo `whisper`, `blind`) ao fazer broadcast: mensagens com `whisper` são enviadas apenas aos sockets dos User IDs listados; se `blind=true`, o payload de rolagem é omitido do broadcast para clientes não-GM.

**REQ-CHT-005** [MVP] O GM DEVE poder deletar mensagens individuais do log; a deleção é propagada a todos os clientes via `document:delete`.

**REQ-CHT-006** [MVP] O GM DEVE poder fazer flush (limpeza total) do log de chat do mundo; a operação trunca a tabela principal e a FTS5, e emite evento `chat:flush` para todos os clientes limparem o painel.

### Tipos de mensagem e estilos

**REQ-CHT-007** [MVP] O sistema DEVE suportar os cinco `MessageType`: `text` (mensagem de texto livre), `roll` (resultado de rolagem com dados serializados), `emote` (ação do personagem), `whisper` (mensagem privada), `system` (mensagem gerada pelo sistema/motor, incluindo chat cards).

**REQ-CHT-008** [MVP] Mensagens do tipo `text` com prefixo `/ooc` ou sem prefixo especial DEVEM ser estilizadas como out-of-character (borda na cor do jogador).

**REQ-CHT-009** [MVP] Mensagens do tipo `text` com prefixo `/ic` DEVEM ser estilizadas como in-character (nome do personagem como remetente).

**REQ-CHT-010** [MVP] Mensagens do tipo `emote` DEVEM exibir o alias do speaker em itálico seguido do texto da ação (ex.: _Aenora examina a sala com cuidado_).

**REQ-CHT-011** [MVP] Mensagens do tipo `whisper` DEVEM exibir indicador visual diferenciado (ex.: ícone de envelope) e listar os destinatários visíveis ao autor.

**REQ-CHT-012** [MVP] Mensagens do tipo `system` DEVEM ter fundo diferenciado indicando origem do sistema de jogo.

### Comandos de chat

**REQ-CHT-013** [MVP] O cliente DEVE reconhecer os seguintes comandos built-in digitados no input de chat e roteá-los ao servidor para avaliação autoritativa — o cliente apenas faz o parse do prefixo e extrai a fórmula/modo, sem executar RNG localmente (ver `08-motor-de-rolagens.md` REQ-ROL-024 `roll:request`):

| Comando(s)                                                 | Comportamento                       |
| ---------------------------------------------------------- | ----------------------------------- |
| `/roll <fórmula>`, `/r <fórmula>`                          | Roll público                        |
| `/gmroll <fórmula>`, `/gmr <fórmula>`                      | Roll visível ao GM e ao autor       |
| `/blindroll <fórmula>`, `/br <fórmula>`                    | Roll visível apenas ao GM           |
| `/selfroll <fórmula>`, `/sr <fórmula>`                     | Roll visível apenas ao autor        |
| `/w <alvo(s)> <mensagem>`, `/whisper <alvo(s)> <mensagem>` | Mensagem privada                    |
| `/emote <texto>`, `/em <texto>`, `/me <texto>`             | Emote do personagem                 |
| `/ic <texto>`                                              | Mensagem in-character               |
| `/ooc <texto>`                                             | Mensagem out-of-character explícita |

**REQ-CHT-014** [MVP] Para o comando `/w`, alvos DEVEM ser especificáveis como nome de usuário entre colchetes, com múltiplos alvos separados por vírgula: `/w [João, Maria] mensagem`. As palavras-chave `gm` e `players` DEVEM ser resolvidas para os IDs dos usuários GM e não-GM respectivamente.

**REQ-CHT-015** [MVP] Comandos não reconhecidos pelo cliente DEVEM ser enviados ao servidor para verificação no `CommandRegistry`; o servidor retorna erro se o comando for desconhecido.

**REQ-CHT-016** [MVP] A `SystemAPI` DEVE expor `registerChatCommand(prefix: string, handler: ServerChatCommandHandler)` para sistemas registrarem comandos adicionais (ver `15-api-de-sistemas.md`).

**REQ-CHT-017** [MVP] O roll mode padrão para rolagens automatizadas (via sistema, macro) DEVE ser configurável por usuário (dropdown no painel de chat); rolagens digitadas manualmente com `/roll` SEMPRE produzem roll público, independentemente do dropdown.

### Rolagens e inline rolls

**REQ-CHT-018** [MVP] Mensagens do tipo `roll` DEVEM incluir o campo `rolls` contendo array de objetos `RollData` serializados (ver `08-motor-de-rolagens.md`), exibidos com total em destaque e breakdown expandível ao clicar/hover.

**REQ-CHT-019** [MVP] O servidor DEVE detectar expressões `[[fórmula]]` no conteúdo de mensagens de texto, avaliá-las via motor de rolagens e substituir pelo resultado antes de persistir. O documento armazenado DEVE conter o resultado, não a expressão original.

**REQ-CHT-020** [MVP] O servidor DEVE detectar expressões `[[/r fórmula]]` (e variantes `/gmroll`, `/selfroll`, etc.) e renderizá-las como metadata de deferred roll que o cliente exibe como botão. Ao clicar, o cliente envia um comando de roll com a fórmula e o modo originais.

**REQ-CHT-021** [MVP] Fórmulas com flavor `# texto` DEVEM ter o texto de flavor preservado e exibido no card de rolagem (ex.: "Ataque com espada: 1d20+5 → **17**").

### Speaker

**REQ-CHT-022** [MVP] O objeto `speaker` de toda mensagem DEVE ser resolvido pelo servidor na seguinte ordem de prioridade: (1) token controlado pelo usuário na cena ativa; (2) actor padrão do usuário; (3) nome do usuário como fallback.

**REQ-CHT-023** [MVP] O campo `speaker.alias` DEVE ser exibido no painel de chat como nome do remetente. Para mensagens OOC, o nome do User (não do personagem) DEVE ser exibido.

### Chat cards declarativos

**REQ-CHT-024** [MVP] O servidor DEVE aceitar mensagens com campo `card: CardData` no payload de criação. `CardData` é validado contra o schema JSON definido nesta spec (ver seção Modelo de dados). Mensagens com `card` inválido são rejeitadas com erro.

**REQ-CHT-025** [MVP] O cliente DEVE renderizar `CardData` com o componente `<ChatCard>` Svelte, nunca via `innerHTML` de string HTML arbitrária.

**REQ-CHT-026** [MVP] Ao clicar em um botão de card, o cliente DEVE enviar ao servidor um evento `chat:card-action` com `{ messageId, actionId, actorId?, targetIds? }`. O servidor valida permissão e despacha para o handler do sistema registrado.

**REQ-CHT-027** [MVP] Sistemas DEVEM poder registrar handlers de ação via `SystemAPI.registerCardAction(actionType: string, handler: CardActionHandler)` (ver `15-api-de-sistemas.md`).

**REQ-CHT-028** [MVP] Botões de card DEVEM poder ser desabilitados pelo sistema após uso (ex.: botão de aplicar dano desabilitado depois de clicado). O estado de `disabled` de cada botão é armazenado em `card.buttons[n].disabled` e atualizado via patch do documento.

### Referências @UUID e markdown

**REQ-CHT-029** [MVP] O servidor DEVE transformar referências `@UUID[TipoDoc.id]{Label}` no conteúdo de mensagens em metadados estruturados persistidos no documento. O cliente DEVE renderizá-los como links clicáveis que abrem o documento referenciado.

**REQ-CHT-030** [MVP] O conteúdo de mensagens de texto DEVE suportar markdown leve: `**bold**`, `*italic*`, `` `código` ``, `[texto](url)` (somente http/https), listas com `-`. Outros elementos markdown são stripped.

**REQ-CHT-031** [MVP] Emoji Unicode padrão DEVEM ser renderizados natively pelo browser (sem biblioteca de emoji customizada no MVP).

**REQ-CHT-032** [V2] O cliente DEVE exibir um picker de emoji ao clicar no ícone correspondente no input de chat.

### Log, paginação e busca

**REQ-CHT-033** [MVP] O painel de chat DEVE carregar as 50 mensagens mais recentes ao abrir/recarregar a página, usando paginação por cursor.

**REQ-CHT-034** [MVP] Ao rolar o painel até o topo, o cliente DEVE carregar automaticamente o próximo bloco de 50 mensagens anteriores (infinite scroll para cima).

**REQ-CHT-035** [MVP] O cliente DEVE usar virtual scroll (DOM apenas das mensagens visíveis) para suportar histórico extenso sem degradação de performance.

**REQ-CHT-036** [MVP] O GM DEVE poder buscar mensagens por texto livre via campo de busca no painel de chat. A busca DEVE ser executada no servidor (SQLite FTS5), retornando no máximo 50 resultados paginados.

**REQ-CHT-037** [MVP] O GM DEVE poder exportar o log de chat do mundo em formato JSON (estrutura completa dos documentos) e texto plano (somente `timestamp | speaker.alias | content`).

### Notificações

**REQ-CHT-038** [MVP] Ao receber uma nova mensagem (incluindo whispers endereçados ao usuário), o cliente DEVE reproduzir um som de notificação padrão via canal de interface de áudio (ver `13-audio-e-playlists.md`).

**REQ-CHT-039** [MVP] Quando o painel de chat estiver minimizado ou fora de foco, o cliente DEVE exibir badge com contagem de mensagens não lidas. O badge DEVE ser zerado ao abrir/focar o painel.

**REQ-CHT-040** [MVP] O usuário DEVE poder silenciar notificações de chat nas configurações de cliente (persiste em `localStorage`).

### Chat bubbles

**REQ-CHT-041** [MVP] Mensagens do tipo `emote` e mensagens IC (`/ic`) originadas de um token posicionado na cena ativa DEVEM gerar um chat bubble acima do token no canvas.

**REQ-CHT-042** [MVP] Chat bubbles DEVEM ser exibidas por 5 segundos e então desaparecer com fade-out. Texto DEVE ser truncado após 120 caracteres com `…`.

**REQ-CHT-043** [MVP] Chat bubbles DEVEM respeitar a visibilidade do token: se o token está fora do campo de visão do jogador (fog of war), o bubble NÃO é exibido para esse jogador.

### Pop-out

**REQ-CHT-044** [V2] O usuário DEVE poder abrir o painel de chat em uma janela separada do browser via botão de pop-out.

### Revelação de mensagens privadas

**REQ-CHT-045** [MVP] Um usuário com papel privilegiado (GM ou Assistente de GM) PODE revelar uma `ChatMessage` privada — aquela cujo `whisper` não está vazio ou cujo `blind` é `true` — tornando-a visível a todos os usuários do mundo. A operação é solicitada pelo evento `chat:reveal`, que identifica a mensagem já existente pelo `_id`.

**REQ-CHT-046** [MVP] A revelação DEVE ser persistida no documento (`whisper` passa a `[]` e `blind` a `false`) **antes** de qualquer emissão, de modo que os três caminhos de leitura entreguem a mensagem revelada: o broadcast ao vivo, o `chat:history` e o snapshot de entrada no mundo. Uma revelação que só altere o broadcast NÃO satisfaz este requisito.

**REQ-CHT-047** [MVP] A mensagem revelada DEVE registrar quem revelou (`revealedBy`, User ID) e quando (`revealedAt`, Unix ms), e o cliente DEVE sinalizar visualmente que aquela mensagem foi revelada pelo narrador. Os campos de auditoria são de exibição: eles NÃO DEVEM participar da decisão de quem recebe a mensagem, que continua sendo derivada apenas de `whisper` e `blind` (DEC-CHT-10).

**REQ-CHT-048** [MVP] Um usuário sem papel privilegiado NÃO DEVE conseguir revelar mensagem alguma: o servidor DEVE responder com erro de permissão e a mensagem DEVE permanecer privada, inclusive no histórico. Revelar uma mensagem que já é pública NÃO DEVE alterar o documento nem gerar broadcast.

**REQ-CHT-049** [MVP] Revelar NÃO DEVE reexecutar a rolagem nem expor a semente do RNG: o payload emitido é exatamente o resultado persistido no momento da rolagem, e o `seed` permanece restrito ao log de auditoria (ver `08-motor-de-rolagens.md`, REQ-ROL-049). Em particular, o autor de uma `blindroll` revelada DEVE passar a receber o resultado real no lugar do texto substituto de confirmação previsto em REQ-ROL-032.

---

## Requisitos não-funcionais

**REQ-CHT-NF-001** [MVP] O servidor DEVE processar e persistir uma mensagem de texto simples em no máximo 50 ms (p95) em hardware de referência (laptop comum, SSD).

**REQ-CHT-NF-002** [MVP] O painel de chat DEVE suportar histórico de até 100 000 mensagens sem degradação visível de scroll, graças ao virtual scroll.

**REQ-CHT-NF-003** [MVP] O tamanho máximo de uma mensagem (campo `content`) DEVE ser limitado a 4 096 caracteres UTF-8. O servidor DEVE rejeitar mensagens acima desse limite com erro `CHT_CONTENT_TOO_LONG`.

**REQ-CHT-NF-004** [MVP] O servidor DEVE aplicar rate limiting por usuário: máximo de 5 mensagens por segundo; exceder gera erro `CHT_RATE_LIMIT`. Detalhes de rate limiting em `21-seguranca.md`.

**REQ-CHT-NF-005** [MVP] Mensagens persistidas DEVEM ter conteúdo sanitizado (nenhum script executável, nenhum atributo de evento HTML).

---

## Modelo de dados

```typescript
// packages/shared/src/chat.ts

/** Tipo discriminador da mensagem */
export type MessageType = "text" | "roll" | "emote" | "whisper" | "system";

/** Roll mode: determina visibilidade da rolagem */
export type RollMode = "public" | "gmroll" | "blindroll" | "selfroll";

/** Identidade do remetente efetivo */
export interface ChatSpeaker {
  /** ID do User Fusion (sempre presente) */
  userId: string;
  /** ID do Actor, se resolvido */
  actorId?: string;
  /** ID do Token, se resolvido */
  tokenId?: string;
  /** Alias exibido no log (nome do token, actor ou user) */
  alias: string;
}

/** Ação associada a um botão de chat card */
export interface CardButton {
  /** Identificador único do botão dentro do card (ex.: "apply-damage") */
  id: string;
  /** Rótulo exibido no botão */
  label: string;
  /** Tipo de ação registrado via SystemAPI.registerCardAction() */
  actionType: string;
  /** Payload serializado passado ao handler ao clicar */
  actionPayload: Record<string, unknown>;
  /** Ícone opcional (nome de ícone do design system) */
  icon?: string;
  /** Estilo visual do botão: 'primary' | 'secondary' | 'danger' */
  variant?: "primary" | "secondary" | "danger";
  /** Se o botão está desabilitado (após uso, por decisão do sistema) */
  disabled?: boolean;
}

/** Linha de dado exibida no corpo do card */
export interface CardField {
  label: string;
  value: string;
  /** Se o valor deve ser exibido em destaque (ex.: total de dano) */
  highlight?: boolean;
}

/** Schema declarativo de chat card — sem HTML arbitrário */
export interface CardData {
  /** Título do card (ex.: "Ataque com Espada Longa") */
  title: string;
  /** Subtítulo opcional (ex.: nome do item) */
  subtitle?: string;
  /** Ícone opcional — caminho de asset ou nome de ícone do design system */
  icon?: string;
  /** Campos de dados exibidos no corpo do card */
  fields?: CardField[];
  /** Texto descritivo opcional (markdown leve, máx 500 chars) */
  description?: string;
  /** Botões de ação */
  buttons?: CardButton[];
  /** Namespace do sistema que criou este card (ex.: "pf2e") */
  systemId: string;
  /** Dados opacos de contexto que o sistema precisa para processar ações; NÃO exibidos na UI */
  systemContext?: Record<string, unknown>;
}

/** Roll serializado — detalhes da estrutura em 08-motor-de-rolagens.md */
export interface RollData {
  formula: string;
  total: number;
  terms: unknown[]; // estrutura detalhada em RollTerm (ver 08)
  flavor?: string;
  mode: RollMode;
}

/** Documento ChatMessage persistido */
export interface ChatMessage {
  /** UUID v4, imutável */
  _id: string;
  /** ID do mundo ao qual pertence */
  worldId: string;
  /** Tipo semântico da mensagem */
  type: MessageType;
  /** Conteúdo textual sanitizado (markdown leve; inline roll results embutidos) */
  content: string;
  /** Remetente efetivo */
  speaker: ChatSpeaker;
  /** Unix timestamp em ms */
  timestamp: number;
  /** IDs de destinatários (populado pelo servidor para whisper/gmroll/selfroll) */
  whisper: string[];
  /** Se true, clientes não-GM não recebem os dados de rolagem */
  blind: boolean;
  /** Unix ms em que um GM revelou esta mensagem; ausente = nunca foi revelada (REQ-CHT-047) */
  revealedAt?: number;
  /** User ID de quem revelou; ausente = nunca foi revelada (REQ-CHT-047) */
  revealedBy?: string;
  /** Rolls avaliados (para type === 'roll') */
  rolls?: RollData[];
  /** Chat card declarativo (para type === 'system' com card) */
  card?: CardData;
  /** Caminho de asset de som reproduzido com a mensagem (opcional) */
  sound?: string;
  /** Dados opacos por sistema de jogo — namespace isolado */
  flags: Record<string, Record<string, unknown>>;
}

/** Payload do evento chat:card-action */
export interface CardActionRequest {
  messageId: string;
  buttonId: string;
  /** Actor do jogador que clicou (para aplicar efeito/dano) */
  actorId?: string;
  /** Tokens-alvo selecionados no canvas */
  targetIds?: string[];
}

/** Handler de ação de card registrado por sistema */
export type CardActionHandler = (
  req: CardActionRequest,
  message: ChatMessage,
  context: SystemActionContext,
) => Promise<void>;

/** Handler de comando de chat registrado por sistema */
export type ServerChatCommandHandler = (
  args: string,
  userId: string,
  worldId: string,
) => Promise<ChatMessage | null>;
```

---

## API e eventos

### Eventos socket.io (cliente → servidor)

| Evento                   | Payload                | Descrição                                                                    |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| `document:create` (chat) | `Partial<ChatMessage>` | Enviar nova mensagem. O servidor valida, sanitiza, persiste e faz broadcast. |
| `document:delete` (chat) | `{ _id: string }`      | GM deleta mensagem.                                                          |
| `chat:card-action`       | `CardActionRequest`    | Clique em botão de card.                                                     |
| `chat:flush` (request)   | `{}`                   | GM solicita limpeza do log.                                                  |
| `chat:reveal`            | `ChatRevealPayload`    | GM revela mensagem privada já enviada (REQ-CHT-045).                         |

### Eventos socket.io (servidor → clientes)

| Evento                   | Destinatários      | Payload                        | Descrição                                       |
| ------------------------ | ------------------ | ------------------------------ | ----------------------------------------------- |
| `document:create` (chat) | Clientes elegíveis | `ChatMessage`                  | Nova mensagem; roll payload omitido para blind. |
| `document:update` (chat) | Clientes elegíveis | `Partial<ChatMessage>` + `_id` | Atualização (ex.: `card.buttons[n].disabled`).  |
| `document:delete` (chat) | Todos              | `{ _id: string }`              | Mensagem deletada.                              |
| `chat:flush`             | Todos              | `{}`                           | Log limpo; cliente limpa painel.                |

### REST (HTTP Fastify)

| Método | Rota                           | Auth | Descrição                                                                                      |
| ------ | ------------------------------ | ---- | ---------------------------------------------------------------------------------------------- |
| `GET`  | `/api/worlds/:wid/chat`        | User | Busca paginada por cursor. Query params: `before` (cursor \_id), `limit` (padrão 50, máx 100). |
| `GET`  | `/api/worlds/:wid/chat/search` | User | Busca FTS5. Query params: `q` (texto), `limit`, `page`.                                        |
| `GET`  | `/api/worlds/:wid/chat/export` | GM   | Export em `?format=json` ou `?format=txt`.                                                     |

---

## Dependências (specs irmãs)

| Spec                          | Dependência                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `02-modelo-de-dados.md`       | `ChatMessage` segue o modelo Document (campos base `_id`, `flags`, ownership).        |
| `03-persistencia-e-mundos.md` | Tabela `chat_messages` e tabela FTS5 `chat_fts` no `world.db`; esquema de índices.    |
| `04-rede-e-sincronizacao.md`  | Envelope de mensagem, namespaces, rooms, rate limiting de socket, sequência `seq`.    |
| `05-usuarios-e-permissoes.md` | Permissão `CHAT_WHISPER`, visibilidade de blind rolls para GMs, deleção de mensagens. |
| `08-motor-de-rolagens.md`     | `RollData`, avaliação de inline rolls, roll modes.                                    |
| `11-ui-framework-e-fichas.md` | Componente `<ChatCard>`, virtual scroll, renderização de markdown.                    |
| `13-audio-e-playlists.md`     | Som de notificação no canal de interface.                                             |
| `14-macros-e-automacao.md`    | Comandos `/macro` e execução de macros via chat são escopo da spec de macros.         |
| `15-api-de-sistemas.md`       | `registerChatCommand()`, `registerCardAction()`.                                      |
| `21-seguranca.md`             | Allowlist de sanitização HTML/markdown, rate limiting detalhado, política de CSP.     |

---

## Critérios de aceitação

**CA-CHT-001** Um jogador digita `/roll 1d20+5` → o servidor avalia, persiste e todos os clientes conectados recebem a mensagem com o resultado em menos de 200 ms (rede local).

**CA-CHT-002** Um jogador digita `/gmroll 1d20+5` → somente o GM e o autor veem o resultado completo; os demais clientes veem a mensagem sem dados de rolagem.

**CA-CHT-003** Um jogador digita `/blindroll 1d20` → somente o GM vê o resultado; o autor recebe confirmação "rolagem cega enviada" sem o valor; os demais não recebem nada.

**CA-CHT-004** Um jogador digita `/w [NomeGM] mensagem secreta` → somente o GM e o autor veem a mensagem no log.

**CA-CHT-005** Um sistema envia um `ChatMessage` com `card: CardData` contendo um botão "Aplicar Dano" → o card é exibido; ao clicar, o `CardActionHandler` registrado é chamado no servidor; o botão fica desabilitado após a ação.

**CA-CHT-006** O conteúdo `<script>alert(1)</script>` em uma mensagem → é stripped pelo servidor; a mensagem é armazenada e exibida sem o script.

**CA-CHT-007** Um mundo com 10 000 mensagens → o painel abre em menos de 1 segundo mostrando as 50 mais recentes; rolar para cima carrega o próximo bloco sem travamento visível.

**CA-CHT-008** O GM acessa "Export log" → recebe arquivo JSON válido com todos os documentos `ChatMessage` do mundo.

**CA-CHT-009** O GM clica em "Flush log" → o log é truncado; todos os clientes conectados limpam o painel instantaneamente.

**CA-CHT-010** Um token visível na cena envia `/emote examina a sala` → um chat bubble aparece acima do token no canvas por 5 segundos; jogadores que não veem o token não veem o bubble.

**CA-CHT-011** Mensagem com conteúdo `**texto em negrito** e [[1d6]]` → negrito renderizado; `[[1d6]]` substituído pelo resultado avaliado pelo servidor (ex.: `**texto em negrito** e 4`).

**CA-CHT-012** Um jogador digita `/gmroll 1d20`; o GM revela a mensagem → o jogador que não era destinatário passa a ver o resultado no broadcast, encontra a mesma mensagem ao consultar o histórico, e um cliente que conecta depois a recebe no snapshot de entrada.

**CA-CHT-013** Um jogador digita `/blindroll 1d20`; o GM revela a mensagem → o autor deixa de ver o texto de confirmação e passa a ver o total realmente rolado, idêntico ao que o GM já via; nenhum payload entregue contém `seed`. Se, em vez do GM, um jogador comum solicitar a revelação, o servidor recusa por permissão e a mensagem continua invisível para os demais, inclusive no histórico.

---

## Questões em aberto

1. **Edição de mensagens:** Deve ser possível editar uma mensagem já enviada? Se sim, quem pode editar (somente o autor? Somente GM?)? O histórico de edições deve ser preservado? _Posição atual: deixado para V2, sem edição no MVP._

2. **Reações a mensagens:** Suporte a reações emoji em mensagens (tipo Discord)? _Posição atual: fora do MVP; depende de demanda da comunidade._

3. **Threads de chat / replies:** Resposta encadeada a mensagens específicas? _Posição atual: fora do MVP._

4. **Menções de usuário (`@usuário`):** Além de `@UUID` para documentos, deve haver `@usuário` com notificação push? _Posição atual: pode ser adicionado ao MVP se simples o suficiente; aguarda definição da spec 11._

5. **Chat bubbles com rich text:** Bullets devem exibir apenas texto plano ou suportar markdown leve? _Posição atual: texto plano no MVP (truncado a 120 chars)._

6. **Persistência de sons de notificação customizados:** O GM pode associar um som customizado a mensagens de sistema específicas? _A spec de áudio (13) define o mecanismo; integração aqui a ser alinhada._

7. **Moderação de chat:** Algum mecanismo de mute/ban de jogador do chat separado do kick global? _Posição atual: o kick de `05-usuarios-e-permissoes.md` cobre o caso de uso no MVP._

8. **Tamanho máximo de `cardData.systemContext`:** O campo `systemContext` de `CardData` precisa de um limite de bytes para evitar mensagens excessivamente grandes via card. _Proposta provisória: 8 KB; aguarda validação com necessidades do sistema PF2e._

---

## Referências

- `docs/research/05-foundry-dice-chat.md` — seções 8 (Roll Modes), 11 (Chat), 12 (Chat Cards), 13 (Chat Bubbles)
- `docs/research/09-foundry-funcionalidades-mesa.md` — seção 10.4 (UI/QoL, PopOut!), seção 11 (expectativas de usuários)
- Red Blob Games — artigos de referência para canvas (indireto, via `06-canvas-e-renderizacao.md`)
- SQLite FTS5 — https://www.sqlite.org/fts5.html
- DOMPurify — https://github.com/cure53/DOMPurify (referência para allowlist de sanitização; implementação detalhada em `21-seguranca.md`)
