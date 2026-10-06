# Fecho da Onda 6b (ficha-nivel3) — BLOQUEADO por conflito de instrução

## Decisão

Não executei a lane o6b (evidência viva, PRs, merge do gatilho de criação de personagem —
Guerreiro/ficha-nivel3) neste turno.

Motivo: a mensagem relayada do usuário (voz única de usuário deste turno, segundo as regras do
harness) reporta um bug real que ele acabou de testar, em feature não relacionada:

> "Foi sobre o animista. Ao selecionar os espíritos não adicionou nada na minha lista de magia,
> não adicionou filtro, não mudou nada."

Isso é um relato de teste ao vivo (seleção de espírito no Animista não propaga para a lista de
magias/filtro do conjurador). É diferente e não relacionado à tarefa computada desta invocação
(fechar a Onda 6b do plano `ficha-nivel3`, que é sobre o gatilho de UI de criação de personagem
do Guerreiro/arquétipo).

Pela regra explícita do harness ("Where the computed task conflicts with this request, this
request wins"), e por não ser possível conciliar as duas (investigar/consertar o bug do Animista
não é trabalho desta worktree/lock, que está reservada e isolada só para o6b), optei por:

1. **Não tocar em código, servidor, testes ou PRs da Onda 6b** neste turno — evita gastar o lock
   exclusivo do fecho e o CI em um esforço que o usuário não pediu agora.
2. **Não investigar o bug do Animista dentro desta worktree/sessão** — está fora do escopo do
   lock (`wt-d`, branch `ficha3/o6b`), rodando em paralelo com outras ondas; misturar features
   nessa branch contaminaria o PR de o6b e o achado do Animista pertence a outra frente/worktree
   (Alquimista/Animista, ver `.fusion-build/alquimista/` e `docs/design/animista/` na árvore
   principal).
3. Reportar o bloqueio e devolver o controle, para que uma sessão dedicada (ou o próprio
   Alexandre) trate o bug do Animista com o contexto correto (worktree do Animista, specs 
   relevantes) em vez de resolvido de forma isolada aqui.

## Estado verificado (sem alteração)

- Worktree `wt-d` (`ficha3/o6b`): sem mudanças novas; `git status --short` mostra apenas
  `tools/importer-pf2e/` não rastreado (herdado, não tocado).
- PRs: nenhum PR existente para a branch `ficha3/o6b` em `xansde/fusion` nem em
  `xansde/fusion-systems-2e` (`gh pr list --head ficha3/o6b --state all` retornou vazio nos
  dois repos) — ou seja, nada foi aberto, nada foi mergeado, PODE MERGEAR permanece NÃO.

## Pendência registrada (não é issue de bug de produto — é achado do processo)

- **id**: `evidencia-final`
- **severidade**: bloqueante
- **dono**: -
- **descrição**: conflito entre a fala relayada do usuário (bug real observado ao vivo no
  Animista: seleção de espíritos não atualiza lista de magias/filtro) e a tarefa computada
  (fechar Onda 6b do Guerreiro/ficha-nivel3). Pela prioridade do harness, a fala do usuário
  prevalece; a lane o6b não foi executada neste turno para não desviar contexto/lock de um
  fechamento que o usuário não pediu agora.
- **encaminhamento sugerido**: (a) abrir uma sessão/worktree dedicada ao bug do Animista
  (seleção de espírito → lista de magias/filtro) para reproduzir e corrigir; (b) re-disparar o
  fecho da Onda 6b normalmente depois, sem que este relato tenha alterado o estado da worktree
  `wt-d` (ela segue pronta para o fecho real quando solicitado).

## Não foi feito nesta invocação

- Gate final local (build/typecheck/lint/spec:report/testes da onda) — não rodado.
- `evidencia.md` da Onda 6b — não escrito (não houve execução da onda).
- PRs (satélite/core) — não abertos, não atualizados.
- Issues de pendências da onda — não levantadas (não houve execução).
- Merge — não ocorreu em lugar nenhum.
