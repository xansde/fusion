# 95 — Operações: Backups, Logs/Telemetria e Estratégia de Testes/QA

**Projeto Fusion — Pesquisa de Arquitetura**
Data: 2026-06-11
Escopo: clean-room — comportamentos e conceitos inspirados no Foundry VTT; nenhum código proprietário copiado.

---

## Sumário Executivo

Este documento cobre as três frentes operacionais ausentes nas specs anteriores do Fusion VTT: (1) estratégia de backup para o banco SQLite, (2) logging estruturado e telemetria do servidor, e (3) plano de testes e QA — desde testes unitários do motor de regras até testes de carga multiplayer. As decisões tomadas aqui impactam diretamente a confiabilidade percebida pelo GM, a privacidade dos dados dos jogadores e a sustentabilidade do projeto a longo prazo.

---

## 1. Backups

### 1.1 Como o Foundry VTT trata backups (referência comportamental)

O Foundry VTT opera com **LevelDB** (ClassicLevel) como backend de dados desde a V11 (maio 2023), tendo migrado do formato de texto plano NeDB. Essa decisão é relevante para o Fusion porque explica o principal ponto de fragilidade que precisamos evitar.

#### Estrutura de diretórios (Foundry, para referência)

```
UserData/
  Data/
    worlds/
      minha-campanha/       ← diretório LevelDB (binário, múltiplos arquivos)
    systems/
    modules/
  Backups/
    <pacote>-<timestamp>.bak
    <pacote>-<timestamp>.json  ← manifesto do backup
    snapshots/
      <snapshot>.json
  Config/
  Logs/
    diagnostics.json
```

O sistema de backup do Foundry V11+ introduz três modalidades:
1. **Package Backup**: backup de um mundo/sistema/módulo específico via clique direito na tela de Setup. Gera um par `.bak` + `.json` (manifesto) na pasta `Backups/`.
2. **Snapshot**: captura completa de todos os pacotes instalados de uma só vez. Recomendado antes de atualizações de versão major (ex.: V12 → V13). Armazenado como `.json` que referencia os `.bak` correspondentes.
3. **Backup manual**: cópia do diretório `Data/` enquanto o servidor está parado.

**Restrição crítica**: O Foundry proíbe explicitamente a modificação manual do diretório `Backups/` — toda gestão deve ocorrer via ferramenta interna. Restauração ocorre pela tela de Setup → botão direito → "Restore Latest" ou pela aba Snapshots do Gerenciador de Backups.

#### O problema dos serviços de sincronização

A documentação oficial do Foundry é categórica: **serviços de sync automático (Dropbox, Google Drive, OneDrive, iCloud) são incompatíveis com um servidor ativo**. Os motivos são dois:

1. **Lock files**: o LevelDB usa arquivos de trava para evitar acesso simultâneo. Um serviço de sync pode restaurar esses locks em estados inconsistentes, impedindo que o banco seja aberto.
2. **Corrupção durante escrita**: banco binário modificado mid-write por um sync torna o conteúdo "quase imediatamente irrecuperável".

Se o usuário insistir em usar sync, o Foundry recomenda: (a) sync unidirecional apenas (upload), (b) nunca sincronizar enquanto o servidor estiver rodando, (c) sincronizar apenas a subpasta `Data/`, excluindo `Config/`.

**Para o Fusion**: o problema é idêntico, pois SQLite também é um arquivo binário com WAL. A estratégia de backup deve partir desse contexto.

---

### 1.2 Estratégia de Backup para o SQLite do Fusion

O Fusion usa **better-sqlite3** com modo **WAL** (Write-Ahead Log). Isso possibilita backups online sem downtime.

#### 1.2.1 Configuração SQLite de produção

O banco de cada mundo deve ser inicializado com os seguintes PRAGMAs:

| PRAGMA | Valor recomendado | Justificativa |
|--------|-------------------|---------------|
| `journal_mode` | `WAL` | Permite backup online; leitores não bloqueiam escritores |
| `synchronous` | `NORMAL` | Equilibrio durabilidade/performance em WAL (3× mais rápido que FULL) |
| `wal_autocheckpoint` | `1000` | Checkpoint a cada 1000 páginas; +12% perf vs. padrão |
| `busy_timeout` | `30000` | 30s de retry automático em SQLITE_BUSY |
| `foreign_keys` | `ON` | Integridade referencial explícita |
| `cache_size` | `-16000` | 16 MB de cache de páginas |

