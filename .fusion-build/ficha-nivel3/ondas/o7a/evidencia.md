# Evidência — Onda 7a (molde das 29 fichas + comparador, adiantados)

**Data do fecho:** 2026-09-21/22
**Worktree:** `wt-d` (core `ficha3/o7a`, satélite `ficha3/o7a`)
**PODE MERGEAR:** SIM (revisão adversarial aprovada, zero bloqueante/importante)

---

## 1. Linha da Onda 7 na tabela da seção 3 do `execucao.md`

Preenchida com a saída real desta lane (a linha original só cobria a Onda 7 completa; a 7a é o
recorte adiantado de molde+comparador, sem o roteiro `tutorial-e2e`, que fica para a Onda 7):

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **7a** | `npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts --reporter=verbose` → **7/7 verdes** (3 describe blocks: 29×3=87 células do molde do Alexandre — hoje 87 pendentes/0 comparadas, cada uma com `pendingReason`; fixture própria Fighter do Player Core Remaster batendo HP+ranks reais; meta-teste provando que o comparador acusa exatamente 1 divergência quando um valor é injetado errado). Gate completo: `pnpm build`/`typecheck`/`lint`/`lint:boundaries`/`format:check`/`spec:report` todos exit 0; `pnpm test` completo (suíte, 452 arquivos/8380 testes): 2 arquivos vermelhos, 23 testes — **idêntico ao baseline o0** (na verdade 1 dos 3 arquivos do baseline, `traitNames.sync`, passou a verde: melhora, não regressão). Depois do re-pin (merge de `origin/alfa/app` + submodule em `v0.2.9`): `pnpm build` e `pnpm typecheck` rodados de novo, ambos exit 0 (typecheck: 1613 arquivos, 0 erros, 24 warnings pré-existentes). | — (não aplicável a este recorte; a personagem "viva" é a que o `classBuildHarness` constrói dentro do próprio teste, caminho real do builder — a ficha de verdade num mundo fica para o roteiro `tutorial-e2e` da Onda 7, autorizado pelo orquestrador a ficar fora desta 7a) | `prints/01-molde-character-templates-abre.png` (52 KB) — abre `character-templates.json` no browser: mostra `metadata.chassis_common` e o início do `batch_1` (Fighter) com `hp`/`ac`/`saves`/`proficiencies` todos `null`, prova visual da não-circularidade (lição #48). `prints/02-exemplo-fighter-legivel.png` (64 KB) — abre `exemplo-preenchido-fighter.json`: níveis 1/3 preenchidos com `proficiency_ranks` reais e notas citando a regra do livro (Bravery etc.), prova visual do "exemplo verde". Ambos olhados (Read na imagem) antes de entrar no relatório. |

## 2. Revisão adversarial e re-verificações

**Veredito do juiz (`revisao-adversarial.md`): APROVADA — zero achados, zero confirmados, zero refutados.**

Reverificação do juiz, linha a linha:
- Comparador rodado isolado na wt-d: 7/7 verdes (1,8 s).
- Molde bate com o teste de 87 células (29 classes × 3 níveis).
- Commits presentes conferidos (core `8f56ce16`, satélite `f7a113f7`, pin correto).
- Prints existem e batem com o recorte da 7a.
- Gate integral conferido (build/typecheck/lint/boundaries/format/spec:report verdes; suíte com 2 arquivos vermelhos = baseline).
- Todos os 9 checks da evidência viva `ok: true`.

Nenhuma pendência de re-verificação ficou em aberto.

## 3. Achado real durante o fecho (fora da revisão adversarial, achado pelo CI)

A revisão adversarial rodou **antes** do push que disparou o CI real do satélite (o gate mecânico local não reproduz o mount standalone do CI). O CI do satélite (PR #150) **falhou 2 vezes seguidas**:

```
Build, Typecheck & Test (against mounted core)  fail  2m2s   run 35675443429
Build, Typecheck & Test (against mounted core)  fail  1m50s  run 35677164581
```

Causa raiz: `character-comparator.test.ts` (T7.2) lê `docs/design/ficha-nivel3/molde/character-templates.json`, que vive no repo **core**. O CI deste satélite (`ci.yml`/`scripts/setup-core.sh`) monta um core clonado e **pinado em `core-ref.txt`** (`aedda2c2`, um commit já mergeado em `alfa/app` bem antes desta onda) para rodar standalone — esse mount não tem o arquivo do molde, que só existe na branch `ficha3/o7a` do core (ainda não mergeada). Resultado: `ENOENT` na coleta do teste, quebrando o arquivo inteiro (não só os testes que dependem do molde).

**Conserto** (commit `ee6d7cb`, satélite): mesmo padrão já usado em `pregen-parity.test.ts` (`VENDOR_AVAILABLE`) — `MOLDE_AVAILABLE = existsSync(...)`, `describe.skipIf(!MOLDE_AVAILABLE)` nos dois blocos que dependem dos arquivos do molde, com `console.warn` explicando por quê. Nenhuma decisão de arquitetura reaberta (o molde continua no core, DEC-SEP-09 do submodule intacta); é só o teste passar a se comportar bem quando roda contra um mount de core mais antigo, exatamente como o comparador de pregens já fazia para o vendor gitignored.

Verificado depois do conserto:
- `npx vitest run .../character-comparator.test.ts --reporter=verbose`: **7/7 verdes** de novo (arquivo local tem o molde, `MOLDE_AVAILABLE=true`, nada muda no comportamento real).
- `npx eslint` + `npx prettier --check`: limpos.
- CI do satélite reexecutado: **verde** (`run 35677517576`, 1m47s / `run 35677521359`, 2m6s).

## 4. Merges e CI final

- **Satélite** `xansde/fusion-systems-2e#150` — CI verde (`Build, Typecheck & Test`, 2m6s) → `gh pr merge --merge` → mergeado em `main` como `b5990b9f`. Tag anotada `v0.2.9` criada em `b5990b9f` (última tag existente era `v0.2.8`) e pushada.
- **Core** `xansde/fusion#252` — antes do merge do satélite, o PR trazia o pin antigo (`8f56ce16`). Depois do merge do satélite: `git fetch origin` (alfa/app tinha avançado com a Onda 6b, PR #251, 9 commits) → `git merge origin/alfa/app` → conflito de submodule (esperado, `hint: Recursive merging with submodules...`) → resolvido apontando `external/fusion-systems-2e` para a tag nova `v0.2.9` (`git checkout v0.2.9` dentro do submodule, que é o próprio commit `b5990b9f` do merge do satélite) → `git add external/fusion-systems-2e` → commit `10a601df` ("merge: integra origin/alfa/app (Onda 6b) e pina o satélite em v0.2.9"). `pnpm build` (exit 0) e `pnpm typecheck` (exit 0, 1613 arquivos, 0 erros, 24 warnings) rodados de novo depois do merge, antes do push. Push (`8f56ce16..10a601df`). CI do PR #252: **verde** (`Build, Lint & Test`, 7m38s, run `35677829036`). `gh pr merge --merge` → mergeado em `alfa/app` como `bfcd597e`.

## 5. Pendências → issues

- **xansde/fusion-systems-2e#149** (nova, criada nesta lane) — "Molde do Alexandre: lote 2 (21 classes) sem estrutura por nível, só template genérico". Sem duplicata (busquei `batch_2`, `character-templates`, `molde` no backlog antes de abrir).
- **xansde/fusion-systems-2e#91** (já existente, aberta em 2026-09-21 pela Onda 0) — já cobre `KNOWN_DIVERGENCES` desatualizado para as 17 classes novas + `actionCategories` (2 pastas de vendor sem grupo). Confirmado que é a mesma pendência que o T7.2 ia registrar; não dupliquei.
- Nenhuma outra pendência nova: `gate.md` e `evidencia-viva.md` desta onda não levantaram achados além dos dois acima.

## 6. Artefatos

- Relatórios copiados para `.fusion-build/ficha-nivel3/ondas/o7a/`: `README-molde.md`, `RELATORIO-ONDA7A.md`, `T7.1-molde.md`, `T7.2-comparador.md`, `evidencia-viva.md`, `gate.md`, `revisao-adversarial.md`, `setup.md`, `prints/01-...png` (52 KB), `prints/02-...png` (64 KB) — nenhum print passou de 500 KB, sem redução necessária.
- Este arquivo (`evidencia.md`) é o fecho.

## Shas e tags finais

- Satélite `main`: `b5990b9f` (merge do PR #150), tag `v0.2.9`.
- Core `alfa/app`: `bfcd597e` (merge do PR #252).
