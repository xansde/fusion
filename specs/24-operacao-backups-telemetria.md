# 24 — Operação, Backups e Telemetria

**Status:** draft v0.1
**Data:** 2026-06-11
**Baseada em:**
- `docs/research/95-ops-backup-telemetry-testing.md` — estratégia de backup SQLite, logging Pino, telemetria local, crash reporting, testes de carga
- `docs/research/92-install-distribution-autoupdate.md` — estrutura de diretórios, onboarding, procedimentos de migração de instalação

---

## Objetivo

Definir como o Fusion opera de forma contínua e confiável: backups automáticos e manuais do banco SQLite por mundo, política de retenção e restauração, logging estruturado do servidor, auditoria de ações sensíveis, diagnóstico exportável para suporte, monitoramento de latência por jogador (visível ao GM), e procedimentos operacionais para recuperar de falhas, mover instalações e migrar entre versões. Esta spec não cobre testes e QA (ver `25-testes-e-qualidade.md`) nem instalação e distribuição (ver `22-instalacao-e-distribuicao.md`).

---

## Escopo

### O que inclui

- Backups automáticos periódicos do `world.db` via SQLite Online Backup API
- Backups manuais disparados pelo GM (snapshot de mundo)
- Backups automáticos em eventos (antes de update, migração, importação)
- Política de retenção configurável com alertas de disco
- Restauração de backup com verificação de integridade
- Verificação de integridade (`PRAGMA integrity_check`) na abertura de mundo
- Export JSON canônico por mundo para versionamento externo
- Logging estruturado com Pino: níveis, rotação diária, campos obrigatórios
- Log de auditoria de ações sensíveis (acesso restrito ao GM)
- Coleta de erros de cliente (browser do jogador) via endpoint REST
- Telemetria: exclusivamente local — nenhum dado sai da máquina sem opt-in explícito
- Arquivo `diagnostics.json` local para contexto de bug report
- Painel de status do servidor: conexões ativas, memória RSS, tamanho do WAL, tamanho do mundo
- Monitoramento de latência de socket por jogador e FPS do cliente, visíveis ao GM
- Bundle de diagnóstico exportável (logs + diagnostics + db integrity) para suporte
- Procedimentos documentados: recuperar de crash, mover instalação para outra máquina, migrar versões

### O que NÃO inclui

- Schema do banco SQLite e PRAGMAs de inicialização (ver `03-persistencia-e-mundos.md`)
- Instalação, empacotamento e auto-update do app (ver `22-instalacao-e-distribuicao.md`)
- Testes unitários, de integração e de carga (ver `25-testes-e-qualidade.md`)
- Autenticação e controle de acesso (ver `05-usuarios-e-permissoes.md`)
- Gerenciamento de assets de mídia (ver `20-assets-e-midia.md`)

---

## Conceitos e Terminologia

| Termo | Definição |
|---|---|
| **SQLite Online Backup API** | API nativa do SQLite (exposta via `db.backup()` do better-sqlite3) que copia o banco página a página enquanto o servidor está ativo, sem bloquear leitores nem escritores. |
| **WAL** | Write-Ahead Log — modo de journaling do SQLite que permite backup online. Ver `03-persistencia-e-mundos.md`. |
| **Backup automático** | Cópia periódica do `world.db` disparada por cron interno enquanto o servidor está ativo. |
| **Snapshot de mundo** | Backup manual completo de um mundo: `world.db` + exportação opcional dos assets referenciados. |
| **Pre-event backup** | Backup gerado automaticamente antes de eventos destrutivos: update do app, migração de schema, importação de mundo. |
| **Export JSON** | Dump legível por humanos de todos os Documents do mundo em arquivos `.json` individuais organizados por tipo; destinado a versionamento em git e inspeção off-line. |
| **integrity_check** | Execução de `PRAGMA integrity_check` no banco ao abrir o mundo; detecta corrupção de arquivo. |
| **Pino** | Biblioteca de logging estruturado para Node.js; formato JSON nativo, 2,4× mais rápido que Winston. |
| **pino-roll** | Transport do Pino para rotação automática de arquivos de log (diária ou por tamanho). |
| **Log de auditoria** | Arquivo separado que registra ações sensíveis (alterar permissão de usuário, deletar mundo, restaurar backup, executar macro com impacto de dados). Legível apenas pelo GM no painel de administração. |
| **diagnostics.json** | Arquivo local gerado pelo servidor com contexto do ambiente (versão do app, sistemas instalados, plataforma, tempo de jogo por mundo). Nunca transmitido automaticamente. |
| **Bundle de diagnóstico** | Arquivo `.zip` exportado pelo GM para enviar ao suporte: logs recentes + diagnostics.json + resultado do integrity_check do(s) mundo(s). Sem dados de personagens nem assets de mídia. |
| **Litestream** | Ferramenta externa (processo separado) de replicação contínua de SQLite para destino local ou cloud. Zero mudança de código; opção avançada documentada. |
| **perf_report** | Mensagem de socket enviada pelo cliente ao servidor a cada 5 segundos com FPS, draw calls e entidades Pixi do frame atual. |
| **RSS** | Resident Set Size — memória física consumida pelo processo Node.js, monitorada para detectar vazamentos. |

