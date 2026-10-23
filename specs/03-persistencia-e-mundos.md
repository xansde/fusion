# 03 — Persistência e Mundos

**Status:** draft v0.1
**Data:** 2026-06-11
**Baseada em:**

- `docs/research/02-foundry-documentos-persistencia.md` — modelo de documentos, estrutura LevelDB, ciclo CRUD, UUIDs
- `docs/research/95-ops-backup-telemetry-testing.md` — estratégia de backup SQLite, PRAGMAs, retenção, Litestream
- `docs/research/90-asset-media-management.md` — referência de paths em documents, portabilidade, export com assets

---

## Objetivo

Definir como o Fusion persiste dados de forma confiável, organiza mundos no disco, especifica o schema SQLite completo por tipo de Document, garante integridade referencial e expõe operações de gerenciamento de mundos (criar, duplicar, excluir, exportar, importar). Esta spec é a camada de armazenamento sobre a qual todo o resto do sistema repousa.

---

## Escopo

### O que inclui

- Layout completo em disco da pasta de dados do Fusion (`fusion-data/`)
- Inicialização do banco SQLite (`world.db`): PRAGMAs, WAL mode, criação de tabelas, índices
- Schema de tabelas por tipo de Document primário com coluna JSON + colunas indexadas
- Operações CRUD no banco: transações, rollback, batch operations
- Criação, duplicação, renomeação e exclusão de worlds com metadados (system, versão, descrição, capa)
- Export de world como ZIP portátil (dados + assets referenciados)
- Import de ZIP de world exportado
- Snapshots/backups automáticos e manuais via API do better-sqlite3
- Import de mundos do Foundry VTT [V2]
- Integridade: `PRAGMA integrity_check` na abertura, recuperação de corrupção, process lock
- Compendium packs: schema e serving (detalhes de conteúdo em `16-compendiums-e-importacao.md`)

### O que NÃO inclui

- Lógica de sincronização em tempo real via socket (ver `04-rede-e-sincronizacao.md`)
- Gerenciamento de arquivos de mídia/assets além de referência de paths (ver `20-assets-e-midia.md`)
- Autenticação e controle de acesso por usuário (ver `05-usuarios-e-permissoes.md`)
- Motor de rolagens, regras de sistema (ver `08-motor-de-rolagens.md` e specs de sistema)
- Logging e telemetria detalhados (ver `24-operacao-backups-telemetria.md`)
- Estratégia de testes do subsistema de persistência (ver `25-testes-e-qualidade.md`)

---

## Conceitos e Terminologia

