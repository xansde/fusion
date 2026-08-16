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

Recon adversarial rodado em 2026-08-16 sobre T012/T013/T016/T025 (T014/T015 falhou antes
de produzir resultado — ver lacuna abaixo). Achados completos, provas por execução e o
que muda de escopo em cada tarefa: `docs/design/banco-de-dados/recon-fase-2.md`.

### T012 — Transação em volta do read-modify-write (em andamento)

`packages/server/src/documents/store.ts` (`update` ~491, `create` ~317, `delete` ~560)
· `packages/server/src/db/connection.ts:194`

`update()` lê via `this.get()` **fora** da transação e só o `UPDATE` entra nela. Dentro do
processo Node isso é atômico por ser síncrono — mas o CLI e o importador abrem o mesmo
`world.db` em WAL, e aí é lost update. Além disso `db.transaction()` é DEFERRED, apesar do
comentário em `connection.ts:135` prometer "immediate".

**Correção de escopo (recon-fase-2.md):** o esqueleto de código do plano original
(`function () { this.get(...) }` chamado via `txn.immediate()`) **não roda** — dentro do
callback, `this` é o objeto-função da transação, não a instância de `DocumentStore`
(`TypeError: this.get is not a function`, provado por execução). Manter arrow functions,
como o código já faz hoje. E os três batches (`createBatch`/`updateBatch`/`deleteBatch`,
`store.ts:599/625/645`) **não estão "já corretos"**: leem e escrevem dentro de uma
transação DEFERRED, que sob contenção real lança `SQLITE_BUSY_SNAPSHOT`
**não-retentável** e aborta o lote inteiro (reproduzido por execução; `busy_timeout` não
ajuda). Trocá-los para `.immediate()` deixa de ser opcional.

**Pronto quando:** leitura e escrita ocorrem na mesma transação `IMMEDIATE` — em
`create()`, `update()`, `delete()` **e nos três batches** —, e um teste com duas conexões
concorrentes prova que a segunda escrita não sobrescreve a primeira em silêncio,
cobrindo também a checagem de colisão de id em `create()` (`:354`), a de existência em
`delete()` (`:568`) e o caminho de batch sob contenção real (onde o
`SQLITE_BUSY_SNAPSHOT` foi reproduzido).

### T013 — `expectedVersion` deixa de ser opcional (em andamento)

`packages/server/src/net/handlers/doc-handlers.ts:774-790` · protocolo em `packages/shared`
· emissores no client

**Como ficou:** o campo continua opcional no zod (torná-lo obrigatório no schema recusaria
tráfego que a política precisa aceitar). A política vive no handler: `doc:update` primário sem
`expectedVersion` é recusado para papel **não privilegiado**; privilegiado mantém o
comportamento anterior, porque vários escritores de servidor incrementam a versão sem nunca
setar o campo e esse tráfego não é escrito pelo cliente.

**A primeira tentativa de resolver o lado do cliente estava errada, e vale registrar por quê.**
O preenchimento automático lê a versão do espelho no instante do envio. Quando um fluxo dispara
vários `doc:update` do mesmo documento no mesmo tick, sem esperar o ack, todos leem a mesma
versão: o primeiro entra, os demais voltam `STALE_WRITE` e somem no `console.error`. A saída
tentada foi **coalescer** os diffs nos construtores do `planVM`. Isso protege só os pontos que
alguém auditou — e a revisão achou dois que escaparam, os dois em uso real: as **Dádivas de
Atributo** (dispara um update por grupo de boost, fora do caminho protegido) e o **descanso**
(cura de HP e recarga de Foco saem juntas; a segunda seria recusada). O `CharacterSheet.svelte`
nem estava na lista auditada.

Caçar ponto de disparo é jogo que não termina. A correção certa é no **funil**, que é por onde
toda VM já passa: fila por `_id` de documento (enquanto uma escrita daquele documento está em
voo, a próxima espera e lê a versão que a anterior produziu) e **uma** nova tentativa em
`STALE_WRITE`. Conserta todos os pontos de disparo de uma vez, inclusive os que ninguém auditou,
e permitiu **remover** a coalescência em vez de acrescentar superfície. A fila é por documento:
escritas de documentos diferentes seguem em paralelo.

**O pré-voo do handler passou a julgar o lote inteiro** — não encontrado, sem permissão, sem
versão, campo não gravável — antes de escrever qualquer coisa, e nessa ordem. Antes, só a guarda
de campo era pré-voo: um lote em que a segunda entrada não tinha permissão gravava a primeira e
respondia `ok:false`. A ordem também importa para o que o autor da chamada ouve: dizer a quem não
tem acesso que falta um campo confirmaria que o documento existe.

**Pronto quando** (adicional ao enunciado original): existe teste de monotonicidade — ler V,
atualizar uma vez, reenviar V, esperar `STALE_WRITE`. Sem ele, um servidor com versão constante
passa em todos os outros casos.

Hoje o STALE_WRITE só é checado `if (upd.expectedVersion !== undefined)`. Cliente que omite
ganha last-write-wins sem aviso.

**Correção de escopo (recon-fase-2.md):** o gate proposto (recusar update sem
`expectedVersion` para papel não-privilegiado, dentro do bloco 774-785) é **contornável**
como estava desenhado: o roteamento `hasEmbedded` em `doc-handlers.ts:739` desvia o LOTE
INTEIRO para `handleEmbeddedUpdate` assim que uma entry tem `embedded`, e esse handler
descarta as entries primárias em silêncio com `ack.ok=true` (reproduzido por execução,
inclusive com `expectedVersion` grosseiramente obsoleto). Esse fechamento específico virou
item próprio desta leva — ver T030. Além disso, a premissa "o mirror do cliente já tem
`_stats.version`, é trivial preencher" ignorava que o mirror pode ficar **permanentemente
atrasado**: há escritas de servidor que incrementam a versão sem emitir `doc:update` (ver
T032) — pré-requisito real da política, não risco lateral. O plano de teste original
também não prova monotonicidade (nenhum caso reenvia uma versão já consumida).

**Pronto quando:** update sem `expectedVersion` é recusado (ou tratado por política única e
documentada), com teste dos dois caminhos **e** um caso que reenvia uma versão já
consumida (prova que o contador é monotônico e o lock funciona, não só que o número certo
é aceito uma vez). Depende de T030 (roteamento fechado) e, para rollout seguro em papel
não-privilegiado, de T032 (mirror fresco).

### T014 [P] — `LIMIT ?` com bind (em andamento)

`packages/server/src/documents/store.ts:444` — hoje interpolado. Nenhum chamador passa valor
do cliente hoje; é faca no chão.

O recon dedicado a T014 **falhou antes de produzir resultado** (ver `recon-fase-2.md`,
seção "Lacuna"); a verificação foi feita na implementação. Nenhum chamador de produção
passa `limit` hoje, e nada vem de payload de socket ou query string — confirmado por
varredura. A correção é endurecimento preventivo, e o teste que a acompanha fixa a **ordem
dos parâmetros**, que é o que uma troca de interpolação para bind erra em silêncio quando
há filtro junto.