---

## Decisões de Design

### DEC-OPS-001: backup via SQLite Online Backup API (`db.backup()`)

**Escolha:** usar `Database.backup(destination, options)` do `better-sqlite3` (SQLite Online Backup API nativa) como mecanismo de backup principal.

**Alternativas rejeitadas:**
- `VACUUM INTO`: cria cópia compacta, mas bloqueia escritas durante toda a operação — inaceitável em servidor ativo.
- Cópia direta do arquivo `world.db`: corre risco de capturar estado inconsistente se houver escrita simultânea com WAL parcialmente aplicado.
- Litestream como mecanismo primário: exige processo externo e setup adicional pelo GM; adequado apenas como complemento opcional.

**Racional:** `db.backup()` é a única modalidade que combina backup online (sem parada do servidor), sem bloqueio de leitores e atomicamente consistente ao final de cada ciclo de cópia. Se uma escrita ocorrer durante o backup, a API reinicia automaticamente — o que reforça o requisito de single-writer por world.

### DEC-OPS-002: sem telemetria externa por padrão; arquivo local primeiro

**Escolha:** nenhum dado sai da máquina do GM por padrão. O `diagnostics.json` é gerado localmente. Qualquer transmissão para servidor externo é 100% opt-in, iniciada manualmente pelo GM (ex.: ao enviar bundle de diagnóstico para suporte via e-mail/Discord).

**Alternativas rejeitadas:**
- Sentry SaaS ativo por padrão: viola privacidade; dados de sessão de RPG são pessoais.
- Sentry self-hosted obrigatório: exige Docker 8 GB+ com 20+ containers — impraticável para o GM doméstico.
- GlitchTip obrigatório: mais leve, mas ainda exige infraestrutura extra.

**Racional:** o Fusion roda localmente na máquina do GM, sem modelo SaaS. Os dados do mundo pertencem ao GM e seus jogadores. O modelo adotado é análogo ao do Foundry V11+ (telemetria opt-in, arquivo local inspecionável antes de qualquer transmissão). Para GMs técnicos que quiserem integrar com Sentry SaaS, basta definir `FUSION_SENTRY_DSN` como variável de ambiente — a integração é documentada mas não ativada por padrão. **Nota sobre `telemetryEnabled`:** o campo `telemetryEnabled: boolean` presente em `FusionConfig` (spec `22-instalacao-e-distribuicao.md`) não é usado por esta spec — o gate de telemetria externa é exclusivamente a presença/ausência de `FUSION_SENTRY_DSN`. O campo deve ser considerado sem efeito funcional até que uma funcionalidade de opt-in com UI seja definida; recomenda-se removê-lo de `FusionConfig` em revisão futura da spec 22.

### DEC-OPS-003: Pino como biblioteca de logging

**Escolha:** Pino com `pino-roll` para rotação de logs.

**Alternativas rejeitadas:**
- Winston: 2,4× mais lento em benchmarks (270ms vs 115ms para 10k ops); logging nunca deve competir com o event loop de um servidor de jogo em tempo real.
- `logrotate` (SO): não portátil entre Windows/macOS/Linux sem configuração extra por plataforma.

**Racional:** Pino é JSON nativo (structured logging sem conversão), usa worker threads para I/O de arquivo (não bloqueia o event loop), e `pino-roll` é portátil nos três sistemas operacionais alvo.

### DEC-OPS-004: logs de auditoria em arquivo separado

**Escolha:** ações sensíveis são gravadas em `Logs/audit.log` separado do log geral, com acesso restrito ao GM via painel de administração (nunca exibido a jogadores).

**Alternativas rejeitadas:**
- Misturar auditoria no log geral com nível `warn`/`info`: dificulta filtragem e aumenta risco de exposição a jogadores se o painel de logs for compartilhado.

**Racional:** segurança e clareza. O log de auditoria deve ser consultável sem navegar por gigabytes de log de debug do servidor.

### DEC-OPS-005: export JSON por tipo de Document como camada de backup humano-legível

**Escolha:** além dos backups binários `.db`, oferecer export JSON estruturado por tipo de Document (um arquivo `.json` por Document, organizados em subpastas por tipo).

**Alternativas rejeitadas:**
- Apenas backup binário: não versionável em git; não inspecionável sem SQLite client.
- Export JSON como substituto do backup binário: restauração via JSON exige reimport completo, muito mais lento e sujeito a erros de schema.

