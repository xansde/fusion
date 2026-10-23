# Gate de integração — Onda 4b (T4.4, Aparições do Animist)

Worktree: `.../scratchpad/wt-d` — core `ficha3/o4b`, submodule `external/fusion-systems-2e`
branch `ficha3/o4b`.

## SHAs finais (pushados)

- Core `xansde/fusion`, `ficha3/o4b`: **`2f7b980b`** (pin do submodule `e7b96f86` + docs `075d1587`
  + `chore` deste gate `2f7b980b`, que só reformata dois `.md` com prettier).
- Satélite `xansde/fusion-systems-2e`, `ficha3/o4b`: **`497313a8`** (sem mudança nova neste gate;
  `git push` deu "Everything up-to-date").

## Comandos e resultados

| Comando | Resultado | Comparação com baseline (`o0/baseline.md`) |
| --- | --- | --- |
| `pnpm build` (topológico) | exit 0, verde | build não é comparado no baseline; verde por si só |
| `pnpm typecheck` (14 pacotes + svelte-check) | exit 0, 0 erros, 24 warnings pré-existentes | baseline não media typecheck completo desta forma; 0 erros é o que importa |
| `pnpm lint` | exit 0, 0 erros, 1 warning pré-existente (`pregen-parity.test.ts`, eslint-disable não usado) | verde |
| `pnpm lint:boundaries` | exit 0, "no dependency violations found" (5037 módulos) | verde |
| `pnpm format:check` | **falhou na 1ª rodada** (2 arquivos `.md` desalinhados: `docs/design/ficha-nivel3/{execucao,tasks}.md`) → `prettier --write` nos 2 + recheck: exit 0 | corrigido nesta sessão, ver commit `2f7b980b` |
| `pnpm test` (vitest --workspace, suíte completa) | exit 1 — 3 arquivos falharam, 24 testes falharam, de **8283 testes / 446 arquivos** (443 passaram, 1 skip, 1 todo) | baseline: 3 arquivos falharam, 25 testes falharam, de 8003/438. Ver análise abaixo — nenhuma regressão nova. |
| `pnpm spec:report` | exit 0, "cobertura [MVP] com teste: 710 (piso 710)" | sem diff em arquivo nenhum (`git status` limpo além dos dois `.md` do prettier) |

## Análise das falhas de teste (comparação linha a linha com o baseline)

Baseline (`o0/baseline.md`, `test-baseline.log`): 25 falhas em 3 arquivos —
`traitNames.sync.test.ts` (2), `actionCategories.test.ts` (1), `pregen-parity.test.ts` (22).

Rodada desta onda: 24 falhas em 3 arquivos —

- `actionCategories.test.ts` (1) — **mensagem idêntica** ao baseline (`impossible-spells,
  naval-combat` sem display group). Não é regressão.
- `pregen-parity.test.ts` (22) — **mesmos 22 nomes de teste** do baseline (skill-increase-ceiling
  de 18 classes + 2 HP do Commander + 2 chassis/pregen). Não é regressão.
- `traitNames.sync.test.ts` (0, era 2 no baseline) — **melhorou**: `TRAIT_NAMES_PT` foi
  atualizado por onda anterior já mergeada em `alfa/app`; não é trabalho desta lane.
- `TokenInteractionManager.teardown.test.ts` (client, 1 teste, **não estava no baseline**) —
  investigado: falha só sob carga da suíte completa (`Test timed out in 15000ms`, não é o
  "Timeout calling onTaskUpdate" de infra do vitest, mas o mesmo padrão de flakiness sob
  contenção de CPU). Rodado isolado (`pnpm --filter client exec vitest run
  .../TokenInteractionManager.teardown.test.ts`): **verde em 2.3s** (arquivo inteiro, 2/2
  testes). O arquivo não tem relação com o código tocado nesta lane (canvas/tokens vs.
  sheets-pf2e/planVM). Classificado como flakiness de infra, não regressão — não corrigido
  (nada para corrigir).

Conclusão: **nenhuma regressão nova desta onda.** A única correção necessária foi de formatação
(prettier), commitada em `2f7b980b`.

## O que foi commitado neste gate

- `2f7b980b` — `chore(ficha-nivel3): aplica prettier --write nos docs da Onda 4b` (core). Sem
  mudança de conteúdo, só reflow de tabela/parágrafo Markdown.
- `spec:report` não gerou diff (cobertura no piso, nenhum arquivo de relatório mudou).

## Push

- `git push origin ficha3/o4b` (core): `075d1587..2f7b980b` — OK.
- `git push origin ficha3/o4b` (satélite): "Everything up-to-date" — já estava pushado pela lane
  de implementação (T4.4).

## Pendências (herdadas do relatório da lane, não deste gate)

Ver `ficha3-reports/o4b/T4.4-aparicoes.md` — issues #101, #110, #115, #119 do satélite
permanecem abertas; prova "Vivo"/"Olhado" (servidor+browser) não foi produzida nesta onda nem
neste gate (fora do escopo mecânico do gate).

## Veredito

**PODE MERGEAR: SIM** (do ponto de vista deste gate — build/typecheck/lint/lint:boundaries/
format/spec:report verdes, suíte completa sem regressão nova). Merge continua sendo decisão
humana.
