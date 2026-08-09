# 04 — Rede e Sincronização

- **Título:** Rede e Sincronização
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/06-foundry-rede-multiplayer.md` (protocolo de CRUD, autoridade do servidor, queries, presença, pings, reconexão, latência)
  - `docs/research/01-foundry-arquitetura-stack.md` (arquitetura cliente/servidor, evolução do protocolo de tempo real, padrão de mensagens)

---

## Objetivo

Especificar a camada de rede em tempo real do Fusion: o protocolo de mensagens sobre WebSocket (socket.io v4), a divisão de autoridade entre servidor e cliente, o modelo de concorrência (otimista para movimento de token, pessimista para o resto), a reconexão e o resync de estado, a presença (usuários online, cursores, pings, force pan) e os controles de robustez (rate limiting, tamanho máximo de mensagem, canal namespaced para sistemas).

Esta spec define **como os dados trafegam** entre o servidor autoritativo e os navegadores dos jogadores. Ela NÃO define o que cada documento contém (ver `02-modelo-de-dados.md`), como são persistidos (ver `03-persistencia-e-mundos.md`), nem as regras de quem pode fazer o quê (ver `05-usuarios-e-permissoes.md`) — apenas o transporte, a serialização, o envelope e o ciclo de vida das operações sobre o fio.

## Escopo

### O que inclui

- Transporte WebSocket via **socket.io v4**, com namespace por mundo e rooms por escopo (cena, usuário, GMs).
- **Envelope de mensagem** padronizado: tipo, payload, `requestId`, `ack`, `seq`.
- Operações de **CRUD de documentos** (create/update/delete) baseadas em diffs, com broadcast autoritativo.
- **Queries** request/response (handler único do lado do servidor ou de um GM designado).
- **Eventos efêmeros** não persistidos: cursor ao vivo, ping no mapa, typing, preview de movimento de token, force pan.
- **Modelo de autoridade:** servidor valida permissão + schema, persiste e faz broadcast.
- **Concorrência:** otimista com rollback para movimento de token; pessimista (await do servidor) para o restante.
- **Reconexão e resync:** heartbeat, detecção de desconexão, resync completo vs delta por número de sequência.
- **Presença:** lista de usuários online, estado ativo, cursores, latência por usuário.
- **Robustez:** rate limiting por evento, tamanho máximo de mensagem, backpressure, canal namespaced para mensagens custom de sistemas.

### O que NÃO inclui

- Esquema interno dos documentos e validação de campo — ver `02-modelo-de-dados.md`.
- Escrita em disco, WAL e transações SQLite — ver `03-persistencia-e-mundos.md`.
- Autenticação, login, sessão e matriz de permissões/ownership — ver `05-usuarios-e-permissoes.md` e `21-seguranca.md`.
- Servir assets estáticos (imagens, áudio) por HTTP — ver `20-assets-e-midia.md`.
- A/V (voz/vídeo entre jogadores) — fora do MVP; ver `00-visao-e-escopo.md` (marcado [V2]). O Fusion NÃO inclui A/V WebRTC no MVP.
- Mecânica de visão/fog que decide o que cada cliente pode ver — ver `07-visao-iluminacao-fog.md`. Esta spec apenas transporta os deltas de fog.
- Execução de rolagens (RNG no servidor) — ver `08-motor-de-rolagens.md`; aqui só se define o envelope que carrega o pedido e o resultado.

## Conceitos e terminologia

- **Servidor autoritativo:** o processo Node.js do GM é o árbitro final. Toda mutação canônica passa por ele; clientes nunca escrevem direto no banco nem confiam cegamente em peers.
- **Envelope (`Envelope`):** estrutura comum que embrulha toda mensagem socket.io, contendo metadados de roteamento e correlação (`type`, `requestId`, `seq`, `ts`) e o `payload` específico.
- **Operação (op):** uma transação de mutação de documento (`create`/`update`/`delete`) ou um comando de jogo (ex.: rolar dados, mover token).
- **Diff:** delta mínimo de um documento — apenas os campos que mudaram, em notação de caminho com ponto (ex.: `{ "system.attributes.hp.value": 12 }`), compatível com merge profundo. Ver `02-modelo-de-dados.md` para a semântica de merge.
- **Broadcast:** reenvio, pelo servidor, de uma mutação confirmada para todos os clientes elegíveis (incluindo o originador, salvo quando o originador já aplicou otimisticamente).
- **`ack` (acknowledgement):** resposta direta do servidor ao cliente originador de uma op, via callback do socket.io, confirmando sucesso (com a forma final do documento) ou falha (com código de erro).
- **Concorrência otimista:** o cliente aplica a mudança localmente antes da confirmação e a desfaz (rollback) se o servidor rejeitar. Usada **somente** para movimento de token, para fluidez de arraste.
- **Concorrência pessimista:** o cliente envia a op e aguarda o `ack`/broadcast antes de refletir a mudança na UI. Usada para todo o restante (fichas, itens, cenas, chat, etc.).
- **Evento efêmero:** mensagem de presença/interação que NÃO é persistida nem versionada (cursor, ping, typing, preview de movimento). É broadcast e descartada.
- **`seq` (sequence number):** contador monotônico por mundo, atribuído pelo servidor a cada mutação canônica. Permite ao cliente detectar gaps e pedir resync por delta.
- **Resync:** processo de reconciliação do estado do cliente após reconexão — total (snapshot completo) ou delta (ops desde o último `seq` conhecido).
- **Room (socket.io):** agrupamento lógico de sockets para broadcast seletivo. O Fusion usa rooms por cena (`scene:<id>`), por usuário (`user:<id>`) e o coletivo de GMs (`gm`).
- **Namespace (socket.io):** isolamento de conexão por mundo (`/world/<worldId>`). Cada mundo é um namespace independente.
- **Canal de sistema:** evento namespaced (`system:<systemId>`) reservado para mensagens custom de um sistema de jogo, sem semântica de documento.

## Decisões

### DEC-NET-01 — Transporte: socket.io v4 (não WebSocket nativo)

**Decisão:** usar **socket.io v4** como camada de transporte de tempo real, sobre HTTP servido pelo Fastify.

**Racional:** socket.io fornece, prontos, vários mecanismos que precisaríamos reimplementar sobre `ws` nativo: reconexão automática com backoff, ACK callbacks (request/response correlacionado por op), namespaces, rooms (broadcast seletivo eficiente), heartbeat (ping/pong) e fallback de transporte. Está na stack fixada do projeto.

**Alternativas rejeitadas:**

- **WebSocket nativo (`ws`):** é o caminho para onde o Foundry migrou (v12+, ver `01-foundry-arquitetura-stack.md` §7.1), eliminando o overhead do socket.io. Rejeitado para o MVP do Fusion porque exigiria reimplementar ACK, rooms, reconexão e heartbeat manualmente — esforço que não agrega valor no MVP. Migração para `ws` nativo é candidata a [V2] caso o overhead se mostre relevante em profiling. A camada de `Envelope` (DEC-NET-02) é projetada para ser transporte-agnóstica, facilitando essa troca futura.
- **WebTransport/HTTP3:** imaturo em 2026 para o público-alvo (navegadores LAN/residenciais variados); rejeitado.

### DEC-NET-02 — Envelope unificado e transporte-agnóstico

**Decisão:** todas as mensagens trafegam dentro de um `Envelope` único com campos de roteamento (`type`), correlação (`requestId`), ordenação (`seq`, apenas em mensagens canônicas vindas do servidor), timestamp (`ts`) e `payload` tipado por `type`. O `type` segue convenção `domain:action` (ex.: `doc:update`, `token:move`, `presence:cursor`).

**Racional:** um envelope único simplifica logging, rate limiting, validação de tamanho e versionamento do protocolo, e isola a lógica de aplicação do transporte (permitindo trocar socket.io por `ws` sem reescrever handlers). Definido em `packages/shared` para ser compartilhado por servidor e cliente (single source of truth de tipos).

**Alternativas rejeitadas:**

- **Um evento socket.io distinto por tipo de operação** (estilo `socket.on("updateActor", ...)`): dispersa a lógica transversal (rate limit, auth, logging) por dezenas de handlers e dificulta versionamento. Rejeitado. Usamos **poucos** eventos socket.io de baixo nível (`op`, `query`, `ephemeral`, `system`) e discriminamos a ação pelo campo `type` do envelope.

### DEC-NET-03 — Autoridade total no servidor

**Decisão:** o servidor é o único que valida permissão + schema, persiste e faz broadcast. Nenhuma mutação de cliente é canônica até o servidor confirmá-la. Rolagens de dados executam no servidor (RNG autoritativo) — ver `08-motor-de-rolagens.md`.

**Racional:** modelo provado no Foundry (ver `06-foundry-rede-multiplayer.md` §3) e essencial para anti-cheat (a stack fixou rolagens no servidor). Clientes são consumidores de verdade emitida pelo servidor.

**Alternativas rejeitadas:**

- **Autoridade no cliente do GM** (estilo `socketlib.executeAsGM` do Foundry, §4 do research): o cliente do GM executaria operações privilegiadas a pedido de jogadores. Rejeitado: nosso servidor é o próprio processo do GM e já é autoritativo; não precisamos delegar a um cliente-GM. Mantemos toda validação no servidor, eliminando a classe de bugs onde "o GM precisa estar online para o jogador descontar HP".

### DEC-NET-04 — Concorrência: otimista para movimento de token, pessimista para o resto

**Decisão:** movimento de token usa **update otimista com rollback** (o cliente move o token na hora, envia `token:move`, e reverte para a posição autoritativa se o servidor rejeitar ou corrigir). Todas as outras mutações são **pessimistas**: a UI só reflete a mudança após o broadcast/ack do servidor.

**Racional:** arrastar tokens precisa ser fluido (sub-frame), e esperar o round-trip introduziria lag perceptível. O risco de divergência é baixo e contornável por rollback. Para o restante (editar HP, criar item, mudar cena), a frequência é baixa e a corretude/consistência importa mais que a latência — o modelo pessimista evita "flicker" e estados intermediários inválidos. O Foundry usa essencialmente last-writer-wins sem optimistic update documentado (§3, §8 do research); nós adotamos otimismo cirúrgico só onde o UX justifica.

**Alternativas rejeitadas:**

- **Tudo otimista (estilo CRDT/local-first):** complexidade de reconciliação alta, conflitos difíceis em dados de regra (HP, condições). Rejeitado para o MVP.
- **Tudo pessimista (incluindo movimento):** simples, mas movimento de token com lag de rede é UX inaceitável. Rejeitado.

### DEC-NET-05 — Concorrência de escrita: last-writer-wins com guarda de versão opcional

**Decisão:** o servidor serializa ops por ordem de chegada (FIFO no namespace do mundo). Conflitos de campo resolvem por **last-writer-wins**. Para documentos sensíveis, o cliente PODE enviar `expectedVersion` (o `seq`/versão que ele acredita ser o atual); se divergir, o servidor rejeita com `STALE_WRITE` e o cliente refaz sobre o estado fresco.

**Racional:** LWW é suficiente para a maioria dos casos (edições de baixa frequência, raramente concorrentes). A guarda opcional de versão dá ao chamador a opção de compare-and-swap para campos críticos sem impor o custo a todas as ops.

**Alternativas rejeitadas:**

- **Locking pessimista de documento:** trava UX (jogador "segura" a ficha). Rejeitado.
- **Merge automático 3-way de diffs concorrentes:** complexidade desproporcional para o MVP. Rejeitado.

### DEC-NET-06 — Resync: delta por `seq` quando possível, snapshot completo como fallback

**Decisão:** o servidor mantém um **buffer circular de ops recentes** por mundo (as últimas N ops canônicas, com seus `seq`). Ao reconectar, o cliente informa o último `seq` aplicado; se ainda estiver no buffer, recebe apenas o delta; caso contrário, recebe um snapshot completo do estado relevante.

**Racional:** delta minimiza tráfego em reconexões curtas (queda momentânea de Wi-Fi). O snapshot garante consistência quando a desconexão foi longa demais. Resolve a "janela de perda de atualizações" que o Foundry só corrigiu na v12 (§8 do research) — nós tratamos desde o início via buffer no servidor + buffer de aplicação no cliente até o `ready`.

**Alternativas rejeitadas:**

- **Sempre snapshot completo:** simples mas caro (recarrega todo o mundo a cada blip de rede). Rejeitado como padrão; mantido só como fallback.
- **Event sourcing persistente completo:** guardar todo o histórico no banco para resync arbitrário. Overkill para o MVP; o buffer circular em memória basta. [V2] pode persistir um log de ops para auditoria (ver `24-operacao-backups-telemetria.md`).

### DEC-NET-07 — Eventos efêmeros fora do pipeline de persistência

**Decisão:** cursor, ping, typing, preview de movimento e force pan trafegam por um caminho separado (`ephemeral`), sem `seq`, sem persistência, sem entrar no buffer de resync. São broadcast direto às rooms relevantes com validação mínima (rate limit + permissão).

**Racional:** são dados de alta frequência e baixa importância individual (perder um frame de cursor é irrelevante). Misturá-los com ops canônicas poluiria o buffer de resync e o `seq`.

### DEC-NET-08 — Canal namespaced para sistemas, sem broadcast irrestrito

**Decisão:** sistemas de jogo (PF2e, SF2e, Etmos) emitem mensagens custom pelo evento `system` com `payload.systemId` e `payload.channel`. O servidor valida que o emissor tem permissão e re-emite apenas para destinatários elegíveis. Não há `emit` arbitrário cliente→cliente sem passar pelo servidor.

**Racional:** mantém a autoridade central mesmo para extensões. Inspirado no namespace `system.<id>`/`module.<id>` do Foundry (§4 do research), mas com o servidor mediando em vez de relay cego. Como no Fusion os sistemas são compilados junto ao app (não plugins de terceiros — ver `15-api-de-sistemas.md`), o conjunto de canais é conhecido e auditável.

## Requisitos funcionais

### Conexão, namespace e rooms

- **REQ-NET-001** [MVP] O servidor DEVE expor um endpoint socket.io v4 montado sobre o servidor HTTP Fastify, no path `/socket.io/`.
- **REQ-NET-002** [MVP] Cada mundo aberto DEVE corresponder a um namespace socket.io distinto no formato `/world/<worldId>`. Conexões a um namespace de mundo não ativo DEVEM ser rejeitadas.
- **REQ-NET-003** [MVP] No handshake de conexão, o cliente DEVE apresentar seu token de sessão (ver `05-usuarios-e-permissoes.md`). O servidor DEVE autenticar antes de admitir o socket; falha de auth DEVE encerrar a conexão com motivo `AUTH_FAILED`.
- **REQ-NET-004** [MVP] Ao admitir um socket, o servidor DEVE associá-lo à room `user:<userId>` e, se o usuário for GM/assistente, também à room `gm`.
- **REQ-NET-005** [MVP] Quando um cliente entra em uma cena (ativa sua view), o servidor DEVE adicioná-lo à room `scene:<sceneId>` e removê-lo da room da cena anterior. Eventos de canvas (efêmeros) DEVEM ser broadcast apenas à room da cena corrente.
- **REQ-NET-006** [MVP] O servidor DEVE impor um limite configurável de conexões simultâneas por mundo (padrão sugerido: 16) e rejeitar excedentes com motivo `WORLD_FULL`.

### Envelope e protocolo de mensagens

- **REQ-NET-010** [MVP] Toda mensagem socket.io DEVE ser embrulhada em um `Envelope` contendo no mínimo `type` (string `domain:action`), `ts` (epoch ms do emissor) e `payload`. Mensagens malformadas (sem `type` ou `payload`) DEVEM ser descartadas e contabilizadas como erro de protocolo.
- **REQ-NET-011** [MVP] Requisições que esperam resposta (ops e queries) DEVEM incluir `requestId` (ULID gerado pelo cliente). O servidor DEVE responder via callback de ack do socket.io com um `Envelope` de resposta correlacionado pelo mesmo `requestId`.
- **REQ-NET-012** [MVP] Toda mutação canônica originada/broadcast pelo servidor DEVE carregar um `seq` (inteiro monotônico crescente por mundo). Clientes DEVEM usar `seq` para detectar lacunas.
- **REQ-NET-013** [MVP] O servidor DEVE usar um número reduzido de eventos socket.io de baixo nível — no mínimo `op` (mutações de documento), `query` (request/response), `ephemeral` (presença/interação) e `system` (canal de sistemas) — discriminando a ação pelo campo `type` do envelope, não por um evento socket.io por ação.
- **REQ-NET-014** [MVP] O protocolo DEVE versionar-se via campo `protocolVersion` no handshake. Se a versão do cliente for incompatível com a do servidor, o servidor DEVE recusar a conexão com motivo `PROTOCOL_MISMATCH` e instrução de recarregar a página.

### CRUD de documentos

- **REQ-NET-020** [MVP] O servidor DEVE aceitar operações `doc:create`, `doc:update` e `doc:delete` para os tipos de documento definidos em `02-modelo-de-dados.md`, suportando operações em lote (array de documentos/diffs em uma única op).
- **REQ-NET-021** [MVP] `doc:update` DEVE transportar apenas o **diff** (campos alterados em notação de caminho com ponto), não o documento completo. O servidor aplica o diff por merge profundo sobre o estado canônico.
- **REQ-NET-022** [MVP] Para cada op recebida, o servidor DEVE, nesta ordem: (1) validar o envelope e tamanho; (2) verificar permissão do usuário sobre o documento (ver `05-usuarios-e-permissoes.md`); (3) validar o resultado contra o schema do documento (ver `02-modelo-de-dados.md`); (4) persistir (ver `03-persistencia-e-mundos.md`); (5) atribuir `seq`; (6) fazer broadcast às rooms elegíveis; (7) responder o ack ao originador.
- **REQ-NET-023** [MVP] Falha em qualquer etapa de validação DEVE abortar a op inteira (atomicidade por op — lote falha por completo se qualquer item falhar) e retornar um ack de erro com código (`PERMISSION_DENIED`, `VALIDATION_FAILED`, `NOT_FOUND`, `STALE_WRITE`, `RATE_LIMITED`, `TOO_LARGE`).
- **REQ-NET-024** [MVP] O broadcast de uma mutação DEVE respeitar a visibilidade do documento: o servidor NÃO DEVE enviar a destinatários sem ao menos ownership `LIMITED`/`OBSERVER` o conteúdo completo; pode enviar uma forma redigida ou suprimir o evento (ver `05-usuarios-e-permissoes.md` e `21-seguranca.md`).
- **REQ-NET-025** [MVP] Documentos embutidos (ex.: itens dentro de um ator) DEVEM ser endereçáveis nas ops por par `{ parentType, parentId, embeddedType, embeddedId }`, e o broadcast resultante DEVE refletir a mutação do pai conforme o modelo de dados.
- **REQ-NET-026** [MVP] `doc:update` PODE incluir `expectedVersion`; se presente e divergente do `seq`/versão atual do documento, o servidor DEVE rejeitar com `STALE_WRITE` sem aplicar a mudança.

### Queries (request/response)

- **REQ-NET-030** [MVP] O servidor DEVE oferecer um mecanismo de `query` request/response: o cliente envia `query` com `type`, `requestId` e `payload`; o servidor (ou um handler registrado) processa e responde via ack correlacionado, com timeout configurável (padrão sugerido 10 s) após o qual o cliente recebe `QUERY_TIMEOUT`.
- **REQ-NET-031** [MVP] Queries DEVEM ter controle de permissão por tipo de query: o servidor verifica se o usuário pode disparar aquele `type` antes de executar (análogo à permissão `QUERY_USER` do research).
- **REQ-NET-032** [V2] O servidor PODE rotear uma query para um cliente específico (ex.: pedir a um GM uma confirmação interativa) e relayar a resposta de volta ao solicitante, mantendo o servidor como mediador.

### Eventos efêmeros e presença

- **REQ-NET-040** [MVP] O servidor DEVE broadcast em tempo real a posição do **cursor** dos usuários (evento `presence:cursor`) à room da cena, sujeito à permissão de exibir cursor (ver `05-usuarios-e-permissoes.md`). Cursores DEVEM ser throttled (padrão sugerido ≤ 30 msg/s por usuário) e não persistidos.
- **REQ-NET-041** [MVP] O servidor DEVE suportar **pings no mapa** (evento `presence:ping`) com tipos `basic` e `alert`/`warning`, broadcast à room da cena, exibindo a cor do usuário emissor; pings DEVEM ser rate-limited.
- **REQ-NET-042** [MVP] O servidor DEVE suportar **force pan / pull de jogadores** (evento `presence:pan`), restrito a GM/assistente, que instrui todos os clientes na cena a centralizar a câmera na coordenada informada.
- **REQ-NET-043** [MVP] O servidor DEVE manter e expor a **lista de usuários conectados** por mundo (presença), atualizando todos os clientes quando um usuário conecta ou desconecta (evento `presence:online`), incluindo o estado ativo e a cor de cada usuário.
- **REQ-NET-044** [MVP] O servidor DEVE suportar **preview de movimento de token** (evento `token:preview`) — broadcast efêmero da posição-alvo durante o arraste, antes da confirmação — à room da cena, throttled, sem persistência.
- **REQ-NET-045** [V2] O servidor PODE broadcast indicador de **typing** no chat (evento `presence:typing`) à room do mundo, efêmero e throttled.
- **REQ-NET-046** [MVP] O servidor DEVE medir e expor a **latência (RTT)** por usuário usando o canal WebSocket já estabelecido (ping/pong de aplicação correlacionado), disponibilizando o valor para a UI do GM, sem abrir conexão HTTP separada.

### Movimento de token (concorrência otimista)

- **REQ-NET-050** [MVP] O movimento de token DEVE usar atualização otimista: o cliente originador aplica o movimento localmente e emite `token:move` (uma op especializada). O servidor valida (colisão de paredes/limites é responsabilidade de `06-canvas-e-renderizacao.md`/`07-visao-iluminacao-fog.md`), persiste a posição final e faz broadcast canônico com `seq`.
- **REQ-NET-051** [MVP] Se o servidor rejeitar ou corrigir um `token:move` (ex.: posição inválida, sem permissão), o cliente originador DEVE fazer **rollback** para a posição autoritativa do broadcast/ack.
- **REQ-NET-052** [MVP] Clientes não-originadores DEVEM aplicar movimento de token apenas a partir do broadcast canônico do servidor (não há otimismo em peers), podendo interpolar/animar entre a posição anterior e a nova.

### Reconexão, heartbeat e resync

- **REQ-NET-060** [MVP] O cliente DEVE reconectar automaticamente após queda de conexão, com backoff exponencial e jitter (recurso nativo do socket.io configurado explicitamente).
- **REQ-NET-061** [MVP] O servidor e o cliente DEVEM usar heartbeat (ping/pong) para detectar conexões mortas; o servidor DEVE considerar um socket desconectado após um intervalo configurável sem pong (padrão sugerido 25 s) e atualizar a presença.
- **REQ-NET-062** [MVP] O servidor DEVE manter um **buffer circular** das últimas N ops canônicas por mundo (padrão sugerido N=1000), cada uma com seu `seq`, para suportar resync por delta.
- **REQ-NET-063** [MVP] Ao reconectar, o cliente DEVE enviar seu último `seq` aplicado. Se esse `seq` ainda estiver no buffer, o servidor DEVE responder com o **delta** (ops faltantes em ordem); caso contrário, DEVE responder com `RESYNC_FULL` e fornecer/instruir um snapshot completo do estado relevante.
- **REQ-NET-064** [MVP] O cliente DEVE **bufferizar** ops recebidas durante a inicialização (entre conexão e o estado "ready") e aplicá-las em ordem de `seq` somente após o estado inicial estar estabelecido, evitando perda da "janela de carregamento".
- **REQ-NET-065** [MVP] Durante a reconexão e o resync, o cliente DEVE sinalizar visualmente o estado de conexão (conectando/reconectando/sincronizando/conectado) para o usuário.

### Rate limiting, tamanho e robustez

- **REQ-NET-070** [MVP] O servidor DEVE impor **tamanho máximo de mensagem** configurável (padrão sugerido 1 MiB para ops; limite menor, ex. 16 KiB, para eventos efêmeros). Mensagens excedentes DEVEM ser rejeitadas com `TOO_LARGE` e não processadas.
- **REQ-NET-071** [MVP] O servidor DEVE aplicar **rate limiting por socket e por tipo de evento** (token bucket), com limites diferenciados — mais permissivo para `ephemeral`/`token:preview`, mais restrito para `doc:*`/`query`. Excedentes DEVEM ser rejeitados com `RATE_LIMITED` (ops) ou silenciosamente descartados (efêmeros), e contabilizados.
- **REQ-NET-072** [MVP] O servidor DEVE aplicar **backpressure**: se a fila de envio de um cliente lento exceder um limite, o servidor PODE coalescer/descartar eventos efêmeros para esse cliente e, em último caso, desconectá-lo com `SLOW_CONSUMER`.
- **REQ-NET-073** [MVP] O servidor DEVE registrar (log estruturado) erros de protocolo, rejeições por rate limit/tamanho e desconexões anômalas, com `userId`, `worldId` e `type`, para diagnóstico (ver `24-operacao-backups-telemetria.md`).

### Canal de sistemas

- **REQ-NET-080** [MVP] O servidor DEVE expor o evento `system` para mensagens custom de sistemas de jogo, com `payload.systemId`, `payload.channel` e `payload.data`. O servidor DEVE validar que o sistema corresponde ao mundo ativo e que o emissor tem permissão antes de relayar.
- **REQ-NET-081** [MVP] Mensagens de `system` DEVEM ser roteadas pelo servidor a destinatários elegíveis (todos, GMs, ou um usuário específico, conforme `payload.scope`), nunca por emissão direta cliente→cliente.
- **REQ-NET-082** [MVP] Mensagens de `system` NÃO DEVEM persistir estado por si mesmas; se um sistema precisa persistir, deve usar `doc:*` sobre um documento. O canal `system` é apenas para sinalização efêmera/coordenação.

## Requisitos não-funcionais

- **REQ-NET-090** [MVP] Latência de aplicação de uma op de documento (recebimento no servidor → broadcast emitido) DEVE ser ≤ 50 ms na máquina do GM sob carga típica (1 GM + 7 jogadores), excluindo latência de rede.
- **REQ-NET-091** [MVP] O caminho de movimento de token (otimista) DEVE refletir localmente em ≤ 1 frame (sem esperar round-trip) e a confirmação canônica não DEVE causar "salto" visível quando a posição validada coincide com a otimista.
- **REQ-NET-092** [MVP] O protocolo DEVE suportar pelo menos 8 clientes simultâneos por mundo com fluidez de movimento e presença, alinhado ao alvo de "1 GM + 7 jogadores" do MVP global.
- **REQ-NET-093** [MVP] Os tipos do `Envelope`, dos `type` de op e dos códigos de erro DEVEM viver em `packages/shared` e ser usados por servidor e cliente sem divergência (compartilhamento estático em TypeScript estrito).
- **REQ-NET-094** [MVP] O servidor DEVE degradar com segurança sob payload malicioso/malformado: nenhuma mensagem de cliente pode derrubar o processo do servidor (ver `21-seguranca.md`).
- **REQ-NET-095** [V2] A camada de protocolo DEVE estar suficientemente isolada do socket.io para permitir substituição por WebSocket nativo sem reescrever a lógica de handlers de op/query.

## Modelo de dados

Interfaces em TypeScript (estrito), definidas em `packages/shared` e importadas por servidor e cliente. Tipos de documento (`Actor`, `Item`, `Scene`, etc.) e seus diffs vêm de `02-modelo-de-dados.md`; aqui descrevemos apenas o envelope e os payloads de rede.

```typescript
/** Versão do protocolo negociada no handshake. */
export const PROTOCOL_VERSION = 1 as const;

