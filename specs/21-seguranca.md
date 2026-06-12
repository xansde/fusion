# 21 — Segurança

- **Título:** Segurança
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/91-fusion-security-threat-model.md` — threat model completo do Fusion: superfície de ataque, lições do Foundry (CVEs/path traversal/RCE), Argon2id, sessão JWT, rate limiting, TLS/headers/CSP, CSWSH, sanitização HTML/enrichers, path traversal e uploads, sandbox de macros, validação de dados importados (Rule Elements), matriz OWASP Top 10:2025, checklist de implementação
  - `docs/research/06-foundry-rede-multiplayer.md` — Admin Access Key separado, autoridade do servidor, modelo de sessão por mundo, `executeAsGM`/socketlib como vetor de privilege escalation, `options.json` (proxySSL, upnp)

> Esta spec é clean-room: descreve o **modelo de ameaça** do Fusion e as defesas
> derivadas, inspirada no *comportamento* e nas *vulnerabilidades públicas* do Foundry
> VTT (sem copiar código proprietário). Tudo que não vem da pesquisa está marcado como
> decisão de design nossa.

---

## Objetivo

Definir o **modelo de segurança transversal** do Fusion: o threat model (atores, superfícies,
ativos), os controles de defesa em profundidade que TODAS as outras specs devem honrar, e a
postura de segurança por área (autenticação, autorização, sanitização, filesystem, exposição à
internet, sandbox de código, dados importados). Esta spec é o **documento de referência central
de segurança** — as specs irmãs implementam os requisitos de seu domínio e apontam para cá quanto
às regras transversais.

O Fusion roda na máquina pessoal do GM. Isso significa que **um RCE no servidor é um RCE no
computador do GM** — não há isolamento de datacenter. O modelo de ameaça é idêntico ao do Foundry
VTT, que acumulou path traversals com escrita arbitrária de diretório levando a RCE via autostart,
handlers WebSocket de setup não autenticados, e duas vulnerabilidades de RCE no workflow de
modificação de Documents (`91-fusion-security-threat-model.md` §1.1). Positive Technologies estimou
~120.000 servidores Foundry expostos publicamente em 2025. O Fusion nasce com essas lições
incorporadas.

---

## Escopo

### O que inclui

- **Threat model**: atores (jogador malicioso/curioso, atacante de rede, conteúdo importado
  malicioso, terceiro cross-site), superfícies (HTTP/REST, WebSocket, uploads, packs importados,
  macros, enrichers), e ativos a proteger (máquina do GM, dados do mundo, sessões dos jogadores).
- **Postura de AuthN/AuthZ transversal**: Argon2id, sessão (cookie httpOnly + token WS), brute-force
  lockout, e a **regra de ouro** — checagem de permissão SEMPRE no servidor, por operação.
- **Sanitização e validação de entrada**: rich text (allowlist TipTap/ProseMirror), chat (sem HTML
  arbitrário — cards declarativos), sanitização de SVG, validação Zod de todo payload, enrichers e
  inline rolls (sem `eval`).
- **Segurança de filesystem**: path traversal, symlinks, validação de tipo real por magic bytes,
  limites de tamanho e quota, segregação de diretórios por papel.
- **Exposição à internet**: TLS (recomendação primária de túnel — Tailscale/cloudflared — e
  alternativa de certificado próprio), rate limiting, CORS/CSRF, CSWSH, headers de segurança (CSP
  estrita para o cliente).
- **Sandbox de código não confiável**: macros de script (postura: só GM, `isolated-vm` server-side
  ou desabilitado por padrão — **[V2]**); dados importados tratados como **dados, nunca código**.
- **SSRF**: fetch de URLs externas (manifests/módulos) controlado por allowlist.
- **Logging de segurança e checklist por release**.

### O que NÃO inclui (delegado a specs irmãs)

- **Fluxo concreto de login/logout/kick, modelo de `User`/`Session`, matriz de Permissions e
  ownership de Documents** — `ver 05-usuarios-e-permissoes.md`. Esta spec define a *postura* (hashing,
  revogação, lockout); a 05 define os endpoints e o schema.
- **Envelope de mensagens, rate limiting por evento socket, tamanho máximo de mensagem, validação de
  Origin no upgrade, resync** — `ver 04-rede-e-sincronizacao.md`. Esta spec define *por que* e *com
  que limites de segurança*; a 04 define o protocolo.
- **Persistência SQLite (PRAGMAs, WAL, transações, backups)** — `ver 03-persistencia-e-mundos.md` e
  `ver 24-operacao-backups-telemetria.md`.
- **Sandbox de execução de script macros em detalhe (API whitelist, timeout, contexto serializado)**
  — `ver 14-macros-e-automacao.md`. Esta spec define a postura e o threat model; a 14 define o
  mecanismo.
- **Validação de schema de Documents importados, mapeamento de Rule Elements, modo quarentena** —
  `ver 16-compendiums-e-importacao.md`. Esta spec define a regra "dados nunca são código"; a 16
  define o pipeline.
- **Allowlist de tags de rich text e chat cards declarativos em detalhe** — `ver 09-chat-e-mensagens.md`
  e `ver 11-ui-framework-e-fichas.md`. Esta spec define a estratégia (allowlist + dupla sanitização);
  elas definem o conjunto de tags.
- **Admin Key, first-run wizard, `fusion.json`, instruções de túnel/port-forwarding** —
  `ver 22-instalacao-e-distribuicao.md`. Esta spec exige os controles; a 22 implementa o setup.
- **Logs estruturados, métricas e telemetria operacional** — `ver 24-operacao-backups-telemetria.md`.
  Esta spec define *o que* logar por segurança; a 24 define *como* armazenar e expor.

---

## Conceitos e terminologia

| Termo | Definição |
|---|---|
| **Threat model** | Enumeração estruturada de atores de ameaça, superfícies de ataque, ativos protegidos e vetores, com as defesas correspondentes. |
| **Ator de ameaça** | Entidade que pode tentar comprometer o sistema: jogador malicioso/curioso, atacante de rede, conteúdo importado malicioso, site de terceiros (cross-site). |
| **Superfície de ataque** | Ponto de entrada exposto: endpoint HTTP/REST, conexão WebSocket, upload de arquivo, pack importado, macro de script, enricher de texto. |
| **Defesa em profundidade** | Aplicar controles redundantes em camadas (ex.: sanitizar no servidor *e* no cliente) para que a falha de um não comprometa o sistema. |
| **Servidor autoritativo** | O processo Node.js do GM é o único árbitro de mutações canônicas; clientes nunca são confiados. Princípio herdado de `04-rede-e-sincronizacao.md` (D3). |
| **AuthZ por operação** | Toda operação privilegiada revalida permissão no servidor, no momento da execução — nunca se confia em verificação prévia do cliente nem em "o cliente não mostra o botão". |
| **Argon2id** | Função de hashing de senha memory-hard, recomendação OWASP/NIST 2026. Parâmetros mínimos: `memory=65536 KiB`, `iterations=3`, `parallelism=4`. |
| **CSWSH** | *Cross-Site WebSocket Hijacking* — um site malicioso abre WS para o Fusion usando cookies da vítima; mitigado por validação de `Origin` + token explícito + `SameSite=Strict`. |
| **CSP** | *Content-Security-Policy* — header que restringe origens de scripts/estilos/conexões no cliente, com `nonce` por request. |
| **Magic bytes** | Assinatura binária inicial de um arquivo que revela seu tipo real, independentemente da extensão ou do MIME declarado pelo cliente. |
| **Path traversal** | Ataque que usa `../`, paths absolutos ou symlinks para escapar do diretório permitido e ler/escrever arquivos arbitrários. |
| **Sandbox** | Ambiente de execução isolado para código não confiável. No Fusion: `isolated-vm` (V8 Isolates) no servidor para macros de GM **[V2]**. |
| **Rule Element** | Objeto JSON declarativo (do sistema PF2e) que dispara lógica na preparação de dados. Tratado como **dado validado por schema**, nunca como código a avaliar. |
| **SSRF** | *Server-Side Request Forgery* — induzir o servidor a fazer requisições a destinos arbitrários (incl. rede interna). |
| **Túnel** | Conexão de saída (Tailscale/cloudflared) que expõe o servidor sem port-forwarding nem abrir porta no roteador. Recomendação primária do Fusion para acesso via internet. |
| **Redaction (broadcast)** | Suprimir ou redigir campos sensíveis de um Document antes de fazer broadcast a um cliente sem ownership suficiente. |

---

## Decisões

### DEC-SEC-01 — Servidor autoritativo + AuthZ server-side por operação (sem `executeAsGM` como proxy)

**Decisão:** Toda decisão de permissão é tomada **no servidor**, no momento de cada operação. O
cliente nunca é fonte de verdade de autorização. O Fusion **não** adota o padrão `executeAsGM` do
socketlib como proxy genérico cliente→cliente-GM (research §4, §6.4): nosso servidor já é o processo
do GM e é autoritativo, eliminando a classe de bugs "o GM precisa estar online para o jogador
descontar HP" e o vetor de privilege escalation. Quando um jogador precisa de uma operação
privilegiada, ele a solicita ao servidor, que revalida a permissão do *requester* contra a operação
específica antes de executar (ver `14-macros-e-automacao.md` DEC-MAC-05 — operações registradas com
schema Zod e revalidação).

**Alternativas rejeitadas:**
- *`executeAsGM` como proxy genérico* (estilo socketlib): a função executa no contexto do GM com
  permissão total; se não revalidar o payload e a permissão de origem, um jogador malicioso escala
  privilégio (research §6.4). Rejeitado como modelo geral — só admitimos operações **fixas,
  registradas e revalidadas**.
- *Confiar na UI do cliente* ("o botão não aparece para PLAYER"): segurança por obscuridade; um
  cliente modificado emite a op diretamente. Rejeitado.

**Racional:** Concentra toda a lógica de segurança em um único lugar testável (o servidor) e alinha
com a autoridade total decidida em `04-rede-e-sincronizacao.md` (D3) e o modelo do Foundry (research §3).

---

### DEC-SEC-02 — Defesa em profundidade na sanitização: allowlist no servidor + sanitização no cliente

**Decisão:** Todo conteúdo HTML rico (journal, descrições de item/actor, rich text de fichas) é
**sanitizado por allowlist no servidor antes de persistir** (biblioteca `sanitize-html`) **E**
re-sanitizado no cliente antes de injetar no DOM (`DOMPurify`). O chat **não** aceita HTML arbitrário:
mensagens usam markdown leve + cards declarativos (schema JSON, sem HTML livre — ver
`09-chat-e-mensagens.md`). A allowlist concreta de tags/atributos vive nas specs de chat (09) e
fichas/UI (11); aqui fixa-se a **estratégia obrigatória**.

**Alternativas rejeitadas:**
- *Sanitizar só no cliente:* um cliente comprometido ou um caminho de injeção fora da UI principal
  (ex.: tooltip, export) reintroduz o XSS. O conteúdo persistido ficaria envenenado. Rejeitado.
- *Sanitizar só no servidor:* enrichers e composição no cliente podem reintroduzir HTML perigoso
  pós-fetch; defesa de borda única é frágil. Rejeitado.
- *Permitir HTML arbitrário no chat (estilo Foundry clássico):* superfície de XSS alta para conteúdo
  vindo de qualquer jogador autenticado (research §4.1). Rejeitado em favor de cards declarativos.

**Racional:** `DOMPurify` (cure53) é DOM-based e evita falsos negativos de regex; combinado com
`sanitize-html` no servidor, garante que nem o que está no banco nem o que entra no DOM seja
confiável cegamente. A dependência deve ser mantida sempre atualizada (CVE-2025-26791 no DOMPurify —
research §4.2).

---

### DEC-SEC-03 — Dados importados são DADOS, nunca CÓDIGO; nenhuma expressão é avaliada com `eval`/`new Function`

**Decisão:** Compendiums, Rule Elements (PF2e), fórmulas de roll e expressões de modifier são
tratados como **dados validados por schema (Zod `.strict()`)**, nunca como código a executar. Nenhum
caminho do Fusion usa `eval()`, `new Function()` ou `node:vm` sobre entrada de usuário ou de pack.
Expressões matemáticas/`@atributos` em rolls e Rule Elements são processadas por um **parser de AST
dedicado** com whitelist de operadores e blacklist de `__proto__`/`constructor`/`prototype`, com
profundidade máxima de acesso a propriedades (research §4.3, §7.2). O motor de rolagens já parte de
`@dice-roller/rpg-dice-roller` como núcleo de parsing (ver `08-motor-de-rolagens.md`), não de `eval`.

**Alternativas rejeitadas:**
- *Avaliar `value` de Rule Element com `eval`/`new Function`:* permite RCE no servidor via pack
  malicioso (research §7.1). Inaceitável.
- *Confiar no schema do pack oficial e pular validação:* packs de terceiros (não os OGL oficiais)
  podem conter chaves inválidas, referências circulares e expressões hostis. Rejeitado — todo pack
  passa por validação (ver `16-compendiums-e-importacao.md`).

**Racional:** A maioria dos RCEs históricos de VTT vem de tratar dados como código. A separação
estrita elimina a classe inteira. O Fastify/Ajv usa `new Function` internamente para *compilar
schemas* — schemas são código de aplicação, **nunca** entrada de usuário (research §7.3).

---

### DEC-SEC-04 — Touros é túnel; TLS direto é alternativa; `ws://`/`http://` apenas em loopback/LAN consciente