### T015 [P] — `_tableHasColumn` derivado do banco (em andamento)

`packages/server/src/documents/store.ts:456` — lista manual de colunas é a **terceira** cópia
do schema (DDL → `extractColumns` → `tableColumns`). Derivar de `PRAGMA table_info` uma vez
no boot.

O recon dedicado também falhou; a verificação veio na implementação, comparando a lista
manual contra o `PRAGMA table_info` de um banco com as migrations 001–008 aplicadas. **A
lista já estava divergente:** `users` ganhou `password_hash`, `color`, `avatar`, `active` e
`preferences` nas migrations 002/006 e nenhuma delas entrou na lista; `id` e `data`
faltavam em todas as tabelas.

**Pronto quando:** adicionar coluna numa migration não exige tocar em `store.ts`.

**Fechamento parcial, declarado:** isto vale para colunas que o store apenas consulta. A
**segunda** cópia do schema — `extractColumns` (`store.ts:165-243`, um `switch (table)`
escrito à mão) — continua manual, porque ela carrega o mapeamento campo-do-JSON → coluna,
que o `PRAGMA` não conhece. Uma migration que adicione uma coluna **extraída** ainda exige
editar `store.ts`. Das três cópias, caiu uma.

### T016 — Ponto único de escrita de token + instrumentação

`packages/server/src/net/handlers/doc-handlers.ts` (`handleEmbeddedUpdate` / `handleEmbeddedCreate`)
· `packages/server/src/net/handlers/vision-handlers.ts` (`buildTokenMoveHandler`)

Não decide nada sobre a forma do token. Garante que **toda** persistência de token passe por
uma função só, e instrumenta o caminho: escritas/min, bytes reescritos, latência.

**Desenho novo exigido (recon-fase-2.md — DERRUBA):** a proposta original
(`persistSceneTokens(...)` substituindo 4 call sites, hardcodada para
`store.update("scenes", ...)`) não é implementável como escrita — os 3 call sites de
`doc-handlers.ts` que ela envolveria são **polimórficos**: os mesmos três servem
Token↔Scene e Item↔Actor (`EMBEDDED_PARENT_MAP`), então hardcodar "scenes" roteia escrita
de `Actor.items` para a tabela errada (reproduzido por execução). E a lista de "4 call
sites" nunca foi exaustiva: o caminho **genérico** de `doc:update` (Scene sem `embedded`)
grava `scene.tokens` livremente — só o campo `active` tem guarda —, e `doc:create` de uma
Scene inteira grava `tokens` via `store.create`. São pelo menos 6 pontos de escrita, não 4. Quem retomar precisa mapear todos antes de desenhar a função única, e decidir se o
"ponto único" bloqueia o caminho genérico (como T010 fez para `active`) ou instrumenta
todos os caminhos. A instrumentação em log depende de T033 (rotação) para o "Pronto
quando" abaixo fazer sentido numa sessão real.

**Pronto quando:** existe um único ponto de escrita — cobrindo os ≥6 caminhos mapeados em
`recon-fase-2.md`, não só os 4 originais —, e um relatório de sessão real mostra os
números — que é o insumo da decisão adiada.

#### Entregue (2026-08-16) — o "ponto único" já existia; era achá-lo

O desenho novo não criou função nenhuma. Os **11** pontos de chamada textuais (não 4, não 6)
espalhados por `doc-handlers.ts`, `vision-handlers.ts` e `combat-handlers.ts` já convergem,
sem exceção, para duas funções **privadas** de `store.ts`: `_createInTxn` e `_updateInTxn`.
A instrumentação foi para dentro delas.

Essa escolha é a tarefa inteira, e não é estética. `updateBatch`/`createBatch` **não chamam**
os métodos públicos `update()`/`create()` — chamam as privadas direto, dentro da própria
transação. Instrumentar em volta do público ficaria cego a todo lote. Provado por execução
antes de escrever código (wrapper no público contou 1 onde houve 2), e provado de novo depois
pela mutação **M6**: mover a métrica para o `update()` público deixa **6 dos 7 testes verdes** —
só o caso de lote cai. Sem esse caso, a colocação errada passaria no review.

**A revisão adversarial reprovou a primeira entrega, e estava certa.** Três lentes
independentes (cegueira de cobertura, teste circular, regressão/vazamento) devolveram
1 REPROVA e 2 APROVA_COM_RESSALVA, 13 achados, **todos** factualmente corretos e consertados.
Os quatro que valem registro:

1. **`amplificationRatio` media o inverso do fenômeno.** `patchBytes` contava a coleção que o
   handler **reenviou**, não o que mudou. Como `token:move` passa `{ tokens: <array inteiro> }`,
   o denominador crescia junto com o numerador: a razão reportada **caía** conforme a cena
   engordava. Medido: um `token:move` com 1 token reportava `2,31×` quando a amplificação real
   é ~58×; com 30 tokens o relatório convergiria para ~1,0 com a real perto de 1000×. Quem
   lesse o log de uma sessão concluiria "não há amplificação, manter token embutido" — a
   decisão errada, tomada com o número que esta tarefa existe para produzir. Conserto:
   `semanticDeltaBytes` estreita arrays aos elementos que mudaram (casados por `_id`, fallback
   por índice; elemento removido contribui 0). O campo mudou de nome (`patchBytes` →
   `deltaBytes`) de propósito: manter o nome antigo convidaria a repetir a leitura errada.
2. **Latência e bytes não tinham oráculo nenhum.** `patchBytes: 1` e `patchBytes * 3`
   sobreviviam com 7/7 verde; `percentile()` retornando 0 e `latencyNs: 0n` também. O relatório
   publicaria "escrita custa 0 ms", a conta de contenção daria zero, e a suíte ficaria verde.
   É a lição #48 na forma exata: verde total convivendo com o número que decide a arquitetura.
3. **Havia uma SEGUNDA instância do funil.** `compendium/service.ts:469` constrói o próprio
   `new DocumentStore({ db })` sem `metrics` — e é o **único chamador de produção de
   `createBatch` que existe hoje**, ou seja, a justificativa central do desenho estava, em
   produção, exercitada só por teste. Provado por execução: banco registrou 3 escritas,
   coletor contou 1. O Mestre importando 12 criaturas no meio da sessão sumiria do relatório
   justamente no minuto de maior pressão.
4. **O flush podia derrubar o servidor.** `setInterval(() => this.flush())` sem try/catch, e
   `flush()` termina em `logger.info` sobre um destino `sync: true`. Os três elos foram
   provados por execução: sonic-boom lança sincronamente em escrita inválida, pino
   `multistream` propaga, e o processo morre com o stack apontando o timer. Disco do Mestre
   enchendo no sábado à noite = todos os jogadores caem no meio do combate. Uma métrica de
   diagnóstico havia ganhado poder que nenhum outro log do servidor tem.

