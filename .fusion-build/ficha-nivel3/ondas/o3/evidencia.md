# Evidência — Onda 3 (Ator companheiro: eidolon e familiar)

Worktree: `wt-o0`. Core `ficha3/o3` (sha `d60ab51f`), submodule `external/fusion-systems-2e`
`ficha3/o3` (sha `e3bff2f`). Ambas as branches já estavam pushed antes deste fecho.

**PODE MERGEAR: SIM** — a revisão adversarial passou (zero bloqueante/importante aberto). O
bloqueante B1 (evidência viva/Vivo/Olhado), que reprovou as rodadas 1 e 2
(`revisao-adversarial-r1.md`, `revisao-adversarial-r2.md`), foi coberto por uma lane dedicada
depois do fecho anterior (que tinha fechado com PODE MERGEAR: NÃO) — ver
`evidencia-viva-final.md` e o comentário de fechamento na issue #241.

## Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **3** | **VERDE** — teste de criação que gera dois documentos (personagem + eidolon/familiar) com ownership herdado do dono, verificado no servidor (`companion-eidolon.test.ts` 9/9, `companion-witch-familiar.test.ts` 2/2). | **VERDE** — Summoner nv1 + Eidolon (`Beast Eidolon`) e Witch nv1 + Familiar criados num mundo real (cópia de `teste_xande`), com o servidor real rodando o heal on-open (`runHealAutoCompanion`); ownership do companheiro conferido **por leitura direta do `world.db`** como igual ao do dono, não só pela UI. | **VERDE** — 7 prints olhados (Summoner e Witch, GM e player) provando classe aplicada, slot preenchido, ator companheiro na gaveta Contatos, aba Pets e o smoke de ownership do lado do jogador. |

**Conclusão**: os três níveis exigidos pela seção 3 ("os três são obrigatórios") estão
cumpridos. Detalhe de cada nível abaixo.

### Vivo — o que foi provado (lane dedicada, `evidencia-viva-final.md`)

- **Summoner nv1 + Eidolon**: ator `Novo Ator` (`uPI3hK89HeppNd4a`), classe Summoner aplicada
  pela UI, slot "Eidolon" preenchido com `Beast Eidolon`. Ao fechar/reabrir a ficha, o servidor
  criou `actors: {id: "bvpTKwoeEx4zDGJO", type: "familiar", name: "Eidolon"}`,
  `system: {companionKind: "eidolon", masterActorId: "uPI3hK89HeppNd4a"}`,
  `ownership: {default: 0, ElEb3Ds597HCt5fa: 3}` — **idêntico** ao ownership do dono, lido
  diretamente do `world.db`.
- **Witch nv1 + Familiar**: ator `Tobias` (`MVZPT17ybspil2yu`, já possuído pelo jogador
  `Tobias`), classe Witch aplicada. O servidor criou
  `actors: {id: "HNdQUFXCfOE2gSW7", type: "familiar", name: "Familiar"}`,
  `system: {companionKind: "familiar", masterActorId: "MVZPT17ybspil2yu"}`,
  `ownership: {default: 0, hLFfRgqkasgtY9Xs: 3}` — ownership herdado sem precisar setar nada.
- **Smoke GM + Player**: GM (`GM_O3c`) abriu as duas fichas e viu os companheiros aninhados na
  gaveta Contatos e a aba Pets de cada um. Player (`Player_O3c`, dono só do `Novo Ator`) logou,
  viu "Novo Ator (você)" + "Eidolon" aninhado e **não viu** o Tobias (personagem de outro
  jogador) — confirma que a redação de ownership filtra corretamente por jogador.

### Olhado — prints (todos OLHADOS, pasta `prints/`)

