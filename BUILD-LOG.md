# Fusion — Build Log

> Log da construção autônoma do app (iniciada em 2026-06-12, branch `build/app`).
> Método: batch-gated development — cada batch implementado por agentes, integrado (build+testes verdes) e auditado por Opus com gate ≥ 95%. `main` permanece intacta nas specs; tudo aqui é reversível por git.

## Plano de execução

Caminho crítico do roadmap (`specs/27-roadmap-e-milestones.md`): **M0 → M1 → M2 → M3** (primeira sessão jogável), depois M4/M5/M6 se houver tempo.

| Batch | Conteúdo                                                                        | Status       | Score auditoria |
| ----- | ------------------------------------------------------------------------------- | ------------ | --------------- |
| M0-A  | Scaffold monorepo, shared, system-api, stub system, server/client skeletons, CI | concluído    | 96              |
| M0-B  | SQLite/WAL, migrations, world lifecycle, Document model + CRUD, CLI             | concluído    | 96              |
| M0-C  | Fastify boot, socket.io handshake/envelope, auth (Argon2id/JWT), contract tests | concluído    | 96              |
| M1-A  | Canvas PIXI v8, grade square, render groups                                     | concluído    | 96              |
| M1-B  | Scene/Token embedded, CRUD broadcast, snapshot+resync, reconexão                | concluído    | 97              |
| M1-C  | Tokens no canvas (drag, animação, barras), ownership no servidor                | em andamento | —               |
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

### M1-B — Sync de Documents (2026-06-12) — score 97 ✅ (após correção dirigida)

- Auditorias do batch: 38 → 82 → 91 (bloqueado no gate); correção dirigida com os 6 fixes do auditor + re-auditoria independente → **97**. ~650 testes verdes.
- Entregue: Scene/TokenDocument embedded (Zod), doc:create/update/delete com permissão no servidor + broadcast com seq, snapshot filtrado por ownership (tokens hidden excluídos para não-GM), resync delta com buffer circular 1000 + fallback para snapshot (incl. pós-restart), DocumentMirror no client (ordenação estrita por seq, fila de boot, gap→resync), reconexão, UI mínima de cenas (GM cria/ativa), pendências M0-C fechadas (ack com requestId; cookie Secure configurável).
- Fixes dirigidos: dot-path expandido no update primário; OpBuffer sinaliza stale pós-restart; world:activeScene aplicado no replay de delta; filtro de hidden no snapshot; allowlist no update de embedded (_id imutável, actorId GM-only); schema morto removido. TODO explícito: filtro de hidden no broadcast live (M1-C).

### M1-A — Grid math + canvas PIXI (2026-06-12) — score 96 ✅

- Auditorias 86 → 93 → 96; 477 testes verdes. Entregue: abstração de grid no shared (SquareGrid completo com 7 regras de diagonal incl. 5-10-5 com acumulação por caminho, snapping em 3 modos, footprints 2x2, path measurement), camera-math pura (zoom-at-point provadamente correto nos limites), FusionCanvas PIXI v8 (WebGPU→WebGL, render groups, stack de camadas da spec 06, GridRenderer, destroy sem leak para HMR), cena de desenvolvimento + overlay de debug F9.
- Nota: o agente de grid caiu por erro de API no meio do batch; o integrador e corretores completaram o trabalho e a auditoria verificou a matemática manualmente.

### M0-C — Auth + socket base (2026-06-12) — score 96 ✅ — **MILESTONE M0 FECHADO (DoD 7/7)**

- Auditorias 93 → correção → 96; 331 testes verdes. Entregue: Argon2id (params da REQ-SEC-010), JWT 15min + refresh opaco rotacionado com reuse-detection (revoga família), cookie httpOnly SameSite=Strict, lockout 5/15min anti-spoof, anti-enumeration; socket.io com namespace /world/<id>, handshake AUTH_FAILED/PROTOCOL_MISMATCH, envelope Zod, seq monotônico persistido; `fusion serve --world`; tela de join real no client (token só em memória) + ping/RTT.
- **Pendências médias a fechar no M1-B**: cookie `Secure` atrás de TLS; ack devolvendo `requestId` (REQ-NET-011).

### M0-B — Persistência, worlds, documents e CLI (2026-06-12) — score 96 ✅

- 7 agentes; auditorias 91 → correção → 96. Entregue: wrapper better-sqlite3 com PRAGMAs da spec 03 + integrity_check + checkpoint no close; framework de migrações com backup pré-migração e rollback seguro; WorldManager (create/open/close/list/delete-para-trash/backup, world.lock com recuperação de stale); DocumentStore com CRUD transacional, \_stats server-only, diff parcial e ownership; CLI `fusion serve|world list|create|backup` com testes via child_process.

### M0-A — Scaffold do monorepo (2026-06-12) — score 96 ✅

- 9 agentes (foundation → server+client → integrador → 3 auditorias + 2 corretores). 121 testes verdes, lint de fronteiras com teste negativo real (dependency-cruiser).
- **Desvio do processo registrado**: as 3 auditorias do workflow travaram em 88 pela mesma issue mecânica (diretório `coverage/` não ignorado quebrando `format:check` do CI) que os corretores não aplicaram. O orquestrador aplicou os fixes manualmente (.gitignore/.prettierignore/eslint ignores, validação de chaves do `documentTypes` via superRefine, dep não usada do stub removida) e uma re-auditoria Opus independente deu **96**. Issues baixas remanescentes (alias morto no vitest do stub, teste de regressão do typo de documentType) também fechadas antes do commit.
- Entregue: root configs (TS strict real: noUncheckedIndexedAccess etc.), @fusion/shared (id nanoid16, UUID hierárquico, envelope da spec 04, PROTOCOL_VERSION), @fusion/system-api (manifest Zod, defineSystem, validateSystemModule, registry), system-stub, server skeleton (config 4 camadas, boot em fases, shutdown gracioso, /health), client skeleton (Svelte 5+Vite, dark theme), CI yml.
