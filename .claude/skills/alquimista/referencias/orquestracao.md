# Orquestração de uma onda do plano do Alquimista

Referência do Passo 3 da skill `/alquimista`. A sessão principal orquestra; subagentes executam. Use a ferramenta Agent (um subagente por item), com `model` e esforço da tarefa. Ao montar cada prompt, inclua a seção "Regras para todo subagente" abaixo.

## Fluxo

1. **Implementar (paralelo, até 6)**: um subagente por tarefa de `alq-rodada.json`, com `model` = campo `modelo` da tarefa. Prompt: texto da tarefa (campo `texto`), worktree, branch, lote, as regras abaixo, e o pedido de devolver `status` (pronta|bloqueada), resumo, testes rodados, SHAs dos commits por repo, pacotes tocados, prints.
2. **Verificar (por tarefa, assim que a implementação dela voltar)**: subagente `sonnet`, independente e cético, sem editar nada. Confere o diff da branch contra `origin/feat/alquimista` nos dois repos (entrega, escopo, arquivos indevidos), roda ele mesmo os testes e o typecheck dos pacotes tocados, confere que o teste assere pela regra do PF2e, que há gatilho real na tela quando há UI, que os prints existem e mostram o prometido (tarefas de lote) e que os contratos batem com a seção 2 do plano. Se reprovar: um subagente corretor (mesmo modelo da tarefa; haiku sobe para sonnet) recebe a lista de problemas, e depois uma segunda verificação. Reprovou de novo → tarefa `bloqueada` com o motivo.
3. **Integrar (um subagente `sonnet`, depois que todas voltaram)**, na worktree `alq-integracao`:
   1. `git pull --ff-only` nos dois repos; anotar `core_base` e `sat_base`.
   2. Satélite: `git merge --no-ff origin/alq/<id>` para cada tarefa pronta com commits lá. Conflito trivial resolve; conflito de lógica → `git merge --abort` e exclui a tarefa com motivo.
   3. Core: idem; depois `git add external/fusion-systems-2e` apontando para o HEAD da `feat/alquimista` do satélite e commit `chore(alquimista): pin do satélite após a onda N`.
   4. Gate: `pnpm install --frozen-lockfile` (se o lockfile mudou), `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, testes dos pacotes tocados, `pnpm spec:report` se entrou teste novo (commitar), `spec-lint` se entrou spec. Falhou → até 2 rodadas de correção; não fechou → `git revert -m 1` do merge culpado e exclui a tarefa.
   5. Push das duas `feat/alquimista` (satélite primeiro). Devolver integradas, excluídas, gate, bases e SHAs finais.
4. **Revisar (um subagente `opus`)**: revisão adversarial do diff `core_base..core_sha` e `sat_base..sat_sha`, sem editar. Lentes obrigatórias: correção da regra PF2e remaster; autoridade do servidor e redação só via `net/redaction.ts` + `isRolePrivileged`; testes não-circulares e sem porta hardcoded; contratos iguais à seção 2 do plano; clean-room, escopo e decisões D-01..D-18. Classifica cada achado como bloqueante, importante ou menor.
5. **Corrigir a revisão (um subagente `sonnet`, só se houver bloqueante/importante)**: commita direto na `feat/alquimista` dos dois repos, teste que reproduz → correção → gate completo de novo → pin → push. Discordância com evidência fica em "abertos".
6. Monte o objeto de resultado para o `record.mjs`:
   `{ onda, tarefas:[{id, status, resumo, bloqueio}], integradas:[ids], excluidas:[{id, motivo}], gate:{ok, detalhes}, revisao:{achados, corrigidos, abertos}, core_sha, sat_sha }`.

## Regras para todo subagente

- O plano completo está em `<alq-integracao>/docs/design/alquimista/tasks.md`; decisões D-01..D-18 na seção 1 e contratos canônicos na seção 2. Siga contratos pelo nome e shape de lá.
- Trabalho da tarefa vai para a branch `alq/<id>` nos dois repos (core na worktree da tarefa; satélite em `<worktree>/external/fusion-systems-2e`). Onde a tarefa fala em "merge do #57", "tag" ou "bump de pin", isso é do integrador/fechamento de lote — a tarefa só commita na própria branch.
- Nunca push em `alfa/app`, `beta/app`, `stable/app`, `main`, `build/app`; `feat/alquimista` só pelo integrador e pelo corretor da revisão. Nunca merge de PR. Nunca `--no-verify`, `git reset --hard`, `git checkout --`, `git clean -f`.
- TDD: teste falhando primeiro, depois implementação. Asserção pela regra do PF2e remaster, nunca pela tabela do próprio pack.
- Rodar só os testes dos pacotes tocados + typecheck deles (há outras tarefas rodando na máquina). Server: pool forks, porta via `helpers/ports.ts`. "Timeout calling onTaskUpdate" sem teste falhando = flakiness: re-rodar o arquivo isolado.
- UI precisa de gatilho real na tela; sem emissor ainda, botão de andaime marcado `SCAFFOLDING`.
- Data-dir de servidor de teste fora da worktree: `<ROOT>/.claude/worktrees/alq-datadir-<id>/`. `git status` antes de commitar; `git add` com paths explícitos; prettier nos arquivos tocados.
- Clean-room: nada de código/texto do Foundry; foundryvtt/pf2e (Apache-2.0) só como referência com atribuição.
- Commits em conventional commits com descrição em pt-BR, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Push da própria branch (`git push -u origin alq/<id>`) nos repos em que commitou.
- Prints (tarefas de roteiro/lote): seguir `<ROOT>/.claude/skills/tutorial-e2e/SKILL.md`; salvar em `<ROOT>/.fusion-build/alquimista/<lote>/<fase>/`, um por tarefa com UI, visão GM e player; o roteiro confere a branch com `git merge-base --is-ancestor` antes de começar; relatório em `<ROOT>/.fusion-build/alquimista/<lote>/relatorio.html`; abrir cada print com Read antes de declarar pronto.
- Tarefa impossível como escrita (contrato ausente, dependência não entregue, contradição com o código): não inventar — devolver `bloqueada` com motivo concreto.
