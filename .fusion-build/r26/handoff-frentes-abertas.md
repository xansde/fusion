# Handoff — frentes abertas do Fusion (levantamento de 2026-08-09)

Sessão de compilação: várias sessões haviam sido pausadas por limite de RAM. Este
documento é o resultado de varrer **todas** as branches com trabalho não mergeado.

> **Leia antes de qualquer coisa:** os handoffs em `.fusion-build/r24/` estão
> **OBSOLETOS** e me induziram ao erro. Eles descrevem a esteira B0→B3 como pausada
> com PRs travados. Ela foi inteiramente concluída depois que aqueles documentos
> foram escritos. Conferir sempre contra o git antes de acreditar em handoff.

## A referência que vale: `origin/build/app`

A branch de integração real é `build/app`, **não** `main`. `origin/main` está 76
commits atrás. Toda comparação de "isso já foi entregue?" é contra `origin/build/app`.

```bash
git fetch origin
git rev-list --left-right --count origin/build/app...<branch>   # atrás / à frente
git merge-base --is-ancestor <branch> origin/build/app          # já absorvida?
```

## Estado verificado em 2026-08-09

- **Nenhum PR aberto** no repositório (`gh pr list --state open` → vazio).
- Esteira B0→B3 mergeada: PRs #67, #70, #74, #75, mais #89, #91, #92.
- Os 7 commits do B3 (`0248225`…`456620e`) estão todos em `origin/build/app`.
- `fix/b2-conteudo-packs` tem **zero commits próprios** — é ancestral da `build/app`.

## O que foi feito nesta sessão (branch `feat/avatar-do-personagem`)

A branch **não subia**: `1e909ff` pôs em `boot.ts:551` um
`await import("./avatar/routes.js")`, mas o módulo nunca entrou no índice
(`git log --all --diff-filter=A -- 'packages/server/src/avatar/*'` volta vazio).
Só existia untracked na árvore local.

| commit | o quê |
| --- | --- |
| `d7934a7` | commita a rota `/avatar/*` + 9 testes (9/9 verdes) — conserta o boot |
| `40faa01` | sidecar do acervo fora do blob SEA + correção do tamanho |
| `8c2a9b9` | lição do `CLAUDE.md`: serve de teste em porta não-default |
| `50d8cb9` | formata 20 arquivos de avatar/Isekai que reprovavam `format:check` |

**Gates medidos depois dos commits:** build ✓ · typecheck 0 erros ✓ · lint limpo ✓ ·
lint:boundaries 0 violações ✓ · `pnpm test` **221/221 arquivos** ✓ · `format:check`
reprova só em `.claude/commands/subir-tunel.md` (untracked, decisão pendente).

Servidor validado ao vivo em `--port 33001 --data-dir ~/.fusion --world isekai`:
o log traz `Serving the avatar acervo at /avatar/*`, `/avatar/catalogo.json` devolve
200 com 1,69 MB e `/avatar/atlas/nao-existe.png` devolve **404 honesto** (não o
index.html da SPA com 200, que era o defeito que a rota existe para evitar).

### Duas armadilhas de medição desta sessão

1. **`dist/` do shared sobrando de outra branch fabrica erro que parece regressão.**
   O typecheck acusou 27 erros `@fusion/shared has no exported member 'AvatarFlag'`.
   Não era defeito — era o `dist` da branch anterior. `pnpm build` zerou. Depois de
   trocar de branch, **rebuildar antes de acreditar no typecheck**.
2. **`git stash` não leva untracked.** Ao trocar para outra branch para rodar gates,
   `packages/server/src/avatar/` e `avatar-routes.test.ts` viajaram junto e
   contaminaram `pnpm test` e `format:check` com 4 falhas que não eram da branch
   testada. Use `git stash -u` ou mova os untracked para fora.

## Correção de conteúdo aplicada