O `record()` também saiu de **dentro** da transação: agora é bufferizado e drenado após o
commit. Isso mata duas coisas de uma vez — a escrita fantasma no relatório quando um lote dá
rollback, e o trabalho de serialização que estava acontecendo com o lock `IMMEDIATE` tomado.

**15 mutações aplicadas, 15 mortas**, harness com restauração verificada por SHA-256.

**O que o instrumento NÃO mede, e está dito na própria linha de log** (campo `scope`):
`writesPerMinute` é um **piso**, não um total. `SeqStore.next()` grava `settings` a cada
broadcast — para cada escrita contada existe pelo menos uma não contada disparada pela mesma
ação —, e `chat_messages`/`users` têm escritores em SQL cru. `delete`/`deleteBatch` seguem
fora por decisão. E `byPatchKey` nunca produz o balde `doorState`: `scene:doorState` persiste
com o patch `{ walls: [...] }`, então porta é indistinguível de geometria de parede — o
exemplo da §3 do desenho prometia uma separação que o código não pode entregar.

Falta só o que nenhum código produz: **uma sessão real de mesa**. O instrumento existe; os
números que ele foi aberto para gerar, não.

### Defeitos vivos achados no recon (T030–T033)

Nenhum destes era tarefa de ninguém — apareceram como efeito colateral dos recons de
T012/T013/T016/T025. Detalhe e evidência em `recon-fase-2.md`, seção "Defeitos vivos".

### T030 — Fechar o desvio de lote misto em `doc:update` (em andamento)

`packages/server/src/net/handlers/doc-handlers.ts:739` (roteamento `hasEmbedded`), `:1118`

Um lote com **uma** entry `embedded` desvia o LOTE INTEIRO para `handleEmbeddedUpdate`, que
descarta as entries primárias em silêncio (`if (!upd.embedded) continue`) devolvendo
`ack.ok=true` — mesmo que a entry primária tivesse `expectedVersion` grosseiramente
obsoleto. É o achado que faz o gate de T013 não valer para lotes mistos.

**Pronto quando:** um lote com entries primária + `embedded` aplica (ou recusa
explicitamente, nunca descarta em silêncio) cada entry pelo seu próprio caminho, com teste
que reproduz o `ack.ok=true`/entry-primária-ignorada de hoje e prova que deixou de
acontecer.

### T031 — Bloquear escrita de coleção embutida pelo caminho genérico de `doc:update` (em andamento)

`packages/server/src/net/handlers/doc-handlers.ts` (caminho `hasEmbedded=false`, guarda de
Scene ~linha 800)

O caminho genérico de `doc:update` sobre Scene só guarda o campo `active` (T010). Um
payload sem `embedded` grava `scene.tokens` livremente — token movido, `hidden` alterado,
token novo injetado —, fora de qualquer handler dedicado. Mesmo padrão do que T010 já fez
para `active`.

**A fuga não é só de Scene, e a irmã é pior.** `Actor.items` tem exatamente a mesma
abertura pelo mesmo caminho, e é a mais alcançável das duas: ser OWNER de uma Scene
significa GM na prática, enquanto **todo jogador é OWNER da própria ficha**. Reproduzido:
um `doc:update` de Actor com `items: [...]` substituiu a coleção inteira, apagando o que
havia e gravando um item de `type` inexistente — passando por cima de
`validateEmbeddedItemForSystem`, cuja própria docstring afirma ser "o único lugar que
valida Items embutidos". `Combat.combatants` fecha o terceiro caso do
`EMBEDDED_PARENT_MAP`. A guarda derivada do mapa cobre os três e cobre de graça qualquer
tipo embutido que venha a ser registrado.

**Recusa só o array.** É a única forma que chega ao banco por este caminho: qualquer outra
forma já morre depois, porque o `deepMerge` substitui o array pelo objeto e o documento
reprova na validação de schema. Recusar as outras trocaria uma rejeição por outra e
esconderia a T034.

**Pronto quando:** `doc:update` genérico (sem `embedded`) recusa a substituição em bloco de
`tokens`, `items` e `combatants`, com teste que reproduz a escrita indevida de hoje e prova
que passa a ser recusada — e com teste de que `doc:create` e o caminho `embedded` seguem
funcionando.

### T034 — `items.+` / `items.-<id>` não existem no servidor (toggle de condição quebrado) — em andamento

`packages/client/src/lib/sheets/pf2e/characterSheetVM.ts:2283-2313` ·
`packages/client/src/lib/sheets/pf2e/npcSheetVM.ts:517-540` ·
`packages/server/src/net/handlers/doc-handlers.ts` (`applyDotPathDiff`)

Marcar e desmarcar condição na ficha (PC e NPC) envia `doc:update` de Actor com
`diff: { "items.-<itemId>": true }` ou `diff: { "items.+": {...} }`. **O servidor não
implementa esses operadores.** `applyDotPathDiff` expande o caminho literalmente, virando
`{ items: { "-<itemId>": true } }`; o `deepMerge` substitui o array `items` por esse
objeto; a validação de schema reprova. Reproduzido por execução contra o handler real: as
duas formas voltam `VALIDATION_FAILED` e o documento fica intacto.

Ou seja: **o toggle de condição não funciona hoje**, nas duas fichas, para qualquer papel.
Nenhum teste cobre o caminho — foi por isso que passou. Achado de passagem no recon da
Fase 2; não é regressão desta leva, e a guarda de T031 foi escrita para não mascará-lo.

**Decisão fechada (recon de 2026-08-16): as duas fichas migram para o caminho `embedded`.**
Não implementar os operadores no servidor — fazê-los funcionar exigiria ensinar o caminho
genérico a mutar coleção embutida, duplicando o ownership, a validação de schema e a
re-derivação que `handleEmbeddedCreate/Update/Delete` já fazem. Duas semânticas para mexer
em `items[]` é a classe de bug que este repo já pagou.

O que sustenta a decisão, provado por execução:

- **O caminho `embedded` já funciona para exatamente este caso.**
  `embedded-item-actor.test.ts` passa 10/10 com um usuário `Role.PLAYER` puro, OWNER da
  própria ficha — criar, atualizar e apagar Item embutido, validado contra o schema do
  subtipo, com re-derivação do pai. É o cenário "jogador marca condição na própria ficha",
  já testado, hoje.
- **`toggleCondition` é a exceção no próprio arquivo.** Poucas centenas de linhas acima,
  `addInventoryItem`, `removeInventoryItem` e `toggleEquipItem` já usam `parent`/`embedded`
  corretamente. A correção é copiar o vizinho.
- **Quebrado desde que nasceu.** `git log -S "toggleCondition"` acha um único commit,
  `25ebf33` (26/06). Nunca funcionou.

Três coisas que o recon achou junto, e que mudam o tamanho da tarefa:

