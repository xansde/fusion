# 05 — Usuários e Permissões

**Status:** draft v0.1
**Data:** 2026-06-11
**Baseada em:**

- `docs/research/06-foundry-rede-multiplayer.md` — Roles, ownership, sessões, presença
- `docs/research/91-fusion-security-threat-model.md` — Argon2id, JWT, rate limiting, CSWSH

---

## Objetivo

Definir o modelo completo de identidade de usuário do Fusion: estrutura de dados,
roles e capacidades, ownership de documentos, fluxo de autenticação (login/logout/kick),
administração pelo GM e mecanismo de convite para novos jogadores.

O Fusion não tem contas globais — cada World tem sua própria lista de usuários, isolada dos
demais Worlds. A autenticação ocorre sempre no contexto de um World específico.

---

## Escopo

### Inclui

- Modelo de dados do `User` (campos, tipagem TypeScript, persistência em SQLite)
- Definição dos quatro roles funcionais e sua matriz de capacidades padrão (configurável pelo GM)
- Sistema de ownership por documento (níveis NONE / LIMITED / OBSERVER / OWNER)
- Fluxo completo de login: tela de join, seleção de usuário, senha, emissão de sessão JWT
- Refresh de token e logout
- Kick de jogador pelo GM (revogação imediata de sessão)
- CRUD de usuários pelo GM (criar, editar, resetar senha, atribuir role)
- URL de convite para o World (LAN e internet)

### Não inclui

- Admin Key da instalação do servidor (escopo de `22-instalacao-e-distribuicao.md`)
- Configuração de TLS / reverse proxy (escopo de `21-seguranca.md`)
- Rate limiting de WebSocket / uploads (escopo de `21-seguranca.md`)
- Autenticação A/V WebRTC (fora do MVP)
- SSO / OAuth externo (fora do escopo — decisão de design; ver Questões em aberto)
- Permissões de acesso a pastas de assets (escopo de `20-assets-e-midia.md`)

---

## Conceitos e Terminologia

| Termo             | Definição                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **User**          | Entidade de identidade dentro de um World. Um mesmo humano pode ter Users em Worlds distintos sem relação entre eles. |
| **Role**          | Papel funcional que determina as capacidades padrão do User: `PLAYER`, `TRUSTED`, `ASSISTANT`, `GAMEMASTER`.          |
| **Ownership**     | Nível de acesso de um User a um Document específico: `NONE`, `LIMITED`, `OBSERVER`, `OWNER`.                          |
| **World**         | Instância de jogo independente com seu próprio banco `world.db`.                                                      |
| **Access Token**  | JWT de curta duração (15 min) usado para autenticar requisições HTTP e upgrade WebSocket.                             |
| **Refresh Token** | Token opaco de longa duração (30 dias) armazenado em cookie `httpOnly`, trocado por novos Access Tokens.              |
| **Session**       | Estado de conexão ativa de um User, associada a um par Access+Refresh token válidos.                                  |
| **Kick**          | Revogação imediata de sessão pelo GM, desconectando o User e invalidando seus tokens.                                 |
| **Permission**    | Capacidade configurável associada a um role mínimo (ex.: `DRAWING_CREATE` requer `TRUSTED` por padrão).               |
| **Admin Key**     | Senha separada que protege a tela de setup do servidor. Não é gerenciada por esta spec.                               |

---

## Decisões de Design

### DEC-USR-01 — Quatro roles (sem `NONE` como role ativo)

**Decisão:** O Fusion define exatamente quatro roles ativos: `PLAYER`, `TRUSTED`, `ASSISTANT`, `GAMEMASTER`.
Usuários bloqueados não recebem um role especial — a coluna `active: boolean` na tabela `users` determina
se o User pode fazer login. Um User inativo é equivalente ao role `NONE` do Foundry.

**Alternativas rejeitadas:**

- Cinco roles incluindo `NONE` numérico: adicionaria complexidade desnecessária; `active` cobre o caso de uso de bloqueio de forma mais explícita.
- Roles completamente custom pelo GM: aumentaria superfície de bugs em verificações de permissão; os quatro roles cobrem todos os casos de uso documentados no research.

**Racional:** Simplifica o código de verificação (`user.role >= Role.ASSISTANT`) sem perder expressividade. O campo `active` permite suspender um usuário sem deletar seu histórico de ownership.

---

### DEC-USR-02 — Argon2id para hashing de senhas

**Decisão:** Todas as senhas (de usuários de World) são hasheadas com **Argon2id** usando parâmetros mínimos:
`memory=65536 KiB`, `iterations=3`, `parallelism=4`. Pacote: `@node-rs/argon2` (bindings Rust/NAPI, sem
dependência de node-gyp).

**Alternativas rejeitadas:**

- bcrypt: aceitável mas limitado a 72 bytes; Argon2id é mais resistente a ataques com hardware especializado.
- scrypt: menor suporte em auditorias de segurança; menos conveniente como dependência Node.
- PBKDF2 / SHA puro: sem memory-hardness; descartado por orientação OWASP 2025.

**Racional:** Foundry migrou de "access keys" informais para senhas hasheadas (v0.8.7). O Fusion nasce com
hashing seguro desde o MVP. `@node-rs/argon2` não exige compilação nativa complexa, simplificando o build
em Windows (máquina do GM).

---

### DEC-USR-03 — Sessão JWT + refresh token httpOnly

**Decisão:** Login emite dois tokens:

1. **Access token** — JWT assinado com HMAC-SHA256 (chave gerada na instalação), expiração 15 minutos. Enviado
   pelo cliente como `Authorization: Bearer <token>` em requests REST e como query param `?token=` no
   upgrade WebSocket (browsers não permitem setar headers custom no WS upgrade).
2. **Refresh token** — UUID v4 opaco, armazenado hasheado na tabela `sessions`, entregue como cookie
   `httpOnly; Secure; SameSite=Strict`, expiração 30 dias. Cada refresh rotaciona o token (reuse detection).

**Alternativas rejeitadas:**

- Sessão puramente baseada em cookie de sessão (sem JWT): não permite autenticação sem-estado no WebSocket
  sem consultar o banco a cada mensagem; aumenta latência.
- JWT de longa duração sem refresh: impede revogação imediata (kick); contradiz requisito de segurança.
- Modelo "senha por sessão" do Foundry (sem token expirado): ausência de revogação real é vetor de segurança
  documentado no threat model (research 91).