**Racional:** as duas modalidades são complementares. O binário `.db` é o caminho de restauração rápido e fidedigno. O export JSON é para inspeção, auditoria, versionamento e recuperação de último recurso quando o binário está corrompido e não há backup recente.

### DEC-OPS-006: Litestream como opção avançada documentada, não requisito

**Escolha:** Litestream (replicação contínua do WAL para destino local ou S3) é documentado no guia de deployment como opção opt-in para power users, sem mudança de código no servidor.

**Alternativas rejeitadas:**
- Incluir Litestream no bundle padrão: exige binário Go extra por plataforma; adiciona 20–30 MB ao instalador; aumenta superfície de suporte.

**Racional:** o custo de manutenção não justifica para um público que, em sua maioria, não exige RPO < 30 minutos. GMs com necessidade de replicação contínua conseguem rodar Litestream como processo separado sem tocar no código do Fusion.

---

## Requisitos Funcionais

### Backups

**REQ-OPS-001** [MVP] O servidor DEVE executar um backup automático do `world.db` de cada mundo ativo a cada 30 minutos enquanto o servidor estiver em funcionamento, usando a SQLite Online Backup API (`db.backup()`), sem interromper leitores nem escritores.

**REQ-OPS-002** [MVP] Backups automáticos DEVEM ser salvos em `fusion-data/worlds/<slug>/backups/auto-<timestamp-ISO>.db`, onde `<timestamp-ISO>` segue o formato `YYYYMMDDTHHMMSSZ`.

**REQ-OPS-003** [MVP] O intervalo de backup automático DEVE ser configurável pelo GM no painel de configuração (valores aceitos: 10, 15, 30, 60 minutos; padrão: 30).

**REQ-OPS-004** [MVP] O GM DEVE poder disparar manualmente um snapshot de mundo a qualquer momento via botão "Fazer Backup Agora" no painel do mundo; o backup manual DEVE ser salvo em `fusion-data/worlds/<slug>/backups/manual-<timestamp-ISO>.db`.

**REQ-OPS-005** [MVP] O servidor DEVE gerar automaticamente um pre-event backup antes de qualquer um dos seguintes eventos: (a) update do aplicativo Fusion, (b) migração de schema do banco, (c) importação de mundo externo. O arquivo DEVE ser salvo em `fusion-data/worlds/<slug>/backups/pre-event-update-<version>-<timestamp-ISO>.db` (para updates, por mundo via `db.backup()`) ou `fusion-data/worlds/<slug>/backups/pre-event-<tipo>-<timestamp-ISO>.db` (para operações de mundo — migração, importação). O formato é sempre `.db` binário gerado por `db.backup()`, sem tarball. **Nota:** a spec `22-instalacao-e-distribuicao.md` REQ-DST-022 (backup pre-update) referencia este mecanismo canônico — backup `.db` por mundo via `db.backup()`, sem tarball.

**REQ-OPS-006** [MVP] A política de retenção padrão de backups automáticos DEVE ser manter os 10 mais recentes por mundo (aproximadamente 5 horas de cobertura com intervalo padrão de 30 min); backups além desse limite DEVEM ser deletados automaticamente, do mais antigo para o mais recente.

**REQ-OPS-007** [MVP] Backups manuais (snapshots do GM) DEVEM ser retidos indefinidamente até que o GM os delete manualmente; o sistema DEVE alertar no painel quando o espaço em disco ocupado por backups ultrapassar 80% do limite configurado (padrão: 10 GB).

**REQ-OPS-008** [MVP] Pre-event backups DEVEM ser retidos até que o GM os marque como dispensáveis no painel de backups ou confirme que a operação foi bem-sucedida; o sistema DEVE exibir alerta se um pre-event backup tiver mais de 7 dias sem ação do GM.

**REQ-OPS-009** [MVP] O GM DEVE poder restaurar qualquer backup listado com um único clique no painel de backups do mundo; o processo de restauração DEVE: (a) gerar um pre-event backup do estado atual antes de restaurar, (b) executar `PRAGMA integrity_check` no arquivo de backup antes de aplicá-lo, (c) substituir `world.db` pelo arquivo restaurado atomicamente (rename), (d) reinicializar a conexão com o banco restaurado.

**REQ-OPS-010** [MVP] Ao abrir qualquer mundo, o servidor DEVE executar `PRAGMA integrity_check` no `world.db`; se o resultado não for `ok`, o servidor DEVE: (a) registrar o erro como `fatal` no log com o output completo do integrity_check, (b) impedir a abertura do mundo, (c) exibir ao GM mensagem indicando corrupção detectada e listando backups disponíveis para restauração.

**REQ-OPS-011** [MVP] O resultado do `PRAGMA integrity_check` de cada mundo aberto DEVE ser registrado no log de nível `info` na inicialização do servidor.

