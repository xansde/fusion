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
| M1-C  | Tokens no canvas (drag, animação, barras), ownership no servidor                | concluído    | 97              |
| M1-D  | Motor de rolagens (RNG servidor, roll modes, inline), chat + cards              | concluído    | 96              |
| M1-E  | Assets (upload/serving), presença (cursores, ping, ruler), DoD M1               | concluído    | 97              |
| M2-A  | Walls + portas, visibility polygon, luzes                                       | concluído    | 96              |
| M2-B  | Fog of war (3 estados, persistência, Clipper2), broadcast de delta              | concluído    | 93 (dívida)     |
| M2-C  | Combat/Combatant, tracker, InitiativeFormula, hooks de turno                    | concluído    | 96              |
| M3-A  | System API completa + engine-2e (derivação, effects MVP, DoS, stacking, IWR)    | concluído    | 95              |
| M3-B  | PF2e schemas + automação (strikes, saves, condições, spellcasting)              | concluído    | 72→✓ corrigido  |
| M3-C  | UI framework (window manager, sheets, TipTap) + fichas PF2e                     | concluído    | 95              |
| M3-D  | Importer pf2e + compendiums + i18n pt-BR + DoD M3 (primeira sessão jogável)     | pendente     | —               |

> **Processo acelerado (autorizado pelo usuário em 2026-06-12, durante M2-B)**: gate reduzido — máx. **2** auditorias Opus por batch (antes 3) e aprovação com **dívida registrada** quando score ≥ 90 sem issues de severidade alta; M3 consolidado de 6 para 4 batches. Issues altas continuam bloqueando sempre.

## ⏸️ PAUSA SOLICITADA PELO USUÁRIO (2026-06-25) — batch M2-C, retomável via resumeFromRunId

- Build retomado em 2026-06-25 (após M2-B commitado em `3143fc7`). Baseline confirmado verde antes de iniciar: build ok, typecheck 0 erros, **server 350 testes + client 532 testes** verdes isolados (a suíte completa `pnpm test` sai não-zero por flakiness conhecida do worker vitest sob carga — 22 testes em cascata após `Timeout calling onTaskUpdate`; isolados passam 100%).
- Batch **M2-C (Combate e Iniciativa)** lançado via workflow `wf_9dc5fcc5-b2f` (script: `.fusion-build/m2c-workflow.js`) com o pipeline: fundação → impl paralela server+client → integração verde → auditoria Opus + fix loop (gate acelerado ≥90 com dívida). **Pausado a pedido do usuário** durante a fase de implementação/integração.
- **Working tree contém trabalho PARCIAL, NÃO commitado e NÃO auditado** — não tratar como pronto. Integração (build/typecheck/lint/boundaries/suíte completa do monorepo) **ainda não revalidada após o merge**; nenhuma auditoria Opus rodou.
- **Já escrito pelos agentes:**
  - _Fundação_ (provavelmente completa): `packages/shared/src/combat/` (schemas, types, initiative, protocol, index + teste), envelopes `combat:*`/`token:targeted` em `protocol.ts`, contrato system-api em `system-api/src/combat.ts` + `system-module.ts`, registros no server (`documents/types.ts` combatants tipado, `doc-handlers.ts` GM_ONLY/EMBEDDED_PARENT_MAP, `sync-handlers.ts` SNAPSHOT_TABLES, `redaction.ts` stripHiddenCombatants, `socket-manager.ts`). Shared rebuildado.
  - _Server_: `packages/server/src/combat/` (combat-handlers, combat-event-bus, initiative-registry, targeting-store, target-handler, combat-chat, index) + testes `combat/__tests__/combat-unit.test.ts`, `__tests__/combat-m2c.test.ts`, `__tests__/combat-redaction-m2c.test.ts`.
  - _Client_: `components/combat/CombatPanel.svelte`, `lib/combat/` (combatStore.svelte, combatTracker, combatVisibility, targeting + testes), `lib/canvas/combat/` (CombatTurnMarker, TargetingMarker, combatCanvasController, index + testes). Ajustes em `AppSidebar.svelte`, `TableScreen.svelte`.
  - _Infra_: fix de alias `@fusion/shared` em `packages/client/vitest.config.ts` (resolve relativo ao config, não ao cwd); `.fusion-build/**` ignorado no eslint.
- **Para retomar com cache** (agentes já concluídos não re-executam): `Workflow({scriptPath: ".fusion-build/m2c-workflow.js", resumeFromRunId: "wf_9dc5fcc5-b2f"})` — ou simplesmente pedir "retoma o build do Fusion".
- **Próximos passos após M2-C:** M3-A → M3-D (primeira sessão jogável).

## ⏸️ PAUSA (2026-06-12, M2-A) — RESOLVIDA (M2-A commitado em `06199e8`)