**Racional:** O modelo JWT + refresh é o padrão da indústria para SPAs com WebSocket. O refresh em cookie
`httpOnly` protege contra XSS. A rotação detecta reuso de tokens furtados. O kick invalida a entrada na
tabela `sessions` — o próximo refresh falha e o usuário é desconectado.

---

### DEC-USR-04 — Matriz de permissões configurável pelo GM

**Decisão:** Existe um conjunto fixo de `Permission` keys (similar ao `USER_PERMISSIONS` do Foundry). Cada
Permission tem um `defaultRole` — o role mínimo que a possui por padrão. O GM pode elevar ou reduzir o
`defaultRole` de cada Permission via painel de administração. As overrides são armazenadas em
`world_settings` (tabela de configurações do World).

**Alternativas rejeitadas:**

- Permissões completamente hard-coded por role: impede que GMs configurem mesas mais abertas ou fechadas
  conforme o grupo.
- Permissões totalmente livres (GM cria as próprias): aumentaria complexidade e risco de configuração
  incorreta que quebre o sistema.

**Racional:** Equilibra flexibilidade (GM pode ajustar o nível de confiança do grupo) com previsibilidade
(o conjunto de Permissions é fixo e testável). A abordagem espelha o que foi documentado no Foundry como
bem-sucedida na prática.

---

### DEC-USR-05 — Ownership por documento com chave `"default"`

**Decisão:** Cada Document que suporta ownership (Actor, Item, JournalEntry, RollTable, Playlist) possui
um campo `ownership: Record<string, OwnershipLevel>`. A chave é `userId`; a chave especial `"default"`
define o nível para todos os usuários não listados explicitamente. GMs sempre têm `OWNER` implícito,
independente do campo `ownership`.

**Alternativas rejeitadas:**

- Ownership apenas por role (sem granularidade por Document): impede que o GM atribua um Actor específico
  a um jogador específico; inviabiliza fichas de personagem individuais.
- Ownership baseado em grupos/times: complexidade desnecessária para o escopo de uma mesa de RPG.

**Racional:** O modelo do Foundry (documentado em research 06) é comprovadamente funcional para VTTs.
A chave `"default"` elimina a necessidade de listar todos os usuários em todos os documentos.

---

### DEC-USR-06 — Senhas opcionais por usuário (mas Admin Key obrigatória)

**Decisão:** Usuários de World podem existir sem senha configurada — neste caso, a seleção do nome na tela
de join é suficiente para autenticar. A Admin Key do servidor é obrigatória e gerada no first-run wizard
(escopo de `22-instalacao-e-distribuicao.md`). O GM pode (e é recomendado) configurar senhas para todos
os usuários via painel de administração.

**Alternativas rejeitadas:**

- Senhas obrigatórias para todos: barreira de entrada desnecessária para grupos que jogam em LAN fechada;
  decisão de segurança deve ser do GM, não imposta pelo sistema.
- Sem senhas de forma alguma: inaceitável para grupos que expõem o servidor à internet.

**Racional:** O Foundry permite usuários sem senha; o Fusion mantém essa flexibilidade mas a documenta
claramente como risco. O painel de admin exibirá alerta visual para usuários sem senha quando o servidor
detectar acesso externo (IP não-LAN).

---

## Requisitos Funcionais

### Modelo de Usuário

**REQ-USR-001** [MVP] O sistema deve manter uma tabela `users` por World com os campos:
`id` (UUID), `name` (string, único no World), `role` (enum), `color` (string hex),
`avatar` (string path ou URL), `password_hash` (string nullable), `active` (boolean),
`preferences` (JSON), `created_at`, `updated_at`.

**REQ-USR-002** [MVP] O campo `color` de cada usuário deve ser visível no canvas para outros usuários
(cursor ao vivo, régua de medição, pings). Deve ser único por World — o sistema sugere cores distintas
ao criar um novo usuário.

**REQ-USR-003** [MVP] O campo `preferences` deve suportar no mínimo: idioma preferido (`locale`),
configuração de notificações de chat, zoom/pan padrão do canvas, e configurações de áudio local. O
schema de `preferences` é extensível sem migrações de banco (campo JSON).

**REQ-USR-004** [MVP] O campo `avatar` aceita path relativo dentro da pasta `assets/` do World ou URL
absoluta HTTPS. Caminhos externos não-HTTPS são rejeitados com erro de validação.

### Roles e Capacidades

**REQ-USR-005** [MVP] O sistema deve implementar quatro roles em ordem crescente de capacidade:
`PLAYER` (1), `TRUSTED` (2), `ASSISTANT` (3), `GAMEMASTER` (4). A verificação de capacidade deve
usar comparação numérica (`user.role >= requiredRole`).

**REQ-USR-006** [MVP] O role `GAMEMASTER` deve ter acesso implícito de `OWNER` a todos os Documents
do World, independente do campo `ownership`. Esta regra é verificada no servidor antes de qualquer
checagem de `ownership`.

**REQ-USR-007** [MVP] O role `ASSISTANT` deve ter as mesmas capacidades de jogo do `GAMEMASTER` (ver
matriz de Permissions) exceto: alterar roles de usuários, deletar o World, configurar opções globais
do servidor.

**REQ-USR-008** [MVP] O sistema deve implementar o conjunto de Permissions configuráveis abaixo, com
seus `defaultRole` iniciais:

| Permission Key    | Default Role | Descrição                                                  |
| ----------------- | ------------ | ---------------------------------------------------------- |
| `ACTOR_CREATE`    | ASSISTANT    | Criar novos Atores                                         |
| `DRAWING_CREATE`  | TRUSTED      | Criar desenhos no canvas                                   |
| `FILES_BROWSE`    | TRUSTED      | Navegar no gerenciador de assets                           |
| `FILES_UPLOAD`    | ASSISTANT    | Fazer upload de arquivos                                   |
| `ITEM_CREATE`     | ASSISTANT    | Criar novos Itens                                          |
| `JOURNAL_CREATE`  | TRUSTED      | Criar entradas de diário                                   |
| `MACRO_SCRIPT`    | PLAYER       | Executar macros de script (ver `14-macros-e-automacao.md`) |
| `MANUAL_ROLLS`    | TRUSTED      | Inserir resultado de dado manualmente                      |
| `MESSAGE_WHISPER` | PLAYER       | Enviar whispers no chat                                    |
| `NOTE_CREATE`     | TRUSTED      | Criar notas no canvas                                      |
| `PING_CANVAS`     | PLAYER       | Pingar localização no mapa                                 |
| `PLAYLIST_CREATE` | ASSISTANT    | Criar playlists de áudio                                   |
| `SHOW_CURSOR`     | PLAYER       | Exibir cursor ao vivo                                      |
| `SHOW_RULER`      | PLAYER       | Exibir régua de medição                                    |
| `TABLE_CREATE`    | ASSISTANT    | Criar tabelas aleatórias                                   |
| `TOKEN_CONFIGURE` | TRUSTED      | Configurar tokens no canvas                                |
| `TOKEN_CREATE`    | ASSISTANT    | Criar tokens no canvas                                     |
| `TOKEN_DELETE`    | ASSISTANT    | Deletar tokens do canvas                                   |
| `WALL_DOORS`      | PLAYER       | Interagir com portas e passagens                           |

**REQ-USR-009** [MVP] O GM pode alterar o `defaultRole` de qualquer Permission acima via painel de
administração. A alteração persiste em `world_settings` e tem efeito imediato para todos os usuários
conectados (broadcast via evento `permissionsUpdated`).

**REQ-USR-010** [MVP] A verificação `user.can(permissionKey)` deve:

1. Retornar `true` se `user.role === GAMEMASTER`.
2. Consultar o `defaultRole` efetivo da Permission (base ou override armazenado em `world_settings`).
3. Retornar `user.role >= effectiveDefaultRole`.
   Esta verificação acontece **no servidor** antes de qualquer operação privilegiada.

**REQ-USR-011** [MVP] GMs e ASSISTANTs podem realizar "force pan" (redirecionar câmera de todos os
usuários para um ponto do canvas via Drag Ping). Esta capacidade é hard-coded por role, não configurável
via matriz de Permissions.

### Ownership de Documentos

**REQ-USR-012** [MVP] Documents dos tipos Actor, Item, JournalEntry, RollTable e Playlist devem
suportar o campo `ownership: Record<string, 0 | 1 | 2 | 3>`. A chave `"default"` define o nível
para usuários não listados. Ausência da chave `"default"` equivale a `0` (NONE).

**REQ-USR-013** [MVP] Os níveis de ownership devem ter a seguinte semântica:

| Nível      | Valor | Semântica                                                          |
| ---------- | ----- | ------------------------------------------------------------------ |
| `NONE`     | 0     | Documento invisível na UI (exceto se o sistema de visão o revelar) |
| `LIMITED`  | 1     | Visível com conteúdo parcial (definido pelo sistema de jogo)       |
| `OBSERVER` | 2     | Leitura completa; sem modificação                                  |
| `OWNER`    | 3     | Leitura e modificação completas                                    |

**REQ-USR-014** [MVP] O servidor deve verificar o ownership antes de processar qualquer operação de
`update` ou `delete` em Documents com ownership. Operações recusadas por falta de permissão retornam
evento `error` com código `PERMISSION_DENIED` (sem revelar existência do Document para NONE).

**REQ-USR-015** [MVP] O GM pode alterar o `ownership` de qualquer Document via interface dedicada.
A alteração é processada como um `update` normal ao Document, com broadcast para todos os clientes,
que atualizam sua visibilidade local em tempo real.

**REQ-USR-016** [V2] Ownership em batch: o GM pode selecionar múltiplos Documents e aplicar
alterações de ownership em lote.

### Fluxo de Login

**REQ-USR-017** [MVP] A tela de join do World deve exibir a lista de usuários `active: true` do World.
Usuários com `active: false` não aparecem na lista.

**REQ-USR-018** [MVP] Ao selecionar um usuário sem `password_hash`, o login é imediato (sem campo de
senha). Ao selecionar um usuário com `password_hash`, o campo de senha é exibido e obrigatório.

**REQ-USR-019** [MVP] O endpoint `POST /auth/login` deve:

1. Receber `{ userId, password? }`.
2. Verificar `user.active`.
3. Verificar senha com Argon2id (se `password_hash` não for null).
4. Em caso de sucesso: emitir Access Token JWT (exp: 15 min) + Refresh Token (UUID v4, exp: 30 dias).
5. Armazenar `hash(refreshToken)` na tabela `sessions` com `userId`, `createdAt`, `expiresAt`, `revokedAt`.
6. Retornar Access Token no body; Refresh Token como cookie `httpOnly; Secure; SameSite=Strict`.

**REQ-USR-020** [MVP] O endpoint `POST /auth/refresh` deve:

1. Ler o Refresh Token do cookie.
2. Verificar `sessions` (não revogado, não expirado).
3. Rotacionar: marcar o token atual como revogado, emitir novo par Access+Refresh.
4. Detectar reuso: se o token estava revogado, invalidar TODA a família de tokens do usuário e logar evento de segurança.

**REQ-USR-021** [MVP] O upgrade WebSocket deve exigir um Access Token válido. O cliente envia o
token como query parameter `?token=<jwt>` na URL de upgrade. Conexões sem token ou com token inválido
são fechadas após 5 segundos com código `4001` (Unauthorized).

**REQ-USR-022** [MVP] O endpoint `POST /auth/logout` deve:

1. Marcar o Refresh Token como revogado na tabela `sessions`.
2. Retornar cookie com max-age=0 (limpar o cookie no cliente).
3. Emitir evento `userDisconnected` para todos os clientes conectados ao World.

**REQ-USR-023** [MVP] O servidor deve aplicar rate limiting no endpoint de login: máximo 5 tentativas
falhas em 15 minutos por combinação IP+userId. Após exceder o limite, retornar HTTP 429 com header
`Retry-After`. (Implementação compartilhada com `21-seguranca.md`.)

**REQ-USR-024** [MVP] O header `Origin` deve ser validado no handshake de upgrade WebSocket contra a
lista `allowedOrigins` configurada (ou o próprio hostname do servidor). Origens não permitidas recebem
HTTP 403. (Ver `21-seguranca.md` — CSWSH.)

### Administração de Usuários pelo GM