1. **Um segundo bug, mascarado pelo primeiro:** o payload monta `system: { value: null }`, e
   `ConditionSystemSchema` usa `z.number().int().min(1).optional()`, que aceita `undefined`
   e **recusa `null`**. Verificado por execução: `value: null` reprova, chave omitida passa.
   Trocar só o caminho de rede deixaria o "marcar" quebrado do mesmo jeito.
2. **Não existe UI para MARCAR condição.** Busca por qualquer picker em `packages/client/src`
   não acha nada: as duas fichas só têm o clique para remover um chip que já está lá. O ramo
   de adição é inalcançável — de rede e de tela. "Desmarcar" é o que dá para consertar sem
   UI nova.
3. **A checagem de imunidade (IWR) nunca foi ligada.** `systems/pf2e/src/actions/conditions-manager.ts`
   existe, é completo e é exportado — e `packages/server/src` não o importa em lugar nenhum.
   REQ-PF2-053 e DEC-PF2-07 estão na spec e não estão no código.

**Pronto quando:** desmarcar condição funciona na mesa pelo caminho `embedded`, com teste
que exercita o op que o VM produz (não um payload montado à mão), como PLAYER dono da ficha.
Marcar depende da UI da lacuna 2; a imunidade, da lacuna 3 — as duas são entregas próprias.

### T032 — Broadcast das escritas que bumpam `_stats.version` (em andamento)

`packages/server/src/etmos/reacao-handler.ts:254-277/351` (`applyEstresseCost`) ·
`packages/server/src/net/handlers/sync-handlers.ts:517/526-535` (cena ativa)

Essas duas escritas incrementam `_stats.version` do documento via `store.update`, mas só
emitem um evento próprio (`combat:updated`, `world:activeScene`) — nunca o `doc:update`
correspondente. O mirror do cliente fica com a versão antiga do documento para sempre,
sem gatilho de resync. Pré-requisito real de T013 para papel não-privilegiado (senão o
jogador afetado leva `STALE_WRITE` permanente na própria ficha).

**Pronto quando:** as duas escritas emitem `doc:update` do documento afetado, com teste
que prova que o mirror do cliente reflete a versão nova depois de cada uma.

**Fechamento parcial, declarado.** Estes dois pontos foram fechados; um terceiro, achado
na revisão, **não**: `store.update("combats", ...)` em `reacao-handler.ts:174` e `:366` e
em `combat/combat-handlers.ts:276` (`persistCombat`, o funil de toda mutação de combate)
incrementa a versão do Combat e emite só `combat:updated`, cujo payload é
`{combatId, diff, seq}` — **sem `_stats`**. Do lado do cliente,
`DocumentMirror._handleCombatUpdated` faz `{...existing, ...diff}`, então o
`_stats.version` local do Combat nunca avança. Combat está em `TYPE_TO_TABLE`, ou seja, é
gravável por `doc:update` com `expectedVersion` — o mesmo alvo da T013. Ver **T036**.

### T035 — Uma cena oculta é visível ou não? O código responde as duas coisas

`packages/server/src/net/handlers/sync-handlers.ts` (`buildSnapshot`, `filterOpsForRole`) ·
`packages/server/src/net/handlers/doc-handlers.ts` (`broadcastToWorld`)

O snapshot de entrada **filtra** cenas por `resolveOwnership(...) >= LIMITED`. Todo
broadcast ao vivo de Scene **não filtra**: redige token oculto e porta secreta, e entrega o
documento inteiro a qualquer socket. O replay do buffer de resync segue o broadcast.

Consequência prática: o que um jogador enxerga de uma cena depende de **quando** ele
conectou, não do que ele pode ver. Entrou agora, com a cena em `ownership.default = NONE`:
não recebe nada. Ficou conectado enquanto o GM mexeu num token dela: recebe o documento
inteiro. No mundo real em disco, **quatro das cinco cenas do `teste_xande` estão em
`default: 0`**, e a única em `default: 2` é a demo — então isso não é hipótese de borda, é
o estado da mesa.

Não dá para escolher um lado dentro de um conserto de outra coisa: apertar quebra a mesa
(jogador para de ver o mapa que hoje vê), afrouxar oficializa o vazamento. É decisão de
produto, e é irmã da T025 — quem decidir aqui decide metade do desenho de lá.

**Pronto quando:** existe UMA regra de visibilidade de cena, aplicada igualmente no
snapshot, no broadcast ao vivo e no replay do buffer, com teste que prova a paridade entre
os três caminhos. Se a resposta for "jogador vê a cena", o `buildSnapshot` afrouxa; se for
"não vê", o broadcast e o replay apertam **e** o fluxo de revelar cena passa a existir.

### T036 — Escritas de Combat também bumpam versão sem `doc:update`

`packages/server/src/combat/combat-handlers.ts:276` (`persistCombat`) ·
`packages/server/src/etmos/reacao-handler.ts:174` e `:366`

Mesmo defeito da T032, tabela diferente, achado na revisão dela. `combat:updated` carrega
`{combatId, diff, seq}` e nunca `_stats`, e o cliente faz merge raso — o `_stats.version`
local do Combat fica parado em 1 para sempre. Não foi consertado junto porque mexer no
formato de `combat:updated` (ou somar um `doc:update` a cada mutação de combate) é mudança
de protocolo com efeito em toda a UI de combate, e merecia caber num PR próprio.

**Pronto quando:** o mirror do cliente reflete a versão nova do Combat depois de qualquer
mutação, com teste; ou a decisão de que Combat não participa do controle otimista fica
escrita, e a T013 exclui a tabela explicitamente.

### T033 — Log diário passa a rotacionar por horário local (em andamento)

`packages/server/src/logger.ts:25-28` (`dailyLogFilePath`), `:42-46`
(`tryCreateFileDestination`), `:87` (chamada única em `createLogger`)

O nome do arquivo é calculado **uma vez**, com `Date.toISOString().slice(0,10)` (UTC), e
fica congelado pela vida do processo — servidor que atravessa meia-noite UTC (21h no fuso
local, UTC-3) continua escrevendo no arquivo do dia anterior. Reproduzido no log real da
máquina (`fusion-2026-08-15.log` com linhas de duas datas UTC distintas). Bloqueia o
"Pronto quando" de T016 (relatório de sessão real no log do dia).

**Pronto quando:** uma sessão que atravessa meia-noite (local ou UTC) produz um arquivo de
log por dia local, sem perder linhas nem duplicar.

---

## Fase 4 — Retenção e manutenção (antes da 3: barata e de efeito imediato)

### T017 — GC no boot (D5) — em andamento

`packages/server/src/auth/session-store.ts` (não existe um `DELETE` hoje) · roll-service · config

Sessões expiradas há mais de 30 dias e auditoria com mais de 12 meses saem no boot, com os
limites configuráveis. **Chat não é tocado.**

**Pronto quando:** teste com dados sintéticos velhos prova o que sai e o que fica; log diz
quantas linhas foram removidas.