#### 1.2.2 Backup online com better-sqlite3

A API `Database.backup(destination, [options])` do better-sqlite3 usa o **SQLite Online Backup API** nativo. Permite backup enquanto o banco está ativo, sem bloquear leitores nem escritores do mesmo processo.

```typescript
// Exemplo conceitual — NÃO é código proprietário, é uso da API pública
await db.backup(`worlds/${worldSlug}/backups/${timestamp}.db`, {
  progress({ totalPages, remainingPages }) {
    const pct = Math.round(((totalPages - remainingPages) / totalPages) * 100);
    logger.debug({ worldSlug, pct }, 'backup progress');
    return 100; // páginas por ciclo do event loop
  }
});
```

**Atenção**: se uma segunda conexão mutacionar o banco durante o backup, o backup é reiniciado automaticamente. Por isso, o Fusion deve garantir que **apenas uma conexão escreve no banco de cada mundo** (single-writer pattern).

#### 1.2.3 Modalidades de backup para o Fusion

| Modalidade | Mecanismo | Gatilho | Destino |
|------------|-----------|---------|---------|
| **Automático periódico** | `db.backup()` online | Cron a cada 30 min enquanto servidor ativo | `worlds/<slug>/backups/auto-<timestamp>.db` |
| **Snapshot de mundo** | `db.backup()` + export assets | Chamado pelo GM manualmente via UI | `worlds/<slug>/backups/manual-<timestamp>.db` |
| **Pre-update** | Snapshot completo | Antes de atualizar o Fusion | `backups/pre-update-<version>-<timestamp>.tar.gz` |
| **Export JSON versionável** | `SELECT` + serialização | Sob demanda | `worlds/<slug>/export/<timestamp>/` (um .json por document type) |

#### 1.2.4 Retenção

Proposta de política de retenção padrão (configurável):

- Backups automáticos: manter os últimos 10 (aproximadamente 5 horas de cobertura em ciclos de 30 min)
- Backups manuais do GM: manter todos até limite de disco (avisar quando ultrapassar 80%)
- Pre-update: manter sempre até que o GM confirme que a atualização está estável

#### 1.2.5 Litestream para replicação contínua (opcional, avançado)

Para GMs que quiserem redundância maior sem gerenciar backups manualmente, o **Litestream** é o padrão de mercado para replicação contínua de SQLite. Ele opera como processo separado (sem mudança de código), monitora o WAL e envia incrementos para S3/GCS/Azure Blob ou mesmo um diretório local de rede.

Funcionamento interno:
- Litestream mantém uma "shadow WAL" — recria os arquivos WAL como série sequencial (`00000000.wal`, `00000001.wal`, ...)
- Organiza backups em "generations" — cada geração é um snapshot base + WAL sequenciais
- Retenção padrão: 24 horas de WAL (precisão de restauração: ~10 segundos)
- Suporta destino em arquivo local além de cloud

Para o Fusion, Litestream é uma **integração opcional** documentada no guia de deployment, não um requisito de baseline.

#### 1.2.6 Export JSON para controle de versão

Independentemente do backup binário, o Fusion deve oferecer **export canônico em JSON** de cada mundo. Isso permite:
- Armazenamento em git para histórico versionável
- Inspeção human-readable do conteúdo do mundo
- Interoperabilidade com ferramentas externas

Estrutura proposta do export:
```
worlds/<slug>/export/<timestamp>/
  manifest.json          ← metadados do mundo e versão do schema
  actors/
    <id>.json
  items/
    <id>.json
  scenes/
    <id>.json
  journal-entries/
    <id>.json
  ...
```

#### 1.2.7 Recuperação de corrupção

Se um arquivo `.db` ou `.db-wal` for corrompido:

1. **Detectar**: ao abrir o banco, executar `PRAGMA integrity_check`. Se retornar algo além de `ok`, o banco está corrompido.
2. **Isolar**: renomear `world.db` → `world.db.corrupted` para preservar evidências.
3. **Restaurar**: carregar o backup mais recente via `db.backup()` reverso (ou cópia simples do `.db` de backup).
4. **Fallback para export JSON**: se não houver backup binário, tentar reconstruir a partir do export JSON mais recente.

O Fusion deve registrar no log de início do servidor o resultado de cada `integrity_check` dos mundos ativos.

---

## 2. Logs e Telemetria

### 2.1 Logging estruturado do servidor

#### 2.1.1 Biblioteca recomendada: Pino

O **Pino** é o logger de produção mais adequado para o servidor Node.js do Fusion:

| Critério | Pino | Winston |
|----------|------|---------|
| Performance | ~115ms para 10.000 ops | ~270ms para 10.000 ops |
| Formato padrão | JSON estruturado | Texto (configurável) |
| Worker threads para I/O | Sim (pino-transport) | Não nativo |
| Tamanho do bundle | Pequeno | Médio |
| Ecossistema de transports | Amplo | Muito amplo |

O Pino é 2,4× mais rápido que o Winston em benchmarks, relevante para um servidor de jogo onde o logging não pode competir com o event loop.

#### 2.1.2 Níveis de log

| Nível | Uso no Fusion |
|-------|---------------|
| `fatal` | Crash do servidor, corrupção de banco detectada |
| `error` | Exceções não tratadas, falha em operações de backup |
| `warn` | Backup próximo do limite de disco, latência de socket elevada |
| `info` | Início/fim de sessão, mundos abertos/fechados, backups completados |
| `debug` | Operações individuais de documento, progresso de backup |
| `trace` | Broadcast socket por mensagem (somente dev) |

Em produção, o nível padrão deve ser `info`. O GM pode elevar para `debug` via painel de configuração.

#### 2.1.3 Rotação de logs

Usando `pino-roll` (ou `rotating-file-stream` como alternativa):

- Rotação diária de arquivos de log do servidor
- Manter os últimos 7 dias de logs em `Logs/server-YYYY-MM-DD.log`
- Manter log de erros separado: `Logs/error.log` (apenas `error` e `fatal`)
- Em ambiente containerizado, emitir apenas para stdout e delegar rotação ao host

#### 2.1.4 Campos obrigatórios em cada entrada de log

Todo log estruturado do Fusion deve incluir:

```json
{
  "time": "<ISO 8601>",
  "level": "info",
  "pid": 12345,
  "hostname": "gm-machine",
  "module": "socket",
  "worldSlug": "minha-campanha",
  "userId": "<uuid>",
  "msg": "document updated"
}
```

O campo `module` identifica o subsistema emitente (ex.: `socket`, `db`, `backup`, `auth`, `rules`).

#### 2.1.5 Log de performance do servidor

Métricas de performance a emitir como log `debug` a cada tick do servidor (ou a cada N segundos):

| Métrica | Descrição |
|---------|-----------|
| `socket.latency.p50` | Latência mediana do round-trip de socket (ms) |
| `socket.latency.p99` | Latência no percentil 99 |
| `socket.connected` | Número de clientes conectados |
| `db.writeLatency` | Tempo médio de escrita no SQLite (ms) |
| `db.walSize` | Tamanho do WAL em páginas |
| `memory.rss` | Memória RSS do processo Node.js (MB) |

Alertas internos sugeridos (logar como `warn`):
- WAL size > 100 MB (sinal de checkpoint travado)
- SQLITE_BUSY rate > 10/min
- Socket latency p99 > 500ms
- Memória RSS > 80% do limite configurado

#### 2.1.6 Log de erros do cliente

Erros JavaScript do cliente (browser do jogador) devem ser capturados e enviados ao servidor via endpoint REST dedicado:

```
POST /api/client-error
{
  "message": "...",
  "stack": "...",
  "userAgent": "...",
  "worldSlug": "...",
  "userId": "..."
}
```

O servidor registra esses erros no nível `error` com prefixo `[client]`. Isso permite ao GM ver erros de jogadores sem acesso às DevTools.