**REQ-USR-025** [MVP] O GM deve poder criar novos usuários via painel de administração com os campos:
`name` (obrigatório, único no World), `role` (obrigatório), `color` (sugerido automaticamente),
`password` (opcional). O novo usuário é persistido e aparece imediatamente na tela de join. Criar um
usuário de papel **não privilegiado** (`PLAYER` ou `TRUSTED`, DEC-USR-01) DEVE criar, no mesmo gesto,
um **personagem em branco** associado a ele — um Actor de subtipo `character` que nasce com o próprio
usuário como `OWNER` (REQ-USR-025a). Para papel privilegiado (`ASSISTANT`, `GAMEMASTER`) nenhum
personagem é criado.

> **Emenda de 2026-08-16** — obrigada pela `42` §12 (DEC-NPC-02). Personagem de jogador não nasce em
> aba nenhuma da gaveta: a aba NPCs não oferece o subtipo `character` na criação, em tela alguma dela
> (REQ-NPC-044, CA-NPC-007), e a aba Contatos deixou de criar ator (DEC-CTT-01). (Quem trata de
> **excluir** personagem de jogador é REQ-NPC-055, não a criação.) Este é, portanto, o único endereço
> da criação de personagem — e com isso a administração de usuários passa a ter consequência sobre
> Documents, o que ela não tinha.
> Personagem sem dono seria documento órfão: nascer junto do usuário resolve criação e `ownership` no
> mesmo gesto. A tela que executa esse gesto é a seção Usuários da `37` (REQ-CFG-051).

**REQ-USR-025a** [MVP] O personagem criado por REQ-USR-025 DEVE nascer com `ownership.default = none`
e `ownership.<userId do novo usuário> = owner` (REQ-DOC-027), mesmo tendo sido criado por um GM — é
uma exceção declarada ao default de criação por GM de REQ-DOC-029, porque o dono pretendido não é o
criador. O GM continua resolvendo `owner` pelo papel (REQ-DOC-028), sem entrada explícita no mapa.

**REQ-USR-025b** [MVP] "Em branco" significa que o personagem nasce apenas com nome (derivado do
nome do usuário) e subtipo `character`, sem preenchimento de sistema de jogo. A criação NÃO DEVE
abrir ficha, janela flutuante nem qualquer tela além da que o GM já estava operando.

**REQ-USR-025c** [MVP] Criar o usuário e criar o personagem DEVEM ser um único gesto atômico: se o
personagem não puder ser criado, o servidor DEVE recusar a operação inteira e não persistir o
usuário. NÃO DEVE existir usuário de papel não privilegiado criado por REQ-USR-025 sem personagem
associado.

**REQ-USR-025d** [MVP] Nenhuma outra ação de administração cria ou remove personagem: editar um
usuário (REQ-USR-026, inclusive mudança de papel), resetar senha (REQ-USR-027), desativar
(REQ-USR-028) e fazer kick (REQ-USR-029) NÃO DEVEM criar um segundo personagem nem excluir o
existente. Dar um **segundo** personagem a um jogador que já tem um é [V2] e não é gesto desta tela
(REQ-NPC-055a); excluir personagem de jogador segue sem tela em lugar nenhum do produto (Q-NPC-06).

**REQ-USR-026** [MVP] O GM deve poder editar os campos `name`, `role`, `color`, `avatar` e `active`
de qualquer usuário (inclusive outros GMs). Não é possível rebaixar o único GM ativo do World para
outro role — o sistema deve recusar com mensagem de erro clara.

**REQ-USR-027** [MVP] O GM deve poder resetar a senha de qualquer usuário. O reset gera uma nova senha
temporária exibida uma única vez no painel (ou remove a senha se o GM optar). Todas as sessões ativas
do usuário são revogadas automaticamente ao resetar a senha.

**REQ-USR-028** [MVP] O GM deve poder desativar (`active: false`) um usuário. O usuário desativado
tem todas as sessões revogadas imediatamente e não aparece na tela de join.

**REQ-USR-029** [MVP] O GM deve poder fazer kick de um usuário conectado. O kick:

1. Revoga todas as entradas de `sessions` do usuário.
2. Emite evento WebSocket `kick` diretamente para a conexão do usuário com motivo opcional.
3. O cliente ao receber `kick` exibe mensagem e redireciona para a tela de join.
4. O servidor fecha a conexão WebSocket após 3 segundos (grace period para o cliente exibir a mensagem).

**REQ-USR-030** [MVP] Todas as ações de administração de usuários devem ser restritas ao role
`GAMEMASTER`. O role `ASSISTANT` não pode criar, editar, desativar nem resetar senhas de usuários.

**REQ-USR-031** [MVP] O painel de administração deve exibir para o GM:

- Lista de todos os usuários (ativos e inativos) com role, cor e status de conexão (online/offline).
- Indicador de latência para usuários conectados (RTT medido via ping/pong WebSocket).
- Alerta visual para usuários sem senha quando o servidor detectar acessos de IPs fora da subnet LAN.

### Autoatendimento de senha

> **Adicionada em 2026-08-17** — fecha a lacuna registrada pela `docs/design/gaveta-lateral/tasks-ajustes-r1.md`
> (item 30, A061): nem esta spec nem a `37-configuracoes.md` mencionavam troca da própria senha. O único
> fluxo de senha documentado até aqui era o reset **pelo GM sobre outro usuário** (REQ-USR-027,
> REQ-CFG-051/053) — não havia self-service. Estes três requisitos e o endpoint correspondente fecham a
> spec; a implementação (campo em `PreferencesSection.svelte` + handler do endpoint) é PR seguinte,
> fora do escopo deste ajuste.

**REQ-USR-040** [MVP] Qualquer usuário autenticado (qualquer role, inclusive `PLAYER`) deve poder trocar a
própria senha informando a senha atual como confirmação. O servidor deve verificar a senha atual com
Argon2id (DEC-USR-02) antes de gravar a nova; senha atual incorreta deve ser recusada com HTTP 401, sem
revelar se o usuário tem ou não senha cadastrada.

**REQ-USR-041** [MVP] Trocar a própria senha NÃO DEVE depender de outro usuário nem exigir role
`GAMEMASTER`; é um fluxo distinto do reset de senha por terceiro (REQ-USR-027), que continua exclusivo do
GM e não exige a senha atual.

**REQ-USR-042** [MVP] Ao trocar a própria senha com sucesso, o servidor deve revogar todas as demais
sessões ativas do usuário (mesma régua de REQ-USR-027), mantendo válida apenas a sessão que originou a
troca.

### Presença e Estado Online

