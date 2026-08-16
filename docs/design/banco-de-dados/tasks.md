# Banco de dados — plano de tarefas

Origem: review adversarial do schema em 2026-08-15 (20 achados). Validado contra
`stable/app` **e** contra a ponta de `alfa/app` — os arquivos de banco são idênticos
nas duas linhas, então nada aqui depende de qual delas você olha.

Base de trabalho: `alfa/app`. Uma fase = um PR. Promoção `alfa → beta → stable` é
sempre ato humano.

**Escopo de linha:** este plano vale para a linha `alfa`/`beta`/`stable` e só para ela.
`build/app` e `main` são a linha geral do projeto, paralela desde `ab4966f` (02/08), e
não há convergência planejada entre as duas — nenhuma migration daqui precisa aplicar
limpo lá, e nenhuma correção daqui chega lá sozinha.

---

## Decisões fechadas (não reabrir sem motivo novo)

| #   | Decisão                                                                                  | Consequência                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Esta linha adota a `004_region_maps`; migrations novas começam em **005**                | `teste_xande` já está gravado em schema v4: uma 004 diferente seria **pulada em silêncio** por `applyMigrations`, e o mundo já tem 2 mapas com 7 pins gravados que a tabela preserva |
| D2  | Mundo enxuto: regras ficam no compêndio. **Sons e imagens vivem no mundo**               | `world.db` fica pequeno; quem cresce é `assets/`. Rebaixa a urgência de snapshot magro e normalização                                                                                |
| D3  | Registro leve de assets no banco (sem tabela de referências no write path)               | Habilita GC de órfãos e, depois, permissão por asset — sem congelar o modelo de documentos                                                                                           |
| D4  | Backup do mundo = banco **+ assets deduplicados por hash**                               | O nome do arquivo já é o hash do conteúdo: arquivo nunca muda, backup incremental sai de graça                                                                                       |
| D5  | Retenção mista: chat nunca some sozinho; sessão expirada (>30d) e auditoria (>12m) somem | Distingue memória da mesa de sobra de implementação                                                                                                                                  |
| D6  | Schema divergente do código = **falha fechada** no boot, com `--force` de escape         | A divergência que temos hoje foi silenciosa; seguir em frente calado foi o que a produziu                                                                                            |
| D7  | Trabalho entra por PR em `alfa/app`                                                      | A linha em que se joga não é a linha em que migration estreia                                                                                                                        |

**Princípio que rege o plano:** decisão irreversível só onde o conceito está fechado.
Onde não está — token, forma do estado quente —, faz-se o reversível e prepara-se o
terreno para a decisão futura sair barata. Ver "Adiado com gatilho".

---

## Como ler estas tarefas

- `T###` — id estável. Não renumerar; tarefa cancelada vira `~~T###~~` com o motivo.
- `[P]` — pode ser feita em paralelo com as outras `[P]` da mesma fase.
- **Pronto quando** — critério verificável, não "implementado". Sem comando que prove, a tarefa não fecha.
- Toda tarefa cita arquivo real, com a linha de referência quando útil.