/** Discriminador de ação no formato "domain:action". */
export type EnvelopeType =
  | "doc:create"
  | "doc:update"
  | "doc:delete"
  | "token:move"
  | "token:preview"
  | "query"
  | "presence:cursor"
  | "presence:ping"
  | "presence:pan"
  | "presence:online"
  | "presence:typing"
  | "system"
  | "resync:request"
  | "resync:delta"
  | "resync:full"
  | "ack:ok"
  | "ack:error";

/** Envelope comum a toda mensagem socket.io. */
export interface Envelope<T = unknown> {
  /** Discriminador da ação. */
  type: EnvelopeType;
  /** Correlação request/response (ULID). Obrigatório em ops e queries. */
  requestId?: string;
  /** Número de sequência canônico (apenas em mensagens vindas do servidor). */
  seq?: number;
  /** Epoch ms do emissor (para RTT/diagnóstico). */
  ts: number;
  /** Carga específica do tipo. */
  payload: T;
}

/** Códigos de erro padronizados retornados em ack:error. */
export type ErrorCode =
  | "AUTH_FAILED"
  | "PROTOCOL_MISMATCH"
  | "WORLD_FULL"
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "STALE_WRITE"
  | "RATE_LIMITED"
  | "TOO_LARGE"
  | "QUERY_TIMEOUT"
  | "SLOW_CONSUMER"
  | "INTERNAL_ERROR";