**REQ-USR-032** [MVP] Ao conectar via WebSocket, o servidor deve emitir evento `userConnected` para
todos os clientes do World com o `userId` e metadados básicos (nome, cor, role). Ao desconectar
(qualquer motivo), emitir `userDisconnected`.

**REQ-USR-033** [MVP] O cliente deve manter localmente o estado `users: Map<userId, UserPresence>`
com `online: boolean`, `sceneId: string | null` (cena ativa do usuário) e `color`.

**REQ-USR-034** [MVP] A coleção de usuários conectados é inicializada no payload de `worldReady`
(handshake inicial do WebSocket), eliminando a necessidade de request HTTP adicional.

**REQ-USR-035** [V2] O servidor deve exibir um indicador de latência por usuário no painel do GM,
medido via ping/pong WebSocket periódico (intervalo configurável, padrão 30s).

### Convites e Acesso Externo

**REQ-USR-036** [MVP] O servidor deve gerar e exibir ao GM uma **URL de convite** no formato:
`http(s)://<hostname>:<port>/join?world=<worldId>`. O hostname e porta são configuráveis em
`fusion.json` (campos `hostname`, `port`, `proxySSL`, `proxyPort`) para funcionar corretamente
atrás de reverse proxy.

**REQ-USR-037** [MVP] A tela de join deve ser acessível sem autenticação (endpoint público). Apenas
a lista de `name` dos usuários ativos é exposta — campos como `password_hash`, `preferences` e
`ownership` não são retornados por este endpoint.

**REQ-USR-038** [MVP] O painel de administração deve exibir a URL de convite LAN (IP local detectado
automaticamente) e, se `hostname` estiver configurado, a URL de convite internet. Deve incluir link
para a documentação de `22-instalacao-e-distribuicao.md` com instruções de port-forwarding e opções
de túnel (Cloudflare Tunnel, ngrok/Pinggy).

**REQ-USR-039** [V2] Geração de link de convite com token de uso único (expiração configurável),
permitindo que um novo usuário seja criado automaticamente ao acessar o link pela primeira vez.

---

## Requisitos Não-Funcionais

**REQ-USR-NF-001** [MVP] O hashing de senha com Argon2id não deve bloquear o event loop do Node.js.
A implementação deve usar a API assíncrona de `@node-rs/argon2` (`hash()` / `verify()` retornam
Promises).

**REQ-USR-NF-002** [MVP] A verificação de permissão (`user.can(permissionKey)`) deve ser executada
em O(1) — lookup em Map em memória, sem consulta ao banco por verificação.

**REQ-USR-NF-003** [MVP] A tabela `sessions` deve ter índice em `(userId, revokedAt)` para busca
eficiente na validação de refresh tokens.

**REQ-USR-NF-004** [MVP] O Access Token JWT deve ser verificado em memória (sem round-trip ao banco)
em todo request HTTP e upgrade WebSocket. O segredo HMAC-SHA256 é carregado na inicialização do
servidor a partir de `fusion.json` e mantido em memória.

**REQ-USR-NF-005** [MVP] O kick de um usuário deve ser processado e a conexão encerrada em menos de
3 segundos a partir do comando do GM.

---

## Modelo de Dados

### Tabela `users` (SQLite — `world.db`)

```typescript
// packages/shared/src/types/user.ts

export enum Role {
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT = 3,
  GAMEMASTER = 4,
}

export enum OwnershipLevel {
  NONE = 0,
  LIMITED = 1,
  OBSERVER = 2,
  OWNER = 3,
}

export interface UserRecord {
  id: string; // DocumentId: nanoid de 16 chars [A-Za-z0-9] (User é Document; ver 02-modelo-de-dados.md REQ-DOC-001)
  name: string; // único no World
  role: Role;
  color: string; // hex, ex: "#e03030"
  avatar: string | null; // path relativo em assets/ ou URL HTTPS
  password_hash: string | null; // Argon2id hash; null = sem senha
  active: boolean;
  preferences: UserPreferences; // armazenado como JSON em SQLite
  created_at: string; // ISO 8601
  updated_at: string;
}

export interface UserPreferences {
  locale?: string; // "pt-BR" | "en"
  chatNotifications?: boolean;
  defaultZoom?: number; // 0.25 – 3.0
  audioVolume?: number; // 0.0 – 1.0
  [key: string]: unknown; // extensível por sistemas de jogo
}

// Payload seguro retornado ao cliente (sem password_hash)
export interface UserPublic {
  id: string;
  name: string;
  role: Role;
  color: string;
  avatar: string | null;
  active: boolean;
  preferences: UserPreferences;
}

// Presença em tempo real (broadcast via WebSocket)
export interface UserPresence {
  userId: string;
  online: boolean;
  sceneId: string | null;
  color: string;
  latencyMs?: number; // [V2] medido via ping/pong
}
```

### Tabela `sessions` (SQLite — `world.db`)

```typescript
export interface SessionRecord {
  id: string; // UUID v4 — identificador da sessão
  user_id: string; // FK → users.id
  refresh_token_hash: string; // SHA-256 do refresh token opaco
  family_id: string; // UUID compartilhado por tokens rotacionados (reuse detection)
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}
```

### Tabela `world_settings` — entrada de permissions

```typescript
// Chave: "permissions.{PERMISSION_KEY}"
// Valor: Role numérico (1-4)
// Exemplo: { key: "permissions.DRAWING_CREATE", value: "2" }
```

### Ownership em Documents

```typescript
// Campo embutido em qualquer Document que suporta ownership
export type OwnershipMap = {
  default?: OwnershipLevel; // nível padrão para usuários não listados
  [userId: string]: OwnershipLevel;
};

// Exemplo:
// { "default": 0, "abc123": 3, "def456": 2 }
// → abc123 é OWNER, def456 é OBSERVER, todos os demais são NONE
```

### Permissões configuráveis (definição em código)