**REQ-OPS-012** [V2] O GM DEVE poder exportar um mundo como JSON canônico (`fusion-data/worlds/<slug>/export/<timestamp>/`), com um arquivo `.json` por Document organizado em subpastas por tipo (`actors/`, `items/`, `scenes/`, `journal-entries/`, etc.) e um `manifest.json` com metadados do mundo e versão do schema.

**REQ-OPS-013** [V2] O export JSON DEVE incluir um hash SHA-256 de cada arquivo exportado no `manifest.json` para verificação de integridade off-line.

**REQ-OPS-014** [V2] O Fusion DEVE documentar o procedimento de configuração do Litestream como opção avançada de replicação contínua, sem exigir mudança de código no servidor; a documentação DEVE cobrir: instalação, configuração de destino local e S3, e restauração a partir de uma generation do Litestream.

---

### Logging

**REQ-OPS-020** [MVP] O servidor DEVE usar Pino como biblioteca de logging com as seguintes configurações de produção: nível padrão `info`; output em JSON estruturado; transporte de arquivo via `pino-roll`.

**REQ-OPS-021** [MVP] Cada entrada de log DEVE conter os campos: `time` (ISO 8601), `level`, `pid`, `hostname`, `module` (subsistema emitente), `worldSlug` (quando aplicável), `userId` (quando aplicável), `msg`.

**REQ-OPS-022** [MVP] O servidor DEVE rotacionar arquivos de log diariamente, mantendo os últimos 7 dias em `fusion-data/Logs/server-YYYY-MM-DD.log`; um arquivo separado `fusion-data/Logs/error.log` DEVE acumular apenas entradas de nível `error` e `fatal` sem rotação automática (o GM apaga manualmente ou via painel).

**REQ-OPS-023** [MVP] O GM DEVE poder elevar o nível de log para `debug` sem reiniciar o servidor, via painel de configuração; o nível alterado DEVE ser persistido em `fusion-data/Config/fusion.json`.

**REQ-OPS-024** [MVP] O servidor DEVE emitir entradas de log `info` nos seguintes eventos: início e encerramento do servidor; abertura e fechamento de mundo; entrada e saída de cada usuário na sessão; início e conclusão de cada backup (automático ou manual); resultado do integrity_check na abertura.

**REQ-OPS-025** [MVP] O servidor DEVE emitir entradas de log `warn` quando qualquer dos seguintes limites for excedido: tamanho do WAL > 100 MB (sinal de checkpoint travado); taxa de `SQLITE_BUSY` > 10 por minuto; latência de socket p99 > 500ms; memória RSS > 80% do limite configurado.

**REQ-OPS-026** [MVP] O servidor DEVE manter um log de auditoria separado em `fusion-data/Logs/audit.log` registrando as seguintes ações com identificador de usuário, timestamp e payload resumido: alterar permissão de usuário; deletar ou restaurar um mundo; iniciar ou encerrar combate; executar macro que modifique dados de outro usuário; importar ou exportar um mundo; alterar configurações do servidor.

**REQ-OPS-027** [MVP] O log de auditoria DEVE ser acessível apenas ao GM via painel de administração; nunca exposto via API REST ou socket para usuários com papel de jogador.

**REQ-OPS-028** [MVP] Erros JavaScript capturados no cliente (browser do jogador) DEVEM ser enviados ao servidor via `POST /api/client-error` com corpo `{ message, stack, userAgent, worldSlug, userId }`; o servidor DEVE registrá-los no log com nível `error` e prefixo `[client]`.

**REQ-OPS-029** [MVP] Em ambiente de desenvolvimento (variável `NODE_ENV=development`), o Pino DEVE usar o transport `pino-pretty` para output formatado no terminal; em produção, output JSON puro para arquivo.

---

### Telemetria e Diagnóstico

**REQ-OPS-040** [MVP] O servidor DEVE gerar e manter localmente o arquivo `fusion-data/Logs/diagnostics.json` com as seguintes informações: versão do Fusion; versão do Node.js; plataforma (OS + arch); sistemas de jogo instalados e suas versões; mundos existentes (apenas slugs e tamanhos em MB, sem conteúdo); tempo de jogo acumulado por mundo (em minutos); data do último backup por mundo.

**REQ-OPS-041** [MVP] O `diagnostics.json` DEVE ser atualizado a cada abertura e fechamento de sessão de jogo; seu conteúdo DEVE ser inspecionável pelo GM no painel de diagnóstico antes de ser compartilhado.

**REQ-OPS-042** [MVP] Nenhum dado do `diagnostics.json` nem qualquer outra informação de uso DEVE ser transmitido automaticamente para servidores externos; qualquer transmissão futura DEVE exigir ação explícita e informada do GM (opt-in por evento).