### T018 [P] — Manutenção do arquivo (em andamento — um dos três itens virou decisão sua)

`PRAGMA optimize` no fechamento, `ANALYZE` periódico, vacuum incremental depois de GC grande.
Nenhum dos três existe no código hoje.

**Dos três itens do enunciado, só um sobreviveu à verificação.**

**1. `PRAGMA optimize` no fechamento — feito.** Roda no `close()` de cada sessão de mundo e
depois de um GC que removeu linhas. Vem com `analysis_limit=400`: o `optimize` é auto-limitado
em _quais_ tabelas analisa, não em _quanto_ de cada uma, e o default `analysis_limit=0` significa
"sem limite". Medido num `chat_messages` de 1 milhão de linhas com cache frio: **2,8 s** sem o
limite contra **~120 ms** com ele. Essa diferença cairia inteira no momento em que você fecha o
app — e `chat_messages` é justamente a tabela que D5 garante que cresce para sempre.

**2. `ANALYZE` periódico — recusado, com evidência.** É redundante com o item 1: desde o SQLite
3.46 a própria documentação chama o `PRAGMA optimize` de "a forma recomendada de rodar ANALYZE".
Manter os dois seria a mesma atualização de estatística rodando duas vezes, com uma agenda extra
para manter em sincronia. A conexão do Fusion é exatamente o caso "conexão de vida curta" que a
documentação diz ser coberto pelo item 1 sozinho.

**3. Vacuum incremental — bloqueado, e a decisão é sua.** `PRAGMA incremental_vacuum` só faz
alguma coisa com `auto_vacuum = INCREMENTAL`. Verificado por execução: tanto uma cópia do
`teste_xande` real quanto um banco recém-criado pelas migrations reportam `auto_vacuum = 0`
(NONE, o default do SQLite) — nenhuma das oito migrations o define. Chamar o pragma hoje é
no-op documentado.

O problema que ele resolveria é real e foi medido: num banco de 126 MB, apagar 90% das linhas
deixou o arquivo em 125,9 MB, com 28.336 páginas na freelist. Depois de um GC grande, o espaço
não volta.

Ligar não é adição pequena: o SQLite só aceita mudar `auto_vacuum` num banco **sem tabelas**, então
habilitar nos mundos existentes exige um `VACUUM` completo — reescrita bloqueante do arquivo
inteiro —, e habilitar só nos mundos novos deixaria todo mundo existente sem recuperar espaço
para sempre. **As duas opções:** (a) pagar uma reescrita completa uma vez, em cada mundo que já
existe; (b) aceitar o crescimento do arquivo como um dos custos de "chat nunca é apagado
sozinho" (D5). Nenhuma das duas é escolha de implementação.

### T019 — Arquivamento manual de chat — em andamento

Comando de CLI que exporta um intervalo e só então remove, sob confirmação explícita.
Chat só sai por ordem sua (D5).

Entregue como `fusion chat archive`. A confirmação **não** é um `--yes`: é
`--confirm-delete-count N`, e N tem que bater com a contagem do intervalo naquela execução —
o número vem da prévia, que é o comportamento padrão do comando. Isso não se digita por acidente.

A ordem é exportar, fechar, reler do disco, conferir campo a campo, e só então apagar. O apagamento
casa `id`, `updated_at` **e** `data`: uma mensagem editada depois do instantâneo que alimentou a
exportação simplesmente não é removida, em vez de ser arquivada numa versão e apagada em outra. Se a
exportação falhar em qualquer ponto — inclusive depois do arquivo aberto —, o parcial é removido e
nada sai do banco. E o comando recusa rodar num mundo com `world.lock` vivo, com a mesma checagem que
o `world delete` já usa.

---

## Fase 3 — Assets como cidadãos de primeira classe

### T020 — Tabela `assets` (em andamento)

Nova migration: nome, hash do conteúdo, bytes, mime, quem subiu, quando.

**A migration é a 009, não a 008.** O enunciado dizia `008_assets.ts`, mas a 008 já existe
(`008_scene_active`, entregue na Fase 1). Uma migration com número já usado seria **pulada em
silêncio** por `applyMigrations` — exatamente o defeito que a guarda de schema da Fase 0 existe
para impedir.

`name` é a chave primária, não `digest`: o nome já é content-addressed e a dedup do upload
garante um arquivo por digest em disco antes do INSERT. `digest` fica indexado, mas **não**
único — fingir unicidade ali seria prometer uma garantia que a varredura por prefixo de 8 hex
não dá.

### T021 — Registro no upload (em andamento)

`packages/server/src/assets/routes.ts` grava a linha ao aceitar o arquivo.

Falha de registro **não** vira erro HTTP: o arquivo já está em disco e é servível, então
reportar erro ali seria pior que a lacuna — que é a mesma em que todo asset pré-existente já
começa, e que a T022 fecha.

**No ramo de dedup, o metadado vem do arquivo em disco, nunca do upload que casou com ele.**
`findExistingByDigest` casa por um trecho de 8 hex **dentro** do nome: 32 bits, e substring, não
sufixo. Um casamento é indício de duplicata, não prova de que os bytes são iguais — descrever o
arquivo guardado com o digest, o tamanho e o mime do arquivo recebido seria gravar uma mentira
plausível no registro, e o upsert sobrescreveria uma linha que estava certa.

`uploaded_by` e `created_at` são preservados no re-registro: os dois respondem "quem pôs esse
arquivo aqui, e quando", e nenhum dos dois muda porque alguém reenviou os mesmos bytes.

### T022 — Reconciliação

Novo `packages/server/src/assets/reconcile.ts` + comando de CLI. Varre o diretório e os
documentos procurando o **padrão de caminho** dentro do JSON — genérico de propósito, sem
lista fixa de campos ("token usa `texture`", "cena usa `background`"), que é justamente o
que vai mudar quando token/ficha forem redefinidos.

**Pronto quando:** relatório lista órfãos (arquivo sem referência) e quebrados (referência
sem arquivo) num mundo real.

### T023 — GC de órfãos

Remoção só depois do relatório e com confirmação. Nunca automática.

### T024 — Backup do mundo inclui assets (D4) — em andamento

`packages/server/src/worlds/world-manager.ts` (`backup`, `backupPreUpdate`, restauração)

Hoje todo backup automático copia só o `world.db` — restaurar traz o banco com caminhos
apontando para arquivos que podem não existir. Copiar por hash: arquivo já presente no
repositório de backup não é copiado de novo.

**Pronto quando:** backup → apaga assets → restaura → todas as referências resolvem.

Entregue como repositório de blobs endereçado por conteúdo + manifesto por backup. Quatro coisas
que a revisão obrigou a mudar, e que valem para quem mexer aqui depois:

1. **O caminho de assets é assíncrono.** `backup()` é async e usa a API de backup online do
   SQLite justamente para não travar o servidor com o mundo aberto; uma cópia de assets síncrona
   desfazia essa garantia. Medido com um asset de 80 MB: a versão síncrona serviu **zero** ticks
   do event loop durante toda a operação; a assíncrona serve ~90% dos ticks esperados. O hash é
   calculado em streaming — um áudio de centenas de MB não pode virar um Buffer só para ser
   hasheado.
2. **Restaurar valida antes de tocar no banco.** A troca do `world.db` acontecia antes de
   conferir os blobs, então um blob faltando deixava o mundo num estado que não é nem o antes nem
   o depois: banco novo, `assets/` vazio. Agora a varredura de existência roda primeiro, e falha
   não altera nada — nem o banco, nem os assets, nem cria backup pré-restauração.
3. **Manifesto corrompido grita.** Antes, o JSON inválido era engolido e a restauração devolvia o
   banco **sem** os assets, em silêncio — literalmente o pior resultado do enunciado. Hoje se
   distingue "este backup não tem manifesto" (legítimo, backups anteriores a esta mudança) de
   "tem e está corrompido" (aborta antes de tocar no banco).
4. **Existe caminho de produto:** `fusion world restore <slug> --backup <arquivo>`. Prévia por
   padrão, recusa com `world.lock` vivo, e exige `--confirm-restore` repetindo o nome do arquivo.
   Funcionalidade que só o vitest alcança não conta como entregue.

### T025 — SEGURANÇA: autorização por documento na rota de assets

`packages/server/src/assets/routes.ts:409` (`GET /assets/*`) · `assets/asset-token.ts`

Hoje a rota serve **qualquer arquivo do mundo a qualquer usuário autenticado** (role ≥
PLAYER). Não há consulta ao `ownership` do documento que referencia o arquivo. O que protege
um mapa não revelado é o nome ter 8 hex de hash do conteúdo — capability URL, não permissão;
e assets semeados por script (ex.: `taverna-demo.jpg`) não têm nem isso.
**Vulnerabilidade reproduzida por execução** (recon-fase-2.md): um PLAYER comum recebeu
`HTTP 200` com os bytes de um asset referenciado só por uma Scene oculta.

**Desenho novo exigido (recon-fase-2.md — DERRUBA):** o gate proposto
(`JSON.stringify(doc).includes(path)`, amarrando o token ao documento que o requisitante
apresenta) é **contornável pelo próprio atacante** — o jogador escolhe o documento e, em
pelo menos um caso real (`Actor.img`, string livre sem validação), o conteúdo dele; basta
gravar o path do asset secreto no próprio Actor para passar o gate. Além disso: (1) HMAC
e `includes()` exigiriam representações diferentes do mesmo path (uma percent-decodificada
sem prefixo, outra percent-codificada com `/assets/`) — quebra garantida com qualquer
nome de arquivo com caractere especial; (2) `region_maps` não está na allowlist
`DOCUMENT_TABLES` reaproveitada, então o único asset do mundo real citado como motivação
(`taverna-demo.jpg`, via `region_maps`) não pode ser autorizado por esse desenho. Quem
retomar precisa de uma prova de posse que o requisitante não controle sozinho, uma
representação única do path, e também decidir: as 5 tabelas de documento sem `ownership`
(`users`, `folders`, `chat_messages`, `combats`, `settings` — não só `combats`), a história
para asset **órfão** (sem documento algum referenciando — 25% dos arquivos do único mundo
real disponível), e a janela de debounce entre escolha otimista no cliente e persistência
no servidor.

**Segunda rodada de desenho: também DERRUBADA (2026-08-16).** A proposta era "um asset herda
a permissão mais restritiva entre os documentos que o referenciam" — que sobrevive ao ataque
que matou a primeira, mas caiu em três pontos novos, todos reproduzidos por execução:

1. **O mínimo não roda sobre o arquivo, roda sobre uma chave de string que o atacante
   escolhe.** O jogador grava o caminho secreto no próprio Actor com uma barra a mais
   (`/assets//mapa.png`); a canonicalização produz uma chave diferente da que a cena oculta
   gerou, então o balde do mínimo passa a conter só o documento dele — e o `path.normalize`
   da rota serve exatamente os mesmos bytes. Na máquina real (Windows) trocar a caixa de uma
   letra tem o mesmo efeito. É o mesmo defeito da primeira rodada com outra roupa: o gate
   volta a ler um dado que o atacante escreve.
2. **O fail-closed ficou invertido.** As três saídas foram ordenadas ao contrário —
   referenciado por documento oculto = negado; sem `ownership` resolvível = ASSISTANT_GM;
   **órfão = TRUSTED**. Como qualquer grafia fora da canônica cai fora do índice e vira
   "órfão", toda grafia torta é uma escada para baixo até o ramo mais permissivo. Menos
   informação tem que dar menos acesso, não mais.
3. **Amarrar o token ao caminho quebra o `FilePicker`.** Ele minta **um** token ao abrir e
   reusa em todas as miniaturas do grid; com HMAC por caminho, o grid inteiro vira 401 — e é
   a tela em que o GM escolhe mapa e retrato.

Restrições que a terceira rodada herda, além das anteriores: `settings` tem escrita crua por
`INSERT OR REPLACE` (fora do `DocumentStore`, então um hook no store não cobre); `ownership` é
campo **gravável** do próprio documento e o store não o valida, então o jogador pode publicar
um asset órfão para a mesa inteira setando `ownership.default = 2` na própria ficha; e o custo
a medir é o número de emissões de token **por tela** (hoje `resolveAssetUrl` minta uma por
imagem renderizada), não o custo de resolver ownership uma vez.

PR próprio, fora das migrations. Pode subir de prioridade para logo depois da Fase 0 se o
risco na mesa incomodar.

---

## Fase 5 — Higiene (sem pressa, sem risco)

Rodada de verificação em 2026-08-16. **Nenhuma migration nova nesta rodada** — os quatro
itens, um a um, acabaram exigindo mudança de código fora dos arquivos desta leva
(`chat/roll-service.ts`, `shared/src/document.ts` + `shared/src/chat/types.ts`,
`admin/lockout-db.ts`, `worlds/world-manager.ts`), nunca só a migration. O que sobreviveu
foi o diagnóstico — com patch exato pronto pra quem pegar cada arquivo — e, onde dava para
provar algo sem tocar em arquivo alheio, um teste. `docs/design/banco-de-dados/tasks.md` e
`__tests__/db-hygiene.test.ts` (novo, 1 caso, verde) são as únicas mudanças desta rodada.

### T026 — dois campos, dois vereditos diferentes

**Metade `roll_audit_log.world_id`: morta, mas a remoção não é só migration.**
Varredura completa de leituras: `chat/roll-service.ts:89-105` (`persistAudit`) é o único
escritor, e nenhum caminho de produção faz `SELECT` filtrando por `world_id` — o único
`WHERE world_id = ?` do repo é um helper de teste
(`__tests__/npc-import-initiative.test.ts:204-209`), que funcionaria igual filtrando só por
`actor_id` já que o banco é de um mundo só (D2). A coluna é peso morto.