**Decisão:** Para acesso via internet, a recomendação **primária** do Fusion é um **túnel de saída**
(Tailscale para grupos privados; cloudflared/Cloudflare Tunnel para acesso por URL pública), que
provê transporte criptografado sem port-forwarding nem abrir porta no roteador. A **alternativa** é
TLS direto via certificado próprio (`sslKey`/`sslCert`) ou reverse proxy (Caddy/Nginx) com
Let's Encrypt. `http://`/`ws://` sem TLS só é aceitável em **loopback** ou **LAN fechada com o GM
ciente** — o cliente exibe aviso quando detecta acesso externo sem TLS. UPnP é **desabilitado por
padrão** (opt-in explícito).

**Alternativas rejeitadas:**
- *Port-forwarding manual como recomendação primária:* expõe a porta diretamente à internet (os
  ~120k servidores Foundry expostos — research §1.1), requer abrir o roteador e não funciona sob
  CG-NAT. Mantido como opção avançada documentada, não como caminho recomendado.
- *TLS obrigatório sempre (inclusive LAN):* fricção alta para o caso de uso dominante (grupo em LAN
  doméstica); a decisão de segurança é do GM, com aviso claro. Rejeitado como imposição.
- *Embutir um proxy TLS no Fusion:* aumenta superfície e responsabilidade de manutenção de certificado;
  delegamos a túnel/proxy externo. Rejeitado para o MVP.

**Racional:** O túnel resolve simultaneamente NAT/CG-NAT (research 06 §11–12), criptografia e
não-exposição de porta — é o melhor custo-benefício de segurança para o público-alvo (GM doméstico).
A nota: A/V WebRTC não funciona por Cloudflare Tunnel, mas o Fusion não tem A/V no MVP
(`ver 04-rede-e-sincronizacao.md`), então isso não é uma limitação relevante aqui.

---

### DEC-SEC-05 — CSP estrita com nonce por request; cliente servido com headers de segurança