**REQ-OPS-043** [MVP] A integração com Sentry SaaS DEVE ser suportada como opção opt-in por variável de ambiente `FUSION_SENTRY_DSN`; quando definida, erros de nível `error` e `fatal` do servidor e erros recebidos via `/api/client-error` DEVEM ser enviados ao Sentry configurado; quando não definida, o comportamento é exclusivamente log local.

**REQ-OPS-044** [MVP] O GM DEVE poder exportar um bundle de diagnóstico via painel de administração; o bundle DEVE ser um arquivo `.zip` contendo: `diagnostics.json`; os últimos 2 dias de `server-YYYY-MM-DD.log`; `error.log`; resultado do `PRAGMA integrity_check` de cada mundo aberto; sem dados de personagens, itens, cenas ou assets de mídia.

**REQ-OPS-045** [MVP] O bundle de diagnóstico DEVE incluir um arquivo `README.txt` descrevendo o conteúdo e instruindo que dados de partida (fichas, mapas) não estão incluídos.

---

### Monitoramento de Sessão

**REQ-OPS-050** [MVP] O servidor DEVE manter em memória, para cada conexão ativa de socket, as seguintes métricas atualizadas a cada 30 segundos: latência de round-trip (ms), timestamp do último heartbeat, número de eventos enviados e recebidos desde a abertura da sessão.

**REQ-OPS-051** [MVP] O GM DEVE visualizar em tempo real, no painel de sessão, a latência de cada jogador conectado com indicador de qualidade: verde (< 100ms), amarelo (100–300ms), vermelho (> 300ms).

**REQ-OPS-052** [MVP] O servidor DEVE emitir uma mensagem de socket `server:perf_snapshot` ao GM a cada 30 segundos contendo: número de conexões ativas; memória RSS do processo (MB); tamanho atual do WAL em MB; tamanho total do `world.db` em MB; uptime do servidor em segundos.

**REQ-OPS-053** [MVP] O cliente DEVE enviar ao servidor, via mensagem de socket `client:perf_report`, a cada 5 segundos enquanto em sessão ativa, as seguintes métricas: FPS médio do último intervalo; número de draw calls; número de entidades PIXI na cena atual.

**REQ-OPS-054** [MVP] O GM DEVE visualizar, no painel de sessão, os dados de `client:perf_report` de cada jogador conectado, incluindo FPS, para identificar jogadores com hardware limitado antes que a experiência degrade.

**REQ-OPS-055** [MVP] Métricas de `client:perf_report` DEVEM ser visíveis apenas ao GM; outros jogadores NÃO DEVEM ter acesso às métricas de conexão ou hardware dos demais.

**REQ-OPS-056** [V2] O servidor DEVE coletar e persistir histogramas de latência (p50, p95, p99) por sessão em `fusion-data/Logs/session-stats.jsonl`, um registro por sessão encerrada.

---

### Painel de Status do Servidor

**REQ-OPS-060** [MVP] O servidor DEVE expor um endpoint HTTP `GET /api/admin/status` (autenticado como GM) retornando JSON com: versão do Fusion; versão do Node.js; uptime; mundos abertos (slugs + tamanho do db em MB); conexões ativas por mundo; RSS em MB; tamanho total da pasta `fusion-data/` em MB; espaço em disco livre em MB.

**REQ-OPS-061** [MVP] O painel de administração da UI DEVE exibir as informações do `/api/admin/status` em uma tela "Status do Servidor" com atualização automática a cada 10 segundos.

**REQ-OPS-062** [MVP] O painel DEVE exibir o tamanho total ocupado por backups e alertar visualmente (badge amarelo) quando ultrapassar 80% do limite configurado, com link para o gerenciador de backups.

---

## Requisitos Não-Funcionais

**REQ-OPS-070** [MVP] A execução de um backup automático via `db.backup()` NÃO DEVE adicionar mais de 50ms de latência perceptível para os jogadores conectados; se o banco tiver mais de 500 MB, o backup DEVE usar a opção de paginação (`100 pages por ciclo`) para distribuir o I/O ao longo de múltiplos ticks do event loop.

**REQ-OPS-071** [MVP] O `PRAGMA integrity_check` na abertura de um mundo com banco de até 500 MB DEVE concluir em menos de 10 segundos; se demorar mais, o servidor DEVE registrar `warn` com o tempo decorrido e continuar aguardando.

**REQ-OPS-072** [MVP] O logging estruturado com Pino NÃO DEVE adicionar mais de 1ms de overhead por operação de log em carga normal; o transport de arquivo DEVE rodar em worker thread separado para não bloquear o event loop.

**REQ-OPS-073** [MVP] O bundle de diagnóstico exportado NÃO DEVE incluir dados pessoais identificáveis dos jogadores (nomes reais, e-mails, endereços IP); campos que possam conter PII DEVEM ser redactados (substituídos por `[redacted]`) antes de incluir no bundle.

