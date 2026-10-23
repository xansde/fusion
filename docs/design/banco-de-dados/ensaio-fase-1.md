# Ensaio da Fase 1 — migrations 005→008 sobre o mundo real (T011)

Data: 2026-08-16 · Mundo: `teste_xande` (o que serve na 33000) · Base: `alfa/app`

Os testes automatizados provam o comportamento das migrations em bancos que eles
mesmos constroem. Este ensaio prova outra coisa: que elas atravessam **o mundo que
existe** — com 29 sessões, uma tabela que nasceu fora das migrations e uma cena ativa
gravada em dois lugares.

## Como a cópia foi feita

`VACUUM INTO` a partir de uma conexão **readonly** sobre `~/.fusion/worlds/teste_xande/world.db`.
Nada foi escrito no mundo original em nenhum momento.

No instante do ensaio o mundo tinha `world.db-wal` de ~1 MB, mais recente que o `.db`, e
`world.lock` presente — ou seja, escritas commitadas ainda não consolidadas e possivelmente
um servidor com o mundo aberto. É exatamente o estado que o backup da Fase 0 foi desenhado
para capturar, e a cópia saiu íntegra (`PRAGMA integrity_check` = `ok`).

## Resultado

|                                  |                            |
| -------------------------------- | -------------------------- |
| Versão antes → depois            | **4 → 8**                  |
| Tempo das quatro migrations      | **40 ms**                  |
| `PRAGMA integrity_check`         | `ok`                       |
| `PRAGMA foreign_key_check`       | nenhuma violação           |
| Guarda de schema (`checkSchema`) | `ok: true`, zero problemas |

## Contagens — antes e depois

Nenhuma linha entrou, saiu ou mudou de tabela. A única contagem que muda é
`schema_migrations`, que é o registro do próprio ensaio.

| Tabela            |  Antes | Depois |
| ----------------- | -----: | -----: |
| actors            |      1 |      1 |
| chat_messages     |      5 |      5 |
| combats           |      2 |      2 |
| fog_exploration   |      0 |      0 |
| folders           |      0 |      0 |
| items             |      0 |      0 |
| journal_entries   |      3 |      3 |
| login_attempts    |      0 |      0 |
| macros            |      0 |      0 |
| playlists         |      0 |      0 |
| region_maps       |      2 |      2 |
| roll_audit_log    |      2 |      2 |
| roll_tables       |      0 |      0 |
| scenes            |      5 |      5 |
| **sessions**      | **29** | **29** |
| settings          |      2 |      2 |
| users             |      2 |      2 |
| schema_migrations |      4 |  **8** |

As 29 sessões são o número que importa: é sobre elas que a recriação de `users` falharia se
a migration 006 tivesse seguido o texto do plano (remover a tabela pai antes da filha, com
`foreign_keys` que não desliga dentro de transação).

## Documentos conferidos um a um

| O quê                   | Antes                                                        | Depois               |
| ----------------------- | ------------------------------------------------------------ | -------------------- |
| Usuários                | `Gamemaster` (role 4, active 1), `Tobias` (role 1, active 1) | idênticos            |
| Cenas                   | 5, incluindo `aha` e `Vale de Godford (demo)`                | mesmos 5 ids e nomes |
| Cena ativa (`settings`) | `Ifau3CIXklXVgocW`                                           | `Ifau3CIXklXVgocW`   |
| Mapas de região         | `A Taverna do Javali`, `Novo mapa`                           | idênticos            |
| Diários                 | `Cães da Estrada`, `O Sino que Não Toca`, `teste`            | idênticos            |
| Ator                    | `Novo Ator` (character)                                      | idêntico             |
| Auditoria de rolagem    | `1d20+5` → 11, `1d20` → 4                                    | idênticos            |

## Mudanças de schema

**Índices removidos:** `idx_chat_timestamp`, `idx_scenes_active`, `idx_scenes_nav`
**Índices criados:** `idx_chat_ts_id`, `idx_users_name_nocase`

**`scenes`** perdeu a coluna `active` (as demais intactas: `id`, `data`, `name`,
`navigation`, `folder_id`, `sort`, `created_at`, `updated_at`).

**`users`** foi recriada com CHECKs e índice único, e saiu com **exatamente as mesmas
colunas, na mesma ordem** de antes — inclusive as cinco que a migration 002 tinha
adicionado por `ALTER TABLE`.

## Consulta real, dado real

O plano da primeira página do histórico de chat, na cópia migrada:

```
SCAN chat_messages USING INDEX idx_chat_ts_id
```

Sem passo de ordenação: o índice já entrega na ordem que a paginação pede.

## Como reproduzir

`scratchpad/ensaio-fase-1/rehearse.mjs` (fora da árvore do git, junto com a cópia e o
`resultado.json` bruto). Ele importa o código real de `packages/server/dist/db/index.js` —
não reimplementa nada — e imprime o JSON de onde esta tabela saiu.