| Print | O que prova |
|---|---|
| `01-summoner-plano-eidolon-slot.png` | Slot "Eidolon" aparece no card Classe do Plano de um Summoner nível 1 — o gatilho de UI existe. |
| `01-summoner-classe-confirmada.png` | Card "Classe Summoner" ✓ e "Summoner 1" ✓ no Plano, slot Eidolon ainda vazio — classe pura aplicada, sem contaminação. |
| `02-summoner-eidolon-escolhido.png` | "Beast Eidolon" ✓ escolhido no Plano, ANTES de reabrir a ficha — no DB ainda não existe ator companheiro, provando que a criação não é síncrona ao confirm. |
| `03-eidolon-gaveta-contatos.png` | Gaveta Contatos (GM): "Novo Ator" com "Eidolon" aninhado embaixo, aba "Pets" já visível. |
| `04-eidolon-aba-pets.png` | Aba Pets do "Novo Ator": card "Eidolon" (tipo EIDOLON) — PV/CA/saves zerados, achado registrado (issue #131, mecânica própria do eidolon ainda não modelada). |
| `05-familiar-gaveta-contatos.png` | Gaveta Contatos (GM): "Tobias" com "Familiar" aninhado. |
| `06-familiar-aba-pets.png` | Aba Pets do Tobias: card "Familiar" com PV/CA/saves/deslocamento preenchidos e habilidades diárias — derivação do familiar completa (ao contrário do eidolon). |
| `07-player-ve-eidolon.png` | Sessão como `Player_O3c`: vê "Novo Ator (você)" + "Eidolon" aninhado, "Conhecidos 0" — não vê o Tobias de outro jogador. Prova visual de ownership correto do lado do jogador. |

Prints de debug do achado da duplicação de item `class` (não fazem parte da prova formal):
`debug-01-after-confirm.png`, `debug-02-classe-summoner.png`.

## Comandos rodados neste fecho (SHA atual, `d60ab51f`/`e3bff2f`) — SAÍDA REAL

| Comando | Resultado |
|---|---|
| `pnpm build` | exit 0 — `packages/client build: ✓ built in 33.94s`, sem erro em nenhum pacote |
| `pnpm -r typecheck` | exit 0 — `packages/client typecheck: COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` (mesmos 24 warnings pré-existentes, nenhum novo) |
| `pnpm lint` | exit 0 — `✖ 1 problem (0 errors, 1 warning)` (warning pré-existente em `pregen-parity.test.ts`) |
| `pnpm lint:boundaries` | exit 0 — `✔ no dependency violations found (5044 modules, 12187 dependencies cruised)` |
| `pnpm format:check` | exit 0 — `All matched files use Prettier code style!` |
| `pnpm spec:report` | exit 0 — `cobertura [MVP] com teste: 719 (piso 719)`, sem diff pra commitar |
| `vitest run` nos 6 arquivos de teste que a Onda 3 tocou (diff `origin/alfa/app...HEAD` + `origin/main...HEAD` do submodule) | exit 0 — `Test Files 6 passed (6)` / `Tests 135 passed (135)`: `planColumn-auto-companion.test.ts` (4), `bundle-completeness.test.ts` (46), `companion-grant.test.ts` (23), `petsVM.test.ts` (51), `companion-witch-familiar.test.ts` (2), `companion-eidolon.test.ts` (9). Duração 10.62s. |

Números idênticos (0 erros/mesmos warnings) aos já reportados em `fix-r2.md`/`gate.md` no SHA
anterior — confirma que nada regrediu entre o fixer e este fecho. O número de testes "das
tarefas da onda" acima (135/6 arquivos) é o conjunto exato tocado pelo diff da onda; rodadas
anteriores (`fix-r1.md`/`fix-r2.md`) também rodaram arquivos colaterais afetados
(`planVM.test.ts`, `petsWire.test.ts`, `player-familiar-create.test.ts`, chegando a 477/6) sem
regressão — não repetidos aqui por não terem sido tocados pelo diff desta onda.

**Suíte completa**: NÃO rodada neste fecho (por instrução explícita — suíte completa é
`gate.md`, já rodada em SHA anterior `d6bc3ec4`/`2f1d895` com 6 arquivos/26 testes falhando de
8253, nenhuma regressão da onda, todas as falhas comparadas contra `origin/alfa/app` e
confirmadas como flakiness/pré-existentes), confirmada agora pelo CI dos dois PRs (que roda a
suíte completa de cada repo).

## PRs e CI

- Satélite: https://github.com/xansde/fusion-systems-2e/pull/133 (`ficha3/o3` → `main`) —
  `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. CI "Build, Typecheck & Test (against mounted
  core)" **pass** (2 runs no mesmo SHA `e3bff2f`):
  https://github.com/xansde/fusion-systems-2e/actions/runs/35657828471/job/106525716322 e
  https://github.com/xansde/fusion-systems-2e/actions/runs/35659675015/job/106531680144.
- Core: https://github.com/xansde/fusion/pull/245 (`ficha3/o3` → `alfa/app`) — no momento deste
  registro, `mergeable: CONFLICTING`/`mergeStateStatus: DIRTY` contra `alfa/app` (a Onda 2 mergeou
  antes, #239, avançando a base). Resolução (merge de `origin/alfa/app` + re-pin do submodule na
  tag nova) e o CI pós-merge estão registrados em `fecho.md` (passo 6b), não neste arquivo — este
  arquivo é a evidência de conteúdo/gate, não de merge.

## Revisão adversarial e re-verificações

- `revisao-adversarial.md` (rodada inicial) + `revisao-regra-pf2e.md`, `revisao-dado-importer.md`,
  `revisao-testes-contratos.md`, `revisao-costura-seguranca.md` — revisão setorial completa,
  achados endereçados em `fix-r1.md`.
- `revisao-adversarial-r1.md` → veredito **REPROVADA**: B1 (evidência viva) seguia bloqueante, N1
  (aviso de "companheiro obsoleto" com falso positivo) importante novo.
- `fix-r2.md` → consertou N1 (`petsVM.ts`/`PlanColumn.svelte`, satélite `e3bff2f`, core
  `19bff216`), RED→GREEN confirmado (11 casos, 6 novos regressivos do N1).
- `revisao-adversarial-r2.md` → veredito: **REPROVADA** só por B1 (nenhum outro achado aberto);
  N1 confirmado FECHADO.
- **Lane de evidência viva** (`evidencia-viva-final.md`, depois do fecho anterior que fechou com
  PODE MERGEAR: NÃO): cobriu B1 com Summoner+Eidolon e Witch+Familiar reais, verificados no banco
  e com os 7 prints da tabela acima. Comentário de fechamento postado na issue #241.

**Veredito consolidado deste fecho**: revisão adversarial **APROVADA** — zero achado
bloqueante/importante em aberto (B1 coberto pela evidência viva; M1/M2/N2/N3/N4, todos menores,
confirmados mas não bloqueiam merge — convertidos em issues nesta rodada, ver Pendências).
**PODE MERGEAR: SIM.**

## Pendências (com link da issue)

| ID | Severidade | Título | Issue | Status |
|---|---|---|---|---|
| B1 | era bloqueante | Evidência viva/Vivo/Olhado da onda | https://github.com/xansde/fusion/issues/241 | coberto pela lane de evidência viva (comentário no issue); fechamento formal neste fecho |
| — | fora de escopo | Animista: selecionar espírito não atualiza lista de magias, filtro nem aba | https://github.com/xansde/fusion/issues/242 | aberta, não é desta onda |
| — | achado novo (não desta feature) | Trocar de classe pelo Plano duplica o item `class` em vez de substituir | https://github.com/xansde/fusion/issues/246 | aberta pela lane de evidência viva, não consertada (fora do escopo desta onda) |

Os 5 achados menores do inventário T3.1 (`T3.1-modelo.md`), sem issue até este fecho —
convertidos agora, sem duplicata (checado com `gh issue list --search`):

| Achado | Issue |
|---|---|
| Concessão de familiar reconhecida pelo nome do talento (deveria ser sourceId) | https://github.com/xansde/fusion-systems-2e/issues/130 |
| Eidolon: faltam PV compartilhado, atributos por tipo, Agir Junto, manifestar/dispensar | https://github.com/xansde/fusion-systems-2e/issues/131 |
| Satélite sem configuração de eslint | https://github.com/xansde/fusion-systems-2e/issues/132 |
| Servidor não recusa masterActorId auto-referente nem ciclo (REQ-ATR-083) | https://github.com/xansde/fusion/issues/243 |
| `player-familiar-create.test.ts` sobe o servidor em `port: 0` | https://github.com/xansde/fusion/issues/244 |

Achados menores confirmados da revisão adversarial (M1/M2/N2-N4), sem issue até este fecho —
convertidos agora, sem duplicata:

| Achado | Issue |
|---|---|
| M1 — familiar da Witch nasce com orçamento de habilidades errado (2 em vez de 4) até a aba Pets abrir | https://github.com/xansde/fusion-systems-2e/issues/134 |
| M2 — petsVM testa constantes de sourceId espelhadas contra si mesmas (circular) | https://github.com/xansde/fusion-systems-2e/issues/135 |
| N2 — FamiliarSheet.svelte mostra "Habilidades 0/0" para o eidolon | https://github.com/xansde/fusion-systems-2e/issues/136 |
| N3 — spec 29 não documenta a autorização de familiar pelo item de classe da Witch | https://github.com/xansde/fusion/issues/247 |
| N4 — remoção do companheiro obsoleto é fire-and-forget (falha silenciosa) | https://github.com/xansde/fusion-systems-2e/issues/137 |

As pendências de T3.2/T3.3 (posse do companheiro, rótulo "Familiar", multiclasse) já estavam
abertas: #236, #237, #238 em `xansde/fusion`.

## SHAs finais

- Core `ficha3/o3` (antes do merge de `alfa/app` do passo 6b): `d60ab51f668357b150a269f26afb7e0adf3899c1`
- Submodule `ficha3/o3`: `e3bff2f43a3a628aaadbd134e74ba4a821028127`
- Pin do core → submodule: confere (sem diff necessário)