**REQ-OPS-074** [MVP] Arquivos de log DEVEM ser codificados em UTF-8; em Windows, o servidor DEVE garantir que o Pino escreve UTF-8 explicitamente (sem BOM).

---

## Modelo de Dados

### Interface de Backup Listado

```typescript
interface BackupEntry {
  id: string;               // UUID gerado na criação
  worldSlug: string;
  type: 'auto' | 'manual' | 'pre-event';
  preEventReason?: 'update' | 'migration' | 'import'; // apenas quando type === 'pre-event'
  filePath: string;         // caminho absoluto do arquivo .db
  sizeBytes: number;
  createdAt: string;        // ISO 8601
  integrityOk: boolean | null; // null = não verificado ainda
  appVersion: string;       // versão do Fusion ao criar o backup
  schemaVersion: number;    // versão do schema do banco ao criar o backup
}
```

### Interface de Snapshot de Status do Servidor

```typescript
interface ServerStatusSnapshot {
  fusionVersion: string;
  nodeVersion: string;
  uptimeSeconds: number;
  rssMemoryMb: number;
  openWorlds: Array<{
    slug: string;
    dbSizeMb: number;
    walSizeMb: number;
    activeConnections: number;
  }>;
  totalDataDirSizeMb: number;
  totalBackupsSizeMb: number;
  diskFreeGb: number;
  timestamp: string; // ISO 8601
}
```

### Interface de Métricas de Conexão por Jogador

```typescript
interface PlayerConnectionMetrics {
  userId: string;
  socketId: string;
  latencyMs: number;
  qualityLevel: 'good' | 'fair' | 'poor'; // < 100ms | 100-300ms | > 300ms
  lastHeartbeat: string; // ISO 8601
  eventsSent: number;
  eventsReceived: number;
  // Enviados via client:perf_report:
  fps: number | null;
  drawCalls: number | null;
  pixiEntities: number | null;
  perfReportAt: string | null; // ISO 8601 do último perf_report recebido
}
```

### Interface de Entrada de Log de Auditoria

```typescript
// Importar de packages/shared/src/types/user.ts
// import { Role } from '@fusion/shared';

interface AuditLogEntry {
  time: string;        // ISO 8601
  userId: string;
  userRole: 'PLAYER' | 'TRUSTED' | 'ASSISTANT' | 'GAMEMASTER'; // alinhado ao enum Role de 05-usuarios-e-permissoes.md
  action: AuditAction;
  targetType?: string; // ex.: 'world', 'user', 'macro'
  targetId?: string;
  summary: string;     // descrição legível da ação
  worldSlug?: string;
}

type AuditAction =
  | 'user.permission_changed'
  | 'world.deleted'
  | 'world.restored'
  | 'world.imported'
  | 'world.exported'
  | 'combat.started'
  | 'combat.ended'
  | 'macro.executed_privileged'
  | 'server.config_changed'
  | 'backup.restored';
```

### Schema do `diagnostics.json`

```typescript
interface DiagnosticsFile {
  fusionVersion: string;
  nodeVersion: string;
  platform: string;       // ex.: "win32 x64"
  installedSystems: Array<{ id: string; version: string }>;
  worlds: Array<{
    slug: string;
    systemId: string;
    dbSizeMb: number;
    totalPlaytimeMinutes: number;
    lastBackupAt: string | null; // ISO 8601
    lastOpenedAt: string | null;
  }>;
  generatedAt: string;    // ISO 8601
  schemaVersion: 1;
}
```

---

## API e Eventos

### Endpoints REST (autenticação obrigatória)

| Método | Path | Autenticação | Descrição |
|--------|------|--------------|-----------|
| `GET` | `/api/admin/status` | GM | Snapshot de status do servidor (ver REQ-OPS-060) |
| `GET` | `/api/admin/backups/:worldSlug` | GM | Lista backups de um mundo (retorna `BackupEntry[]`) |
| `POST` | `/api/admin/backups/:worldSlug/snapshot` | GM | Dispara backup manual imediato (REQ-OPS-004) |
| `POST` | `/api/admin/backups/:worldSlug/:backupId/restore` | GM | Restaura backup específico (REQ-OPS-009) |
| `DELETE` | `/api/admin/backups/:worldSlug/:backupId` | GM | Deleta um backup listado (manual ou auto) |
| `GET` | `/api/admin/diagnostics` | GM | Retorna conteúdo do `diagnostics.json` |
| `POST` | `/api/admin/diagnostics/bundle` | GM | Gera e retorna bundle de diagnóstico como `.zip` |
| `GET` | `/api/admin/audit-log` | GM | Lista entradas recentes do audit.log (paginado, max 500) |
| `POST` | `/api/client-error` | Qualquer autenticado | Recebe erro JS do cliente (REQ-OPS-028) |