/** Resposta de ack (via callback do socket.io). */
export type Ack<R = unknown> =
  | { ok: true; seq?: number; result: R }
  | { ok: false; code: ErrorCode; message: string };

/** Diff de documento: caminhos com ponto → valor novo. */
export type DocumentDiff = Record<string, unknown>;

/** Payload de doc:update (lote). */
export interface DocUpdatePayload {
  documentType: string; // "Actor" | "Item" | "Scene" | ...
  updates: Array<{
    _id: string;
    diff: DocumentDiff;
    expectedVersion?: number; // compare-and-swap opcional (DEC-NET-05)
    /** Endereçamento de documento embutido, quando aplicável. */
    embedded?: { type: string; id: string };
  }>;
}

export interface DocCreatePayload {
  documentType: string;
  data: unknown[]; // documentos completos a criar
  parent?: { type: string; id: string };
}

export interface DocDeletePayload {
  documentType: string;
  ids: string[];
  parent?: { type: string; id: string };
}

/** Movimento de token (concorrência otimista, DEC-NET-04). */
export interface TokenMovePayload {
  sceneId: string;
  tokenId: string;
  x: number;
  y: number;
  rotation?: number;
  /** Posição otimista assumida pelo cliente, para o servidor detectar correção. */
  optimistic?: { x: number; y: number };
}

