# Evidência — Onda 3 (Ator companheiro: eidolon e familiar)

Worktree: `wt-o0`. Core `ficha3/o3` (sha `19bff216`), submodule `external/fusion-systems-2e`
`ficha3/o3` (sha `e3bff2f`). Ambas as branches já estavam pushed antes deste fecho.

## Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **3** | **VERDE** — `companion-eidolon.test.ts` (9/9): teste de criação que gera dois documentos (personagem + eidolon) com ownership herdado do dono, verificado no servidor. | **PARCIAL** — Summoner nv1 criado e testado só via fixture/servidor de teste; nenhuma personagem viva num mundo real foi criada nesta rodada (nem eidolon nem familiar), então o requisito "não é fixture de teste" da regra da seção 3 não está cumprido. | **PARCIAL** — só 1 print existe (`01-summoner-plano-eidolon-slot.png`, slot do Plano); nenhum print do ator eidolon criado, nenhum da aba Pets, nenhum smoke GM+player. |

**Conclusão**: a onda prova o nível **Mecânico**; os níveis **Vivo** e **Olhado** ficam
incompletos — por regra da própria seção 3 ("os três são obrigatórios", "Qualquer prova só no
nível mecânico... foi assim que a #48 conviveu com 60 defeitos"), a onda **não pode ser
considerada encerrada só com este fecho**. Registrado como bloqueante B1 (issue #241) — ver
Pendências.

## Comandos rodados neste fecho (SHA atual, 19bff216/e3bff2f) — SAÍDA REAL

| Comando | Resultado |
|---|---|
| `pnpm build` | exit 0 — `packages/client build: ✓ built in 43.16s`, sem erro em nenhum pacote |
| `pnpm -r typecheck` | exit 0 — `packages/client typecheck: COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` (mesmos 24 warnings pré-existentes do fix-r2, nenhum novo) |
| `pnpm lint` | exit 0 — `✖ 1 problem (0 errors, 1 warning)` (warning pré-existente em `pregen-parity.test.ts`, idêntico ao fix-r2) |
| `pnpm lint:boundaries` | exit 0 — `✔ no dependency violations found (5044 modules, 12187 dependencies cruised)` |
| `pnpm format:check` | exit 0 — `All matched files use Prettier code style!` |
| `pnpm spec:report` | exit 0 — `cobertura [MVP] com teste: 719 (piso 719)`, sem diff pra commitar |
| Testes das tarefas da onda (`vitest run` nos 6 arquivos afetados) | exit 0 — `Test Files 6 passed (6)` / `Tests 477 passed (477)` — `planVM.test.ts` (397), `petsWire.test.ts` (7), `petsVM.test.ts` (51), `companion-witch-familiar.test.ts` (2), `player-familiar-create.test.ts` (11), `companion-eidolon.test.ts` (9). Duração 13.73s. |

Números idênticos aos já reportados em `fix-r2.md` (mesmo SHA) — confirma que nada regrediu entre
o fixer e este fecho.

**Suíte completa**: NÃO rodada neste fecho (por instrução explícita — suíte completa é
`gate.md`, já rodada em SHA anterior `d6bc3ec4`/`2f1d895` com 6 arquivos/26 testes falhando de
8253, nenhuma regressão da onda), confirmada pelo CI dos dois PRs abaixo (que roda a suíte
completa de cada repo).

## PRs e CI

- Satélite: https://github.com/xansde/fusion-systems-2e/pull/133 (`ficha3/o3` → `main`) — CI
  "Build, Typecheck & Test (against mounted core)" **pass**, runs
  https://github.com/xansde/fusion-systems-2e/actions/runs/35657828471/job/106525716322 e
  https://github.com/xansde/fusion-systems-2e/actions/runs/35659675015/job/106531680144 (rodou
  duas vezes por dois pushes na branch — commit do evidencia.md ficou só no core, então o segundo
  run reflete o mesmo SHA `e3bff2f`).
- Core: https://github.com/xansde/fusion/pull/245 (`ficha3/o3` → `alfa/app`) — CI "Build, Lint &
  Test" **pass** em 6m29s, run
  https://github.com/xansde/fusion/actions/runs/35659636718/job/106531552721 (SHA `65c42c8a`).

## Prints

- `prints/01-summoner-plano-eidolon-slot.png` (137 KB) — mostra o slot de eidolon aparecendo no
  card Classe do Plano de um Summoner nível 1, confirmando que a UI oferece o gatilho para criar
  o companheiro. Não prova a criação do documento nem a aba Pets (ver Vivo/Olhado acima).

## Revisão adversarial e re-verificações

- `revisao-adversarial.md` (rodada inicial) + `revisao-regra-pf2e.md`, `revisao-dado-importer.md`,
  `revisao-testes-contratos.md`, `revisao-costura-seguranca.md` — revisão setorial completa,
  achados endereçados em `fix-r1.md`.
- `revisao-adversarial-r1.md` → veredito **REPROVADA**: B1 (evidência viva) seguia bloqueante, N1
  (aviso de "companheiro obsoleto" com falso positivo) importante novo.
- `fix-r2.md` → consertou N1 (`petsVM.ts`/`PlanColumn.svelte`, satélite `e3bff2f`, core
  `19bff216`), RED→GREEN confirmado (11 casos, 6 novos regressivos do N1). B1 permanece não
  resolvido — estrutural (skill `tutorial-e2e` não versionada em worktree isolada), virou issue
  #241.
- `revisao-adversarial-r2.md` → veredito final: **B1 segue bloqueante**; nenhum outro achado
  aberto.

**Veredito consolidado**: PODE MERGEAR = **NÃO**, por B1 (evidência viva/Vivo/Olhado
incompletos). Mecânico está verde e nenhum achado de correção segue em aberto.

## Pendências (com link da issue)

| ID | Severidade | Título | Issue |
|---|---|---|---|
| B1 | bloqueante | Evidência viva ainda não rodou (só 1 print do slot do Plano; nenhum print do ator criado nem da aba Pets; sem smoke GM+player) | https://github.com/xansde/fusion/issues/241 |
| — | fora de escopo | Animista: selecionar espírito não atualiza lista de magias, filtro nem aba (relato do Alexandre, repetido em duas rodadas de fixer e novamente no relayed request deste fecho) | https://github.com/xansde/fusion/issues/242 |

Nenhuma pendência de código/mecânica nova surgiu neste fecho — o gate local (SHA atual)
reproduziu exatamente os números já registrados pelo fix-r2, sem regressão e sem achado novo.

Os 5 achados menores do inventário T3.1 (`T3.1-modelo.md`) ainda não tinham issue aberta —
convertidos agora, sem duplicata (checado com `gh issue list --search`):

| Achado | Issue |
|---|---|
| Concessão de familiar reconhecida pelo nome do talento (deveria ser sourceId) | https://github.com/xansde/fusion-systems-2e/issues/130 |
| Eidolon: faltam PV compartilhado, atributos por tipo, Agir Junto, manifestar/dispensar | https://github.com/xansde/fusion-systems-2e/issues/131 |
| Satélite sem configuração de eslint | https://github.com/xansde/fusion-systems-2e/issues/132 |
| Servidor não recusa masterActorId auto-referente nem ciclo (REQ-ATR-083) | https://github.com/xansde/fusion/issues/243 |
| `player-familiar-create.test.ts` sobe o servidor em `port: 0` | https://github.com/xansde/fusion/issues/244 |

As pendências de T3.2/T3.3 (posse do companheiro, rótulo "Familiar", multiclasse) já estavam
abertas: #236, #237, #238 em `xansde/fusion`.

## SHAs finais

- Core `ficha3/o3`: `19bff2162455ed85abab6bd9110eb17924a243b7`
- Submodule `ficha3/o3`: `e3bff2f43a3a628aaadbd134e74ba4a821028127`
- Pin do core → submodule: confere (sem diff necessário)