```typescript
export interface PermissionDefinition {
  key: string;
  defaultRole: Role;
  description: string; // i18n key
}

// Registro completo — mantido em packages/shared/src/permissions.ts
export const PERMISSIONS: Record<string, PermissionDefinition> = {
  ACTOR_CREATE: {
    key: "ACTOR_CREATE",
    defaultRole: Role.ASSISTANT,
    description: "permission.actorCreate",
  },
  DRAWING_CREATE: {
    key: "DRAWING_CREATE",
    defaultRole: Role.TRUSTED,
    description: "permission.drawingCreate",
  },
  FILES_BROWSE: {
    key: "FILES_BROWSE",
    defaultRole: Role.TRUSTED,
    description: "permission.filesBrowse",
  },
  FILES_UPLOAD: {
    key: "FILES_UPLOAD",
    defaultRole: Role.ASSISTANT,
    description: "permission.filesUpload",
  },
  ITEM_CREATE: {
    key: "ITEM_CREATE",
    defaultRole: Role.ASSISTANT,
    description: "permission.itemCreate",
  },
  JOURNAL_CREATE: {
    key: "JOURNAL_CREATE",
    defaultRole: Role.TRUSTED,
    description: "permission.journalCreate",
  },
  MACRO_SCRIPT: {
    key: "MACRO_SCRIPT",
    defaultRole: Role.PLAYER,
    description: "permission.macroScript",
  },
  MANUAL_ROLLS: {
    key: "MANUAL_ROLLS",
    defaultRole: Role.TRUSTED,
    description: "permission.manualRolls",
  },
  MESSAGE_WHISPER: {
    key: "MESSAGE_WHISPER",
    defaultRole: Role.PLAYER,
    description: "permission.messageWhisper",
  },
  NOTE_CREATE: {
    key: "NOTE_CREATE",
    defaultRole: Role.TRUSTED,
    description: "permission.noteCreate",
  },
  PING_CANVAS: {
    key: "PING_CANVAS",
    defaultRole: Role.PLAYER,
    description: "permission.pingCanvas",
  },
  PLAYLIST_CREATE: {
    key: "PLAYLIST_CREATE",
    defaultRole: Role.ASSISTANT,
    description: "permission.playlistCreate",
  },
  SHOW_CURSOR: {
    key: "SHOW_CURSOR",
    defaultRole: Role.PLAYER,
    description: "permission.showCursor",
  },
  SHOW_RULER: { key: "SHOW_RULER", defaultRole: Role.PLAYER, description: "permission.showRuler" },
  TABLE_CREATE: {
    key: "TABLE_CREATE",
    defaultRole: Role.ASSISTANT,
    description: "permission.tableCreate",
  },
  TOKEN_CONFIGURE: {
    key: "TOKEN_CONFIGURE",
    defaultRole: Role.TRUSTED,
    description: "permission.tokenConfigure",
  },
  TOKEN_CREATE: {
    key: "TOKEN_CREATE",
    defaultRole: Role.ASSISTANT,
    description: "permission.tokenCreate",
  },
  TOKEN_DELETE: {
    key: "TOKEN_DELETE",
    defaultRole: Role.ASSISTANT,
    description: "permission.tokenDelete",
  },
  WALL_DOORS: { key: "WALL_DOORS", defaultRole: Role.PLAYER, description: "permission.wallDoors" },
};
```

---

## API e Eventos

### Endpoints REST (Fastify)

| Método   | Path                            | Auth        | Descrição                                                                       |
| -------- | ------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `GET`    | `/join?world=<id>`              | Pública     | Retorna lista de usuários ativos (somente `id`, `name`, `color`, `hasPassword`) |
| `POST`   | `/auth/login`                   | Pública     | Autenticar usuário; retorna Access Token + seta cookie Refresh                  |
| `POST`   | `/auth/refresh`                 | Cookie      | Renovar Access Token; rotaciona Refresh Token                                   |
| `POST`   | `/auth/logout`                  | Bearer      | Revogar sessão atual                                                            |
| `GET`    | `/api/users`                    | Bearer (GM) | Listar todos os usuários do World                                               |
| `POST`   | `/api/users`                    | Bearer (GM) | Criar novo usuário                                                              |
| `PATCH`  | `/api/users/:id`                | Bearer (GM) | Editar usuário (name, role, color, avatar, active)                              |
| `POST`   | `/api/users/:id/reset-password` | Bearer (GM) | Resetar senha; retorna nova senha temporária                                    |
| `POST`   | `/api/users/me/password`        | Bearer      | Trocar a própria senha (exige senha atual; REQ-USR-040)                         |
| `DELETE` | `/api/users/:id`                | Bearer (GM) | Desativar usuário (soft delete — `active: false`)                               |
| `POST`   | `/api/users/:id/kick`           | Bearer (GM) | Kick imediato de usuário conectado                                              |
| `GET`    | `/api/permissions`              | Bearer      | Retorna mapa atual de permissions (base + overrides)                            |
| `PATCH`  | `/api/permissions`              | Bearer (GM) | Atualizar defaultRole de uma ou mais Permissions                                |

### Eventos WebSocket (socket.io v4)

#### Servidor → Cliente

| Evento               | Payload                                                             | Descrição                                                           |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `worldReady`         | `{ users: UserPresence[], permissions: Record<string, Role>, ... }` | Handshake inicial; inclui estado completo de usuários e permissions |
| `userConnected`      | `UserPresence`                                                      | Um usuário conectou ao World                                        |
| `userDisconnected`   | `{ userId: string }`                                                | Um usuário desconectou                                              |
| `userUpdated`        | `UserPublic`                                                        | Dados de um usuário foram alterados pelo GM                         |
| `permissionsUpdated` | `Record<string, Role>`                                              | Mapa de permissions foi alterado pelo GM                            |
| `kick`               | `{ reason?: string }`                                               | Enviado para o usuário que está sendo kickado                       |

#### Cliente → Servidor

| Evento               | Payload                       | Descrição                                         |
| -------------------- | ----------------------------- | ------------------------------------------------- |
| `auth`               | `{ token: string }`           | Enviado imediatamente após connect; timeout de 5s |
| `userPresenceUpdate` | `{ sceneId: string \| null }` | Atualiza a cena ativa do usuário                  |

---

## Dependências (Specs Irmãs)