/** Preview efêmero de movimento durante o arraste. */
export interface TokenPreviewPayload {
  sceneId: string;
  tokenId: string;
  x: number;
  y: number;
}

/** Cursor ao vivo (efêmero, throttled). */
export interface CursorPayload {
  sceneId: string;
  x: number;
  y: number;
}

/** Ping no mapa. */
export interface PingPayload {
  sceneId: string;
  x: number;
  y: number;
  style: "basic" | "alert";
}

/** Force pan / pull de jogadores (GM/assistente). */
export interface PanPayload {
  sceneId: string;
  x: number;
  y: number;
  /** Alvos: todos na cena por padrão; ou lista de userIds. */
  targets?: string[];
}

/** Presença online: estado consolidado de um usuário conectado. */
export interface PresenceEntry {
  userId: string;
  active: boolean;
  color: string;
  sceneId?: string;
  /** Round-trip time em ms (REQ-NET-046), null se ainda não medido. */
  rttMs: number | null;
}

/** Pedido de resync na reconexão. */
export interface ResyncRequestPayload {
  lastSeq: number;
}

/** Resposta de resync por delta. */
export interface ResyncDeltaPayload {
  fromSeq: number;
  toSeq: number;
  ops: Envelope[]; // ops canônicas faltantes, em ordem de seq
}

