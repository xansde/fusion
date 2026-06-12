# Fusion — Build Log

> Log da construção autônoma do app (iniciada em 2026-06-12, branch `build/app`).
> Método: batch-gated development — cada batch implementado por agentes, integrado (build+testes verdes) e auditado por Opus com gate ≥ 95%. `main` permanece intacta nas specs; tudo aqui é reversível por git.

## Plano de execução

Caminho crítico do roadmap (`specs/27-roadmap-e-milestones.md`): **M0 → M1 → M2 → M3** (primeira sessão jogável), depois M4/M5/M6 se houver tempo.

| Batch | Conteúdo                                                                        | Status       | Score auditoria |
| ----- | ------------------------------------------------------------------------------- | ------------ | --------------- |
| M0-A  | Scaffold monorepo, shared, system-api, stub system, server/client skeletons, CI | concluído    | 96              |
| M0-B  | SQLite/WAL, migrations, world lifecycle, Document model + CRUD, CLI             | em andamento | —               |
| M0-C  | Fastify boot, socket.io handshake/envelope, auth (Argon2id/JWT), contract tests | pendente     | —               |
| M1-A  | Canvas PIXI v8, grade square, render groups                                     | pendente     | —               |
| M1-B  | Scene/Token embedded, CRUD broadcast, snapshot+resync, reconexão                | pendente     | —               |
| M1-C  | Tokens no canvas (drag, animação, barras), ownership no servidor                | pendente     | —               |
| M1-D  | Motor de rolagens (RNG servidor, roll modes, inline), chat + cards              | pendente     | —               |
| M1-E  | Assets (upload/serving), presença (cursores, ping, ruler), DoD M1               | pendente     | —               |
| M2-A  | Walls + portas, visibility polygon, luzes                                       | pendente     | —               |
| M2-B  | Fog of war (3 estados, persistência, Clipper2), broadcast de delta              | pendente     | —               |
| M2-C  | Combat/Combatant, tracker, InitiativeFormula, hooks de turno                    | pendente     | —               |
| M3-A  | System API completa (derivação topológica, motor de effects MVP)                | pendente     | —               |
| M3-B  | engine-2e (DoS, stacking, TEML, MAP, IWR, dying/wounded)                        | pendente     | —               |
| M3-C  | PF2e schemas + automação (strikes, saves, condições, spellcasting)              | pendente     | —               |
| M3-D  | UI framework (window manager, sheets, TipTap) + fichas PF2e                     | pendente     | —               |
| M3-E  | Importer pf2e + compendiums + i18n pt-BR                                        | pendente     | —               |
| M3-F  | DoD M3 / primeira sessão jogável — verificação integrada                        | pendente     | —               |

## Registro por batch

### M0-A — Scaffold do monorepo (2026-06-12) — score 96 ✅

- 9 agentes (foundation → server+client → integrador → 3 auditorias + 2 corretores). 121 testes verdes, lint de fronteiras com teste negativo real (dependency-cruiser).
- **Desvio do processo registrado**: as 3 auditorias do workflow travaram em 88 pela mesma issue mecânica (diretório `coverage/` não ignorado quebrando `format:check` do CI) que os corretores não aplicaram. O orquestrador aplicou os fixes manualmente (.gitignore/.prettierignore/eslint ignores, validação de chaves do `documentTypes` via superRefine, dep não usada do stub removida) e uma re-auditoria Opus independente deu **96**. Issues baixas remanescentes (alias morto no vitest do stub, teste de regressão do typo de documentType) também fechadas antes do commit.
- Entregue: root configs (TS strict real: noUncheckedIndexedAccess etc.), @fusion/shared (id nanoid16, UUID hierárquico, envelope da spec 04, PROTOCOL_VERSION), @fusion/system-api (manifest Zod, defineSystem, validateSystemModule, registry), system-stub, server skeleton (config 4 camadas, boot em fases, shutdown gracioso, /health), client skeleton (Svelte 5+Vite, dark theme), CI yml.