| Spec                              | Dependência                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-arquitetura-geral.md`         | Estrutura de pacotes do monorepo; localização de `packages/shared` e `packages/server`                                                                                  |
| `02-modelo-de-dados.md`           | Definição base de Document e campo `ownership`                                                                                                                          |
| `03-persistencia-e-mundos.md`     | Tabelas SQLite `users`, `sessions`, `world_settings`; WAL mode                                                                                                          |
| `04-rede-e-sincronizacao.md`      | Protocolo WebSocket; handshake `worldReady`; broadcast de eventos                                                                                                       |
| `14-macros-e-automacao.md`        | Permission `MACRO_SCRIPT`; sandbox de execução de macros                                                                                                                |
| `20-assets-e-midia.md`            | Permission `FILES_BROWSE` / `FILES_UPLOAD`; diretórios por role                                                                                                         |
| `21-seguranca.md`                 | Rate limiting de login/WebSocket; validação de Origin (CSWSH); TLS                                                                                                      |
| `22-instalacao-e-distribuicao.md` | Admin Key; `fusion.json` (hostname, port, proxySSL); instruções de port-forwarding/túnel para URL de convite                                                            |
| `37-configuracoes.md`             | Seção Usuários da gaveta — a tela que executa REQ-USR-025..029 (REQ-CFG-050..054); seção Minhas preferências — o formulário que executa REQ-USR-040..042 (REQ-CFG-027)  |
| `42-aba-npcs.md`                  | DEC-NPC-02: personagem de jogador nasce com o usuário, não na aba NPCs (REQ-NPC-044, REQ-NPC-055a); excluir personagem de jogador não é gesto daquela aba (REQ-NPC-055) |

---

## Critérios de Aceitação

**CA-USR-01** Um usuário sem senha pode fazer login selecionando seu nome na tela de join sem
informar senha, e receber um Access Token JWT válido que autoriza a conexão WebSocket.

**CA-USR-02** Um usuário com senha incorreta recebe HTTP 401; após 5 tentativas em 15 minutos,
o endpoint retorna HTTP 429 com `Retry-After`.

**CA-USR-03** Um usuário com role `PLAYER` tentando criar um Actor recebe evento `error` com
código `PERMISSION_DENIED` e a operação não é persistida.

**CA-USR-04** O GM altera o `defaultRole` de `DRAWING_CREATE` de `TRUSTED` para `PLAYER`;
imediatamente todos os clientes conectados recebem `permissionsUpdated` e um PLAYER pode criar
desenhos sem reconectar.

**CA-USR-05** Um Actor com `ownership: { "default": 0, "userId-A": 3 }` é visível com edição
completa para userId-A, mas não aparece na sidebar para outros jogadores (com role PLAYER).

**CA-USR-06** O GM faz kick do userId-B; em menos de 3 segundos, o cliente de userId-B exibe a
mensagem de kick e a conexão WebSocket é encerrada. Uma nova tentativa de login com o Refresh Token
antigo de userId-B falha com HTTP 401.

**CA-USR-07** Ao rotacionar o Refresh Token (via `/auth/refresh`), o token antigo é marcado como
revogado. Tentar usar o token antigo novamente invalida a família inteira e registra evento de segurança.

**CA-USR-08** O GM não pode rebaixar o único usuário com role `GAMEMASTER` — o servidor retorna
HTTP 400 com mensagem de erro explicativa.

**CA-USR-09** A URL de convite exibida no painel do GM corresponde ao `hostname` + `proxyPort`
configurados em `fusion.json` (não ao IP loopback), permitindo que jogadores externos acessem o link.

**CA-USR-10** Um usuário com `active: false` não aparece na tela de join e não consegue fazer login
mesmo com senha correta (HTTP 403).

**CA-USR-11** O GM cria um usuário com role `PLAYER` e, sem abrir nenhuma outra tela, já existe um
Actor de subtipo `character` cujo `ownership` dá `OWNER` a esse usuário e `default = none`; ao entrar
no mundo, o jogador enxerga o personagem (REQ-USR-025, REQ-USR-025a).

**CA-USR-12** O GM cria um usuário com role `GAMEMASTER`: nenhum personagem é criado. Em seguida ele
desativa e faz kick de um jogador: o personagem desse jogador continua existindo, com o mesmo
`ownership` (REQ-USR-025d).

**CA-USR-13** Um usuário `PLAYER` autenticado troca a própria senha informando a senha atual correta; o
servidor aceita, revoga as demais sessões ativas do usuário, e um login subsequente só funciona com a
nova senha. O mesmo usuário tenta trocar de novo informando a senha atual errada: recebe HTTP 401, a
senha antiga continua válida e nenhuma sessão é revogada.

---

## Questões em Aberto

1. **SSO / OAuth externo:** Há interesse futuro em suportar login com Google/Discord para facilitar
   acesso sem configurar senhas individuais? Isso afetaria o modelo de `UserRecord` e o fluxo de join.
   Postergado para [V2] se relevante.

2. **Múltiplos GMs simultâneos:** A spec permite múltiplos usuários com role `GAMEMASTER` no mesmo
   World. Isso é intencional (mesas com co-GMs)? Há alguma operação que deve ser exclusiva do "GM
   principal" (ex.: configuração de rede, backup)? A regra atual (não rebaixar o último GM) cobre
   o caso simples, mas grupos complexos podem precisar de um "GM owner" distinto.

3. **Expiração de Refresh Token configurável:** 30 dias é adequado para grupos que jogam
   semanalmente? GMs que usam o servidor em LAN podem preferir tokens sem expiração (revogação apenas
   manual). Vale expor `refreshTokenExpirationDays` em `fusion.json`?

4. **Visibilidade de NONE entre jogadores:** Um Actor com `ownership.default = 0` é completamente
   invisível para jogadores. Mas o GM pode querer que jogadores saibam que "algo existe" sem ver os
   detalhes (ex.: inimigo identificado pelo nome mas sem stats). O nível `LIMITED` cobre este caso?
   A definição de "conteúdo parcial" do nível LIMITED deve ser especificada por sistema de jogo ou
   aqui na spec base?

5. **Audit log de administração:** Ações do GM sobre usuários (criar, kick, resetar senha) devem ser
   registradas em log persistente no World? Útil para grupos com múltiplos GMs ou conflitos.
   Detalhamento em `24-operacao-backups-telemetria.md`.

6. **Convite de jogador sem conta prévia:** REQ-USR-039 [V2] propõe links de convite que criam
   usuários automaticamente. Qual o role padrão para usuários criados por convite? Deve ser
   configurável pelo GM que gerou o link?

7. **Personagem automático e papel:** REQ-USR-025 cria o personagem só para papel não privilegiado,
   lendo DEC-NPC-02 ("criar um _player_ cria um personagem") ao pé da letra. Um usuário criado como
   `ASSISTANT` ou `GAMEMASTER` que também joga fica sem personagem, e promover/rebaixar um usuário
   não muda isso (REQ-USR-025d). Se a mesa precisar do caso, o gesto de criar personagem para quem
   já existe é o mesmo [V2] de REQ-NPC-055a — ou esta regra se estende a todo papel?

---

## Anexo A — Auditoria de origem das permissões (A060, 2026-08-17)

> Registrada pela `docs/design/gaveta-lateral/tasks-ajustes-r1.md` (item 29, A060), a pedido do
> Alexandre, para revisão **futura** — este anexo não muda comportamento nenhum. Mapeia cada
> `Permission Key` de REQ-USR-008 ao(s) handler(s) que efetivamente a consomem hoje, e separa isso do
> uso de `isRolePrivileged` (limiar por role, binário) em pontos do servidor que não pertencem à matriz
> de REQ-USR-008/009. A tarefa futura, item a item: decidir se cada uma das 13 chaves sem gate deveria
> ganhar um gate granular, e se algum uso de `isRolePrivileged` abaixo deveria migrar para uma
> `Permission Key` nova.

### A.1 — As 19 `Permission Key` de REQ-USR-008 (fonte: `world-permissions.ts`)

| Permission Key    | Gate atual                                                         | Handler                                                         |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `ACTOR_CREATE`    | Granular — `resolvePermissionMinRole` (REQ-CFG-040..042)           | `doc-handlers.ts` (`CREATE_PERMISSION_KEY_BY_TYPE`, ~L200/L785) |
| `ITEM_CREATE`     | Granular — `resolvePermissionMinRole`                              | `doc-handlers.ts` (idem)                                        |
| `TABLE_CREATE`    | Granular — `resolvePermissionMinRole`                              | `doc-handlers.ts` (idem)                                        |
| `PLAYLIST_CREATE` | Granular — `resolvePermissionMinRole`                              | `doc-handlers.ts` (idem)                                        |
| `JOURNAL_CREATE`  | Granular — `resolvePermissionMinRole` (fluxo próprio, ~L818–840)   | `doc-handlers.ts`                                               |
| `TOKEN_CREATE`    | Granular — `resolvePermissionMinRole` (fluxo próprio, ~L1418–1439) | `doc-handlers.ts`                                               |
| `DRAWING_CREATE`  | **Nenhum** — sem operação de gate correspondente ainda             | —                                                               |
| `FILES_BROWSE`    | **Nenhum**                                                         | —                                                               |
| `FILES_UPLOAD`    | **Nenhum**                                                         | —                                                               |
| `MACRO_SCRIPT`    | **Nenhum**                                                         | —                                                               |
| `MANUAL_ROLLS`    | **Nenhum**                                                         | —                                                               |
| `MESSAGE_WHISPER` | **Nenhum**                                                         | —                                                               |
| `NOTE_CREATE`     | **Nenhum**                                                         | —                                                               |
| `PING_CANVAS`     | **Nenhum**                                                         | —                                                               |
| `SHOW_CURSOR`     | **Nenhum**                                                         | —                                                               |
| `SHOW_RULER`      | **Nenhum**                                                         | —                                                               |
| `TOKEN_CONFIGURE` | **Nenhum**                                                         | —                                                               |
| `TOKEN_DELETE`    | **Nenhum**                                                         | —                                                               |
| `WALL_DOORS`      | **Nenhum**                                                         | —                                                               |

Só 6 das 19 chaves (as de criação de Document via `doc-handlers.ts`) têm um gate real por
`Permission Key` hoje; as outras 13 aparecem na seção Permissões (REQ-CFG-040, "listar **as**
permissões", literal) e são ajustáveis pelo GM, mas nenhuma operação do servidor ainda as lê — a
feature correspondente (ex.: `DRAWING_CREATE`) não tem uma trava dedicada, e sim, quando tem alguma,
um `isRolePrivileged` genérico (tabela A.2) que não é a mesma coisa.

### A.2 — Uso de `isRolePrivileged` fora da matriz de REQ-USR-008 (limiar por role, não por Permission Key)

| Arquivo                              | Uso                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor-delete-handlers.ts:33`        | `isRolePrivileged` — exclusão de ator (REQ-NPC-050)                                                                                                              |
| `doc-handlers.ts`                    | `isRolePrivileged` (linhas 70, 287, 1878); `isGamemasterStrict` (1891, seções de mesa da Config.); `role >= minRole` (780, permissões configuráveis REQ-USR-010) |
| `fog-handlers.ts:78,120,154`         | `isRolePrivileged` — fog of war                                                                                                                                  |
| `folder-handlers.ts:88`              | `isRolePrivileged` — CRUD de pastas                                                                                                                              |
| `knowledge-handlers.ts:55`           | `isRolePrivileged` — conhecimento/contatos                                                                                                                       |
| `settings-handlers.ts:201`           | comentário aponta REQ-CFG-070 (`role === GAMEMASTER` no servidor)                                                                                                |
| `sync-handlers.ts:74,665`            | `isRolePrivileged` — sincronização/redação de snapshot                                                                                                           |
| `vision-handlers.ts` (6 ocorrências) | `isRolePrivileged` — visão/iluminação                                                                                                                            |

Nenhuma linha acima consome `PERMISSION_KEYS`/`resolvePermissionMinRole` — são checagens de role fixo,
não settings configuráveis pelo GM, e ficam fora do escopo de REQ-USR-008/009 como está hoje.

---

## Referências

- `docs/research/06-foundry-rede-multiplayer.md` — Seção 5: Roles e permissões; Seção 6: Sessões e presença
- `docs/research/91-fusion-security-threat-model.md` — Seções 2 (autenticação), 3 (TLS/CSWSH), 8 (matriz OWASP)
- [Foundry VTT — Users and Permissions](https://foundryvtt.com/article/users/)
- [USER_ROLES v14 API](https://foundryvtt.com/api/variables/CONST.USER_ROLES.html)
- [Foundry VTT Issue #4462 — Deprecate Access Keys](https://github.com/foundryvtt/foundryvtt/issues/4462)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [PkgPulse — Password Hashing 2026: bcrypt vs Argon2 vs scrypt](https://www.pkgpulse.com/guides/bcrypt-vs-argon2-vs-scrypt-password-hashing-2026)
- [`@node-rs/argon2` npm](https://www.npmjs.com/package/@node-rs/argon2)