---

### 2.2 Telemetria e Privacidade

#### 2.2.1 Contexto: jogo roda localmente

O Fusion é um servidor local do GM. Não há "produto SaaS" coletando dados centralmente por default. Isso muda o contexto de privacidade:

- Os dados do mundo pertencem exclusivamente ao GM e seus jogadores
- Não há necessidade legal de GDPR para coleta interna
- **Qualquer telemetria enviada para fora da máquina local deve ser 100% opt-in**

#### 2.2.2 Modelo do Foundry VTT como referência

O Foundry V11 introduziu telemetria opt-in com as seguintes características (referência comportamental):
- Desabilitada por padrão
- Diálogo de consentimento na primeira execução
- Dados salvos localmente em `Logs/diagnostics.json` antes de qualquer transmissão
- O usuário pode inspecionar o arquivo antes de decidir habilitar
- Conteúdo: versões instaladas, sistemas utilizados, tempo de jogo (sem PII)
- Transmissão apenas quando "Allow Data Sharing" está ativo

**Para o Fusion**: adotar o mesmo modelo. O `diagnostics.json` local é uma feature útil independente do opt-in — permite ao GM gerar relatório de bug incluindo contexto do ambiente.

#### 2.2.3 Crash reporting: Sentry vs. self-hosted vs. local-only

| Opção | Infraestrutura | Privacidade | Complexidade |
|-------|----------------|-------------|--------------|
| **Sentry SaaS** | Nenhuma | Dados saem da máquina | Baixa |
| **Sentry self-hosted** | Docker 8+ GB RAM, PostgreSQL, Redis, Kafka, Clickhouse, 20+ containers | Dados ficam no servidor do GM | Alta |
| **GlitchTip** (alternativa leve) | Docker 1-2 containers | Dados no servidor | Média |
| **Log-only local** | Nenhuma | Total | Zero |

**Recomendação para o Fusion**: dado que o servidor roda na máquina do GM e que a maioria dos GMs não vai querer operar uma stack Docker para Sentry self-hosted, o **baseline deve ser log-only local** com export de crash report como arquivo JSON. Para equipes técnicas, documentar a integração com Sentry SaaS como opção opt-in (via variável de ambiente `SENTRY_DSN`).

#### 2.2.4 Métricas de FPS do cliente

O cliente (browser do jogador) deve medir e reportar FPS ao servidor via mensagem de socket periódica (a cada 5 segundos):

```json
{ "type": "perf_report", "fps": 58, "drawCalls": 1204, "pixiEntities": 847 }
```

Esses dados ficam visíveis apenas no painel do GM (nunca transmitidos externamente), ajudando a identificar jogadores com hardware limitado antes que a sessão degrade.

---

## 3. Testes e QA

### 3.1 Visão Geral da Estratégia

Um VTT tem três camadas de lógica com requisitos de teste completamente diferentes:

| Camada | Característica | Ferramenta |
|--------|----------------|------------|
| **Motor de regras** (PF2e, SF2e, Etmos) | Lógica pura, sem DOM, sem browser | Vitest (unit) |
| **Servidor** (CRUD, socket broadcast) | I/O de arquivo, WebSocket, sem browser | Vitest (integration) |
| **Cliente** (UI, canvas, Pixi.js) | Browser real, canvas/WebGL | Playwright (E2E) |
| **Carga multiplayer** | Múltiplos clientes simultâneos | Artillery ou k6 |
| **Regressão visual do canvas** | Screenshots do canvas | Playwright + pixelmatch |

### 3.2 Testes Unitários — Motor de Regras

#### 3.2.1 O que testar

O motor de regras do Fusion é a parte mais crítica e testável de forma isolada. Deve cobrir:

**Degree of Success (PF2e Remaster)**:
- Critical Success: resultado ≥ DC + 10
- Success: resultado ≥ DC
- Failure: resultado < DC
- Critical Failure: resultado ≤ DC - 10
- Efeito de fortune/misfortune sobre grau de sucesso
- Efeito de "one degree better/worse" de condições

