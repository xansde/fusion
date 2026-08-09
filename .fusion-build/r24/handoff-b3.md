> **⚠️ OBSOLETO — não siga este documento.** Verificado em 2026-08-09: a esteira
> B0→B3 foi inteiramente concluída e mergeada (PRs #67, #70, #74, #75). Os 7 commits
> do B3 estão em `origin/build/app` e não há nenhum PR aberto. O que está descrito
> abaixo como "pausado" ou "travado" já não existe. Mantido só como registro
> histórico. Estado atual em `.fusion-build/r26/handoff-frentes-abertas.md`.

# Handoff — continuar a esteira de batches a partir do B3

Cole o bloco abaixo numa sessão nova, com o diretório de trabalho em
`C:\Users\xansd\pessoal\fusion`.

---

Você vai continuar uma esteira de correção de 71 issues abertas do repositório
`C:\Users\xansd\pessoal\fusion` (Fusion — VTT web em TypeScript, monorepo pnpm, sistema
Pathfinder 2e). Três batches já foram entregues; você retoma no **B3**.

## Onde está tudo

- **Plano completo:** `.fusion-build/r24/plano-batches.md` — 11 batches (B0–B10), com a
  justificativa de agrupamento, as dependências entre eles e as ondas de execução. **Leia
  primeiro.**
- **Levantamento original:** `.fusion-build/r22/varredura-jogabilidade.md` e a issue-mãe
  **#61** no GitHub (que tem um comentário meu com a tabela batch → PR → issues).
- **Repo GitHub:** `xansde/fusion` (conta **pessoal**). Push exige
  `gh auth switch --user xansde`, e voltar para `xansde-seazone` depois.

## Estado atual (verificado, não presuma — reconfira)

Três PRs abertos, **empilhados**, todos contra branch de integração (nunca `main`):

| PR | branch | base | issues |
|---|---|---|---|
| #67 | `fix/b0-gates` | `build/app` | #2, #27, #35, #48, #69, #68(parcial) |
| #70 | `fix/b1-identidade` | `fix/b0-gates` | #41, #47, #57, #15, #14, #58, #44, #68 |
| #74 | `fix/b2-conteudo-packs` | `fix/b1-identidade` | #1, #24, #16, #26, #28, #25, #30, #45, #46 |

**Ordem de merge: #67 → #70 → #74.** Nenhum foi mergeado ainda, então nenhuma issue está
fechada no GitHub (as keywords `Closes #N` só fecham quando chegar na `main`).

**22 de 71 issues resolvidas.** Restam os batches B3–B8, mais B9 (#66, sendo feita fora do
plano) e B10 (fechar a #61).

## Seu próximo passo: B3 — i18n de ponta a ponta

**Issues:** #10, #43, #9, #32, #42, #40, #64, #65 — **nesta ordem**, que não é arbitrária:
primeiro **parar de perder** tradução (#10 descarta `item.i18n` no painel de detalhes; #43
apaga o overlay de forma permanente ao importar do compêndio para o mundo), depois
**produzir** (#9 descrições, #32 pré-requisitos), depois **migrar** o que já foi gravado
vazio (#42 — é decisão de produto, resolva antes de codar), e por fim os rótulos de UI
(#40, #64, #65). Traduzir antes de consertar a #43 é encher balde furado.

**O escopo cresceu por causa do B2, e a issue #9 ainda não sabe disso.** Medi agora:

- **679** documentos com descrição EN e tradução PT vazia (o número que a #9 cita);
- **449** documentos que o B2 acabou de trazer e que **não têm entrada nenhuma** no
  overlay pt-BR: `feats-core` 348, `heritages-core` 45, `backgrounds-core` 40,
  `ancestries-core` 8, `class-features-core` 8.

Ou seja: os packs têm 4.236 documentos e o overlay cobre 3.787. **Comece medindo de novo**
e atualize a #9 com o número real antes de começar a traduzir.

O gate que reprova tradução vazia já existe e funciona (`missing-description` em
`tools/translate-packs/src/qa-checks.mjs`, feito na #27). Use-o para medir antes/depois.
Ele tem uma válvula explícita — `noDescription: true` no overlay — para o caso legítimo de
doc sem prosa; use-a em vez de deixar string vazia.

## Como trabalhar (isto não é opcional)

**Você orquestra, não executa.** Delegue implementação a subagentes `sonnet` via Agent
tool; fique no plano, na revisão e nos gates. Regras do usuário em
`~/.claude/rules/opus-delegation.md` e `orquestracao-subagentes.md`.

**Dimensione o fan-out pela fonte, não pelo número de issues.** Fan-out por fonte
disjunta; **batch por fonte compartilhada**. No B2 isso foi decisivo: 9 issues que
colidiam no mesmo `build-mvp-subset.mjs` e nos mesmos `documents.json` regerados tiveram
de rodar em série. No B3, verifique antes se as issues tocam arquivos disjuntos.

**Worktree isolado NÃO funciona para tudo neste repo:** `tools/importer-pf2e/out/` é
gitignored (165 MB de intermediários que só existem nesta máquina), então um agente em
worktree não consegue rodar o importador. Só isole quando a tarefa não depender disso.

**Verifique você mesmo.** Não aceite o relatório do subagente. No B2 um agente reportou
"tudo verde" tendo rodado pacote por pacote; rodando `pnpm test` no workspace inteiro
apareceram 5 falhas. Refaça as medições dele com script próprio — em três batches os
números da issue divergiram do real (#14 dizia 7 divergências, são 5; #24 tinha
diagnóstico errado: era teto de nível, não falta de livro).

**Proíba `git stash` nos prompts dos agentes.** Um agente usou e derrubou o trabalho de
outro três vezes. Instrua sempre: `git add <caminhos específicos>`, nunca `git add -A`, e
conferir `git log --oneline -3` antes de commitar para não engolir commit alheio.

## Gates, e o que é ruído conhecido

```
pnpm build · pnpm typecheck · pnpm lint · pnpm lint:boundaries
pnpm format:check      # deve dizer "All matched files use Prettier code style!"
pnpm test              # workspace inteiro, nunca pacote a pacote
node --test tools/importer-pf2e/src/__tests__/*.test.mjs
node --test tools/translate-packs/src/__tests__/*.test.mjs
```

- **Quatro arquivos são flaky sob carga** — `socket.test.ts`, `worldSync.test.ts`,
  `serve-tunnel-guard.test.ts`, `boot-nonblocking.test.ts`. Falham no workspace cheio e
  passam isolados, sempre. Qualquer OUTRO teste vermelho é problema de verdade.
- `pnpm test` costuma sair com código não-zero e `Timeout calling "onTaskUpdate"` mesmo
  com 0 testes falhando — flakiness de infra do vitest, já documentada no `CLAUDE.md`.
- `format:check` e `lint` estavam **vermelhos na `build/app` antes de tudo** e foram
  consertados nos B0/B1 (#68, #69). Não os quebre de novo.
- `tools/translate-packs` **não está no `vitest.workspace.ts`**, então `pnpm test` não o
  executa — rode `node --test` à mão. É a issue **#71** (traits `oath`/`consecration` sem
  tradução, teste vermelho que ninguém vê). **#71 ainda não está em batch nenhum e é
  parente direto do B3 — considere puxá-la para cá.**

## Regras inegociáveis do projeto

1. **Clean-room.** Nunca copiar código, arte ou texto proprietário da Paizo. Todo `img`
   dos packs precisa ser placeholder. Audite com script próprio varrendo campos
   aninhados e `system.items[].img` — hoje são 4.236 documentos, 9 valores distintos de
   `img`, todos placeholder. Não confie em leitura de código para isso.
2. **Identidade de documento é `flags.fusion.sourceId` (ou o `_id` do pack), nunca o
   nome.** Homônimo é a norma no PF2e — 62 nomes colidem entre os 4 packs principais.
3. Código, comentários e identificadores em **inglês**; docs, specs e mensagens de commit
   em **pt-BR com acentuação correta** (nunca "nivel"/"concessao"). Conventional Commits.
4. **Nunca corrigir `systems/pf2e/packs/*/documents.json` à mão** — o próximo
   `build-mvp-subset.mjs` sobrescreve em silêncio. Corrija na curadoria
   (`tools/importer-pf2e/src/curation/`) e regenere. O B2 criou o mecanismo
   `prerequisiteFixes` exatamente para isso, com `assertAllPrerequisiteFixesApplied`
   reprovando o build se um fix declarado não achar alvo. Siga esse padrão.
5. Nunca `push`, PR ou merge para `main`. PR sempre contra a branch de integração.

## Cuidado com a sessão paralela

Há **outra sessão** trabalhando na issue **#66** (multiclasse por níveis, UI) no MESMO
working tree. Ela commita direto na `build/app` e já commitou por engano dentro de duas
branches minhas — preservei em `mcl/66-classe-por-nivel` e `mcl/66-features-por-nivel`.
Ela toca `planVM.ts`, `PlanColumn.svelte`, `CharacterSheet.svelte` e `SpellsTab.svelte`.
Antes de qualquer commit, confira `git log --oneline -3`.

A `build/app` avança sozinha por causa disso — mergeie-a na sua branch antes de abrir o PR
e **rode os gates depois do merge**, não antes.

## Duas issues novas fora do plano

**#72** (descansar não recupera PV) e **#73** (multiclasse: invariante do eixo "ator
concedido") apareceram durante o trabalho e **não estão em batch nenhum**. Avalie onde
encaixam e atualize o `plano-batches.md`.

## Entrega

Um PR por batch, empilhado sobre o anterior enquanto os anteriores não forem mergeados.
Commit por issue, com `Closes #N` na mensagem E no corpo do PR. Descrição do PR com os
números que VOCÊ mediu, o que ficou de fora e por quê, e a saída real dos gates.

Nota sobre a sidebar "Development" do GitHub: PR empilhado em branch de feature **não**
recebe o vínculo automático (testei formato de keyword, reprocessamento e a API GraphQL —
não existe mutation pública para issue↔PR). Isso se resolve sozinho quando os PRs
reapontarem para `build/app` após os merges. Não gaste tempo nisso.