- Build pausado a pedido do usuário durante o batch M2-A. Estado: fase de geometria (visibility polygon em `packages/shared/src/vision/` + testes) CONCLUÍDA pelos agentes; fases schemas/server e client-vision estavam em execução quando a pausa foi pedida.
- **Working tree contém trabalho parcial NÃO commitado e NÃO auditado do M2-A** — não tratar como pronto.
- **Para retomar o M2-A com cache** (agentes já concluídos não re-executam): `Workflow({scriptPath: "C:\Users\xansd\.claude\projects\C--Users-xansd-pessoal-fusion\477c65a9-566c-4c09-9ba1-752ee88a14fd\workflows\scripts\fusion-batch-m2a-wf_daeea573-1cb.js", resumeFromRunId: "wf_daeea573-1cb"})` — ou simplesmente pedir "retome o build do Fusion" que o processo segue do BUILD-LOG.
- Próximos batches após M2-A: M2-B (fog), M2-C (combate), depois M3 (A–F) → primeira sessão jogável.

## Registro por batch

### M3-C — UI framework + fichas + montagem ao vivo (2026-06-26) — score 95 ✅ — **GAP DE INTEGRAÇÃO FECHADO**

- Auditorias 72 → 95; 2.336 testes verdes. **Fecha o gap arrastado desde o M2-A**: o `SceneOrchestrator` (testável, com renderers injetados como interfaces) conecta o `DocumentMirror` aos renderers existentes (TokenLayer, LightingRenderer, FogState, vision-state, CombatTurnMarker) e é instanciado pela `TableScreen` — o pipeline visão/fog/tokens/combate agora renderiza AO VIVO em resposta ao sync.
- Entregue: WindowHost montado na mesa (window manager do prep agora em uso), fichas PF2e em Svelte (character/npc) consumindo o `derived` do servidor sem recalcular regras, sheet registry por subtype, TipTap (bold/italic/headings/lists/@links/secrets/inline rolls com schema controlado), diretório de atores (drag actor→token), i18n pt-BR, a11y básica.
- Verificação headless: orquestrador testado com mirror mockado + renderers fake (token/porta/cena/combate/tear-down); o restante (Svelte/PIXI) confirmado por build + svelte-check. **A confirmação visual final fica para a DoD do M3-D** (requer execução real).

### M3-B — Sistema PF2e (2026-06-26) — bloqueado em 72, corrigido e verificado ✅

- O gate fez seu trabalho: a auditoria pegou **2 bugs ALTOS de cálculo de regra** que teriam corrompido todo combate PF2e — (1) condições com valor não multiplicavam (`frightened 2` aplicava -1, não -2; a função de resolução existia mas estava órfã), (2) `drained` não propagava o valor (`drained 2` reduzia HP por 1×nível, não 2×nível). Ambos mascarados por testes que fabricavam os valores à mão — o mesmo padrão "vaziamente verde" pego no M1-C/M1-D.
- Correção dirigida (Opus): adicionada `conditionsToEffectSources` (produção, em `conditions.ts`) que materializa ConditionItems com valor → -X; testes reescritos para partir do `ConditionItem` real. FIX-3/FIX-4 (médios) resolvidos via thin-delegation: `proficiencyBonus`/`mapPenalties`/`PF2E_STACKING_TABLE` viraram re-exports de `engine-2e` (fonte única validada por fixtures). O workflow de correção **morreu no retorno de output estruturado** (retry cap do harness), mas o trabalho de código foi concluído — **o orquestrador verificou manualmente, de forma adversarial**: probou frightened 2 → -2 (AC 24→22, Fort 11→9) e drained 2 → -10 HP (75→65) a partir de ConditionItems reais, confirmou a delegação ao engine-2e e a ausência de mascaramento; suíte completa verde (264 pf2e + 136 engine-2e + 399 server, exit 0).
- Entregue: pacote `systems/pf2e` registrável (`fusion world create --system pf2e`), schemas de actor (character/npc) + 9 item types, derivação topológica (AC/saves/perícias/HP via engine-2e), strikes com MAP, condições como FlatModifiers, IWR no dano, iniciativa por Perception no servidor.

### M3-A — System API + engine-2e (2026-06-13) — score 95 ✅