**Modifier Stacking (PF2e)**:
- Bônus do mesmo tipo: apenas o maior se aplica
- Bônus de tipos diferentes: todos se somam
- Penalidades: cumulativas independente do tipo
- Tipos canônicos: circumstance, item, status, untyped
- Condicional: `predicate` em modifier deve ser avaliado contra o contexto do check

**Dice Parser**:
- Notações básicas: `1d20`, `4d6`, `2d10+5`
- Notações compostas: `2d6+1d4+3`
- Keep/Drop: `4d6kh3` (keep highest 3), `4d6dl1` (drop lowest 1)
- Exploding: `d6!`, `d6!>5`
- Reroll: `d6rr1` (reroll 1s)
- Minimum/Maximum: `d20min10`
- Resultado determinístico para testes (seed injetável via DI)

**Referência**: o repositório `foundryvtt/pf2e` usa **Jest** com `jest.config.json` (preset `es-jest`) e configura aliases de path para módulos (`@actor`, `@item`, `@scene`, `@module`, `@scripts`, `@system`, `@util`). O diretório de testes é `tests/` com setup em `tests/setup.ts`. O CI (`ci.yml`) executa em ~2 minutos com 2500+ runs registrados.

**Para o Fusion**: migrar para **Vitest** (compatível com Jest, melhor suporte a ESM nativo, mais rápido). Manter estrutura modular análoga.

#### 3.2.2 Estrutura de diretórios de testes

```
src/
  rules/
    pf2e/
      degree-of-success.ts
      modifier-stacking.ts
      dice-parser.ts
    __tests__/
      degree-of-success.test.ts
      modifier-stacking.test.ts
      dice-parser.test.ts
  server/
    __tests__/
      document-crud.test.ts
      socket-broadcast.test.ts
tests/
  e2e/
    canvas-render.spec.ts
    multiplayer-session.spec.ts
  load/
    concurrent-players.yml    ← Artillery
```

#### 3.2.3 Isolamento do motor de regras

O motor de regras **não deve ter dependências de browser, socket ou banco de dados**. Deve ser uma biblioteca TypeScript pura importável tanto no servidor quanto no cliente. Isso viabiliza testes unitários rápidos sem mock de infraestrutura.

### 3.3 Testes de Integração — Servidor

#### 3.3.1 Escopo

Testes de integração cobrem a camada de servidor com banco real (SQLite in-memory ou arquivo temporário) e socket mock:

- **CRUD de documentos**: criar, ler, atualizar, deletar Actor/Item/Scene/JournalEntry
- **Consistência transacional**: garantir que rollback ocorre em caso de erro
- **Broadcast de socket**: verificar que update de documento emite evento correto para todos os clientes conectados
- **Autenticação**: tentativas de operação sem permissão retornam código de erro esperado
- **Backup API**: testar que `db.backup()` produz arquivo SQLite válido e íntegro

#### 3.3.2 Banco in-memory para testes

```typescript
// Exemplo conceitual de setup de banco in-memory para testes
const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
// Aplicar migrations
runMigrations(testDb);
```

#### 3.3.3 Socket mock

Para testes de integração do servidor sem cliente real, usar um cliente Socket.IO em processo (sem rede) conectado ao servidor de teste em porta efêmera.

### 3.4 Testes E2E com Playwright

#### 3.4.1 Desafios específicos de VTT

O canvas WebGL/Pixi.js é a maior dificuldade para testes E2E:

- O canvas é um elemento opaco para a árvore de acessibilidade do DOM
- Eventos de mouse no canvas devem ser disparados com coordenadas exatas
- O estado visual é não-determinístico sem controle de seed do RNG

**Abordagem recomendada**:
1. Expor um objeto `window.__fusion_test_api__` no cliente em modo de teste, com métodos para:
   - Obter o estado atual do canvas em formato serializável
   - Injetar tokens em posições determinísticas
   - Disparar eventos de regra com parâmetros controlados
2. Usar `page.evaluate()` do Playwright para acessar essa API interna
3. Screenshots do canvas via `page.screenshot()` apenas para testes de regressão visual (não como asserção primária)

#### 3.4.2 Seletor de elementos UI não-canvas