### Eventos de Socket

| Evento | Direção | Payload | Descrição |
|--------|---------|---------|-----------|
| `server:perf_snapshot` | servidor → GM | `ServerStatusSnapshot` | Status do servidor a cada 30s (REQ-OPS-052) |
| `server:player_metrics` | servidor → GM | `PlayerConnectionMetrics[]` | Métricas de todos os jogadores conectados, a cada 30s |
| `client:perf_report` | cliente → servidor | `{ fps, drawCalls, pixiEntities }` | FPS e métricas do canvas a cada 5s (REQ-OPS-053) |
| `server:backup_progress` | servidor → GM | `{ worldSlug, percent, type }` | Progresso do backup em andamento |
| `server:backup_complete` | servidor → GM | `BackupEntry` | Backup concluído com metadados do arquivo gerado |
| `server:backup_error` | servidor → GM | `{ worldSlug, error: string }` | Falha em backup automático ou manual |
| `server:disk_warning` | servidor → GM | `{ usedPercent, usedMb }` | Alerta de disco ao ultrapassar 80% do limite |

---

## Dependências (specs irmãs)

| Spec | Dependência |
|------|-------------|
| `03-persistencia-e-mundos.md` | PRAGMAs do SQLite, inicialização do banco, single-writer pattern, formato do `world.db` |
| `04-rede-e-sincronizacao.md` | Socket.io v4, protocolo de mensagens, autenticação de socket |
| `05-usuarios-e-permissoes.md` | Papéis de usuário (GM vs. jogador), autenticação de endpoints admin |
| `22-instalacao-e-distribuicao.md` | Estrutura de diretórios `fusion-data/`, procedimento de update e pre-event backup |
| `25-testes-e-qualidade.md` | Testes da Backup API, testes de integridade, smoke tests de logging |

---

## Critérios de Aceitação

**CA-OPS-001:** Com o servidor ativo e um mundo aberto, o backup automático cria um arquivo `.db` válido a cada intervalo configurado, verificável via `sqlite3 <arquivo> "PRAGMA integrity_check"` retornando `ok`.

**CA-OPS-002:** Após corromper manualmente um `world.db` (truncar o arquivo), ao tentar abrir o mundo o servidor impede a abertura, registra `fatal` no log com o resultado do integrity_check, e exibe ao GM a lista de backups disponíveis.

**CA-OPS-003:** O GM clica em "Restaurar" para um backup listado; o sistema cria um pre-event backup do estado atual, verifica a integridade do backup alvo e, se íntegro, substitui o banco ativo; o mundo é reaberto com o conteúdo do backup restaurado.

**CA-OPS-004:** Com o servidor em produção, os arquivos `fusion-data/Logs/server-YYYY-MM-DD.log` são criados diariamente; arquivos com mais de 7 dias são rotacionados automaticamente; o `error.log` acumula apenas entradas de `error`/`fatal`.

**CA-OPS-005:** O GM realiza uma ação sensível (ex.: altera a permissão de um jogador); a ação aparece em `audit.log` com timestamp, userId e summary; a ação não aparece no log geral com nível exposto; um jogador não consegue acessar `/api/admin/audit-log`.

**CA-OPS-006:** O painel de sessão exibe latência de cada jogador em tempo real; um jogador com latência simulada de 400ms exibe indicador vermelho no painel do GM.

**CA-OPS-007:** O endpoint `/api/admin/diagnostics/bundle` retorna um `.zip` que não contém nenhuma ficha de personagem, cena ou asset de mídia; contém `diagnostics.json`, logs recentes e resultado de integrity_check.

**CA-OPS-008:** Com `FUSION_SENTRY_DSN` não definido, nenhuma requisição de rede para endpoints externos é feita pelo servidor (verificável via proxy/Wireshark durante operação normal).

**CA-OPS-009:** Com `FUSION_SENTRY_DSN` definido, um erro `fatal` simulado no servidor é capturado e visível no painel do Sentry configurado.

**CA-OPS-010:** O pre-event backup é criado automaticamente antes de qualquer migração de schema; se a migração falhar, o backup pré-migração está disponível para restauração manual.

---

## Procedimentos Operacionais

### Recuperar de Crash do Servidor

1. O servidor pode ter crashado por: exceção não tratada, OOM, sinal externo (SIGKILL), queda de energia.
2. Ao reiniciar, o servidor executa `PRAGMA integrity_check` em cada mundo configurado como ativo.
3. Se o banco estiver íntegro (resultado `ok`): o servidor abre normalmente; o WAL não aplicado é resolvido automaticamente pelo SQLite no próximo checkpoint.
4. Se o banco estiver corrompido: ver CA-OPS-002. O GM restaura a partir do backup mais recente via painel.
5. Se não houver backup binário disponível: tentar reconstruir via export JSON mais recente (REQ-OPS-012 — [V2]); se não houver, o mundo é considerado irrecuperável com os dados disponíveis.