/** Mensagem custom de sistema (canal namespaced, DEC-NET-08). */
export interface SystemMessagePayload {
  systemId: string;
  channel: string;
  scope: "all" | "gm" | "user";
  targetUserId?: string; // obrigatório quando scope === "user"
  data: unknown; // JSON-serializável; validado pelo sistema
}

/** Query genérica request/response. */
export interface QueryPayload {
  queryType: string; // ex.: "system.pf2e.resolveCheck"
  data: unknown;
}
```

## API e eventos

### Eventos socket.io de baixo nível

O Fusion usa um conjunto mínimo de eventos socket.io; a ação real é discriminada pelo `Envelope.type`.

| Evento socket.io | Direção                     | Ack?                 | `Envelope.type` esperados                                                              |
| ---------------- | --------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `op`             | cliente → servidor          | sim (callback `Ack`) | `doc:create`, `doc:update`, `doc:delete`, `token:move`                                 |
| `op` (broadcast) | servidor → clientes         | não                  | mesmos, com `seq` preenchido                                                           |
| `query`          | cliente → servidor          | sim (callback `Ack`) | `query`                                                                                |
| `ephemeral`      | bidirecional                | não                  | `token:preview`, `presence:cursor`, `presence:ping`, `presence:pan`, `presence:typing` |
| `presence`       | servidor → clientes         | não                  | `presence:online`                                                                      |
| `system`         | bidirecional (via servidor) | opcional             | `system`                                                                               |
| `resync`         | cliente → servidor          | sim                  | `resync:request` → `resync:delta` \| `resync:full`                                     |

### Ciclo de uma op pessimista (ex.: `doc:update` de HP)

```
Cliente A                         Servidor                        Demais clientes
   │   op(Envelope{doc:update,        │                                  │
   │      requestId, diff})           │                                  │
   ├─────────────────────────────────►│                                  │
   │                                  │ 1. valida envelope/tamanho        │
   │                                  │ 2. checa permissão                │
   │                                  │ 3. valida schema                  │
   │                                  │ 4. persiste (SQLite/WAL)          │
   │                                  │ 5. atribui seq                    │
   │                                  │ 6. broadcast op(seq) ─────────────►│ aplica + dispara hooks
   │◄── ack{ ok:true, seq, result } ──┤                                  │
   │  aplica estado canônico          │                                  │