Comandos do repo: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm build`
(worktree nova exige `pnpm install` + `pnpm build` antes do primeiro `pnpm test`, senão a suíte nem coleta).

---

## Fase 0 — Tornar migration segura, antes de escrever qualquer migration ✅

Pré-requisito de tudo. Enquanto o backup pré-migração for cópia de arquivo de um banco
WAL aberto, nenhuma migration das fases seguintes é segura de rodar.

**Concluída** (PR 1). T001–T006 entregues; a guarda de T004 foi verificada contra um
snapshot do `teste_xande` real (v4, 2 mapas de região) e o aceita sem apontar nada.

### T001 ✅ — Backup pré-migração consistente

`packages/server/src/db/migrations.ts` (`backupBeforeMigration`, ~linha 75)

Hoje: `copyFileSync` do `.db` com a conexão **aberta**, e o `-wal` copiado depois em
best-effort — duas operações não atômicas sobre um banco em uso.
Trocar por `VACUUM INTO ?` (SQLite 3.53 no better-sqlite3 atual; síncrono, produz cópia
consistente de uma conexão aberta, e já vem compactada). A API `db.backup()` que o
`WorldManager` usa é assíncrona e não encaixa aqui — `applyMigrations` é síncrona de
ponta a ponta.

**Pronto quando:** teste gera backup com escrita concorrente pendente e o arquivo
resultante passa em `PRAGMA integrity_check` e contém as mesmas linhas da origem.
→ `__tests__/db-backup-restore.test.ts` ("captures writes still pending in the WAL":
200 linhas no WAL, backup íntegro, com as 200, e ainda na versão anterior).

### T002 ✅ [P] — Poda cobre todos os tipos de backup

`packages/server/src/worlds/world-manager.ts` (~linha 738)

`maxAutoBackups` só poda o tipo `auto`. `pre-migration-*` e `pre-delete-*` acumulam
cópias integrais para sempre. Parametrizar limite por tipo.

**Pronto quando:** teste com N+3 backups de cada tipo deixa exatamente o limite de cada um.
→ `WorldManagerOptions.backupRetention` (auto 10, pre-migration 5, pre-update 5,
pre-delete 3, pre-restore 3, **manual ilimitado** — backup que um humano pediu não some
sozinho, mesma régua do chat em D5). `pruneBackups()` é público porque o backup
pré-migração nasce no framework de migration, que não conhece retenção: quem o poda é o
`open()`.

### T003 ✅ — Portar `004_region_maps`

Novo: `packages/server/src/db/migrations/004_region_maps.ts` (cópia fiel da de `build/app`)
Editar: `packages/server/src/db/index.ts:33` (`registerMigrations([...])`)

Só a tabela e os dois índices. Nenhuma UI, nenhum handler, nenhum tipo de documento novo
nesta tarefa — `region_maps` fica como tabela existente e não usada nesta linha.

A cópia precisa ser **fiel ao shape que o `teste_xande` já tem gravado** (o mundo carrega 2
mapas com 7 pins, criados quando passou pela outra linha). Não é questão de merge futuro —
as linhas não convergem —, é que a tabela precisa casar com o dado que já está lá, senão
a guarda de T004 acusa divergência no primeiro boot.

**Pronto quando:** banco novo nasce em v4; banco v3 sobe para v4; `teste_xande` (v4) abre
sem nada pendente. → `__tests__/db-schema-guard.test.ts`; o DDL foi conferido linha a linha
contra o `sqlite_master` do `teste_xande` antes de portar, e bate.

### T004 ✅ — Guarda de schema no boot (D6)

`packages/server/src/db/migrations.ts` · `packages/server/src/worlds/world-manager.ts` (`open`)
· `packages/server/src/cli/commands/serve.ts` (flag `--force`)

Hoje `applyMigrations` calcula `MAX(version)` e aplica o que for maior — sem nome, sem
checksum. Um banco que andou por outra linha faz o servidor pular migration **em silêncio**.

1. No boot, comparar o schema **real** do arquivo com o schema que as migrations
   registradas produzem, na versão que o banco declara.
2. Divergiu → **recusar abrir**, com mensagem que diga: o que esperava, o que achou, onde
   está o backup, qual comando repara. `--force-schema` segue mesmo assim.
3. Lista explícita de tabelas legadas toleradas: `roll_audit_log` (nasce fora das migrations
   até T007).

**Mudança de abordagem, decidida na implementação:** o plano pedia _checksum do código de
cada migration_. Isso tem dois defeitos que só aparecem quando você tenta escrever: um
`prettier` ou um comentário reescrito muda o hash e o mundo **para de abrir** por nada; e um
hash de código não vê drift nenhum que tenha nascido fora das migrations (`roll_audit_log`
é exatamente esse caso). O que importa não é qual código rodou, é se o **schema no arquivo**
é o que este build espera — então a guarda aplica as migrations registradas num banco
`:memory:` e compara `sqlite_master` objeto a objeto, com o SQL normalizado (whitespace e
espaço em volta de `(`, `)`, `,`). Não há segunda cópia do schema para manter em dia, e
reindentar migration não acusa falso positivo — o que é matéria de teste.

**Pronto quando:** testes cobrem os quatro casos — banco novo, banco v3, banco v4 vindo de
outra linha, banco com migration faltando no meio — e o caso divergente falha com mensagem
acionável, não com stack trace. → `db-schema-guard.test.ts`, 9 casos (os quatro, mais versão
desconhecida, `roll_audit_log` tolerado, `--force-schema` e reindentação).

### T005 ✅ — Ensaio de restauração

Teste de integração que restaura um backup gerado por T001 e abre o mundo restaurado.
Um backup que nunca foi restaurado não é um backup.

**Pronto quando:** `pnpm test` verde com o ciclo completo backup → restaura → abre → lê documento.
→ `db-backup-restore.test.ts` ("backs up a world, loses it, restores it and reads the
document back": cria mundo → grava ator → backup → `DELETE FROM actors` → restaura →
`open()` → lê o ator de volta, com `integrity_check` ok).

### T006 ✅ [P] — Este documento no repo

`docs/design/banco-de-dados/tasks.md` commitado, para o plano não viver só no chat.

---

## Fase 1 — Consertar o schema (migrations 005+) ✅

Depende da Fase 0 inteira. T008 recria tabelas: só roda com T001 e T005 fechadas, e o
ensaio é sobre **cópia** do `teste_xande`, nunca sobre o mundo que está servindo na 33000.

**Concluída** (PR 2), com **quatro** migrations em vez de três: T010 ganhou a sua (008).
Antes de escrever qualquer uma, os 8 mundos em disco foram auditados — o ativo e os 7
arquivados em `~/.fusion/backups/mundos-arquivados-2026-08-15/`. O resultado é o que
liberou os constraints de T008: `role` só assume 1 e 4, nenhum nome colide ignorando
caixa, `active` é sempre 1, nenhuma sessão órfã, e `roll_audit_log` existe nos 8 com DDL
byte-idêntico.

### T007 ✅ — `roll_audit_log` entra nas migrations

Nova migration `005_roll_audit_log.ts` · removido `ensureAuditTable` de
`packages/server/src/chat/roll-service.ts` (a chamada ficava no **construtor** do
`RollService`, não no primeiro dado: bastava instanciar o serviço)

Hoje a tabela nasce sob demanda no primeiro dado rolado — ou seja, o schema de um mundo
depende de alguém ter jogado. Criar por migration e apagar a criação ad-hoc.

**A exceção da guarda não podia ser apagada, só versionada.** `checkSchema` julga o banco
na versão que ele **declara**, antes de aplicar nada: um mundo em v4 é comparado contra as
migrations 001–004, que não criam a tabela. Esvaziar `LEGACY_TOLERATED_OBJECTS` recusaria
abrir todo mundo existente — inclusive o `teste_xande` — _antes_ de chegar na 005 que o
consertaria. A allowlist virou `Map<nome, versão que adota>`: o objeto é tolerado como
extra só **abaixo** da versão adotante; de lá em diante ele é esperado, e some vira
problema.

**Pronto quando:** banco novo já tem a tabela antes de qualquer rolagem; mundo antigo que
já a tinha não quebra (`CREATE TABLE IF NOT EXISTS`); guarda de T004 deixa de precisar da
exceção. → `db-schema-guard.test.ts`: tolerado em v4, exigido em v5, extra desconhecido
ainda recusado, linhas preservadas na subida, e o DDL da migration comparado com o que o
caminho antigo produzia (`lands on the same table an ad-hoc world already has`).
`roll-converter.test.ts` passou a aplicar migrations — dependia do efeito colateral.

### T008 ✅ — Constraints por recriação de tabela

Nova migration `006_constraints.ts`

O SQLite não aceita `ALTER TABLE … ADD CONSTRAINT`: só rename, add e drop column. Cada
tabela afetada é recriada (nova → copia → drop → rename).

- `users`: `CHECK (role BETWEEN 1 AND 4)`, `CHECK (active IN (0,1))`, unicidade de nome —
  hoje ela existe só como `findByName` antes do insert (`auth/user-store.ts:162`, chamado
  de `auth/service.ts:271`), que é TOCTOU.
- `sessions`: `user_id … REFERENCES users(id) ON DELETE CASCADE` — hoje é `NO ACTION`, o
  que faria "excluir usuário" falhar com erro de constraint no dia em que existir.

**Mudança de abordagem, decidida na implementação — a técnica descrita acima não roda.**
O plano dizia "com `foreign_keys` desligado durante o procedimento". `applyMigrations`
executa cada `migration.up()` **dentro** de uma transação (`migrations.ts:454`), e o
SQLite ignora `PRAGMA foreign_keys` em silêncio com transação aberta (verificado por
execução contra o better-sqlite3 desta árvore: o pragma volta lido como `1`). A FK fica
ligada de qualquer jeito, e aí remover a tabela `users` falha com `FOREIGN KEY constraint
failed` em qualquer mundo que tenha sessões — o `teste_xande` tem 29. **A saída não precisa
de pragma nenhum: remover a tabela FILHA antes da PAI.** Sem a `sessions` antiga, ninguém
referencia a `users` antiga. A FK segue aplicada o tempo todo e sobrevive ao rename.

Outras três decisões:

- **Faixa 1..4, não 0..4** como o texto acima dizia: o enum `Role` (`auth/user-store.ts`)
  não define 0, o DEFAULT da coluna é 1, e os 8 mundos auditados só têm 1 e 4. Um CHECK
  que aceita um valor sem significado não é um CHECK.
- **A unicidade virou `CREATE UNIQUE INDEX idx_users_name_nocase ON users(name COLLATE
NOCASE)`**, não constraint de tabela. Mesmo efeito, e o mesmo objeto serve o `findByName`
  — o índice de busca que T009 previa não precisa existir separado.
- **Checagem prévia com mensagem acionável.** Sem ela, um mundo com dado fora da regra
  morre no boot com `CHECK constraint failed` e nada mais. A migration agora recusa antes
  de tocar em qualquer coisa, nomeando a linha ofensora e apontando o backup.

**Pronto quando:** migration roda sobre cópia do `teste_xande` e do banco de um mundo
arquivado; dados batem linha a linha antes/depois; tentativa de inserir `role = 9` ou nome
duplicado falha no banco, não só no Zod. → `db-constraints.test.ts`, 10 casos. O primeiro
**semeia users e sessions antes de migrar**: com tabela vazia a remoção nunca viola FK, então
todo teste que parte de diretório limpo daria falso positivo para uma 006 quebrada.

### T009 ✅ [P] — Índices que servem para o que o código faz

Nova migration `007_indexes.ts`

- ~~Criar `users(name COLLATE NOCASE)`~~ — já veio na 006, como o índice único que também
  aplica a regra de nome. Um objeto, dois propósitos.
- Criar `chat_messages(timestamp DESC, id DESC)` — é exatamente a ordenação da paginação keyset.
- Dropar `idx_scenes_nav` (ninguém consulta por `navigation`).
- **A mais:** dropar `idx_chat_timestamp`. Tudo que um índice em `(timestamp)` serve, um em
  `(timestamp, id)` também serve — mantidos os dois, é uma escrita de índice a mais por
  mensagem em troca de nada.
- `idx_scenes_active`: foi para a 008, junto com a coluna (ver T010).

**Pronto quando:** `EXPLAIN QUERY PLAN` das três consultas reais usa índice, e não `SCAN`.
→ `db-indexes.test.ts`, com o SQL **copiado de `chat-handler.ts` e `user-store.ts`**, não
reescrito. Além de usar o índice, o plano não pode conter `USE TEMP B-TREE FOR ORDER BY`:
índice que o SQLite aceita mas não usa para ordenar é o defeito que `idx_chat_timestamp`
tinha.

### T010 ✅ — Uma fonte de verdade para a cena ativa

Nova migration `008_scene_active.ts` · `packages/server/src/documents/store.ts`
(`extractColumns`, `_tableHasColumn`) · `packages/server/src/net/handlers/doc-handlers.ts`
· `packages/server/src/net/handlers/sync-handlers.ts`

Hoje `scenes.active` existe como coluna **com índice**, mas quem manda é
`settings['_meta:activeScene']`. Duas fontes, uma delas mentindo.
Recomendação: manter `settings` (é o que o código já usa) e dropar coluna + índice.

Eram **três** representações, não duas: a coluna, o campo `active` dentro do JSON do
documento, e a chave em `settings`. Só a última era lida por alguém — o snapshot do join e
o broadcast de ativação. A coluna era escrita em todo create/update de cena e lida por
ninguém, em lugar nenhum do server nem do client (a UI compara `scene._id ===
activeSceneId`, nunca `scene.active`).

O que ficou: a coluna e o índice saíram; `settings` é a fonte de verdade; o campo no
documento continua como **espelho**, mantido só pelo handler de `world:activeScene` — e
`doc:update` passou a **recusar** `active` em Scene. Era esse o segundo escritor que
deixava os registros discordarem: gravava o campo sem tocar em `settings`, sem desativar a
cena anterior e sem broadcast (o `e2e-dod-m3.test.ts` fazia exatamente isso, e passava).
A ordem dentro da migration importa: `DROP INDEX` antes de `DROP COLUMN`, ou o SQLite
recusa com um `SQLITE_ERROR` que não diz o motivo.

**Pronto quando:** existe um único caminho de leitura e um único de escrita para "qual é a
cena ativa", com teste que prova que ativar cena por qualquer caminho reflete no outro.
→ `db-indexes.test.ts` (coluna e índice sumiram, documentos atravessam intactos) e
`e2e-dod-m3.test.ts`, onde o caminho genérico agora é recusado e a ativação passa por
`world:activeScene`.

### T011 ✅ — Ensaio de fase sobre cópia do `teste_xande`

Rodar 005→008 sobre uma cópia, abrir o mundo, conferir contagens e um documento de cada tipo.

**Pronto quando:** relatório de antes/depois anexado ao PR.
→ `docs/design/banco-de-dados/ensaio-fase-1.md`. A cópia sai por `VACUUM INTO` de uma
conexão **readonly** sobre o mundo vivo — que estava com ~1 MB de WAL pendente e `world.lock`
presente na hora do ensaio, ou seja, exatamente o estado que o backup da Fase 0 foi
desenhado para capturar.

---

## Fase 2 — Corrigir o caminho de escrita (sem migration)

### T012 — Transação em volta do read-modify-write

`packages/server/src/documents/store.ts` (`update` ~491, `create` ~317, `delete` ~560)
· `packages/server/src/db/connection.ts:194`

`update()` lê via `this.get()` **fora** da transação e só o `UPDATE` entra nela. Dentro do
processo Node isso é atômico por ser síncrono — mas o CLI e o importador abrem o mesmo
`world.db` em WAL, e aí é lost update. Além disso `db.transaction()` é DEFERRED, apesar do
comentário em `connection.ts:135` prometer "immediate".

**Pronto quando:** leitura e escrita ocorrem na mesma transação `IMMEDIATE`, e um teste com
duas conexões concorrentes prova que a segunda escrita não sobrescreve a primeira em silêncio.

### T013 — `expectedVersion` deixa de ser opcional

`packages/server/src/net/handlers/doc-handlers.ts:774-790` · protocolo em `packages/shared`
· emissores no client

Hoje o STALE_WRITE só é checado `if (upd.expectedVersion !== undefined)`. Cliente que omite
ganha last-write-wins sem aviso.

**Pronto quando:** update sem `expectedVersion` é recusado (ou tratado por política única e
documentada), com teste dos dois caminhos.

### T014 [P] — `LIMIT ?` com bind

`packages/server/src/documents/store.ts:444` — hoje interpolado. Nenhum chamador passa valor
do cliente hoje; é faca no chão.

### T015 [P] — `_tableHasColumn` derivado do banco

`packages/server/src/documents/store.ts:456` — lista manual de colunas é a **terceira** cópia
do schema (DDL → `extractColumns` → `tableColumns`). Derivar de `PRAGMA table_info` uma vez
no boot.

**Pronto quando:** adicionar coluna numa migration não exige tocar em `store.ts`.

### T016 — Ponto único de escrita de token + instrumentação

`packages/server/src/net/handlers/doc-handlers.ts` (`handleEmbeddedUpdate` / `handleEmbeddedCreate`)

Não decide nada sobre a forma do token. Garante que **toda** persistência de token passe por
uma função só, e instrumenta o caminho: escritas/min, bytes reescritos, latência.

**Pronto quando:** existe um único ponto de escrita, e um relatório de sessão real mostra os
números — que é o insumo da decisão adiada.

---

## Fase 4 — Retenção e manutenção (antes da 3: barata e de efeito imediato)

### T017 — GC no boot (D5)

`packages/server/src/auth/session-store.ts` (não existe um `DELETE` hoje) · roll-service · config

Sessões expiradas há mais de 30 dias e auditoria com mais de 12 meses saem no boot, com os
limites configuráveis. **Chat não é tocado.**

**Pronto quando:** teste com dados sintéticos velhos prova o que sai e o que fica; log diz
quantas linhas foram removidas.

### T018 [P] — Manutenção do arquivo

`PRAGMA optimize` no fechamento, `ANALYZE` periódico, vacuum incremental depois de GC grande.
Nenhum dos três existe no código hoje.

### T019 — Arquivamento manual de chat

Comando de CLI que exporta um intervalo e só então remove, sob confirmação explícita.
Chat só sai por ordem sua (D5).

---

## Fase 3 — Assets como cidadãos de primeira classe

### T020 — Tabela `assets`

Nova migration `008_assets.ts`: nome, hash do conteúdo, bytes, mime, quem subiu, quando.

### T021 — Registro no upload

`packages/server/src/assets/routes.ts` (~194) grava a linha ao aceitar o arquivo.

### T022 — Reconciliação

Novo `packages/server/src/assets/reconcile.ts` + comando de CLI. Varre o diretório e os
documentos procurando o **padrão de caminho** dentro do JSON — genérico de propósito, sem
lista fixa de campos ("token usa `texture`", "cena usa `background`"), que é justamente o
que vai mudar quando token/ficha forem redefinidos.

**Pronto quando:** relatório lista órfãos (arquivo sem referência) e quebrados (referência
sem arquivo) num mundo real.

### T023 — GC de órfãos

Remoção só depois do relatório e com confirmação. Nunca automática.

### T024 — Backup do mundo inclui assets (D4)

`packages/server/src/worlds/world-manager.ts` (`backup`, `backupPreUpdate`, restauração)

Hoje todo backup automático copia só o `world.db` — restaurar traz o banco com caminhos
apontando para arquivos que podem não existir. Copiar por hash: arquivo já presente no
repositório de backup não é copiado de novo.

**Pronto quando:** backup → apaga assets → restaura → todas as referências resolvem.

### T025 — SEGURANÇA: autorização por documento na rota de assets

`packages/server/src/assets/routes.ts:409` (`GET /assets/*`) · `assets/asset-token.ts`

Hoje a rota serve **qualquer arquivo do mundo a qualquer usuário autenticado** (role ≥
PLAYER). Não há consulta ao `ownership` do documento que referencia o arquivo. O que protege
um mapa não revelado é o nome ter 8 hex de hash do conteúdo — capability URL, não permissão;
e assets semeados por script (ex.: `taverna-demo.jpg`) não têm nem isso.

PR próprio, fora das migrations. Pode subir de prioridade para logo depois da Fase 0 se o
risco na mesa incomodar.

---

## Fase 5 — Higiene (sem pressa, sem risco)

- **T026** — remover `roll_audit_log.world_id` e `chat_messages.data.worldId`: coluna
  multi-tenant num banco que já é de um mundo só.
- **T027** — `settings` guarda a chave duas vezes (`id` + `data.key`) e exige SQL cru para
  `_meta:*` porque o `:` não passa no regex de `_id`. Dar um caminho oficial.
- **T028** — unificar as duas definições de `login_attempts` (migration 002 e
  `admin/lockout-db.ts:57`).
- **T029** — `world.json.schemaVersion` é gravado como `1` e nunca acompanha as migrations.
  Refletir a verdade ou remover o campo.

---

## Adiado com gatilho explícito

| Item                                                  | Por que espera                                                                                                                                             | Destrava quando                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Forma do estado quente (token na cena, HP na ficha)   | Não existe spec de Token — o conceito está espalhado por 12 specs (103 menções na 06, 75 na 07). Decidir DDL sobre conceito indefinido é congelar o errado | Spec de Token existir **e** os números de T016 estarem na mão |
| Colunas geradas (`json_extract`) + índices sobre JSON | Com mundo enxuto (D2), pode nunca doer. E são descartáveis: se o campo mudar de lugar, muda-se a expressão do índice, sem migrar dado                      | Uma consulta real ficar lenta                                 |
| Snapshot magro com carga sob demanda                  | Idem — o cenário que justificava era "492 monstros importados no mundo", descartado por D2                                                                 | O mundo passar de alguns milhares de documentos               |

---

## Mapa de PRs

| PR  | Conteúdo                   | Depende de                             |
| --- | -------------------------- | -------------------------------------- |
| 1   | Fase 0 (T001–T006) ✅      | —                                      |
| 2   | Fase 1 (T007–T011) ✅      | PR 1                                   |
| 3   | Fase 2 (T012–T016)         | PR 1                                   |
| 4   | Fase 4 (T017–T019)         | PR 2                                   |
| 5   | Fase 3 dados (T020–T024)   | PR 2                                   |
| 6   | T025 (segurança de assets) | independente — pode vir logo após PR 1 |
| 7   | Fase 5 (T026–T029)         | PR 2                                   |

Se algo for cortado por tempo, corta-se **da 5 para trás**. A Fase 0 nunca é cortada: é o
que impede que uma migration ruim vire perda de mundo.

---

## Rastreabilidade: achado do review → tarefa

| Achado                                                                                                                                                                | Tarefa                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1 write amplification · 2 snapshot completo · 3 sem consulta no SQL                                                                                                   | adiados (com gatilho) + T016       |
| 4 sem retenção/GC · 5 sem ANALYZE                                                                                                                                     | T017, T018, T019                   |
| 6 duas fontes para cena ativa                                                                                                                                         | T010                               |
| 7 sem constraints · 8 FK sem cascade                                                                                                                                  | T008                               |
| 9 transação no lugar errado · 10 `expectedVersion` opcional                                                                                                           | T012, T013                         |
| 11 schema drift (tabela ad-hoc, sem checksum)                                                                                                                         | T004, T007                         |
| 12 backup pré-migração inconsistente · 13 backups sem poda                                                                                                            | T001, T002, T005                   |
| 14 migrations sem checksum                                                                                                                                            | T004                               |
| 15 `world_id` redundante · 16 `settings` duplicando chave · 17 terceira cópia do schema · 18 `login_attempts` duplicada · 19 `LIMIT` interpolado · 20 índices errados | T026, T027, T015, T028, T014, T009 |
| novo: assets sem registro/GC                                                                                                                                          | T020–T023                          |
| novo: assets sem autorização por documento                                                                                                                            | T025                               |
| novo: backup do mundo ignora assets                                                                                                                                   | T024                               |