### Mover Instalação para Outra Máquina

1. Encerrar o servidor na máquina de origem.
2. Copiar a pasta `fusion-data/` completa para a nova máquina.
3. Instalar o Fusion na nova máquina na mesma versão ou superior.
4. Na primeira execução na nova máquina, apontar o wizard de configuração para o diretório copiado.
5. O servidor abrirá os mundos normalmente; o `Config/fusion.json` pode precisar de ajuste de porta e caminhos de rede.
6. Verificar os backups: os caminhos absolutos em `BackupEntry.filePath` podem diferir; o servidor DEVE usar caminhos relativos à `fusion-data/` para backups, a ser resolvido em runtime.

### Migrar Entre Versões do Fusion

1. O servidor detecta que a versão instalada é superior à versão do `schema_version` no banco do mundo.
2. Antes de qualquer migração, um pre-event backup é criado automaticamente (REQ-OPS-005).
3. As migrations de schema são aplicadas em sequência a partir da versão atual até a alvo (ver `03-persistencia-e-mundos.md` para o sistema de migrations).
4. Se uma migration falhar: o servidor aborta, registra `fatal` no log, e orienta o GM a restaurar o pre-event backup.
5. Após migração bem-sucedida, o `schema_version` é atualizado no banco; o pre-event backup fica disponível por 7 dias antes do alerta de remoção (REQ-OPS-008).

---

## Questões em Aberto

1. **Backup de assets:** arquivos de imagem e áudio referenciados por Documents do mundo devem ser incluídos no backup `.db` ou apenas nos snapshots manuais? Como calcular o tamanho total (db + assets) para fins de retenção e alerta de disco? Aguarda decisão em `20-assets-e-midia.md` e `03-persistencia-e-mundos.md`.

2. **Caminhos relativos em BackupEntry:** a spec define que `filePath` deve ser relativo à `fusion-data/` para portabilidade; isso requer que o servidor resolva o caminho absoluto em runtime — confirmar que a implementação de listagem de backups está alinhada com `03-persistencia-e-mundos.md`.

3. **Redação de PII no bundle de diagnóstico:** quais campos dos logs podem conter PII (usernames, IPs)? Definir lista exaustiva de campos a redactar antes da implementação do gerador de bundle.

4. **Sink de logs externo configurável:** o Fusion deve suportar envio de logs para endpoint externo (ELK, Grafana Loki, Datadog) via variável de ambiente além do `FUSION_SENTRY_DSN`? Isso beneficia GMs técnicos mas aumenta a superfície de suporte.

5. **Telemetria de FPS:** os dados de `client:perf_report` de um jogador devem ser visíveis apenas ao GM ou também ao próprio jogador no seu painel de conexão? Definir antes da implementação do painel de sessão.

6. **Limite configurável de retenção de backups automáticos:** o padrão é 10 backups; o GM deve poder configurar um número diferente (ex.: 5 a 48)? Qual é o limite máximo permitido para evitar consumo excessivo de disco?

7. **Auditoria de eventos de combate:** o log de auditoria registra início e fim de combate; deve também registrar rolls individuais de iniciativa e resultados de ataques para fins de replay? Isso aumenta consideravelmente o volume do audit.log.

8. **Comportamento do pre-event backup quando já existe um recente:** se o último backup automático tem menos de 5 minutos, o pre-event backup deve criar um novo arquivo ou reutilizar o backup recente? Definir política para evitar duplicação desnecessária.

---

## Referências

- `docs/research/95-ops-backup-telemetry-testing.md` — estratégia de backup SQLite, Pino, Litestream, telemetria local, crash reporting, testes de carga
- `docs/research/92-install-distribution-autoupdate.md` — estrutura de diretórios, onboarding, procedimentos de migração
- better-sqlite3 `Database.backup()` — [https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- Pino.js — [https://getpino.io/](https://getpino.io/)
- pino-roll — [https://github.com/mcollina/pino-roll](https://github.com/mcollina/pino-roll)
- Litestream — [https://litestream.io/how-it-works/](https://litestream.io/how-it-works/)
- Foundry VTT Backups and Snapshots — [https://foundryvtt.com/article/backups/](https://foundryvtt.com/article/backups/)
- Foundry VTT Automated Backup and Sync Services — [https://foundryvtt.com/article/automatic-backups/](https://foundryvtt.com/article/automatic-backups/)
- Oldmoe's Blog — Backup Strategies for SQLite in Production — [https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/)
- Sentry Self-Hosted — [https://develop.sentry.dev/self-hosted/](https://develop.sentry.dev/self-hosted/)