O tamanho do acervo do avatar estava errado em **três** lugares e em duas grandezas:
os comentários novos diziam 58 MB, o plugin Vite já commitado dizia ~6,7 MB.
**Medido: 22 MB, 669 arquivos, 643 PNGs** (`du -sb` sobre o `saida/` do pacote
pinado). A decisão do sidecar continua correta — 134 MB de executável + 22 MB estoura
o teto de 150 MB do REQ-DST-046 — mas o total projetado cai de ~193 MB para ~156 MB.

## As frentes, por estado

### Prontas para PR (ordem recomendada)

| branch | à frente / atrás | observação |
| --- | --- | --- |
| `feat/camada-isekai-2` | 4 / 0 | fatia limpa do Isekai, zero conflito. **Abrir primeiro** |
| `feat/system-window-hub` | 7 / 0 | merge `4d99afd` é **local, nunca pushado** |
| `feat/ficha-alvo-fofurinha` | 3 / 19 | catraca de 11 lacunas; só coordena se sair da branch |
| `main` | 5 / 0 | é `build/app` + Isekai. Push como `feat/*`, **nunca** `main:main` |

### Em andamento

- **`feat/avatar-do-personagem`** (16 / 7) — avatar + Isekai + fix de canvas fundidos.
  Precisa de rebase sobre `build/app`: dois commits já chegaram lá por outro caminho,
  então há conflito garantido em `planVM.ts`, `characterSheetVM.ts`, `loreSlug.ts` e
  `merge.ts`. A **spec 33 está desatualizada**: a REQ-AVT-041 ainda descreve o acervo
  dentro do executável, decisão que o sidecar inverteu.
- **`feat/ancestries-heritages`** (1 / 0) — PC1 ∪ PC2, ancestralidades 10→17 e heranças
  53→107. Traz um bug real não anunciado: o predicado só casava por
  `system.ancestry.slug`, e herança versátil tem `ancestry === null`. **Pendente:** os
  61 documentos novos estão em inglês — rodar `tools/translate-packs` e regenerar
  `documentNamesPt.ts`.

### Mortas — candidatas a deleção (pede OK humano)

`fix/antecedente-pericias`, `fix/antecedente-pericias-only`,
`fix/portas-dinamicas-testes`, `mcl/66-classe-por-nivel`, `mcl/66-features-por-nivel`,
`test/mario-prs` (e `pr-79`, local-only). Todas com conteúdo já superado na
`build/app`. As `mcl/*` foram superadas pelo commit `ab4966f`.

## Duplicação a resolver

A camada Isekai existe em **três** lugares: `main`, `feat/camada-isekai-2` e
`feat/avatar-do-personagem`. Verificado: `main` e `avatar` são **byte-a-byte
idênticas** (`git diff main feat/avatar-do-personagem -- '*sekai*'` volta vazio).
Recomendação: eleger `feat/camada-isekai-2` como canônica (única fatia limpa) e
resolver as outras duas pelo rebase.

## Sete stashes de sessões antigas

Não verificados — provavelmente já na `build/app`, já que as branches de origem foram
mergeadas, mas **isso não foi conferido**.

```
stash@{0} sound-m3 (feat/wi-token-ficha-01)          4 arq  +52/-2
stash@{1} wip-antes-do-teste-prs-mario               5 arq  +50/-29
stash@{2} outra sessão live #44/#66 (fix/b1)         8 arq  +336/-42
stash@{3} outra sessão #44/#66 (fix/b1)              8 arq  +382/-42
stash@{4} r19-w4 derivations-kineticist              1 arq  +33/-13
stash@{5} r19-w4 embeddedModifiers/hp                2 arq  +70/-19
stash@{6} r18n1-render-wip (build/app)               4 arq  +228/-2
```

## Decisões pendentes do humano

1. **Qual cópia do Isekai é canônica** (ver duplicação acima).
2. **`.claude/` e `.esteira/`** — versionar, gitignorar ou deixar fora? O `.gitignore`
   já ignora `.claude/worktrees/` e `.claude/launch.json`, então há convenção. Enquanto
   não decidir, `format:check` fica vermelho por `.claude/commands/subir-tunel.md`.
3. **Apagar as seis branches mortas.**
4. **Abrir os PRs** — nenhum foi aberto; é ato humano.