Para UI HTML que envolve o canvas (tooltips, barras de HP, painel lateral), usar seletores por `data-testid` attributes. **Nunca** usar seletores por classe CSS ou texto, que mudam com internacionalização ou redesign.

#### 3.4.3 Pipeline E2E no CI

O Playwright requer browser headless instalado. Configuração no GitHub Actions:

```yaml
# Trecho conceitual de workflow
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
- name: Start Fusion server
  run: node dist/server/main.js --test-mode &
- name: Run E2E tests
  run: npx playwright test
```

O servidor deve suportar `--test-mode` flag que:
- Usa banco SQLite in-memory ou temporário
- Pré-popula dados de fixture
- Desabilita autenticação de licença
- Habilita `window.__fusion_test_api__`

### 3.5 Regressão Visual do Canvas

#### 3.5.1 Abordagem

O Playwright suporta comparação pixel-a-pixel via `expect(page).toHaveScreenshot()` usando a biblioteca **pixelmatch**. Comparação de um screenshot 1280×720 em ~50ms.

Para canvas WebGL:
- Configurar `preserveDrawingBuffer: true` no contexto WebGL/Pixi.js em modo de teste
- Garantir estado determinístico antes de capturar screenshot: mesma cena, mesmas posições de tokens, sem animações
- Threshold de diferença configurável (padrão: 1 pixel) para tolerar variações de anti-aliasing entre GPUs

#### 3.5.2 O que cobrir com regressão visual

| Cena de teste | Descrição |
|---------------|-----------|
| Scene rendering | Tile de fundo + grid + tokens em posições fixas |
| Fog of war | Área revelada vs. não revelada |
| Token HUD | Barra de HP, condições, nome |
| Lighting | Fontes de luz com raio e cor configurados |
| Measurement template | Template de cone/círculo/linha |

**Atenção**: regressão visual do canvas é frágil entre GPUs e sistemas operacionais. Recomenda-se rodar esses testes apenas no CI (ambiente controlado) e não localmente na máquina do dev.

### 3.6 Testes de Carga Multiplayer

#### 3.6.1 Contexto

O documento 06 das specs cita limite de ~6-8 usuários simultâneos de audio/vídeo. Para o servidor de jogo em si (sem A/V), o limite é muito maior. O objetivo dos testes de carga é determinar:

1. Qual é o número máximo de clientes que o servidor aguenta sem degradação perceptível (latência socket p99 < 200ms)?
2. Como o servidor se comporta quando múltiplos jogadores modificam documentos simultaneamente?
3. O WAL do SQLite cresce de forma controlada sob carga de escrita contínua?

#### 3.6.2 Ferramentas

| Ferramenta | Protocolo suportado | Configuração | CI-friendly |
|------------|---------------------|--------------|-------------|
| **Artillery** | HTTP, WebSocket, **Socket.IO nativo** | YAML | Sim |
| **k6** | HTTP, WebSocket (raw) | JavaScript | Sim |

Para o Fusion, **Artillery** é preferível porque suporta Socket.IO nativamente (via `artillery-engine-socketio-v3`), refletindo o protocolo real usado. Evitar k6 + Socket.IO pois requer wrappers que não cobrem handshake do protocolo.

**Atenção**: a instalação padrão do Artillery vem com cliente Socket.IO v2, incompatível com servidor v3/v4. É mandatório usar o engine customizado:
```
npm install artillery artillery-engine-socketio-v3
```

#### 3.6.3 Cenários de carga

**Cenário baseline (smoke test)**: 1 GM + 5 jogadores. Verificar latência p99 < 100ms durante 5 minutos.

**Cenário de estresse**: rampa de 1 a 30 clientes em 2 minutos, mantendo por 5 minutos. Medir: conexões estáveis, latência p99, tamanho do WAL.

**Cenário de escrita simultânea**: 8 clientes enviando updates de documento ao mesmo tempo. Verificar que nenhuma escrita é perdida e o SQLite não retorna SQLITE_BUSY acima de 1%.

**Cenário de desconexão**: 30% dos clientes desconectam e reconectam a cada 30 segundos. Verificar que o servidor não vaza memória (RSS estável) e reconexões são bem-sucedidas.