- Auditoria 95 (1 passada); **94/94 golden fixtures passando** (13+ verificados à mão pelo auditor, 15 probes de robustez 15/15). Entregue: contrato da system API (registro de subtypes com Zod, derivação por sort topológico com detecção de ciclo — resolve o "prepareData hell", hooks tipados com isolamento de erro e cancelamento por pre-hook), motor de effects MVP (FlatModifier/RollOption/Note/ToggleCondition/IWR + predicados all/any/not + fallback que loga rule elements não suportados sem crash) e o pacote `systems/engine-2e` (DoS, stacking dos 7 tipos, MAP, IWR, TEML, dying/wounded — math pura validada pelas fixtures). 136 testes engine-2e + 110 system-api.
- **Limpeza pós-auditoria (orquestrador)**: 164 artefatos `.js/.d.ts/.map` compilados por engano em `src/` (um agente rodou `tsc` sem outDir) removidos via `git clean -Xfd` restrito; band-aid de eslint que os ignorava revertido; `global.d.ts` (escrito à mão) preservado. Gates revalidados verdes.
- Dívida menor (não-bloqueante): caso `dw-016` (verify:true, mecânica V2 clearWounded) é tautológico no teste — revisitar quando clearWounded for implementado.

### M2-C — Combate (2026-06-13) — score 96 ✅ — **MILESTONE M2 FECHADO (DoD 6/6)**

- Workflow morreu na sessão anterior deixando a implementação completa no working tree; retomado via `resumeFromRunId` (impl do cache, integração + auditoria ao vivo). Auditorias 86 → 96; ~1.685 testes verdes. Sem dívida.
- Entregue: Combat/Combatant documents, tracker (CombatPanel) com controles de GM e iniciativa rolada **no servidor** via RollService + `InitiativeFormulaRegistry`/`generic-1d20`; comparator de desempate plugável (testado com fórmula "players beat NPCs" estilo Etmos); ciclo round/turn com wraparound e skipDefeated; hooks de turno na ordem canônica (`turnEnd`→`roundEnd`→`roundStart`→`turnStart` no boundary de rodada); targeting de tokens; indicador de turno no canvas.
- **Invariante crítica verificada manualmente nos 4 caminhos**: NPC oculto nunca vaza iniciativa/nome/existência (snapshot via `stripHiddenCombatantsFromCombat`, broadcast per-socket com redação de `combat:turnChange`, delta resync via `filterCombatOpForRole`, ack via dispatcher central). Reusa `redaction.ts` canônico. DoD M2 (walls, luzes, fog, combate) confirmada 6/6.

### M2-B — Fog of war (2026-06-12) — score 93 ✅ (aprovado pelo gate reduzido, com dívida)

- O workflow do batch morreu no meio da fase de correção deixando o trabalho parcial no working tree; o orquestrador limpou as sobras (guard de `window` no fog-state, `stubGlobal` nos testes, imports não usados, non-null assertions, `**/vendor/**` ignorado no prettier/eslint — o clone pf2e tinha `.prettierrc` próprio que quebrava o format do monorepo) e rodou o gate reduzido: **93**, aprovado (≥90 sem issues altas). ~1.450 testes verdes.
- Entregue: fog com 3 estados (não-explorado/explorado-translúcido/visível), união via Clipper2 com simplificação, persistência por (usuário, cena) com isolamento testado contra forja de userId, reset do GM com broadcast, filtro visual de tokens fora da visão atual.
- **Invariante de isolamento confirmada** (fog de um usuário nunca acessível a outro). **Dívida registrada (revisitar no M3-C/polish):** (média) `simplifyFog` pode encolher área no teto de 20k vértices — docstring promete superset via inflate não implementado; (média) `LightingRenderer._buildStateKey` chaveia por contagens, não coords — token movendo curto não atualiza a janela visível; (baixa) `'PAYLOAD_TOO_LARGE'` fora do enum ErrorCode; (baixa×2) dead code em `fog-handlers`/`geometry`; (baixa) teste de visibilidade de token reimplementa a lógica em vez de exercitar `TokenLayer`.
- **Gap de integração** (herdado do M2-A, fecha no M3-C): módulos de visão/fog/tokens testados unitariamente mas ainda não montados num orquestrador de cena/socket vivo — nenhuma sessão jogável end-to-end ainda.

### M2-A — Walls, visibility polygon e iluminação (2026-06-12) — score 96 ✅ (retomado pós-pausa via cache)

- Auditorias 88 → 96; 1.225 testes verdes. Matemática verificada à mão pelo auditor (sombras de parede com vértices numéricos, terrain limited com contagem de camadas, cone com wrap-around 0/2π, directionality por cross-product).
- Invariantes confirmadas: geometria SOMENTE em `packages/shared/src/vision` (client e servidor usam a mesma — grep por implementações duplicadas vazio); secret doors redigidas nos 4 caminhos (snapshot, broadcast, delta, ack) integradas ao `redaction.ts` canônico.
- Entregue: visibility polygon por angular sweep (118 testes incl. property-based com 300 pontos), walls com restrições independentes move/sight/light/sound + terrain limited, portas (estados, players abrem destrancadas, secret GM-only), validação de movimento server-side com MOVE_BLOCKED (+force GM), walls layer com ferramenta de desenho, luzes bright/dim com darkness e máscara de visão do player.

