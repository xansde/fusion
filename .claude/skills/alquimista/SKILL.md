---
name: alquimista
description: Use quando o Alexandre digitar /alquimista (com ou sem argumento) para tocar o plano de implementação do Alquimista PF2e — próxima onda de tarefas, uma onda específica, ou o status do plano.
disable-model-invocation: true
---

# /alquimista — executa o plano `docs/design/alquimista/tasks.md`

Uso:

- `/alquimista` ou `/alquimista proxima` — roda a próxima onda pronta (tarefas cujas dependências já estão integradas).
- `/alquimista onda <N>` — roda só as tarefas prontas da onda N.
- `/alquimista status` — mostra o progresso (feito/bloqueado/pendente por fase, lotes, PRs de lote). Não executa nada.

Execute os passos abaixo em ordem, sem pedir confirmação (o Alexandre já aprovou o plano e as decisões D-01..D-18). Pare e reporte só nos pontos marcados **PARE**.

## Modelo de branches (decidido em 2026-09-15)

- Core `xansde/fusion`: branch de integração `feat/alquimista`, nascida de `origin/docs/alquimista-tasks` (= `alfa/app` + o plano).
- Satélite `xansde/fusion-systems-2e`: branch de integração `feat/alquimista`, nascida da cabeça do PR #57 (`origin/feat/classes-druid-gunslinger-psychic`).
- Cada tarefa trabalha em `alq/<id-minúsculo>` nos dois repos, numa worktree própria, e é integrada na `feat/alquimista` pelo integrador da onda (commit em branch de feature — **não** é merge em `alfa/app` nem em `main`).
- O core em `feat/alquimista` aponta o submodule para a cabeça da `feat/alquimista` do satélite. Tag do satélite e bump para tag só no fechamento de lote.
- **Merge humano** acontece só nos PRs de lote: core `feat/alquimista → alfa/app` e satélite `feat/alquimista → main`. Nenhum passo desta skill mergeia PR.
- Onde uma tarefa do plano fala em "merge do #57", "tag" ou "bump de pin", leia como: trabalho entra na `feat/alquimista` do satélite e o integrador fixa o pin no SHA dela.

## Passo 0 — Preparação (sempre)

```bash
ROOT=$(git rev-parse --show-toplevel)          # checkout principal do Fusion
SK="$ROOT/.claude/skills/alquimista"
WT="$ROOT/.claude/worktrees"                   # já está no .gitignore
gh auth switch -u xansde
git -C "$ROOT" fetch -q origin
git -C "$ROOT/external/fusion-systems-2e" fetch -q origin || true
bash "$SK/scripts/setup-branches.sh" "$ROOT"   # cria as feat/alquimista na primeira vez; idempotente
```

Se `setup-branches.sh` falhar, **PARE** e mostre o erro.

## Passo 1 — Planejar a rodada

```bash
node "$SK/scripts/plan.mjs" --root "$ROOT" --mode <proxima|onda|status> [--onda N] --out "$WT/alq-rodada.json"
```

- `status`: mostre a saída (tabela) ao Alexandre e termine.
- Se não houver tarefa pronta: diga o que está bloqueando (a saída lista dependências pendentes e tarefas bloqueadas) e termine.
- Caso contrário, `alq-rodada.json` tem `{onda, tarefas:[{id, titulo, repo, modelo, esforco, lote, texto, branch, worktree}], coreBase, satBase, integracao}`.

## Passo 2 — Worktrees (sequencial, nunca em paralelo)

```bash
bash "$SK/scripts/prep-worktrees.sh" "$ROOT" "$WT/alq-rodada.json"
```

Cria (ou reaproveita) uma worktree por tarefa e a worktree de integração `alq-integracao`, com submodule na branch certa, `pnpm install --frozen-lockfile` e `pnpm build`. É lento e sequencial de propósito: `pnpm install` paralelo em várias worktrees corrompe o `node_modules` em silêncio. Se falhar, **PARE** e mostre o erro.

## Passo 3 — Rodar a onda

Leia `"$SK/referencias/orquestracao.md"` e siga o fluxo: implementar em paralelo (um subagente por tarefa, com o modelo e o esforço da tarefa), verificar cada tarefa de forma independente, integrar na `feat/alquimista` com o gate (build, typecheck, lint, format:check, testes dos pacotes tocados, spec:report/spec-lint), revisão adversarial do diff da onda e correção do que bloqueia. Ao final, monte o objeto de resultado descrito no item 6 da referência.

## Passo 4 — Registrar

Salve o objeto retornado pelo Workflow em `"$WT/alq-resultado.json"` e rode:

```bash
node "$SK/scripts/record.mjs" --root "$ROOT" --rodada "$WT/alq-rodada.json" --resultado "$WT/alq-resultado.json"
```

Ele atualiza `docs/design/alquimista/estado.json` na worktree de integração, commita, dá push na `feat/alquimista`, remove as worktrees das tarefas integradas e diz se algum lote fechou.

## Passo 5 — Lote fechado (só quando o record.mjs disser)

Para cada lote fechado (L1/L2/L3):

1. Confira que os prints do lote existem em `<ROOT>/.fusion-build/alquimista/<lote>/` e que `relatorio.html` foi gerado (as tarefas de roteiro do lote fazem isso). Abra 3 prints ao acaso com Read e confira que mostram o que a tarefa promete.
2. Crie a tag do satélite `v0.2.0-alq.<lote minúsculo>` na cabeça da `feat/alquimista` e dê push da tag.
3. Abra (ou, se já existir, comente) os PRs de lote com `gh pr create`/`gh pr comment`:
   - satélite: `feat/alquimista → main` em `xansde/fusion-systems-2e`;
   - core: `feat/alquimista → alfa/app` em `xansde/fusion`.
     Corpo: tarefas do lote com status, link/caminho do `relatorio.html`, lista de prints por tarefa, resultado do gate e achados da revisão adversarial. Termine com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. **PARE**: o merge é do Alexandre.

## Passo 6 — Relatório final da rodada

Uma mensagem só, em pt-BR: onda rodada; tarefas integradas, bloqueadas (com motivo) e excluídas; resultado do gate; achados da revisão (corrigidos/abertos); SHAs das duas `feat/alquimista`; próximo comando sugerido (`/alquimista` de novo, ou "lote fechado, PRs abertos — revisar e mergear").

Atualize também o vault (`Projects/fusion/alquimista/`): para cada mecanismo que a onda completou, mude `status` e a evidência na nota `mecanismos/mec-*.md` e acrescente uma linha em `alquimista-indice.md` na seção do plano.

## Regras que valem para toda a rodada

- Nunca push/PR/merge em `alfa/app`, `beta/app`, `stable/app`, `main` ou `build/app` — só `feat/alquimista` e `alq/*`.
- Nunca `--no-verify`, nunca `git reset --hard`, `git checkout --`, `git clean -f`.
- Data-dir de servidor de teste sempre no scratchpad, fora de worktree. `git status` antes de todo commit; commits com paths explícitos.
- Se uma tarefa bloqueia, ela fica `bloqueada` no estado com o motivo e as dependentes esperam; a próxima rodada tenta de novo.