#### 3.6.4 Métricas a coletar

| Métrica | Meta |
|---------|------|
| Socket connection time | p99 < 500ms |
| Round-trip latency | p99 < 200ms |
| Packets per second throughput | > 1000 pps sem degradação |
| SQLITE_BUSY rate | < 1% sob estresse |
| WAL file size após 30 min | < 50 MB |
| Node.js RSS durante carga | Crescimento < 10% após warmup |

### 3.7 Pipeline de CI/CD

#### 3.7.1 Estrutura de workflows (GitHub Actions)

```
.github/workflows/
  ci.yml               ← unit + integration tests (toda PR/push)
  e2e.yml              ← E2E Playwright (push para main/staging)
  load-test.yml        ← carga Artillery (agendado, não em PR)
  release.yml          ← build + tag + changelog
```

#### 3.7.2 Workflow de CI principal

O workflow `ci.yml` deve:
1. Instalar dependências (`npm ci`)
2. Rodar typecheck (`tsc --noEmit`)
3. Rodar lint (ESLint)
4. Rodar testes unitários (Vitest — <30s esperado)
5. Rodar testes de integração (Vitest integration config — <2min esperado)
6. Verificar cobertura mínima (80% para `rules/`, sem limite para demais)

#### 3.7.3 Workflow E2E

O workflow `e2e.yml` deve:
1. Buildar o servidor e cliente
2. Instalar browsers Playwright (`npx playwright install --with-deps chromium`)
3. Subir servidor em modo de teste
4. Rodar testes Playwright
5. Publicar HTML report como artifact do GitHub Actions
6. Em falha, publicar screenshots e videos como artifacts

#### 3.7.4 Testes de regressão visual no CI

Armazenar screenshots baseline como artefatos versionados no repositório (diretório `tests/e2e/__snapshots__/`). Atualizar baselines explicitamente com flag `--update-snapshots`. Nunca atualizar automaticamente em CI.

---

## 4. Tabela de Decisões Arquiteturais

| Decisão | Opção escolhida | Alternativa considerada | Razão |
|---------|----------------|------------------------|-------|
| Backend de logging | Pino | Winston | 2.4× mais rápido; JSON nativo |
| Rotação de logs | pino-roll | logrotate (SO) | Portável entre Windows/macOS/Linux |
| Backup online | `db.backup()` (better-sqlite3) | `VACUUM INTO` | Backup incremental page-by-page; reflte mutações in-flight |
| Replicação avançada | Litestream (opcional) | Nenhuma | Zero code change; opt-in para power users |
| Crash reporting default | Log local JSON | Sentry SaaS | Privacidade; server roda localmente |
| Telemetria | Opt-in, arquivo local primeiro | Automático | Alinhado com modelo Foundry V11+ |
| Framework de testes unitários | Vitest | Jest | ESM nativo; compatível com Jest API; mais rápido |
| Framework E2E | Playwright | Cypress | Suporte headless melhor; canvas testing mais maduro |
| Load testing | Artillery | k6 | Socket.IO v3/v4 nativo |
| Cobertura de regressão visual | pixelmatch (Playwright built-in) | Percy/Chromatic | Zero infra externa; suficiente para canvas determinístico |

---

## 5. Questões em Aberto para as Specs

1. **Limite configurável de backups**: o GM deve poder configurar número de backups retidos? Qual deve ser o default?
2. **Backup de assets**: arquivos de imagem/áudio referenciados por documentos do mundo devem ser incluídos no backup `.db` ou gerenciados separadamente? Como calcular o tamanho total?
3. **Integridade do export JSON**: o export JSON deve ter hash/checksum para verificação de integridade?
4. **Telemetria de FPS por jogador**: os dados de FPS de cada jogador devem ser visíveis apenas para o GM ou também para o próprio jogador?
5. **Sink de logs externo**: o Fusion deve suportar envio de logs para um endpoint externo configurável (para GMs que usam ELK/Grafana/Datadog próprio)?
6. **Testes de regressão visual multiplataforma**: como lidar com diferenças de renderização GPU entre Windows, macOS e Linux no CI?
7. **Seed do RNG para testes E2E**: o Fusion deve expor controle de seed do dice roller para testes determinísticos? Como sem vazar a implementação?
8. **Cobertura mínima de código**: qual a cobertura alvo para módulos além do motor de regras (servidor, cliente)?
9. **Estratégia de testes para sistemas ainda não implementados (Etmos)**: os testes de motor de regras do Etmos devem ser especificados antes da implementação (TDD)?
10. **Modo de teste no cliente**: o `window.__fusion_test_api__` deve ser eliminado em builds de produção via tree-shaking, ou protegido por flag de runtime?