```

### Ciclo de movimento de token (otimista, com rollback)

```
Cliente A (originador)            Servidor                        Demais clientes
   │ aplica posição localmente        │                                  │
   │   op(token:move, optimistic)     │                                  │
   ├─────────────────────────────────►│ valida + persiste posição final  │
   │                                  │ broadcast token:move(seq) ────────►│ interpola até nova posição
   │◄── ack{ ok:true, seq, x,y } ─────┤                                  │
   │  se x,y ≠ optimistic → corrige   │                                  │
   │  se ack:error → rollback         │                                  │
```

### Negociação de handshake

No `connect`, o cliente envia, no auth do socket.io, `{ token, protocolVersion, lastSeq? }`. O servidor responde aceitando (e disparando resync se `lastSeq` presente) ou recusando com `AUTH_FAILED` / `PROTOCOL_MISMATCH` / `WORLD_FULL`.

## Dependências (specs irmãs)

- `01-arquitetura-geral.md` — posição da camada de rede no sistema; processo servidor único por mundo.
- `02-modelo-de-dados.md` — tipos de documento, semântica de diff e merge profundo, documentos embutidos, versão de documento.
- `03-persistencia-e-mundos.md` — escrita autoritativa em SQLite/WAL invocada na etapa de persistência das ops; ciclo de vida do mundo (namespace ativo).
- `05-usuarios-e-permissoes.md` — autenticação no handshake, token de sessão, roles, ownership e checagem de permissão por op/query/evento.
- `06-canvas-e-renderizacao.md` — consumo de `token:move`/`token:preview`/`presence:*` no canvas; interpolação e force pan.
- `07-visao-iluminacao-fog.md` — validação de colisão/limites no movimento; transporte de deltas de fog explorado.
- `08-motor-de-rolagens.md` — rolagens autoritativas no servidor carregadas via op/query; resultado broadcast como mensagem de chat.
- `09-chat-e-mensagens.md` — mensagens de chat como documentos via `doc:create`; typing efêmero.
- `15-api-de-sistemas.md` — registro de canais de sistema e de tipos de query por sistema.
- `21-seguranca.md` — validação anti-abuso, redaction de broadcast, hardening contra payload malicioso.
- `24-operacao-backups-telemetria.md` — logs estruturados de rede, métricas de latência e taxa de erro.

## Critérios de aceitação

- **CA-01** Dois clientes conectados ao mesmo mundo: uma `doc:update` emitida por um aparece no outro via broadcast, com o documento atualizado e `seq` incrementado. (REQ-NET-012, REQ-NET-020/022)
- **CA-02** Uma op com permissão insuficiente retorna `ack:error` com `PERMISSION_DENIED` e o estado não muda em nenhum cliente. (REQ-NET-022/023)
- **CA-03** Arrastar um token: o originador vê o movimento imediato (sem esperar a rede); demais clientes veem o token mover após o broadcast; uma posição inválida causa rollback no originador. (REQ-NET-050/051/052)
- **CA-04** Derrubar a rede de um cliente por < tempo do buffer e reconectar resulta em resync por **delta** (apenas ops faltantes), sem recarregar o mundo inteiro. (REQ-NET-062/063)
- **CA-05** Derrubar a rede por tempo longo (além do buffer) e reconectar resulta em `RESYNC_FULL` (snapshot completo). (REQ-NET-063)
- **CA-06** Uma mensagem acima do tamanho máximo é rejeitada com `TOO_LARGE` sem afetar o processo. (REQ-NET-070, REQ-NET-094)
- **CA-07** Inundar o servidor com `doc:update` além do limite resulta em `RATE_LIMITED` para o excedente; inundar com `presence:cursor` resulta em descarte silencioso, ambos sem afetar outros clientes. (REQ-NET-071)
- **CA-08** Um GM emite force pan e todos os clientes na cena centralizam a câmera no ponto; um jogador comum não consegue emitir force pan. (REQ-NET-042)
- **CA-09** A lista de presença reflete corretamente conexões e desconexões em ≤ 1 heartbeat; o RTT por usuário é exposto e plausível. (REQ-NET-043/046/061)
- **CA-10** Uma mensagem de `system` de um sistema é entregue apenas aos destinatários do `scope` declarado e nunca persiste estado por si só. (REQ-NET-080/081/082)
- **CA-11** Conectar com `protocolVersion` incompatível resulta em `PROTOCOL_MISMATCH` e o cliente é instruído a recarregar. (REQ-NET-014)
- **CA-12** Os tipos de envelope, op e erro são importados de `packages/shared` por servidor e cliente, sem duplicação. (REQ-NET-093)

## Questões em aberto

- **Q1** Qual o valor definitivo do tamanho do buffer circular de ops por mundo (N)? 1000 é um chute; depende do tamanho médio de op e do uso de memória aceitável. Validar em testes de carga (ver `25-testes-e-qualidade.md`).
- **Q2** O resync por delta deve ser por mundo inteiro ou particionado por cena/coleção? Particionar reduz tráfego mas complica o controle de `seq`. Decisão adiada para a fase de implementação.
- **Q3** Compressão de mensagens (permessage-deflate do WebSocket ou compressão de payload própria) entra no MVP ou fica para otimização posterior? O Foundry avaliou JSON comprimido e envio binário (§7.2 do research) — medir antes de decidir.
- **Q4** O `seq` global por mundo pode se tornar gargalo de contenção sob alta concorrência de escrita? Avaliar se um esquema por coleção seria necessário (relaciona com Q2).
- **Q5** Para movimento de token de múltiplos jogadores simultâneos sobre o mesmo token (caso raro), basta LWW ou precisamos de uma trava efêmera de "quem está arrastando"? Definir com o time de canvas (`06-canvas-e-renderizacao.md`).
- **Q6** Force pan deve ser cancelável/recusável pelo jogador (acessibilidade — movimento de câmera forçado pode causar desconforto)? Cruzar com `23-acessibilidade-e-dispositivos.md`.
- **Q7** Precisamos de um log de ops persistente (event sourcing parcial) para auditoria/replay já no MVP, ou o buffer em memória basta? Cruzar com `24-operacao-backups-telemetria.md`.

## Referências

- `docs/research/06-foundry-rede-multiplayer.md` — protocolo de CRUD por diff e broadcast autoritativo (§3), SocketInterface e padrão ack/broadcast (§3), CONFIG.queries e canal namespaced de sistemas/módulos (§4), roles e permissões de presença (§5), cursores e pings (§6, §7), force pan via Drag Ping (§7), last-writer-wins e buffer de atualizações no carregamento (§8), reconexão e latência por usuário (§8).
- `docs/research/01-foundry-arquitetura-stack.md` — arquitetura cliente/servidor desacoplada (§2), evolução do transporte de tempo real socket.io → WebSocket nativo (§7.1), padrão de mensagens e roteamento por categoria (§7.2), lições arquiteturais para o Fusion (§11.2).