Mas dropá-la exige tocar em `roll-service.ts`, fora desta leva: a query de INSERT lista as
9 colunas por posição, então uma migration que remove `world_id` sem esse ajuste quebra
**toda rolagem de dado** no primeiro boot (`no such column: world_id`). Patch exato, não
aplicado:

```ts
// packages/server/src/chat/roll-service.ts
// 1. persistAudit(): remover a coluna e o bind
   db.prepare(`
     INSERT INTO roll_audit_log
-      (roll_id, world_id, user_id, actor_id, formula, expanded_formula, total, seed, created_at)
-    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
+      (roll_id, user_id, actor_id, formula, expanded_formula, total, seed, created_at)
+    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   `).run(
     entry.rollId,
-    entry.worldId,
     entry.userId,
     ...
   );
// 2. remover `worldId` do parâmetro de `persistAudit` e do destructuring em `roll()`
//    (RollRequest.worldId pode continuar existindo — chat-handler.ts ainda o envia —
//    só deixa de ser lido aqui).
```

Migration companion (viraria a `010`, não escrita — depende do patch acima ir junto):
`DROP INDEX idx_roll_audit_world_user` (nenhuma query real usa esse índice — nem o
`WHERE world_id = ? AND actor_id = ?` do teste acima, que não tem `actor_id` na chave) →
recriar tabela sem `world_id` (SQLite exige recriação para `DROP COLUMN` quando há índice
cobrindo a coluna) → `CREATE INDEX idx_roll_audit_user ON roll_audit_log(user_id, created_at)`
se algum caminho real vier a precisar (hoje nenhum precisa).

**Metade `chat_messages.data.worldId`: recusada, sem patch.** `ChatMessageSchema.worldId`
(`shared/src/chat/types.ts:470`) é campo **obrigatório** do schema, escrito em toda
mensagem por `buildBaseMessage` (`chat/chat-handler.ts:1315-1341`) e comparado em 5 pontos
do mesmo arquivo (`payload.worldId !== deps.worldId`, linhas 437/687/809/929/1106) como
guarda anti-cliente-obsoleto — real, ativo, não é sobra. Os três arquivos que uma remoção
tocaria (`chat-handler.ts`, `protocol.ts`, `types.ts`) são exatamente os que o orquestrador
marcou como **de outro agente, em edição agora, sem commit** (spec 38, Aba Chat). Mexer
neles seria colisão direta, e o campo em si não é dead code — é a request-side guard que
está viva. Não proponho patch: o destino desse campo é de quem é dono da spec 38, não desta
rodada de higiene.

### T027 — `settings` duplicando a chave: é desenho, não migration

Confirmado por leitura: `SettingSchema` (`shared/src/document.ts` via
`documents/types.ts:260-263`) estende `BaseDocumentSchema`, herdando
`_id: z.string().regex(/^[A-Za-z0-9]{16}$/)` — 16 chars alfanuméricos, sem `:`. É por isso
que `net/seq-store.ts` (`_meta:worldSeq`) e `net/handlers/sync-handlers.ts`
(`_meta:activeScene`) **não podem** passar por `DocumentStore` e escrevem SQL cru
(`INSERT OR REPLACE INTO settings...`) cada um com sua própria cópia do upsert, cada um
gravando a chave duas vezes (`id` = chave, e a mesma chave de novo dentro de `data`).

**Não há mudança de schema SQL aqui** — a tabela `settings` (`id`, `data`, `created_at`,
`updated_at`) já comporta o que qualquer uma das opções abaixo precisa; o gap é só na
camada de validação/aplicação, em arquivos fora desta leva. Duas direções, sem eu escolher
por quem não pediu escolha:

- **Opção A** — `SettingSchema` ganha seu próprio `_id` (`.extend({ _id: z.string().min(1) })`,
  sobrescrevendo o regex herdado), e as duas chaves `_meta:*` passam a nascer por
  `store.create("settings", { _id: key, key, value })` como qualquer outro documento — some
  a duplicação e as duas cópias de SQL cru. Maior: muda uma validação compartilhada por
  todo tipo de documento (mesmo escopo, `_id` diferente só para Setting) e pede teste de
  regressão para os dois call sites.
- **Opção B** — mantém o desvio por SQL cru (não mexe no invariante de `_id` de mais
  ninguém), mas fatora o upsert duplicado num helper único (ex.: `MetaSettingsStore`)
  usado por `seq-store.ts` e `sync-handlers.ts`, e para de gravar a chave dentro de `data`
  (só `value`/`seq` precisam ficar lá — `id` já é a chave). Menor, mas o `:` no `id`
  continua sendo convenção não validada, não invariante.

Nenhuma das duas é "higiene sem risco" — são decisão de arquitetura sobre um contrato
compartilhado (`BaseDocumentSchema`) ou sobre o caminho de escrita de settings. Registro
aqui para quem for desenhar, sem migration associada.

### T028 — `login_attempts` duplicado: verificado, e não é o bug que parecia

**Não são duas definições da mesma coisa — são dois arquivos `.sqlite` diferentes, de
propósito.** `admin/lockout-db.ts:1-28` já documenta o motivo: o admin plane
(`/admin/*`) não tem `world.db` (não há mundo aberto nessa rota), e amarrar seu contador de
lockout ao framework de migrations de mundo corromperia a sequência de versão de **todo**
mundo (`registerMigrations` é singleton global). A saída deliberada foi abrir um sqlite
standalone (`Config/admin-lockout.sqlite`) fora do framework de migration, com o mesmo
shape de tabela. Duas bases, um propósito cada, DDL replicado por necessidade — não por
descuido.

Comparado byte a byte (SQL normalizado como a guarda de schema faz — espaço em volta de
`(`, `)`, `,`): **idêntico**, tabela e índice. Verificado por execução, não por leitura —
`__tests__/db-hygiene.test.ts` builda um `world.db` real via `applyMigrations` (as 9
migrations registradas) e um `admin-lockout.sqlite` real via `openAdminLockoutDb()`, lê o
`sqlite_master` das duas e compara. Verde hoje.

**"Unificar" não é migration.** Migrations só valem dentro de `world.db`; o arquivo do
admin plane é deliberadamente fora do framework (motivo acima), então não há update
mecânico que alcance as duas ao mesmo tempo. E `migration002` é história congelada (lição
da Fase 1: mudar o DDL de uma migration já aplicada quebra todo mundo existente no boot) —
mesmo que fosse migration, não seria ali que se mexe.

O que dá pra fazer, e que não fiz por ficar fora desta leva (`admin/lockout-db.ts` não é
meu arquivo): extrair a DDL para uma constante compartilhada, importada pelos dois lados —
elimina a duplicação **textual** sem mudar o schema de nenhum dos dois bancos (a guarda de
schema normaliza espaço, então trocar "onde a string mora" não muda o DDL resultante — é
seguro tocar até em `migration002` para isso). Patch exato, não aplicado:

```ts
// packages/server/src/db/login-attempts-ddl.ts (novo)
export const LOGIN_ATTEMPTS_DDL = `
  CREATE TABLE IF NOT EXISTS login_attempts (
    id          TEXT    PRIMARY KEY NOT NULL,
    user_id     TEXT    NOT NULL,
    ip          TEXT    NOT NULL,
    attempted_at INTEGER NOT NULL,
    success     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_login_attempts_user_ip
    ON login_attempts(user_id, ip, attempted_at);
`;

// migrations/002_users_sessions.ts — troca o literal inline por:
db.exec(LOGIN_ATTEMPTS_DDL);

// admin/lockout-db.ts:56-67 — mesma troca
db.raw.exec(LOGIN_ATTEMPTS_DDL);
```

Até essa extração acontecer, `db-hygiene.test.ts` é a rede de segurança: se um dos dois
lados divergir do outro no futuro, o teste — que lê as duas fontes reais, não uma cópia
digitada à mão — acusa antes de virar bug de lockout em produção.

**Pronto quando:** as duas definições vêm da mesma constante (ou o teste acima segue verde
provando que não divergiram) — hoje o segundo já é verdade.
→ `db-hygiene.test.ts`, 1 caso: `applyMigrations` real + `openAdminLockoutDb()` real,
`sqlite_master` comparado tabela e índice.

### T029 — `world.json.schemaVersion`: bug real, patch pronto, fora do meu arquivo

Confirmado por execução: `WorldManager.create()` (`worlds/world-manager.ts:373`) grava
`schemaVersion: 1` **hardcoded**, não o que `applyMigrations` acabou de produzir (hoje
seria 9). `open()` (mesma classe, ~linha 496-500) atualiza `lastOpenedAt` e `fusionVersion`
no manifesto depois de rodar `applyMigrations` — mas nunca `schemaVersion`. Resultado: todo
`world.json` deste repo mostra `schemaVersion: 1` para sempre, banco em v9 incluído.

Varredura de leitores: um único ponto lê o campo em produção —
`cli/commands/worlds.ts:107`, a coluna `schemaVersion` de `fusion worlds list`. Puramente
informativo para o humano; nenhuma lógica decide nada com base nele. Não há schema SQL
envolvido — `world.json` é um arquivo irmão do banco, não parte dele — então **não há
migration nenhuma para este item, em nenhum cenário**: é 100% código de aplicação, em
`world-manager.ts`, fora dos arquivos desta leva.

Dos quatro itens da Fase 5, este é o mais simples de fechar — sem ambiguidade de desenho,
só reflete o que `getSchemaVersion()` (já exportado por `db/index.ts`) diz. Patch exato,
não aplicado:

```ts
// packages/server/src/worlds/world-manager.ts
// create(): antes do fusionDb.close(), capturar a versão real
    applyMigrations(fusionDb.raw, dbFilePath, { force: this.forceSchema });
+   const appliedSchemaVersion = getSchemaVersion(fusionDb.raw);
  } finally {
    fusionDb.close();
  }
  ...
-   schemaVersion: 1,
+   schemaVersion: appliedSchemaVersion,

// open(): junto da atualização de fusionVersion, já depois de applyMigrations()
    const manifest = readManifest(this.dataDir, slug);
    manifest.lastOpenedAt = new Date().toISOString();
    manifest.fusionVersion = FUSION_VERSION;
+   manifest.schemaVersion = getSchemaVersion(fusionDb.raw);
    writeManifest(this.dataDir, slug, manifest);

// import: getSchemaVersion já é export público de ../db/index.js
```

**Pronto quando:** um mundo criado e reaberto por várias sessões (cada uma com migrations
novas) mostra em `world.json.schemaVersion` o mesmo número que `fusion worlds list` e que
`PRAGMA user_version`/`schema_migrations` reportam no banco — não fiz esse teste por não
poder tocar em `world-manager.ts` nesta leva.

---

## Adiado com gatilho explícito

| Item                                                  | Por que espera                                                                                                                                             | Destrava quando                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Forma do estado quente (token na cena, HP na ficha)   | Não existe spec de Token — o conceito está espalhado por 12 specs (103 menções na 06, 75 na 07). Decidir DDL sobre conceito indefinido é congelar o errado | Spec de Token existir **e** os números de T016 estarem na mão |
| Colunas geradas (`json_extract`) + índices sobre JSON | Com mundo enxuto (D2), pode nunca doer. E são descartáveis: se o campo mudar de lugar, muda-se a expressão do índice, sem migrar dado                      | Uma consulta real ficar lenta                                 |
| Snapshot magro com carga sob demanda                  | Idem — o cenário que justificava era "492 monstros importados no mundo", descartado por D2                                                                 | O mundo passar de alguns milhares de documentos               |

---

## Mapa de PRs

| PR  | Conteúdo                                                                                                                                      | Depende de                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Fase 0 (T001–T006) ✅                                                                                                                         | —                                      |
| 2   | Fase 1 (T007–T011) ✅                                                                                                                         | PR 1                                   |
| 3   | T012, T014, T015, T030, T031                                                                                                                  | PR 2                                   |
| 3b  | T013 (depende de T030 e T032)                                                                                                                 | PR 3                                   |
| 3c  | T016 (desenho novo) + T033                                                                                                                    | PR 3                                   |
| 4   | Fase 4 (T017–T019)                                                                                                                            | PR 2                                   |
| 5   | Fase 3 dados (T020–T024)                                                                                                                      | PR 2                                   |
| 6   | T025 (desenho novo)                                                                                                                           | independente — pode vir logo após PR 1 |
| 7   | Fase 5 (T026–T029) — verificada 2026-08-16, sem migration; 4 patches de app-code documentados, nenhum aplicado (fora dos arquivos desta leva) | PR 2                                   |
| 8   | T032, T033 (defeitos vivos)                                                                                                                   | PR 3                                   |
| —   | T034, T035, T036                                                                                                                              | independentes, sem migration           |

A Fase 2 rachou em três PRs porque o recon mostrou que T013 e T016 não estavam prontas
para implementação: T013 depende de dois consertos que ela não previa (T030, T032) e T016
perdeu o desenho. O que estava maduro sai no PR 3; o resto espera desenho, não pressa.

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
| novo (recon fase 2): lote misto de `doc:update` engole entries primárias em silêncio                                                                                  | T030                               |
| novo (recon fase 2): caminho genérico de `doc:update` grava `scene.tokens` sem guarda                                                                                 | T031                               |
| novo (recon fase 2): escritas que bumpam `_stats.version` sem `doc:update` (mirror atrasado)                                                                          | T032                               |
| novo (recon fase 2): log diário não rotaciona (data UTC congelada)                                                                                                    | T033                               |