---

## Fontes

- [Foundry VTT — Backups and Snapshots](https://foundryvtt.com/article/backups/)
- [Foundry VTT — Troubleshooting: Backing Up and Moving Your User Data](https://foundryvtt.com/article/user-data-backup/)
- [Foundry VTT — Automated Backup and Sync Services](https://foundryvtt.com/article/automatic-backups/)
- [Foundry VTT — V11 LevelDB Content Packaging Changes](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Foundry VTT — Release 13.341 (V13)](https://foundryvtt.com/releases/13.341)
- [GitHub Issue #8912 — Opt-in diagnostic data sharing](https://github.com/foundryvtt/foundryvtt/issues/8912)
- [GitHub Issue #9824 — Auto-repair for corrupted LevelDB databases](https://github.com/foundryvtt/foundryvtt/issues/9824)
- [better-sqlite3 — API Documentation (backup method)](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [better-sqlite3 — Performance documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [Oldmoe's Blog — Backup Strategies for SQLite in Production](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/)
- [Sling Academy — Best Practices for Managing SQLite Backups in Production](https://www.slingacademy.com/article/best-practices-for-managing-sqlite-backups-in-production/)
- [Forward Email — SQLite Performance Optimization Guide 2026](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide)
- [Litestream — How it Works](https://litestream.io/how-it-works/)
- [Litestream — Streaming SQLite Replication](https://litestream.io/)
- [GitHub — foundryvtt/pf2e (jest.config.json)](https://github.com/foundryvtt/pf2e/blob/master/jest.config.json)
- [GitHub — foundryvtt/pf2e CI Workflow](https://github.com/foundryvtt/pf2e/actions/workflows/ci.yml)
- [GitHub ADR-005 — Dual Test Strategy Vitest + Playwright (foundryvtt-mcp)](https://github.com/laurigates/foundryvtt-mcp/blob/main/docs/blueprint/adrs/ADR-005-dual-test-strategy-vitest-playwright.md)
- [GitHub — asgaardlab/canvas-visual-bugs-testbed](https://github.com/asgaardlab/canvas-visual-bugs-testbed)
- [Playwright — Visual Comparisons (toHaveScreenshot)](https://playwright.dev/docs/test-snapshots)
- [Socket.IO — Load Testing Documentation](https://socket.io/docs/v4/load-testing/)
- [Pino.js — Ultimate Guide to High-Performance Node.js Logging (Last9)](https://last9.io/blog/npm-pino-logger/)
- [Lead With Skills — Logging in Node.js: Winston and Pino Best Practices](https://www.leadwithskills.com/blogs/logging-nodejs-winston-pino-best-practices)
- [Sentry — Self-Hosted Documentation](https://develop.sentry.dev/self-hosted/)
- [Sentry for Electron — Native Crash Reporting](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [k6 vs Artillery vs Locust vs JMeter 2026 (DevToolReviews)](https://www.devtoolreviews.com/reviews/load-testing-tools-k6-vs-artillery-vs-locust-vs-jmeter-2026)
- [Artillery — Full-stack performance & reliability testing](https://www.artillery.io/)
- [WebSocket Performance Testing: Real-Time Communication at Scale](https://yrkan.com/blog/websocket-performance-testing/)
- [The Forge VTT Blog — Multiple Levels of Challenges (LevelDB debugging V13)](https://blog.forge-vtt.com/multiple-levels-of-challenge/)
- [forwardemail/sqlite-benchmarks — Comprehensive SQLite benchmarking](https://github.com/forwardemail/sqlite-benchmarks)