**Decisão:** O cliente é servido com uma **CSP estrita** (`default-src 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`), usando um **`nonce` criptográfico gerado por request**
para os `<script>` em vez de `'unsafe-inline'` em produção. `img-src`/`media-src` permitem `data:`/`blob:`
(assets locais e thumbnails); `connect-src` inclui `wss://` explicitamente. Os demais headers de
segurança (HSTS quando sob TLS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`) são injetados por middleware Fastify e validados
em CI.

**Alternativas rejeitadas:**
- *`'unsafe-inline'`/`'unsafe-eval'` em produção:* anula grande parte do valor da CSP contra XSS.
  Permitido apenas em modo de desenvolvimento. Rejeitado para produção.
- *Sem CSP (confiar só na sanitização):* CSP é a última linha quando a sanitização falha; é defesa
  em profundidade barata. Rejeitado abrir mão dela.

**Racional:** Como os sistemas de jogo são compilados junto ao app (não há plugins de terceiros
carregados em runtime no MVP — decisão global), a CSP pode ser estrita sem o problema do Foundry de
módulos injetando scripts dinamicamente (research §3.2). Isso é uma vantagem de segurança direta da
arquitetura do Fusion.

---

### DEC-SEC-06 — Uploads: renomear, validar magic bytes, confinar por `path.resolve`, segregar por papel, limitar tamanho

**Decisão:** Todo upload (1) recebe um **nome novo aleatório** (hex de 16 bytes + extensão detectada),
nunca o nome original do cliente; (2) tem seu **tipo real confirmado por magic bytes** (`file-type`),
casado contra um allowlist de `(mime, extensão)` — o MIME declarado pelo cliente é ignorado; (3) tem
o path final **resolvido e confirmado dentro do diretório permitido** (`path.resolve` + `startsWith`),
rejeitando symlinks que apontem para fora; (4) é gravado em diretório **segregado por papel** (ver
tabela em Requisitos); (5) respeita **limites de tamanho** por categoria (imagem 10 MB, áudio 50 MB,
vídeo 200 MB) e **quota por usuário** configurável.

**Alternativas rejeitadas:**
- *Confiar no `Content-Type`/extensão do cliente:* trivialmente falsificável; permite contrabando de
  arquivo executável ou SVG com script. Rejeitado (research §5.2 Regra 2).
- *Usar o nome original do arquivo no path:* raiz dos path traversals do Foundry (research §5.1).
  Rejeitado.
- *SVG tratado como imagem comum sem sanitização:* SVG é XML que pode embutir `<script>`/`onload`.
  SVGs são **sanitizados** (DOMPurify/`sanitize-html` em modo SVG) ou servidos com `Content-Type`
  que impede execução. Rejeitado servir SVG cru.

**Racional:** Replica as cinco regras do research §5.2 que corrigem exatamente os path traversals
históricos do Foundry (file picker < 0.4.0; instalador de módulos < 0.7.10/0.8.2 — research §1.1).

---

### DEC-SEC-07 — Macros de script: só GM, sandbox `isolated-vm` server-side, desabilitadas por padrão — **[V2]**

**Decisão:** Script macros (código JS arbitrário) são **[V2]**, restritas ao GM, executadas em
`isolated-vm` (V8 Isolates reais) **no servidor**, com whitelist de APIs (operações de Document; sem
`fs`/`net`/`child_process`), timeout (padrão 10 s), e **log obrigatório** (usuário, timestamp,
primeiros N chars do código). Vêm **desabilitadas por padrão** — o GM as habilita conscientemente. No
MVP, automação para jogadores é feita por **QuickActions declarativas** (sem código), validadas por
Zod no servidor (ver `14-macros-e-automacao.md` DEC-MAC-01/02). `node:vm` e `vm2` são **proibidos**
para código não confiável.

**Alternativas rejeitadas:**
- *Execução no browser (Web Worker), estilo Foundry:* isola o DOM mas permite `fetch()` livre — um GM
  desonesto exfiltra dados; e viola o servidor autoritativo. Rejeitado (research §6.3; 14 DEC-MAC-01).
- *`vm2`:* 20+ escapes conhecidos, abandonado/ressuscitado com reputação comprometida (research §6.2).
  Proibido.
- *`node:vm`:* não é sandbox, trivialmente escapável (research §6.2). Proibido para código não
  confiável.

**Racional:** RCE no servidor = RCE no PC do GM. Restringir, sandboxar server-side e desabilitar por
padrão minimiza a superfície sem privar o GM avançado. QuickActions cobrem ~90% dos casos sem código
arbitrário (14 DEC-MAC-02).

---

### DEC-SEC-08 — Brute-force lockout, validação Zod de todo payload e fail-safe sob entrada malformada

**Decisão:** (1) Login aplica **rate limiting / lockout** por IP+username (5 falhas/15 min → bloqueio
temporário; backoff exponencial), com mensagens de erro idênticas para usuário inexistente e senha
errada (anti-enumeration). (2) **Todo** payload que cruza a fronteira de confiança (REST body, query,
mensagem WebSocket, item de pack importado) é validado por **schema Zod** antes de uso; falha resulta
em rejeição com código de erro, nunca em processamento parcial. (3) Nenhuma mensagem de cliente pode
derrubar o processo (fail-safe): erros de validação/parsing são capturados e logados, não propagados
como crash. A implementação concreta dos limites de WS vive em `04-rede-e-sincronizacao.md`; o lockout
de login em `05-usuarios-e-permissoes.md`.

**Alternativas rejeitadas:**
- *Sem lockout (só hashing forte):* permite brute-force online de senhas fracas e enumeration de
  usuários por timing/resposta. Rejeitado (research §2.2.3).
- *Validar payload "quando der erro":* deixa caminhos não validados como vetor de injeção e crash.
  Rejeitado — validação na borda é obrigatória e exaustiva.

**Racional:** Auth failures e injection são A07/A03 do OWASP Top 10:2025 (research §8). A validação Zod
de borda é o controle único que mais reduz a superfície de injeção e DoS por payload malformado.

---

## Requisitos funcionais

Requisitos numerados `REQ-SEC-NNN`, cada um testável, com tag `[MVP]`/`[V2]`. Onde a implementação
concreta vive em uma spec irmã, o requisito aqui fixa a **obrigação de segurança** e referencia a irmã.

### Threat model e princípios transversais

- **REQ-SEC-001** [MVP] O Fusion DEVE manter, nesta spec, um threat model explícito com atores,
  superfícies e ativos (ver seção *Threat model* abaixo). Toda nova superfície de ataque introduzida
  por outra spec DEVE mapear-se a um ator e a um conjunto de defesas aqui referenciado.
- **REQ-SEC-002** [MVP] Toda operação privilegiada (mutação de Document, query, upload, ação
  administrativa) DEVE ter sua permissão **revalidada no servidor** no momento da execução, contra o
  usuário autenticado da conexão — independentemente de qualquer verificação feita no cliente
  (`ver 05-usuarios-e-permissoes.md` REQ-USR-010/014; `ver 04-rede-e-sincronizacao.md` REQ-NET-022).
- **REQ-SEC-003** [MVP] O servidor NÃO DEVE expor nenhum endpoint (HTTP ou WebSocket) que vaze
  informação sensível sem autenticação — em particular path de instalação, listagem de mundos com
  config, ou dados de usuário além de `name`/`color`/`hasPassword` na tela de join (lição do
  `getSetupData` não autenticado do Foundry, research §1.1; `ver 05-usuarios-e-permissoes.md`
  REQ-USR-037).
- **REQ-SEC-004** [MVP] O servidor DEVE degradar com segurança sob entrada malformada/maliciosa:
  nenhuma mensagem de cliente, payload REST ou item de pack PODE derrubar o processo
  (`ver 04-rede-e-sincronizacao.md` REQ-NET-094).

### Autenticação e sessão (postura; implementação em 05)

- **REQ-SEC-010** [MVP] Todas as senhas (usuários de mundo e Admin Key) DEVEM ser hasheadas com
  **Argon2id** (`memory≥65536 KiB`, `iterations≥3`, `parallelism≥4`), nunca armazenadas em claro nem
  com hash rápido (MD5/SHA puro/PBKDF2) (`ver 05-usuarios-e-permissoes.md` DEC-USR-02;
  `ver 22-instalacao-e-distribuicao.md` para Admin Key).
- **REQ-SEC-011** [MVP] O login DEVE aplicar **lockout por força bruta**: no máximo 5 tentativas
  falhas por (IP, username) em 15 minutos; ao exceder, retornar HTTP 429 com `Retry-After` e aplicar
  backoff exponencial (`ver 05-usuarios-e-permissoes.md` REQ-USR-023).
- **REQ-SEC-012** [MVP] As mensagens de falha de login DEVEM ser **indistinguíveis** entre "usuário
  inexistente" e "senha incorreta", e o tempo de resposta NÃO DEVE permitir user enumeration por
  timing (comparação de hash em tempo constante; resposta uniforme).
- **REQ-SEC-013** [MVP] A sessão DEVE permitir **revogação imediata** (kick/reset de senha invalidam
  todas as sessões do usuário); o refresh token DEVE rotacionar a cada uso com detecção de reuso
  (`ver 05-usuarios-e-permissoes.md` REQ-USR-020/027/029).
- **REQ-SEC-014** [MVP] O refresh token DEVE ser entregue como cookie `httpOnly; Secure; SameSite=Strict`;
  o access token (JWT, exp curta) NÃO DEVE ser persistido em `localStorage` acessível a script
  (`ver 05-usuarios-e-permissoes.md` DEC-USR-03).

### Autorização e visibilidade (redaction)

- **REQ-SEC-020** [MVP] O broadcast de uma mutação de Document NÃO DEVE entregar a um cliente conteúdo
  que ele não tem ownership para ver; o servidor DEVE **suprimir o evento ou redigir** os campos
  sensíveis antes de enviar (`ver 04-rede-e-sincronizacao.md` REQ-NET-024;
  `ver 05-usuarios-e-permissoes.md` REQ-USR-013/014).
- **REQ-SEC-021** [MVP] Operações recusadas por falta de permissão DEVEM retornar `PERMISSION_DENIED`
  **sem revelar a existência** de Documents que o usuário não pode ver (NONE é indistinguível de
  "não existe").
- **REQ-SEC-022** [MVP] Operações de delegação de privilégio (jogador solicita ação que requer
  permissão maior) DEVEM ser um **conjunto fixo de operações registradas**, cada uma com schema Zod e
  **revalidação da permissão do requester** sobre o efeito pretendido; NÃO DEVE existir operação
  genérica "executar qualquer função como GM" (`ver 14-macros-e-automacao.md` DEC-MAC-05; research §6.4).

### Sanitização e validação de entrada

- **REQ-SEC-030** [MVP] Todo conteúdo HTML rico (journal, descrições, rich text de fichas) DEVE ser
  sanitizado por **allowlist no servidor** (`sanitize-html`) antes de persistir, e re-sanitizado no
  cliente (`DOMPurify`) antes de injetar no DOM (defesa em profundidade — DEC-SEC-02;
  `ver 11-ui-framework-e-fichas.md`, `ver 12-journal-tabelas-cartas.md`).
- **REQ-SEC-031** [MVP] O chat NÃO DEVE aceitar HTML arbitrário de usuários: mensagens usam markdown
  leve sanitizado + **chat cards declarativos** (schema JSON, sem HTML livre), com ações tipadas
  (`ver 09-chat-e-mensagens.md`).
- **REQ-SEC-032** [MVP] A allowlist de sanitização DEVE proibir `javascript:`/`data:` em `href`/`src`,
  atributos de evento (`onload`, `onerror`, …) e `style` inline com expressões; URLs externas em
  `href` limitadas a `http`/`https`.
- **REQ-SEC-033** [MVP] Enrichers e referências `@UUID[...]` DEVEM ter seu **formato validado por
  regex** antes de processar (ex.: `Tipo.idAlfanumérico`), e o output do enricher DEVE ser sanitizado
  antes de ir ao DOM (research §4.3; `ver 09-chat-e-mensagens.md`).
- **REQ-SEC-034** [MVP] Inline rolls (`[[fórmula]]`) e expressões `@atributos` DEVEM ser avaliadas por
  parser dedicado (`@dice-roller/rpg-dice-roller` + camada de roll data), **nunca** por `eval()`/`new
  Function()` (`ver 08-motor-de-rolagens.md`; DEC-SEC-03).
- **REQ-SEC-035** [MVP] Uploads de **SVG** DEVEM ser sanitizados (remoção de `<script>`, `<foreignObject>`,
  handlers de evento, referências externas) antes de servidos, OU servidos com cabeçalho que impeça
  execução; SVG cru não sanitizado NÃO DEVE ser servido inline.
- **REQ-SEC-036** [MVP] **Todo** payload que cruza a fronteira de confiança (body/query REST, mensagem
  WebSocket, item de pack importado) DEVE ser validado por schema **Zod** (com `.strict()` onde
  aplicável a objetos de schema fechado) antes de uso; falha de validação resulta em rejeição com
  código de erro (`VALIDATION_FAILED`/HTTP 400), nunca em processamento parcial.

### Filesystem e uploads

- **REQ-SEC-040** [MVP] Arquivos enviados DEVEM ser **renomeados** para um nome aleatório
  (hex 16 bytes) + extensão derivada do tipo detectado; o nome original do cliente NÃO DEVE compor o
  path de gravação (DEC-SEC-06; research §5.2 Regra 1).
- **REQ-SEC-041** [MVP] O tipo de arquivo DEVE ser confirmado por **magic bytes** (`file-type`) e
  casado contra um allowlist de `(mime, extensão)`; o `Content-Type`/extensão declarados pelo cliente
  NÃO DEVEM ser confiados (research §5.2 Regra 2).
- **REQ-SEC-042** [MVP] O path final de qualquer operação de arquivo (upload, browse, serving) DEVE ser
  **normalizado e confirmado dentro do diretório permitido** (`path.resolve` + verificação de prefixo);
  paths com `..`, paths absolutos do cliente e **symlinks** que escapem do diretório DEVEM ser
  rejeitados (research §5.2 Regra 3).
- **REQ-SEC-043** [MVP] Os diretórios DEVEM ser **segregados por papel**, com permissão de escrita
  conforme a tabela abaixo (research §5.2 Regra 4):

  | Diretório | Quem pode escrever | Notas |
  |---|---|---|
  | `assets/public/` | GM e `TRUSTED` (se `FILES_UPLOAD` permitir) | Servido estaticamente |
  | `assets/system/` | Apenas o processo de instalação do sistema | Não editável por usuários |
  | `worlds/<id>/world.db` e `data/` | Apenas o servidor (nunca upload direto) | Dados estruturados |
  | `config/` | Apenas CLI/processo local | Nunca exposto via HTTP |

- **REQ-SEC-044** [MVP] O upload DEVE respeitar **limites de tamanho por categoria** (imagem 10 MB,
  áudio 50 MB, vídeo 200 MB) e **quota por usuário** configurável; exceder retorna erro sem gravar
  (research §5.2 Regra 5; `ver 20-assets-e-midia.md`).
- **REQ-SEC-045** [MVP] O servidor NÃO DEVE expor via HTTP nenhum caminho fora dos diretórios de
  assets/cliente explicitamente servidos; o diretório `config/` e os `*.db` dos mundos NÃO DEVEM ser
  alcançáveis por requisição estática.

### Exposição à internet, TLS e headers

- **REQ-SEC-050** [MVP] A documentação e o first-run wizard DEVEM apresentar **túnel (Tailscale/cloudflared)
  como recomendação primária** para acesso via internet, e **TLS direto/reverse proxy** como
  alternativa; port-forwarding manual é opção avançada com aviso (DEC-SEC-04;
  `ver 22-instalacao-e-distribuicao.md`).
- **REQ-SEC-051** [MVP] O cliente DEVE **avisar visivelmente** quando a conexão for de origem externa
  (IP fora da subnet LAN) **sem TLS**, e o painel do GM DEVE sinalizar usuários sem senha nesse cenário
  (`ver 05-usuarios-e-permissoes.md` REQ-USR-031/039).
- **REQ-SEC-052** [MVP] **UPnP** DEVE vir **desabilitado por padrão** em `fusion.json`; habilitar é
  opt-in explícito do GM (`ver 22-instalacao-e-distribuicao.md`; research §9.1).
- **REQ-SEC-053** [MVP] O servidor DEVE injetar headers de segurança em respostas HTTP do cliente:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`, e `Strict-Transport-Security` **quando sob TLS**.
- **REQ-SEC-054** [MVP] O cliente DEVE ser servido com **CSP estrita** incluindo no mínimo
  `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`,
  `connect-src 'self' wss:`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, e `script-src
  'self' 'nonce-<por-request>'`; `'unsafe-inline'`/`'unsafe-eval'` NÃO DEVEM aparecer em produção
  (DEC-SEC-05).
- **REQ-SEC-055** [MVP] O `nonce` da CSP DEVE ser gerado criptograficamente **por request** e injetado
  nos `<script>` servidos; nonces estáticos/hardcoded são proibidos (research §3.2).
- **REQ-SEC-056** [MVP] CORS para endpoints REST autenticados DEVE restringir `Access-Control-Allow-Origin`
  à própria origem (ou às `allowedOrigins` configuradas), nunca `*`; `Access-Control-Allow-Credentials:
  true` só combinado com origem explícita (research §3.3).
- **REQ-SEC-057** [MVP] O upgrade WebSocket DEVE **validar o header `Origin`** contra `allowedOrigins`
  e exigir token explícito de sessão (não enviado automaticamente pelo browser), mitigando CSWSH;
  origens não permitidas recebem HTTP 403 (research §3.4; `ver 04-rede-e-sincronizacao.md` REQ-NET-003,
  `ver 05-usuarios-e-permissoes.md` REQ-USR-024).
- **REQ-SEC-058** [MVP] Operações REST que mudam estado DEVEM ser protegidas contra **CSRF** por
  cookies `SameSite=Strict` no refresh + uso de access token `Authorization: Bearer` (não cookie
  ambiente) nas mutações; endpoints de mutação NÃO DEVEM depender apenas de cookie de sessão.

### Rate limiting e anti-abuso (limites de segurança; implementação em 04)

- **REQ-SEC-060** [MVP] O servidor DEVE impor **rate limiting por socket e por tipo de evento**, com
  limites de segurança mínimos: ≤ 50 mensagens/s por conexão e ≤ 10 novas conexões/min por IP;
  excedentes são rejeitados (`RATE_LIMITED`) ou descartados (efêmeros) e contabilizados
  (`ver 04-rede-e-sincronizacao.md` REQ-NET-071; research §2.2.3).
- **REQ-SEC-061** [MVP] O servidor DEVE impor **tamanho máximo de mensagem** (op ≤ 1 MiB; efêmero ≤
  16 KiB) e rejeitar excedentes (`TOO_LARGE`) sem processar (`ver 04-rede-e-sincronizacao.md`
  REQ-NET-070).
- **REQ-SEC-062** [MVP] Conexões que não autenticam dentro de **5 s** após o connect DEVEM ser
  encerradas (`ver 05-usuarios-e-permissoes.md` REQ-USR-021; research §2.2.2).
- **REQ-SEC-063** [MVP] O número de conexões simultâneas por mundo DEVE ser limitado (`WORLD_FULL`),
  evitando exaustão de recursos (`ver 04-rede-e-sincronizacao.md` REQ-NET-006).

### Sandbox e dados importados

- **REQ-SEC-070** [V2] Script macros DEVEM executar **apenas no servidor**, em `isolated-vm`, restritas
  ao GM, com whitelist de API (sem `fs`/`net`/`child_process`), timeout e log obrigatório; vêm
  **desabilitadas por padrão** (`ver 14-macros-e-automacao.md` DEC-MAC-01).
- **REQ-SEC-071** [MVP] `node:vm` e `vm2` NÃO DEVEM ser usados para executar código não confiável em
  nenhum caminho do Fusion (research §6.2).
- **REQ-SEC-072** [MVP] No MVP, automação acessível a jogadores DEVE ser **declarativa** (QuickActions
  validadas por Zod), sem execução de código arbitrário (`ver 14-macros-e-automacao.md` DEC-MAC-02).
- **REQ-SEC-073** [MVP] Cada Document importado de um pack DEVE ser validado por schema Zod
  (`.strict()` no sub-schema de Rule Elements, para rejeitar chaves desconhecidas) antes de
  persistir; itens com Rule Elements inválidos DEVEM ser **rejeitados e logados**, nunca silenciados
  (`ver 16-compendiums-e-importacao.md` REQ-CMP-044; research §7.2). O REQ-CMP-044 da spec 16 é o
  implementador desta obrigação de segurança: valida cada documento por Zod (engine + `system`) antes
  de gravar no `pack.db`, excluindo e listando inválidos — e DEVE aplicar `.strict()` ao sub-schema
  de Rule Elements em particular.
- **REQ-SEC-074** [MVP] Expressões em Rule Elements / modifiers (ex.: `@actor.system...`) DEVEM ser
  avaliadas por parser de AST com whitelist de operadores e blacklist de `__proto__`/`constructor`/
  `prototype`, com profundidade máxima de acesso a propriedades — **nunca** `eval`/`new Function`
  (DEC-SEC-03; `ver 16-compendiums-e-importacao.md` REQ-CMP-037; research §7.2). O REQ-CMP-037 da
  spec 16 é o implementador desta obrigação no pipeline de import: expressões não parseáveis pelo
  parser dedicado DEVEM cair em fallback `partial`, nunca ser avaliadas por `eval`/`new Function`.
- **REQ-SEC-075** [V2] Ao importar packs de fontes **não-oficiais**, o sistema DEVE exibir aviso ao GM
  e oferecer um **modo quarentena** (importar sem ativar Rule Elements até revisão)
  (`ver 16-compendiums-e-importacao.md`; research §7.2).

### SSRF e fetch externo

- **REQ-SEC-080** [V2] Qualquer fetch de URL externa pelo servidor (ex.: manifest de módulo, asset
  remoto) DEVE validar o destino contra uma **allowlist** de domínios/registries, rejeitar IPs
  privados/loopback/link-local, e aplicar timeout curto, mitigando SSRF (research §8 A10).

### Logging de segurança

- **REQ-SEC-090** [MVP] O servidor DEVE registrar (log estruturado JSON) os eventos de segurança:
  falhas de autenticação, lockouts, tentativas de path traversal detectadas (com IP e payload
  redigido), rejeições por rate limit/tamanho, e detecção de reuso de refresh token
  (`ver 24-operacao-backups-telemetria.md`).
- **REQ-SEC-091** [V2] Execuções de script macro DEVEM ser logadas com usuário, timestamp e os
  primeiros N chars do código (`ver 14-macros-e-automacao.md`).
- **REQ-SEC-092** [MVP] Logs de segurança NÃO DEVEM conter segredos em claro (senhas, tokens, hashes
  completos); valores sensíveis são redigidos ou truncados antes de logar.

---

## Requisitos não-funcionais

- **REQ-SEC-NF-001** [MVP] O hashing/verificação Argon2id DEVE usar a API assíncrona e NÃO DEVE
  bloquear o event loop do Node.js (`ver 05-usuarios-e-permissoes.md` REQ-USR-NF-001).
- **REQ-SEC-NF-002** [MVP] As dependências de segurança (DOMPurify, sanitize-html, file-type,
  @node-rs/argon2, isolated-vm) DEVEM ser **pinadas** e monitoradas por alertas de vulnerabilidade
  (Dependabot/GHSA); atualizações de segurança críticas DEVEM ser priorizadas (research §4.2, §8 A06).
- **REQ-SEC-NF-003** [MVP] Os controles de segurança transversais (headers, CSP, validação de Origin,
  sanitização) DEVEM ser cobertos por **testes automatizados em CI** que falham o build se um controle
  for removido (`ver 25-testes-e-qualidade.md`).
- **REQ-SEC-NF-004** [MVP] A validação de permissão server-side (`user.can`) DEVE ser O(1) (lookup em
  memória) para não tornar a checagem por operação um gargalo (`ver 05-usuarios-e-permissoes.md`
  REQ-USR-NF-002).
- **REQ-SEC-NF-005** [MVP] Segredos de runtime (chave HMAC do JWT, Admin Key hash) DEVEM ser mantidos
  apenas em memória/`config` local com permissões restritas, nunca commitados nem expostos via HTTP.

---

## Threat model

### Atores de ameaça

| Ator | Descrição | Motivação típica |
|---|---|---|
| **Jogador malicioso** | Usuário autenticado com role baixo (PLAYER/TRUSTED) que tenta exceder seus privilégios. | Trapacear em rolagens, ver dados ocultos do GM, escalar privilégio, derrubar a sessão. |
| **Jogador curioso** | Usuário legítimo que tropeça em informação que não deveria ver (ex.: stats de inimigo, blind roll). | Vazamento acidental por falha de redaction/visibilidade. |
| **Atacante de rede** | Entidade na rede entre cliente e servidor (LAN hostil, internet). | Interceptar credenciais (sem TLS), replay, downgrade, varrer porta exposta. |
| **Conteúdo importado malicioso** | Pack/compendium de terceiros com Rule Elements ou expressões hostis. | RCE no servidor (= PC do GM), loop infinito/DoS na preparação de dados. |
| **Site de terceiros (cross-site)** | Página web maliciosa que a vítima (GM/jogador logado) visita. | CSWSH, CSRF, roubo de sessão. |

### Superfícies de ataque e defesas

| Superfície | Vetores principais | Defesas (requisitos) |
|---|---|---|
| **HTTP/REST** | Injeção, CSRF, CORS aberto, endpoint não autenticado, headers ausentes | REQ-SEC-036, 053–056, 058; AuthZ REQ-SEC-002 |
| **WebSocket** | CSWSH, auth ausente no upgrade, flood, mensagem gigante, payload malformado | REQ-SEC-057, 060–063; REQ-SEC-004/036 |
| **Uploads** | Path traversal, symlink, tipo falsificado, executável contrabandeado, SVG com script, DoS por tamanho | REQ-SEC-040–045, 035 |
| **Packs importados** | RCE via expressão avaliada, schema inválido, referência circular, arte proprietária | REQ-SEC-073–075; DEC-SEC-03 |
| **Macros** | RCE no servidor, exfiltração via `fetch`, escape de sandbox | REQ-SEC-070–072, 091 |
| **Enrichers / inline rolls** | XSS via `@UUID`/`[[ ]]`, `eval` de expressão | REQ-SEC-033, 034 |
| **Rich text / chat** | XSS persistido, HTML arbitrário | REQ-SEC-030–032 |
| **Autenticação** | Brute force, enumeration, sessão não revogável, token roubado | REQ-SEC-010–014, 011/012 |

### Ativos a proteger (em ordem de impacto)

1. **A máquina do GM** — RCE aqui compromete o computador pessoal; prioridade máxima (DEC-SEC-03, 06, 07).
2. **Integridade das rolagens** — RNG autoritativo no servidor previne trapaça (`ver 08-motor-de-rolagens.md`).
3. **Dados do mundo** (`world.db`, assets) — confidencialidade (visão/ownership) e integridade.
4. **Sessões dos jogadores** — proteção contra roubo/hijack (TLS, httpOnly, CSWSH).

### Matriz OWASP Top 10:2025 → Fusion (research §8)

| OWASP | Manifestação no Fusion | Requisito |
|---|---|---|
| A01 Broken Access Control | Delegação sem revalidação; CSWSH; endpoint sem auth | REQ-SEC-002, 022, 057, 003 |
| A02/A05 Misconfiguration | Admin Key ausente, `ws://` sem TLS, CORS aberto, UPnP | REQ-SEC-010, 050–056, 052 |
| A03 Injection | XSS, path traversal, `eval`, Rule Element hostil | REQ-SEC-030–036, 040–042, 074 |
| A04 Insecure Design | Macros irrestritas, proxy genérico GM | REQ-SEC-070–072, 022 |
| A06 Vulnerable Components | vm2, DOMPurify desatualizado | REQ-SEC-071, NF-002 |
| A07 Auth Failures | Brute force, sessão não expira, token sem rotação | REQ-SEC-010–014 |
| A08 Software Integrity | Pack/Rule Element malicioso | REQ-SEC-073–075 |
| A09 Logging Failures | Auth falha não logada, macro sem rastro | REQ-SEC-090–092 |
| A10 SSRF | Fetch de manifest a URL arbitrária | REQ-SEC-080 |

---

## Modelo de dados

Interfaces TypeScript de apoio à segurança, em `packages/shared`. Tipos de `User`/`Session`/`Permission`
vivem em `05-usuarios-e-permissoes.md`; o `Envelope`/`ErrorCode` em `04-rede-e-sincronizacao.md`. Aqui
ficam apenas as estruturas de configuração e logging de segurança próprias desta spec.

```typescript
// packages/shared/src/types/security.ts

/** Categorias de upload com seus limites e tipos aceitos. */
export interface UploadPolicy {
  /** Allowlist: mime detectado → extensões permitidas. */
  allowedTypes: Record<string, string[]>; // ex.: { "image/png": [".png"] }
  /** Limite de tamanho por categoria, em bytes. */
  maxSizeBytes: { image: number; audio: number; video: number; pdf: number };
  /** Quota total por usuário, em bytes (null = sem quota). */
  userQuotaBytes: number | null;
}

/** Política de exposição/rede carregada de fusion.json. */
export interface NetworkSecurityPolicy {
  /** Origens permitidas no upgrade WS e no CORS REST. */
  allowedOrigins: string[];
  /** UPnP — desabilitado por padrão (REQ-SEC-052). */
  upnp: boolean;
  /** Servindo atrás de proxy TLS? (afeta HSTS e links de convite). */
  proxySSL: boolean;
  proxyPort?: number;
  /** Limites de segurança de rede (espelham 04-rede). */
  rateLimit: {
    loginMaxAttempts: number;        // 5
    loginWindowSeconds: number;      // 900
    wsMessagesPerSecond: number;     // 50
    wsConnectionsPerMinutePerIP: number; // 10
    authTimeoutMs: number;           // 5000
  };
}

/** Configuração de CSP gerada por request (nonce dinâmico). */
export interface CspContext {
  nonce: string;        // base64 aleatório, 16+ bytes, por request
  underTls: boolean;    // injeta HSTS quando true
}

/** Evento de segurança para o log estruturado (REQ-SEC-090). */
export type SecurityEventType =
  | "auth.failure"
  | "auth.lockout"
  | "auth.refresh_reuse"
  | "upload.rejected"
  | "path.traversal_attempt"
  | "ratelimit.exceeded"
  | "message.too_large"
  | "import.rule_element_rejected"
  | "macro.executed";

export interface SecurityEvent {
  type: SecurityEventType;
  ts: string;                 // ISO 8601
  worldId: string | null;
  userId: string | null;
  ip: string | null;
  /** Detalhe redigido (sem segredos em claro — REQ-SEC-092). */
  detail: Record<string, unknown>;
}

/** Postura de sandbox de macro (V2). */
export interface MacroSandboxPolicy {
  enabled: boolean;           // default: false (REQ-SEC-070)
  gmOnly: true;               // sempre verdadeiro no MVP/V2
  timeoutMs: number;          // default: 10000
  apiAllowlist: string[];     // métodos de Document permitidos
}
```

---

## API e eventos

Esta spec não define endpoints próprios — os controles de segurança são **propriedades transversais**
aplicadas aos endpoints e eventos definidos nas specs irmãs. As tabelas abaixo mapeiam *onde* cada
controle incide.

### Controles por endpoint REST (definidos em 05/20/16)

| Endpoint (origem) | Controles de segurança aplicados |
|---|---|
| `POST /auth/login` (05) | Argon2id, lockout (REQ-SEC-011), resposta uniforme (012), cookie httpOnly (014) |
| `POST /auth/refresh` (05) | Rotação + reuse detection (013), `SameSite=Strict` (058) |
| `POST /api/assets/upload` (20) | Renome (040), magic bytes (041), confinamento de path (042), quota/tamanho (044), SVG sanitizado (035) |
| `POST /api/compendium/import` (16) | Validação Zod `.strict()` (073), parser de expressão (074), quarentena (075) |
| Qualquer mutação `/api/*` | AuthZ server-side (002), Zod (036), CORS restrito (056), CSRF via Bearer (058) |
| Toda resposta de cliente | Headers de segurança (053), CSP com nonce (054/055) |

### Controles no upgrade e nas mensagens WebSocket (definidos em 04/05)

| Ponto | Controle |
|---|---|
| Handshake/upgrade | Validar `Origin` (057), exigir token de sessão (057/062), recusar namespace de mundo inativo |
| Por mensagem | Zod do envelope/payload (036), tamanho máximo (061), rate limit por tipo (060) |
| Broadcast | Redaction/supressão por ownership (020/021) |
| Fail-safe | Erro de parsing nunca derruba o processo (004) |

### Eventos de segurança emitidos ao log (REQ-SEC-090)

`auth.failure`, `auth.lockout`, `auth.refresh_reuse`, `upload.rejected`, `path.traversal_attempt`,
`ratelimit.exceeded`, `message.too_large`, `import.rule_element_rejected`, `macro.executed` — todos no
formato `SecurityEvent`, consumidos por `24-operacao-backups-telemetria.md`.

---

## Checklist de segurança por release

Esta checklist DEVE ser verificada antes de cada release (gate em CI onde automatizável —
`ver 25-testes-e-qualidade.md`). Derivada do checklist de implementação do research §10.

### Autenticação e sessão
- [ ] Argon2id em todas as senhas (usuários + Admin Key); parâmetros ≥ mínimos.
- [ ] Lockout de login (5/15 min por IP+username) ativo; resposta uniforme (anti-enumeration).
- [ ] Refresh token rotacionado com reuse detection; revogação imediata em kick/reset.
- [ ] Cookie de refresh `httpOnly; Secure; SameSite=Strict`; access token fora de `localStorage`.
- [ ] Timeout de auth pós-connect (5 s) no WebSocket.

### Rede e exposição
- [ ] Validação de `Origin` no upgrade WS (CSWSH) com `allowedOrigins`.
- [ ] CORS restrito (sem `*` em endpoints autenticados); CSRF coberto por Bearer + SameSite.
- [ ] Headers de segurança presentes (nosniff, frame-options, referrer-policy; HSTS sob TLS).
- [ ] CSP estrita com nonce por request; sem `'unsafe-inline'`/`'unsafe-eval'` em produção.
- [ ] UPnP desabilitado por padrão; aviso de "sem TLS + acesso externo" no cliente.
- [ ] Documentação de túnel (Tailscale/cloudflared) como recomendação primária.

### Entrada e sanitização
- [ ] `sanitize-html` (servidor) + `DOMPurify` (cliente) em todo HTML rico; deps atualizadas.
- [ ] Chat sem HTML arbitrário (markdown + cards declarativos).
- [ ] `@UUID`/enrichers com formato validado por regex; output sanitizado.
- [ ] Inline rolls e expressões via parser dedicado; zero `eval`/`new Function` sobre input.
- [ ] SVG sanitizado antes de servir inline.
- [ ] Zod em todo payload de borda (REST, WS, pack); `.strict()` em schemas fechados.

### Filesystem e uploads
- [ ] Renome aleatório + extensão derivada do tipo detectado.
- [ ] Magic bytes (`file-type`) casados com allowlist; MIME do cliente ignorado.
- [ ] `path.resolve` + verificação de prefixo; symlinks de escape rejeitados.
- [ ] Diretórios segregados por papel; `config/` e `*.db` não alcançáveis por HTTP.
- [ ] Limites de tamanho e quota aplicados.

### Sandbox e dados importados
- [ ] `node:vm`/`vm2` ausentes para código não confiável.
- [ ] Script macros (V2) só GM, `isolated-vm`, desabilitadas por padrão, com log e timeout.
- [ ] Rule Elements validados por schema; inválidos rejeitados e logados (não silenciados).
- [ ] Expressões de modifier via AST com blacklist de `__proto__`/`constructor`/`prototype`.

### Logging e dependências
- [ ] Eventos de segurança logados (auth falha, traversal, rate limit, reuse) sem segredos em claro.
- [ ] Dependências de segurança pinadas; alertas GHSA/Dependabot monitorados.
- [ ] Testes de CI cobrem headers, CSP, Origin e sanitização (falham se removidos).

---

## Dependências (specs irmãs)

| Spec | Relação |
|---|---|
| `01-arquitetura-geral.md` | Estrutura de pacotes; `packages/shared` como home dos tipos de segurança; sistemas compilados junto (não há plugins de terceiros em runtime no MVP — base da CSP estrita). |
| `03-persistencia-e-mundos.md` | Localização de `world.db`/`config/` fora do alcance HTTP; integridade de escrita autoritativa. |
| `04-rede-e-sincronizacao.md` | Implementa rate limit por evento, tamanho máximo, validação de Origin, fail-safe, redaction de broadcast. |
| `05-usuarios-e-permissoes.md` | Implementa Argon2id, sessão JWT/refresh, lockout, kick/revogação, `user.can` server-side, ownership. |
| `08-motor-de-rolagens.md` | Parser de fórmulas sem `eval`; RNG autoritativo no servidor (anti-cheat). |
| `09-chat-e-mensagens.md` | Chat sem HTML arbitrário; cards declarativos; sanitização de markdown e enrichers. |
| `11-ui-framework-e-fichas.md` | Allowlist de rich text (TipTap/ProseMirror); sanitização no cliente. |
| `12-journal-tabelas-cartas.md` | Sanitização de conteúdo rico de journal. |
| `14-macros-e-automacao.md` | Sandbox `isolated-vm` de script macros; QuickActions declarativas; delegação registrada. |
| `16-compendiums-e-importacao.md` | Validação de schema de packs; modo quarentena; mapeamento de Rule Elements como dados. |
| `20-assets-e-midia.md` | Pipeline de upload (renome, magic bytes, quota, diretórios por papel, sanitização de SVG). |
| `22-instalacao-e-distribuicao.md` | Admin Key; first-run wizard; `fusion.json` (proxySSL, upnp); instruções de túnel/port-forwarding. |
| `24-operacao-backups-telemetria.md` | Armazenamento e exposição dos logs de segurança e métricas de rate limiting. |
| `25-testes-e-qualidade.md` | Testes de CI que validam os controles transversais de segurança. |
| `26-licencas-e-legal.md` | Não importar arte proprietária; obrigações de notice (toca a importação de packs). |

---

## Critérios de aceitação

- **CA-SEC-01** Uma senha de usuário/Admin Key armazenada no banco é um hash Argon2id válido; nenhum
  caminho persiste senha em claro ou com hash rápido. (REQ-SEC-010)
- **CA-SEC-02** Seis tentativas de login falhas em 15 minutos para o mesmo (IP, username) resultam em
  HTTP 429 com `Retry-After`; a resposta para usuário inexistente é indistinguível da de senha errada.
  (REQ-SEC-011/012)
- **CA-SEC-03** Um upgrade WebSocket com header `Origin` não pertencente a `allowedOrigins` é recusado
  com HTTP 403; um upgrade sem token de sessão é encerrado em ≤ 5 s. (REQ-SEC-057/062)
- **CA-SEC-04** Uma mensagem de chat contendo `<img src=x onerror=alert(1)>` é armazenada e exibida
  sem executar script (sanitizada no servidor e no cliente); `javascript:` em `href` é removido.
  (REQ-SEC-030/032)
- **CA-SEC-05** Um upload de arquivo `.png` cujo conteúdo é na verdade um HTML/executável (magic bytes
  divergentes) é rejeitado; um upload com nome `../../config/admin` é gravado com nome aleatório dentro
  do diretório permitido, sem escapar. (REQ-SEC-040/041/042)
- **CA-SEC-06** Um SVG enviado com `<script>` embutido é sanitizado (script removido) ou servido de
  forma que não executa ao ser exibido. (REQ-SEC-035)
- **CA-SEC-07** Um pack importado com um Rule Element cujo `value` é `constructor.constructor('...')()`
  é rejeitado na validação de schema/parser, logado como `import.rule_element_rejected`, e nenhum
  código é executado no servidor. (REQ-SEC-073/074; DEC-SEC-03)
- **CA-SEC-08** O cliente em produção é servido com CSP contendo `script-src 'self' 'nonce-...'` (nonce
  distinto por request) e sem `'unsafe-inline'`/`'unsafe-eval'`; um `<script>` inline sem nonce é
  bloqueado pelo browser. (REQ-SEC-054/055)
- **CA-SEC-09** Um jogador PLAYER que emite uma op para curar um Actor que não possui recebe
  `PERMISSION_DENIED` (revalidação server-side), e o efeito não é aplicado mesmo que a UI tivesse
  escondido o botão. (REQ-SEC-002/022)
- **CA-SEC-10** Inundar a conexão com > 50 mensagens/s resulta em `RATE_LIMITED` (ops) / descarte
  (efêmeros) e o processo do servidor permanece estável; uma mensagem de 5 MiB é rejeitada com
  `TOO_LARGE`. (REQ-SEC-060/061/004)
- **CA-SEC-11** `grep` no código do servidor não encontra `eval(`, `new Function(`, `require('vm')` ou
  `vm2` em caminhos que processam entrada de usuário ou de pack. (REQ-SEC-071; DEC-SEC-03)
- **CA-SEC-12** Os logs de segurança registram falhas de auth, lockouts e tentativas de path traversal,
  e em nenhum deles aparecem senha, token de sessão ou hash completo. (REQ-SEC-090/092)
- **CA-SEC-13** A checklist de segurança por release está versionada nesta spec e os itens
  automatizáveis (headers, CSP, Origin, ausência de `eval`) são verificados em CI, falhando o build se
  um controle for removido. (REQ-SEC-NF-003)

---

## Questões em aberto

1. **Verificação de integridade de packs** (research §8 A08): packs oficiais importados devem ter
   checksum/assinatura verificada? No MVP os packs são gerados pelo próprio `tools/importer-pf2e` a
   partir de fonte pública confiável; a verificação ganha relevância se/quando houver distribuição de
   packs de terceiros. Cruzar com `16-compendiums-e-importacao.md`. [V2]

2. **Modelo de A/V e suas implicações de segurança:** A/V WebRTC é [V2]; quando entrar, exigirá
   tratamento de STUN/TURN, portas UDP e SSL obrigatório para mídia (research 06 §9). Definir threat
   model específico de A/V quando a feature for especificada.

3. **CSP e dados/blob inline:** `img-src data: blob:` é necessário para thumbnails e dados embutidos,
   mas `data:` amplia levemente a superfície. Avaliar se thumbnails podem migrar para URLs servidas
   (`'self'`) eliminando `data:` da CSP. Cruzar com `20-assets-e-midia.md` e `06-canvas-e-renderizacao.md`.

4. **Rotação de segredos de runtime:** a chave HMAC do JWT e a Admin Key são geradas na instalação e
   mantidas em memória. Há necessidade de um fluxo de rotação (ex.: comprometimento suspeito) que
   invalide todas as sessões? Cruzar com `22-instalacao-e-distribuicao.md`. [V2]

5. **Granularidade do `nonce` da CSP com Vite/Svelte 5:** o build do cliente precisa cooperar para que
   scripts gerados recebam o nonce por request (SSR de uma shell mínima ou injeção de meta). Validar a
   abordagem técnica na implementação do servidor estático (Fastify static). Cruzar com
   `11-ui-framework-e-fichas.md`.

6. **Limite de profundidade e custo do parser de expressões de Rule Element:** a profundidade máxima de
   acesso a propriedades (research sugere 4) e o conjunto de operadores whitelistados precisam casar
   com o que os Rule Elements reais do PF2e exigem, sem quebrar conteúdo legítimo. Calibrar com a
   tabela de cobertura de `16-compendiums-e-importacao.md` e o motor de modifiers de `08-` / `15-`.

7. **Detecção de "acesso externo sem TLS":** a heurística de subnet LAN para emitir o aviso (REQ-SEC-051)
   pode dar falso positivo/negativo com VPNs, IPv6 e redes incomuns. Definir a heurística concreta e o
   comportamento em caso de incerteza. Cruzar com `22-instalacao-e-distribuicao.md`.

---

## Referências

- `docs/research/91-fusion-security-threat-model.md` — superfície de ataque e lições do Foundry (§1),
  autenticação Argon2id/JWT/rate limiting (§2), TLS/headers/CSP/CORS/CSWSH (§3), sanitização HTML e
  enrichers (§4), path traversal e uploads (§5), sandbox de macros e executeAsGM (§6), validação de
  dados importados/Rule Elements (§7), matriz OWASP Top 10:2025 (§8), configuração de inicialização
  (§9), checklist de implementação (§10).
- `docs/research/06-foundry-rede-multiplayer.md` — Admin Access Key separado e autoridade do servidor
  (§1, §3), executeAsGM/socketlib como vetor de privilege escalation (§4), modelo de sessão por mundo
  (§6), `options.json` proxySSL/upnp e hosting/NAT/túnel (§11–12).
- [OWASP Top 10:2025 Introduction](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Christian Schneider — Cross-Site WebSocket Hijacking (CSWSH)](https://christian-schneider.net/blog/cross-site-websocket-hijacking/)
- [DOMPurify GitHub (cure53)](https://github.com/cure53/dompurify)
- [Snyk — CVE-2025-26791 DOMPurify XSS](https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251)
- [isolated-vm GitHub (laverdet)](https://github.com/laverdet/isolated-vm)
- [The Hacker News — Critical vm2 Flaw Allows Sandbox Escape (2026)](https://thehackernews.com/2026/01/critical-vm2-nodejs-flaw-allows-sandbox.html)
- [catnip.fyi — Foundry VTT Unauthenticated RCE Part 1: Dir Overwrite](https://catnip.fyi/posts/foundry-p1/)
- [Foundry VTT Release 13.351 — RCE security fix](https://foundryvtt.com/releases/13.351)
- [node-rate-limiter-flexible (animir)](https://github.com/animir/node-rate-limiter-flexible)
- [file-type (sindresorhus)](https://github.com/sindresorhus/file-type)