| Termo                 | Definição                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **World**             | Uma campanha/mundo de jogo — unidade isolada de dados com banco SQLite próprio, pasta de assets e metadados. Analogia: um "jogo salvo" completo. |
| **world.db**          | Arquivo SQLite que contém todos os Documents primários de um World.                                                                              |
| **Document**          | Unidade atômica de dado do Fusion — Actor, Scene, Item, JournalEntry etc. (detalhado em `02-modelo-de-dados.md`).                                |
| **Document primário** | Document que reside em tabela própria no banco (ex.: `actors`, `scenes`).                                                                        |
| **Document embedded** | Document que vive como JSON aninhado dentro do campo `data` do Document pai (ex.: Token dentro de Scene). Não tem tabela própria.                |
| **world slug**        | Identificador de URL do world — snake_case, único globalmente na instalação, derivado do nome ao criar. Ex.: `the_lost_mine`.                    |
| **fusion-data/**      | Pasta raiz de dados do Fusion na máquina do GM. Analogia ao `UserData/` do Foundry.                                                              |
| **WAL**               | Write-Ahead Log — modo de journaling do SQLite que permite leituras simultâneas a escritas e backup online.                                      |
| **Backup online**     | Backup feito sem parar o servidor usando `Database.backup()` do better-sqlite3 (SQLite Online Backup API).                                       |
| **ZIP portátil**      | Arquivo `.fwzip` exportado de um world contendo `world.db` + assets referenciados + manifesto.                                                   |
| **Process lock**      | Arquivo `world.lock` que garante que apenas um processo acessa o banco de cada world simultaneamente.                                            |
| **Compendium pack**   | Coleção de Documents pré-fabricados fora do world ativo, pertencente a um sistema ou ao world. Detalhes em `16-compendiums-e-importacao.md`.     |

---

## Decisões de Design

### DEC-PER-01: SQLite com better-sqlite3 em vez de LevelDB

**Decisão:** Cada world usa um arquivo `world.db` SQLite com better-sqlite3 (Node.js) em modo WAL.

**Alternativas rejeitadas:**

- _LevelDB (ClassicLevel)_ — mesmo backend do Foundry V11+. Rejeitado porque: (a) formato binário ilegível sem ferramentas, (b) exige ferramenta CLI (`foundryvtt-cli`) para dump/inspeção, (c) não há query ad-hoc, (d) o Foundry usou LevelDB com sublevels para contornar limitações de update granular que SQLite resolve nativamente com UPDATE.
- _MongoDB/PostgreSQL_ — dependência externa pesada incompatível com o modelo "servidor local sem infra" do Fusion.
- _NeDB / lowDB (JSON file)_ — performance degradante com volumes grandes; sem transações atômicas reais.

**Racional:** SQLite em WAL oferece: arquivo único portátil, backup online sem downtime via API nativa, queries ad-hoc para debug, transações ACID, integridade referencial via `FOREIGN KEY`, e índices em colunas extraídas do JSON. O better-sqlite3 é síncrono por design — adequado ao modelo de single-writer autoritativo do servidor Fusion.

---

### DEC-PER-02: Documentos embedded armazenados como JSON dentro do pai

**Decisão:** Documents embedded (Tokens, Walls, Lights, Items de Actor, etc.) são persistidos como JSON no campo `data` do Document pai — não têm tabela própria.

**Alternativas rejeitadas:**

- _Tabelas separadas para cada tipo embedded_ — explosão de JOINs para montar um Scene completo; overhead de schema sem ganho real, pois embedded documents são sempre carregados com o pai.
- _EmbeddedCollection em sublevels (modelo LevelDB do Foundry)_ — benefício granular real em LevelDB; em SQLite a coluna JSON é atualizada atomicamente no UPDATE do pai, o que é igualmente correto e muito mais simples.

**Racional:** Um Scene completo com 200 tokens, 500 walls e 100 lights ainda cabe em poucos MB de JSON — SQLite suporta strings até 1 GB. O carregamento é sempre do Document completo (o cliente precisa de tudo para renderizar). Updates de embedded documents traduzem-se em UPDATE do pai com diff do JSON (ver `04-rede-e-sincronizacao.md`).

---

### DEC-PER-03: Um banco por world, não um banco global

**Decisão:** Cada world tem seu próprio arquivo `world.db` isolado em `fusion-data/worlds/<slug>/world.db`.

**Alternativas rejeitadas:**

- _Banco único com coluna `world_id`_ — backup de um world requer dump de tabela inteira; delete de world requer DELETE com WHERE; corrupção afeta todos os worlds; crescimento de um world afeta performance global.

**Racional:** Isolamento completo entre worlds. Backup, export, delete e restore são operações de arquivo (copiar/deletar `world.db`). Corrupção contém-se ao world afetado. Escalonamento independente. Abre caminho para WAL checkpoint por world de forma independente.

---

### DEC-PER-04: PRAGMAs obrigatórios na abertura do banco

**Decisão:** Aplicar os seguintes PRAGMAs em toda conexão com `world.db`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA busy_timeout = 30000;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -16000;
PRAGMA temp_store = MEMORY;
```

**Racional baseado em pesquisa:** `WAL` + `synchronous = NORMAL` é o equilíbrio ideal para servidor de jogo — ~3x mais performance que `FULL` com durabilidade suficiente (perda máxima: última transação em crash de SO, não de processo). `busy_timeout = 30000` evita erros `SQLITE_BUSY` em operações simultâneas de socket. `foreign_keys = ON` garante integridade referencial entre Documents. `cache_size = -16000` aloca 16 MB de cache de páginas (suficiente para worlds médios). `temp_store = MEMORY` acelera queries com ORDER BY / GROUP BY.

---

### DEC-PER-05: Schema de tabelas com coluna `data` JSON + colunas indexadas

**Decisão:** Cada tipo de Document primário tem uma tabela com estrutura mínima comum (`id`, `data`, `created_at`, `updated_at`) e colunas adicionais extraídas do JSON para indexação e filtragem eficiente.

**Alternativas rejeitadas:**

- _Coluna JSON pura sem colunas extraídas_ — impossibilita índices em `name`, `folder_id`, `sort` sem full table scan com `json_extract`.
- _Schema totalmente relacional com uma coluna por campo_ — impossível para o campo `system` dos Documents, que varia radicalmente por tipo de sistema; exigiria migrations a cada nova versão de sistema de jogo.

**Racional:** A abordagem híbrida (JSON como source of truth + colunas indexadas para campos estáveis e frequentemente filtrados) é o padrão documentado para SQLite com dados semi-estruturados. O campo `data` contém o Document completo (incluindo o campo `system` específico do sistema de jogo). Colunas extraídas cobrem apenas campos que o servidor Fusion precisa filtrar/ordenar internamente.

---

### DEC-PER-06: Process lock via arquivo `world.lock`

**Decisão:** Ao abrir um world, o servidor cria `world.lock` com PID e timestamp. Ao fechar, remove o arquivo. Ao tentar abrir um world com `world.lock` existente, verificar se o PID ainda está ativo; se sim, recusar; se não, remover o lock stale e abrir.

**Racional:** SQLite em modo WAL tolera múltiplos leitores mas somente um escritor por vez. O modelo do Fusion é single-writer (servidor autoritativo), portanto o process lock garante que dois processos Fusion não abram o mesmo world simultaneamente — situação que causaria conflitos de write e potencial corrupção no arquivo WAL.

---

### DEC-PER-07: Export de world como `.fwzip` com assets incluídos

**Decisão:** O export de world produz um arquivo ZIP renomeado como `.fwzip` contendo: `manifest.json` (metadados), `world.db` (cópia do banco via backup online), e todos os assets referenciados nos Documents do world copiados em estrutura de pasta preservada.

**Alternativas rejeitadas:**

- _Export sem assets (só o banco)_ — cria o mesmo problema documentado no Foundry: paths quebrados ao importar em outra máquina.
- _Export apenas como dump JSON_ — perda de binários (imagens, áudio); arquivo maior que ZIP com compressão.

**Racional:** O principal ponto de dor do Foundry (documentado na pesquisa) é que backups não incluem assets, causando paths quebrados em imports. O `.fwzip` resolve isso sendo um bundle self-contained. O manifesto inclui hash SHA-256 do `world.db` para verificação de integridade.

---

### DEC-PER-08: Import de worlds do Foundry VTT marcado como [V2]

**Decisão:** O suporte a import de mundos do Foundry VTT é uma feature [V2] — não será implementado no MVP.

**Abordagem provável para V2:** O Foundry usa LevelDB desde V11. A ferramenta `foundryvtt-cli` (open-source, MIT) provê os comandos `unpack` (LevelDB → arquivos JSON por documento) e `pack` (arquivos JSON → LevelDB). O importer V2 do Fusion usará `foundryvtt-cli` para fazer dump do world Foundry em JSON e então converter para o schema SQLite do Fusion via mapeamento de campos (ver `02-modelo-de-dados.md` para correspondência de campos).

**Riscos identificados:**

1. Campos `system` são específicos de cada sistema de jogo — um world PF2e do Foundry só pode ser importado se o sistema PF2e do Fusion tiver conversor implementado.
2. Paths de assets no Foundry são relativos ao `Data/` do Foundry; precisam de remapping para o storage do Fusion.
3. Mundos Foundry V10 ou anteriores usam NeDB (formato diferente) — requerem migração adicional.
4. Documentos com campos proprietários de módulos Foundry (`flags.<module-id>`) são silenciosamente ignorados ou preservados em `flags` sem tratamento.

---

## Requisitos Funcionais

### Layout em Disco

**REQ-PER-001** [MVP] O Fusion deve criar e manter a estrutura de diretórios abaixo na pasta de dados configurada (`fusion-data/` por padrão). O layout canônico de primeiro nível (subpastas e capitalização) é definido em `22-instalacao-e-distribuicao.md` REQ-DST-007; esta spec detalha o conteúdo interno de cada subpasta relevante à camada de persistência:

```
fusion-data/
  Config/
    fusion.json            ← configuração global do servidor (nome canônico; ver REQ-ARQ-022)
  Logs/
    server-YYYY-MM-DD.log  ← logs rotativos do servidor
    error.log              ← apenas erros e fatais
  worlds/
    <slug>/
      world.json           ← metadados do world (ver REQ-PER-010)
      world.db             ← banco SQLite do world
      world.db-wal         ← WAL (criado automaticamente pelo SQLite)
      world.db-shm         ← shared memory WAL (criado automaticamente)
      world.lock           ← process lock (ver REQ-PER-006)
      assets/              ← assets específicos deste world
      backups/
        auto-<timestamp>.db   ← backups automáticos
        manual-<timestamp>.db ← backups manuais do GM
  assets/                  ← assets globais compartilhados entre worlds
    .thumbs/               ← thumbnails gerados automaticamente
  assets.db                ← índice SQLite de instalação da biblioteca de assets compartilhados
                             (tabelas asset_meta, asset_folder_meta — ver 20-assets-e-midia.md).
                             Reconstruível a partir do filesystem; NÃO contém users (users são
                             por-world, no world.db — ver 05-usuarios-e-permissoes.md).
  compendiums/             ← compendium packs globais (sistema/módulos)
    <pack-slug>/
      pack.db              ← banco SQLite do pack (schema idêntico ao world.db)
      pack.json            ← metadados do pack
  temp/                    ← diretório temporário (limpo ao iniciar)
```

**REQ-PER-002** [MVP] O caminho de `fusion-data/` deve ser configurável via variável de ambiente `FUSION_DATA_DIR` e via parâmetro de linha de comando `--data-dir`. O padrão por plataforma é definido em `22-instalacao-e-distribuicao.md` REQ-DST-008 (fonte única de verdade):

- Windows: `%USERPROFILE%\Documents\FusionVTT`
- macOS: `~/Documents/FusionVTT`
- Linux: `~/FusionVTT`

**REQ-PER-003** [MVP] O servidor deve criar todos os diretórios necessários na primeira execução, caso não existam, com permissões adequadas ao usuário corrente.

---

### Inicialização e Schema SQLite

**REQ-PER-004** [MVP] Ao abrir um world, o servidor deve aplicar os PRAGMAs definidos em DEC-PER-04 antes de qualquer outra operação no banco.

**REQ-PER-005** [MVP] O servidor deve executar `PRAGMA integrity_check` na abertura de cada world. Se o resultado não for `ok`, o servidor deve:

1. Logar erro fatal com o resultado completo do integrity check.
2. Renomear `world.db` para `world.db.corrupted.<timestamp>`.
3. Tentar restaurar o backup mais recente disponível em `worlds/<slug>/backups/`.
4. Se não houver backup, emitir evento de erro para o GM com instruções de recuperação e recusar abertura do world.

**REQ-PER-006** [MVP] O banco deve ser criado e mantido com o seguinte schema de tabelas:

```sql
-- Tabela comum a todos os Document types:
-- id: DocumentId de 16 caracteres no alfabeto [A-Za-z0-9] (nanoid), conforme 02-modelo-de-dados.md REQ-DOC-001
-- data: JSON completo do Document (source of truth)
-- created_at, updated_at: timestamps Unix em milissegundos

CREATE TABLE IF NOT EXISTS actors (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,          -- JSON completo do Actor
  name        TEXT NOT NULL,          -- extraído de data.name (índice)
  type        TEXT NOT NULL,          -- extraído de data.type (índice)
  folder_id   TEXT,                   -- extraído de data.folder (FK)
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 0,  -- boolean (0/1)
  navigation  INTEGER NOT NULL DEFAULT 1,  -- boolean (0/1)
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS macros (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,          -- 'script' | 'chat'
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roll_tables (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  folder_id   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,       -- extraído de data.timestamp (índice)
  author_id   TEXT NOT NULL,          -- extraído de data.author
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS combats (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  scene_id    TEXT,                   -- extraído de data.scene
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        INTEGER NOT NULL DEFAULT 1,  -- extraído de data.role
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY NOT NULL,
  data        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,          -- tipo de Document que contém
  parent_id   TEXT,                   -- FK para folders.id (hierarquia)
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id          TEXT PRIMARY KEY NOT NULL,  -- formato: 'namespace.key'
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- fog_explorations: NÃO é tabela primária no MVP. O fog explorado é persistido como
-- dado anexo à Scene por usuário (ver 02-modelo-de-dados.md DEC-DOC-04, REQ-DOC-022 e
-- 07-visao-iluminacao-fog.md). FogExploration como Document de primeira classe é [V2].

-- cards_collections: NÃO entra no MVP. Cards/Card é tipo [V2] (ver 02-modelo-de-dados.md
-- DEC-DOC-04, REQ-DOC-022). A tabela deve ser criada apenas quando Cards for promovido a [V2].

-- Tabela de controle de schema migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY NOT NULL,
  applied_at  INTEGER NOT NULL,
  description TEXT NOT NULL
);
```

**REQ-PER-007** [MVP] O servidor deve criar os seguintes índices:

```sql
CREATE INDEX IF NOT EXISTS idx_actors_name       ON actors(name);
CREATE INDEX IF NOT EXISTS idx_actors_type       ON actors(type);
CREATE INDEX IF NOT EXISTS idx_actors_folder     ON actors(folder_id);
CREATE INDEX IF NOT EXISTS idx_items_name        ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_type        ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_folder      ON items(folder_id);
CREATE INDEX IF NOT EXISTS idx_scenes_active     ON scenes(active);
CREATE INDEX IF NOT EXISTS idx_scenes_nav        ON scenes(navigation);
CREATE INDEX IF NOT EXISTS idx_scenes_folder     ON scenes(folder_id);
CREATE INDEX IF NOT EXISTS idx_journal_name      ON journal_entries(name);
CREATE INDEX IF NOT EXISTS idx_journal_folder    ON journal_entries(folder_id);
CREATE INDEX IF NOT EXISTS idx_chat_timestamp    ON chat_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_author       ON chat_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_folders_type      ON folders(type);
CREATE INDEX IF NOT EXISTS idx_folders_parent    ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_roll_tables_folder ON roll_tables(folder_id);
CREATE INDEX IF NOT EXISTS idx_combats_scene     ON combats(scene_id);
CREATE INDEX IF NOT EXISTS idx_combats_active    ON combats(active);
```

**REQ-PER-008** [MVP] O servidor deve implementar sistema de migrations versionadas. Cada migration é um arquivo TypeScript em `packages/server/src/db/migrations/` com número sequencial (ex.: `001_initial_schema.ts`). Ao abrir um world, o servidor compara a versão atual com a versão máxima aplicada na tabela `schema_migrations` e executa migrations pendentes em ordem, dentro de uma única transação.

---

### Process Lock

**REQ-PER-009** [MVP] Ao abrir um world, o servidor deve:

1. Verificar se `worlds/<slug>/world.lock` existe.
2. Se existir, ler o PID contido no arquivo. Checar se o processo com aquele PID está ativo.
3. Se o processo está ativo, logar erro e recusar abertura do world com mensagem: `"World '<slug>' já está sendo usado pelo processo <PID>. Feche a outra instância antes de continuar."`.
4. Se o processo não está ativo (lock stale), remover o arquivo `world.lock` e prosseguir.
5. Se não existir, criar `world.lock` com conteúdo JSON `{ "pid": <PID>, "started_at": <timestamp_iso> }`.

Ao fechar o world (shutdown gracioso ou `SIGTERM`/`SIGINT`), remover `world.lock`.

---

### Metadados de World

**REQ-PER-010** [MVP] Cada world deve ter um arquivo `world.json` com o seguinte schema:

```typescript
interface WorldManifest {
  id: string; // slug único (ex.: "the_lost_mine")
  title: string; // nome exibido ao usuário
  system: string; // id do sistema de jogo (ex.: "pf2e")
  systemVersion: string; // versão do sistema no momento da última sessão
  fusionVersion: string; // versão do Fusion na criação/última abertura
  schemaVersion: number; // versão do schema do banco (sincronizado com schema_migrations)
  description: string; // descrição em texto plano ou Markdown (max 2000 chars)
  coverImage?: string; // path relativo à pasta do world para imagem de capa
  createdAt: string; // ISO 8601
  lastOpenedAt: string; // ISO 8601
  playTime: number; // tempo total de sessão em segundos
  compatibility: {
    minimumFusion: string; // versão mínima do Fusion para abrir este world
  };
}
```

**REQ-PER-011** [MVP] O servidor deve atualizar `lastOpenedAt` e `fusionVersion` em `world.json` toda vez que um world é aberto com sucesso.

---

### Operações de Gerenciamento de Worlds

**REQ-PER-012** [MVP] O servidor deve expor as seguintes operações de gerenciamento de worlds via API REST (`/api/worlds`):

| Método   | Endpoint                      | Descrição                                                        |
| -------- | ----------------------------- | ---------------------------------------------------------------- |
| `GET`    | `/api/worlds`                 | Listar todos os worlds disponíveis com metadados do `world.json` |
| `POST`   | `/api/worlds`                 | Criar novo world                                                 |
| `GET`    | `/api/worlds/:slug`           | Obter metadados de um world específico                           |
| `PATCH`  | `/api/worlds/:slug`           | Atualizar metadados (título, descrição, capa)                    |
| `DELETE` | `/api/worlds/:slug`           | Excluir world (com confirmação)                                  |
| `POST`   | `/api/worlds/:slug/duplicate` | Duplicar world                                                   |
| `POST`   | `/api/worlds/:slug/export`    | Iniciar export como `.fwzip`                                     |
| `POST`   | `/api/worlds/import`          | Importar `.fwzip` (multipart upload)                             |

**REQ-PER-013** [MVP] A criação de world deve:

1. Validar que o `slug` é único, composto apenas de letras minúsculas, dígitos e underscores (`[a-z0-9_]+`), com máximo de 64 caracteres.
2. Se `slug` não for fornecido, derivá-lo do `title` via slugify (lowercase, substituir espaços e caracteres especiais por underscore, remover caracteres não permitidos).
3. Criar a estrutura de diretórios completa.
4. Criar e inicializar `world.db` com schema e PRAGMAs.
5. Criar `world.json` com metadados.
6. Executar todas as migrations disponíveis.
7. Retornar o `WorldManifest` completo.

**REQ-PER-014** [MVP] A exclusão de world deve:

1. Verificar que o world não está atualmente aberto (sem `world.lock` ativo).
2. Criar um backup automático antes da exclusão em `worlds/<slug>/backups/pre-delete-<timestamp>.db`.
3. Remover recursivamente o diretório `worlds/<slug>/`.
4. Retornar confirmação.

Nunca excluir um world que esteja com `world.lock` ativo — retornar erro `409 Conflict`.

**REQ-PER-015** [MVP] A duplicação de world deve:

1. Verificar que o world original não está aberto.
2. Fazer backup online do banco original via `db.backup()`.
3. Copiar a estrutura de diretórios completa, incluindo assets.
4. Gerar novo slug baseado no título original com sufixo ` (cópia)` (ou `_copy` no slug).
5. Atualizar `world.json` com novo id, título, `createdAt` e `lastOpenedAt`.
6. Retornar `WorldManifest` do world duplicado.

**REQ-PER-016** [MVP] A renomeação de world (via `PATCH /api/worlds/:slug`) deve atualizar apenas `world.json` — não renomeia o diretório (slug é imutável após criação).

---

### CRUD de Documents

**REQ-PER-017** [MVP] Todas as operações de escrita no banco (CREATE, UPDATE, DELETE) devem ser executadas dentro de transações SQLite explícitas (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`). Nunca executar múltiplas operações de escrita fora de uma transação.

**REQ-PER-018** [MVP] A criação de Document deve:

1. Validar que o `id` é um DocumentId de 16 caracteres no alfabeto [A-Za-z0-9] (nanoid, conforme 02-modelo-de-dados.md REQ-DOC-001) e único na tabela correspondente.
2. Serializar o Document completo como JSON no campo `data`.
3. Extrair colunas indexadas do Document.
4. Inserir na transação com `created_at = updated_at = now()`.
5. Retornar o Document criado com todos os campos.

**REQ-PER-019** [MVP] A atualização de Document deve:

1. Receber um diff parcial (não o Document completo).
2. Ler o `data` atual do banco.
3. Aplicar o diff sobre o Document atual seguindo a semântica canônica de `02-modelo-de-dados.md` REQ-DOC-037: merge profundo para objetos, **substituição integral para arrays** (arrays no diff substituem, não são mesclados), e chaves com valor `null` em sub-objetos de `flags`/`system` **removem a chave** (operação `deleteKey`). Preferencialmente reusar a mesma função de merge da camada de modelo (`packages/shared`) para garantir consistência com `04-rede-e-sincronizacao.md`.
4. Revalidar o Document resultante (ver `02-modelo-de-dados.md`).
5. Salvar o Document completo atualizado e atualizar colunas extraídas.
6. Atualizar `updated_at = now()`.
7. Retornar o Document completo após update.

**REQ-PER-020** [MVP] A atualização em batch (múltiplos Documents de mesmo tipo em uma operação) deve executar todos os updates em uma única transação. Falha em qualquer item reverte toda a transação.

**REQ-PER-021** [MVP] A exclusão de Document deve:

1. Verificar que o Document existe.
2. Excluir o registro da tabela.
3. Retornar o id do Document excluído.

**REQ-PER-022** [MVP] A exclusão em batch deve executar todos os deletes em uma única transação.

**REQ-PER-023** [MVP] A leitura de Document deve suportar:

- Busca por id: `SELECT * FROM <table> WHERE id = ?`
- Listagem de coleção com filtros opcionais por `folder_id`, `type`, `name` (LIKE) e ordenação por `sort`, `name`, `updated_at`.
- Nenhuma leitura requer transação explícita (SQLite garante leitura consistente em WAL).

---

### Backup e Snapshots

**REQ-PER-024** [MVP] O servidor deve executar backups automáticos do `world.db` de cada world aberto a cada 30 minutos de atividade usando `Database.backup(destination)` do better-sqlite3. O backup deve ser gravado em `worlds/<slug>/backups/auto-<timestamp_unix>.db`.

**REQ-PER-025** [MVP] O servidor deve manter no máximo 10 backups automáticos por world. Ao criar um novo backup automático, excluir o mais antigo se o limite for ultrapassado.

**REQ-PER-026** [MVP] O GM deve poder acionar manualmente um backup via API REST `POST /api/worlds/:slug/backup`. O backup manual é gravado em `worlds/<slug>/backups/manual-<timestamp_unix>.db` e nunca é excluído automaticamente por política de retenção.

**REQ-PER-027** [MVP] A API `GET /api/worlds/:slug/backups` deve listar todos os backups disponíveis com: nome do arquivo, timestamp, tamanho em bytes, tipo (auto/manual).

**REQ-PER-028** [MVP] A API `POST /api/worlds/:slug/restore` deve permitir restaurar um backup específico pelo nome do arquivo. A restauração deve:

1. Verificar que o world não está aberto (`world.lock` ausente ou stale).
2. Fazer backup do banco atual como `pre-restore-<timestamp>.db` antes de substituir.
3. Copiar o arquivo de backup para `world.db`.
4. Retornar confirmação.

**REQ-PER-029** [V2] O servidor deve suportar integração opcional com Litestream para replicação contínua do WAL. Configuração via `fusion.json` com destino local ou S3-compatible. Documentar como integração opcional no guia de instalação (ver `22-instalacao-e-distribuicao.md`).

> **Atenção — incompatibilidade com checkpoint manual:** quando Litestream estiver ativo, o controle de checkpoint do WAL DEVE ser delegado ao Litestream; executar `PRAGMA wal_checkpoint(TRUNCATE)` manualmente de forma concorrente pode corromper ou interromper a replicação contínua. Ver REQ-PER-039. Cruzar com `24-operacao-backups-telemetria.md`.

---

### Export e Import de World

**REQ-PER-030** [MVP] O export de world deve produzir um arquivo `.fwzip` (ZIP renomeado) com a seguinte estrutura interna:

```
manifest.json              ← metadados + hash SHA-256 do world.db
world.db                   ← cópia do banco via backup online
assets/                    ← assets referenciados nos Documents
  <path-relativo>/
    <arquivo>
```

**REQ-PER-031** [MVP] O manifesto interno do `.fwzip` deve ter o seguinte schema:

```typescript
interface ExportManifest {
  fusionVersion: string;
  exportedAt: string; // ISO 8601
  world: WorldManifest;
  dbHash: string; // SHA-256 do world.db incluído no ZIP
  assetCount: number;
  totalSizeBytes: number;
  assetPaths: string[]; // lista de todos os paths de assets incluídos
}
```

**REQ-PER-032** [MVP] O processo de export deve:

1. Iniciar backup online do `world.db` para arquivo temporário em `temp/`.
2. Varrer todos os Documents do banco para extrair referências de assets (campos `img`, `src`, `path` e qualquer campo de arquivo nos dados `system`).
3. Para cada asset referenciado, verificar existência no filesystem e incluí-lo no ZIP preservando o path relativo.
4. Incluir apenas assets que existam fisicamente — ignorar paths quebrados e registrá-los no manifesto como `missingAssets: string[]`.
5. Calcular SHA-256 do `world.db` temporário.
6. Gerar `manifest.json`.
7. Compactar tudo em ZIP e renomear para `<world-slug>-<timestamp>.fwzip`.
8. Mover para diretório configurável (padrão: `fusion-data/exports/`).
9. Limpar arquivos temporários.

**REQ-PER-033** [MVP] O import de `.fwzip` deve:

1. Validar que o arquivo é um ZIP válido com `manifest.json` na raiz.
2. Validar o schema do `manifest.json` e verificar compatibilidade de versão (`world.compatibility.minimumFusion`).
3. Verificar SHA-256 do `world.db` interno contra o valor no manifesto.
4. Verificar que o `world.id` (slug) não conflita com worlds existentes. Se conflitar, oferecer opção de importar com slug alternativo.
5. Criar a estrutura de diretórios do novo world.
6. Extrair `world.db` e assets para os devidos locais.
7. Executar migrations pendentes no banco importado.
8. Retornar `WorldManifest` do world importado.

**REQ-PER-034** [MVP] O import deve ser idempotente: importar o mesmo `.fwzip` duas vezes (com slug diferente) deve produzir dois worlds independentes e funcionais.

---

### Export JSON (Legível / Versionável)

**REQ-PER-035** [V2] O servidor deve suportar export de world em formato JSON legível por humanos, adequado para armazenamento em git. Formato:

```
worlds/<slug>/export/<timestamp>/
  manifest.json           ← WorldManifest + versão do schema
  actors/
    <id>.json             ← um arquivo por Document
  items/
    <id>.json
  scenes/
    <id>.json
  journal-entries/
    <id>.json
  ...
```

Os campos voláteis (`created_at`, `updated_at`, `_stats.modifiedTime`, `_stats.lastModifiedBy`) devem ser excluídos do export JSON por padrão (flag `--omit-volatile`), tornando o diff legível em git.

---

### Import de Mundos do Foundry VTT [V2]

**REQ-PER-036** [V2] O servidor deve suportar import de mundos do Foundry VTT V11+ (formato LevelDB) via ferramenta CLI auxiliar `tools/importer-fvtt`. A ferramenta deve:

1. Receber o caminho do diretório do world Foundry como argumento.
2. Usar `foundryvtt-cli unpack` para extrair todos os Documents como arquivos JSON.
3. Executar conversor de schema mapeando campos Foundry → campos Fusion (ver `02-modelo-de-dados.md`).
4. Gerar um `.fwzip` válido importável pelo Fusion.
5. Logar Documents com campos não reconhecidos como warnings, nunca falhar em campos desconhecidos.

**REQ-PER-037** [V2] O importer Foundry deve suportar apenas sistemas para os quais existe um conversor implementado. Sistemas sem conversor devem ser importados com o campo `system` dos Documents preservado como opaque JSON, sem processamento de regras.

---

### Integridade e Recuperação

**REQ-PER-038** [MVP] O servidor deve executar `PRAGMA integrity_check` em cada world ao abrir, conforme REQ-PER-005. O resultado deve ser registrado no log do servidor com nível `info` (se `ok`) ou `fatal` (se falha).

**REQ-PER-039** [MVP] O servidor deve monitorar o tamanho do arquivo WAL (`world.db-wal`). Se ultrapassar 100 MB, emitir log `warn` e forçar checkpoint manual via `PRAGMA wal_checkpoint(TRUNCATE)`. Documentar que serviços de sincronização de arquivo (OneDrive, Dropbox, Google Drive) são incompatíveis com o servidor ativo (podem corromper WAL durante operações de cópia).

> **Atenção — incompatibilidade com Litestream:** quando Litestream ([V2], REQ-PER-029) estiver ativo, o checkpoint forçado (`TRUNCATE`) manual NÃO deve ser executado pelo servidor — o controle de checkpoint é responsabilidade do Litestream. O parâmetro `wal_autocheckpoint` também deve ser configurado conforme recomendação do Litestream (geralmente desabilitado ou em valor alto). Cruzar com `24-operacao-backups-telemetria.md`.

**REQ-PER-040** [MVP] O servidor deve verificar a existência dos três arquivos SQLite relacionados (`world.db`, `world.db-wal`, `world.db-shm`) ao abrir um world. Se `world.db-wal` ou `world.db-shm` existirem sem o arquivo principal, emitir erro fatal e recusar abertura (estado inconsistente).

---

## Requisitos Não-Funcionais

**REQ-PER-NF-001** [MVP] A abertura de um world (do início do request até banco disponível, incluindo `integrity_check`) deve completar em menos de 3 segundos para worlds com até 10.000 Documents no banco.

**REQ-PER-NF-002** [MVP] Uma operação de CREATE/UPDATE/DELETE de Document individual deve completar em menos de 10 ms em P99, excluindo latência de rede.

**REQ-PER-NF-003** [MVP] Um backup automático online (`db.backup()`) de um `world.db` de até 500 MB deve completar em menos de 60 segundos sem degradar latência de operações concorrentes de leitura.

**REQ-PER-NF-004** [MVP] O export de um world de até 2 GB (banco + assets) deve completar em menos de 5 minutos e reportar progresso ao cliente via Server-Sent Events ou polling de status.

**REQ-PER-NF-005** [MVP] O servidor deve tolerar SQLITE_BUSY (write contention) por até 30 segundos antes de retornar erro — suficiente para aguardar o WAL de uma transação longa de sincronização de cena.

**REQ-PER-NF-006** [MVP] O banco de cada world deve suportar pelo menos 100.000 Documents distribuídos entre todas as tabelas sem degradação de performance de leitura (índices garantem O(log n)).

---

## Modelo de Dados (Interfaces TypeScript)

```typescript
// packages/shared/src/types/persistence.ts

export interface WorldManifest {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  fusionVersion: string;
  schemaVersion: number;
  description: string;
  coverImage?: string;
  createdAt: string;
  lastOpenedAt: string;
  playTime: number;
  compatibility: {
    minimumFusion: string;
  };
}

// fog_explorations e cards_collections são [V2] — ver 02-modelo-de-dados.md DEC-DOC-04, REQ-DOC-022
export type DocumentTable =
  | "actors"
  | "items"
  | "scenes"
  | "journal_entries"
  | "macros"
  | "roll_tables"
  | "playlists"
  | "chat_messages"
  | "combats"
  | "users"
  | "folders"
  | "settings";

export interface DocumentRow {
  id: string;
  data: string; // JSON serializado do Document completo
  created_at: number; // timestamp Unix ms
  updated_at: number; // timestamp Unix ms
  // Colunas adicionais variam por tabela (extraídas do JSON)
}

export interface SchemaMigration {
  version: number;
  applied_at: number;
  description: string;
}

export interface BackupEntry {
  filename: string;
  type: "auto" | "manual" | "pre-delete" | "pre-restore";
  timestamp: number;
  sizeBytes: number;
  path: string;
}

export interface WorldLock {
  pid: number;
  started_at: string; // ISO 8601
}

export interface ExportManifest {
  fusionVersion: string;
  exportedAt: string;
  world: WorldManifest;
  dbHash: string; // SHA-256 hex
  assetCount: number;
  totalSizeBytes: number;
  assetPaths: string[];
  missingAssets: string[];
}

export interface CreateWorldOptions {
  title: string;
  system: string;
  description?: string;
  coverImage?: string;
  slug?: string; // gerado automaticamente se omitido
}

export interface DbBackupOptions {
  type: "auto" | "manual";
  worldSlug: string;
}

export interface CrudOperation {
  table: DocumentTable;
  id: string;
}

export interface CreateDocumentOp extends CrudOperation {
  data: Record<string, unknown>;
}

export interface UpdateDocumentOp extends CrudOperation {
  diff: Record<string, unknown>; // apenas as mudanças (deep merge)
}

export interface DeleteDocumentOp extends CrudOperation {}

export interface BatchOperation {
  creates?: CreateDocumentOp[];
  updates?: UpdateDocumentOp[];
  deletes?: DeleteDocumentOp[];
}
```

---

## API e Eventos

### Endpoints REST

| Método   | Rota                              | Body                          | Resposta             | Descrição            |
| -------- | --------------------------------- | ----------------------------- | -------------------- | -------------------- |
| `GET`    | `/api/worlds`                     | —                             | `WorldManifest[]`    | Listar worlds        |
| `POST`   | `/api/worlds`                     | `CreateWorldOptions`          | `WorldManifest`      | Criar world          |
| `GET`    | `/api/worlds/:slug`               | —                             | `WorldManifest`      | Obter metadados      |
| `PATCH`  | `/api/worlds/:slug`               | `Partial<WorldManifest>`      | `WorldManifest`      | Atualizar metadados  |
| `DELETE` | `/api/worlds/:slug`               | —                             | `{ deleted: true }`  | Excluir world        |
| `POST`   | `/api/worlds/:slug/duplicate`     | `{ newTitle?: string }`       | `WorldManifest`      | Duplicar world       |
| `POST`   | `/api/worlds/:slug/backup`        | —                             | `BackupEntry`        | Backup manual        |
| `GET`    | `/api/worlds/:slug/backups`       | —                             | `BackupEntry[]`      | Listar backups       |
| `POST`   | `/api/worlds/:slug/restore`       | `{ filename: string }`        | `{ restored: true }` | Restaurar backup     |
| `POST`   | `/api/worlds/:slug/export`        | `{ includeAssets?: boolean }` | `{ jobId: string }`  | Iniciar export async |
| `GET`    | `/api/worlds/:slug/export/:jobId` | —                             | `ExportStatus`       | Status do export     |
| `POST`   | `/api/worlds/import`              | multipart `.fwzip`            | `WorldManifest`      | Importar world       |

### Eventos Socket.IO

Os eventos de Document são gerenciados pela camada de sincronização (ver `04-rede-e-sincronizacao.md`). A camada de persistência dispara os seguintes eventos internos no servidor (não são eventos de socket diretamente):

```typescript
// Emitidos pelo DatabaseService para o SocketService consumir
type PersistenceEvent =
  | { type: "document:created"; table: DocumentTable; document: Record<string, unknown> }
  | {
      type: "document:updated";
      table: DocumentTable;
      id: string;
      diff: Record<string, unknown>;
      full: Record<string, unknown>;
    }
  | { type: "document:deleted"; table: DocumentTable; id: string }
  | { type: "world:opened"; slug: string }
  | { type: "world:closed"; slug: string }
  | { type: "backup:completed"; slug: string; entry: BackupEntry }
  | { type: "integrity:ok"; slug: string }
  | { type: "integrity:failed"; slug: string; result: string };
```

---

## Dependências entre Specs

| Spec                                | Tipo de dependência                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `02-modelo-de-dados.md`             | Define os tipos de Document e campos que esta spec persiste; o schema SQL de colunas extraídas deriva dos campos definidos lá                                     |
| `04-rede-e-sincronizacao.md`        | Consome eventos do `DatabaseService`; implementa broadcast dos Documents via socket                                                                               |
| `05-usuarios-e-permissoes.md`       | A tabela `users` é gerida por esta spec; permissões de acesso às operações de world são verificadas pela spec de permissões                                       |
| `16-compendiums-e-importacao.md`    | Compendium packs usam schema idêntico ao `world.db` com banco `pack.db` separado; o importer usa o DatabaseService desta spec                                     |
| `20-assets-e-midia.md`              | O processo de export (REQ-PER-030/032) depende do subsistema de assets para localizar e copiar arquivos; referência de paths em Documents é convenção definida lá |
| `22-instalacao-e-distribuicao.md`   | Documenta o caminho padrão de `fusion-data/` por plataforma e configuração via variável de ambiente                                                               |
| `24-operacao-backups-telemetria.md` | Detalha política de retenção, logging de backup, alertas de WAL e integração opcional com Litestream                                                              |
| `25-testes-e-qualidade.md`          | Define testes de integração para CRUD, transações e backup usando SQLite in-memory                                                                                |

---

## Critérios de Aceitação

**CA-PER-01** [MVP] Dado um servidor Fusion recém-instalado, ao executar `fusion-server --data-dir ./test-data`, a estrutura de diretórios `fusion-data/` deve ser criada automaticamente com todos os subdiretórios listados em REQ-PER-001.

**CA-PER-02** [MVP] Dado um world criado, ao conectar ao `world.db` com um cliente SQLite externo (ex.: DB Browser for SQLite), todas as tabelas listadas em REQ-PER-006 devem estar presentes com os índices listados em REQ-PER-007.

**CA-PER-03** [MVP] Dado um world aberto, ao tentar abrir o mesmo world em um segundo processo Fusion simultaneamente, o segundo processo deve retornar erro com mensagem indicando que o world já está em uso.

**CA-PER-04** [MVP] Dado um world com 100 Actors, ao fazer `PRAGMA integrity_check` imediatamente após 1000 operações de UPDATE concorrentes (simuladas via testes de carga), o resultado deve ser `ok`.

**CA-PER-05** [MVP] Dado um world com dados corrompidos (simulado sobrescrevendo bytes aleatórios no `world.db`), ao tentar abrir o world, o servidor deve detectar a corrupção via `integrity_check`, renomear o arquivo corrompido, restaurar o backup mais recente automaticamente e logar o evento.

**CA-PER-06** [MVP] Dado um world com 50 Actors e 10 imagens referenciadas em `assets/`, o export como `.fwzip` deve produzir um arquivo ZIP válido contendo `manifest.json`, `world.db` com SHA-256 correto, e os 10 arquivos de imagem em seus paths relativos.

**CA-PER-07** [MVP] Dado o `.fwzip` do CA-PER-06, ao importá-lo em uma instalação Fusion limpa, o world resultante deve ter todos os 50 Actors e as imagens acessíveis nos paths originais.

**CA-PER-08** [MVP] Dado um world com backup habilitado, após 30 minutos de servidor ativo, um arquivo `auto-<timestamp>.db` deve existir em `worlds/<slug>/backups/` e ser um SQLite válido com `PRAGMA integrity_check = ok`.

**CA-PER-09** [MVP] Dado um batch de 100 creates de Actor enviados simultaneamente, todos os 100 devem ser persistidos sem duplicatas, sem dados corrompidos, e a operação deve completar em menos de 500 ms.

**CA-PER-10** [MVP] Dado um world sendo exportado (arquivo de 1 GB), o endpoint `GET /api/worlds/:slug/export/:jobId` deve retornar progresso atualizado a cada polling, e o arquivo `.fwzip` final deve ser íntegro e importável.

---

## Questões em Aberto

1. **Limite de tamanho de export**: qual é o tamanho máximo aceitável para um `.fwzip`? Se um world tiver 50 GB de assets de vídeo, o export deve ter um modo "só banco" como fallback?

2. **Granularidade de backup de assets**: assets em `worlds/<slug>/assets/` devem ser incluídos em backups automáticos (além do export manual)? Backups só do banco são de pouca utilidade se as imagens forem perdidas independentemente.

3. **Limpeza de assets órfãos**: ao excluir um Document que referenciava um asset, o asset físico deve ser excluído automaticamente? Isso requer rastrear referências por contagem — complexidade adicional. Alternativa: varredura periódica de assets não referenciados.

4. **Configuração de política de retenção**: o GM deve poder configurar o número máximo de backups automáticos (default: 10) via painel? Qual o valor máximo permitido?

5. **Migração incremental vs. big-bang**: para migrations que alteram schema do campo `data` (JSON), o servidor deve migrar todos os Documents existentes na abertura ou migrar lazily na leitura? Migração em massa pode bloquear a abertura de worlds grandes.

6. **Compendium packs no export**: um `.fwzip` de world deve incluir também os compendium packs criados dentro daquele world? Ou apenas os Documents do world ativo?

7. **Atomicidade do import de `.fwzip`**: se o import falhar na metade (ex.: disco cheio), como garantir que não fique um world parcialmente importado? Staging em diretório temporário + rename atômico é suficiente em todos os sistemas de arquivos suportados?

8. **Suporte a worlds Foundry V10 (NeDB)**: a ferramenta de import V2 deve suportar também o formato NeDB legado do Foundry V10, ou apenas V11+ (LevelDB)?

9. **Notificação de backup em progresso**: ao executar backup automático, o servidor deve notificar os clientes conectados via socket (para exibir indicador de "salvando...")? Ou o backup é transparente para os jogadores?

10. **Estratégia de checkpoint WAL em shutdown**: ao desligar o servidor graciosamente, deve-se executar `PRAGMA wal_checkpoint(TRUNCATE)` para garantir que o WAL seja incorporado ao arquivo principal antes de fechar? Isso adiciona latência ao shutdown mas garante que o próximo open seja mais rápido.

---

## Referências

- `docs/research/02-foundry-documentos-persistencia.md` — seção 11 (Persistência LevelDB), seção 13 (Ciclo CRUD), seção 14 (UUIDs)
- `docs/research/95-ops-backup-telemetry-testing.md` — seção 1 (Estratégia de Backup para SQLite), PRAGMAs, modalidades de backup, Litestream
- `docs/research/90-asset-media-management.md` — seção 6 (Referência de paths em Documents), seção 6.4 (impacto em backup)
- [better-sqlite3 — backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite WAL documentation](https://www.sqlite.org/wal.html)
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [foundryvtt-cli (GitHub)](https://github.com/foundryvtt/foundryvtt-cli)
- `02-modelo-de-dados.md` — tipos de Document e campos persistidos
- `04-rede-e-sincronizacao.md` — consumo de eventos de persistência pelo socket layer
- `16-compendiums-e-importacao.md` — schema e uso de compendium packs
- `20-assets-e-midia.md` — convenções de paths de assets
- `22-instalacao-e-distribuicao.md` — caminhos de dados por plataforma
- `24-operacao-backups-telemetria.md` — política de retenção e alertas operacionais
- `25-testes-e-qualidade.md` — testes de integração de persistência