### M1-E — Assets + presença (2026-06-12) — score 97 ✅ — **MILESTONE M1 FECHADO (DoD 7/7)**

- Auditorias 93 → 93 → 97; 1.079 testes verdes. DoD M1 verificada com evidência executável: RTT mediano de token em loopback **1ms** (p90 6ms); resync pós-desconexão correto; cursores/ping efêmeros (sem seq, sem buffer, sem DB); upload com magic bytes + path traversal bloqueado em variantes Windows/POSIX/URL-encoded (sonda adversarial 17/17); inline rolls no servidor com forge bloqueado por schema; PERMISSION_DENIED para token alheio. Item 1 parcial apenas por canvas não ser testável headless (fallback WebGPU→WebGL presente no código).
- Entregue: rotas de assets (upload validado, serving imutável com cache, SVG sanitizado), FilePicker com drag&drop integrado a cenas/tokens, presença completa (cursores interpolados, ping Alt+click, ruler com medição do grid e broadcast efêmero, rate limit).

### M1-D — Rolagens autoritativas + chat (2026-06-12) — score 96 ✅ (após correção dirigida)

- Auditorias do batch: 68 → 28 → 82 (bloqueado); correção dirigida Opus → **96**. Invariantes verificadas por sondas do auditor: cliente jamais determina resultado de dado; gmroll/blindroll/selfroll/whisper redigidos em broadcast, ack, history E join-snapshot.
- Defeito central corrigido: detecção de termos via `type==='roll-results'` só funciona na forma exportada da lib — conversor refatorado para `diceRoll.export()` com faces via AST do Parser; breakdown rico, crit/fumble, dados 3D e guard de DoS (10k dados, vetor multi-termo) operacionais com testes de regressão determinísticos.
- Entregue: RollService (CSPRNG, limites anti-abuso), chat persistido com comandos completos, inline rolls resolvidos no servidor, cards declarativos sem HTML, sidebar de chat com breakdown expandível, dice-box 3D sincronizado com resultado autoritativo.
- **Known issue de infra**: suíte completa do server ocasionalmente sai não-zero por timeout de RPC do worker do vitest sob carga (~240s) sem nenhum teste falhando — re-rodar isolado confirma. Tratar como infra, não como regressão.

### M1-C — Tokens interativos + segurança de hidden (2026-06-12) — score 97 ✅ (após 2 rodadas de fix de segurança)

- A saga deste batch mostra o valor da auditoria adversarial: auditorias iniciais 72→68→62 (vazamento de token hidden no **delta resync** com teste de guarda vaziamente verde); fix Opus 1 fechou snapshot/broadcast/delta com helper canônico `redaction.ts`, mas a sonda adversarial achou um 4º caminho — **eco do ACK** vazando a Scene completa ao remetente não-GM; fix Opus 2 centralizou a redação no dispatcher (cobre handlers futuros). Re-auditoria: invariante intacta nos 5 caminhos (sonda de 40 iterações), 88 segurado só por flakiness de teste; orquestrador centralizou o predicado `isRolePrivileged`, trocou pool threads→forks (ACCESS_VIOLATION do better-sqlite3 em worker_threads no Windows), maxForks 4 e timeouts honestos no runCli. Suíte 5x verde consecutivas → re-auditoria final **97**. 776 testes.
- Entregue: TokenLayer reativo (texturas+placeholder, nameplates LOD, barras, animação interpolada), drag otimista com rollback (máquina de estados testada), setas, seleção, GM tools (add/del/toggle hidden), filtro de hidden em TODOS os caminhos de emissão, infra de teste determinística.

### M1-B — Sync de Documents (2026-06-12) — score 97 ✅ (após correção dirigida)

- Auditorias do batch: 38 → 82 → 91 (bloqueado no gate); correção dirigida com os 6 fixes do auditor + re-auditoria independente → **97**. ~650 testes verdes.
- Entregue: Scene/TokenDocument embedded (Zod), doc:create/update/delete com permissão no servidor + broadcast com seq, snapshot filtrado por ownership (tokens hidden excluídos para não-GM), resync delta com buffer circular 1000 + fallback para snapshot (incl. pós-restart), DocumentMirror no client (ordenação estrita por seq, fila de boot, gap→resync), reconexão, UI mínima de cenas (GM cria/ativa), pendências M0-C fechadas (ack com requestId; cookie Secure configurável).
- Fixes dirigidos: dot-path expandido no update primário; OpBuffer sinaliza stale pós-restart; world:activeScene aplicado no replay de delta; filtro de hidden no snapshot; allowlist no update de embedded (\_id imutável, actorId GM-only); schema morto removido. TODO explícito: filtro de hidden no broadcast live (M1-C).

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
