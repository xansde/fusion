> **⚠️ OBSOLETO — não siga este documento.** Verificado em 2026-08-09: a esteira
> B0→B3 foi inteiramente concluída e mergeada (PRs #67, #70, #74, #75). Os 7 commits
> do B3 estão em `origin/build/app` e não há nenhum PR aberto. O que está descrito
> abaixo como "pausado" ou "travado" já não existe. Mantido só como registro
> histórico. Estado atual em `.fusion-build/r26/handoff-frentes-abertas.md`.

# Handoff — merge da stack de PRs (B0 → B1 → B2)

**Data:** 2026-08-02 · **Estado:** diagnóstico completo, nada aplicado ainda.

Sessão interrompida (queda de energia) no meio de uma decisão de arquitetura de CI —
ver "Decisão pendente" no fim. Nenhum arquivo de código foi tocado por esta sessão;
o único arquivo escrito é este handoff.

## A stack

| PR  | branch                  | base                | mergeable | CI      |
| --- | ----------------------- | ------------------- | --------- | ------- |
| #67 | `fix/b0-gates`          | `build/app`         | sim       | vermelho |
| #70 | `fix/b1-identidade`     | `fix/b0-gates`      | sim       | vermelho |
| #74 | `fix/b2-conteudo-packs` | `fix/b1-identidade` | sim       | vermelho |

Ordem obrigatória: **67 → 70 → 74**. Cada branch está **0 commits atrás** da sua base
(fast-forward limpo, sem rebase pendente). `build/app` **não** tem branch protection
(`404 Branch not protected`) — o GitHub não barra mecanicamente; o bloqueio é de
disciplina. `main` está parado em `512653a` (2026-06-12), **238 commits atrás** de
`build/app` — a integração real acontece na `build/app`, não na `main`.

## O que trava o merge: CI vermelho — as duas causas estão no B0

### 1. `pregen-parity.test.ts` lê um vendor que não existe no CI

```
ENOENT: scandir '.../tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics'
```

- `tools/importer-pf2e/vendor/` tem **0 arquivos versionados** (é um clone git do
  `foundryvtt/pf2e` que só existe na máquina local) e o workflow não o clona.
- O teste nasceu no B0 (issue #48) — `build/app` não o tem. Por isso o fix vai no B0
  e propaga por merge para B1 e B2.
- Impacto no #74: `1 failed | 175 passed`, 4036 testes verdes. É literalmente esse
  único suite.
- **Defeito estrutural:** `const ALL_PREGENS = loadPregens()` roda em **module scope**
  (linha 114), então o ENOENT derruba a coleta do arquivo inteiro — inclusive o bloco
  3, que não usa vendor nenhum. Ver "o que o teste verifica" abaixo.
- O vizinho `actionCategories.test.ts:144` já resolve isso certo, com
  `if (!existsSync(dir))` antes de varrer.

### 2. `format:check` falhando no #67

5 arquivos fora do Prettier, todos vindos do merge da `build/app` (que ela própria tem
101 arquivos desformatados — o CI da base está vermelho desde sempre):

- `packages/client/src/lib/sheets/pf2e/characterSheetVM.ts`
- `packages/client/src/lib/sheets/pf2e/planVM.ts`
- `packages/client/src/lib/sheets/pf2e/__tests__/class-levels-plan.test.ts`
- `systems/pf2e/src/__tests__/class-levels-spellcasting.test.ts`
- `systems/pf2e/src/variants/classLevels/levels.ts`

O B1 **já corrigiu** isso no commit `315c1da` ("style: formatar os arquivos que entraram
pelo merge da build/app") — por isso o #70 passa do format e só morre no teste. O fix
existe, está no lugar errado da pilha: precisa estar no B0 para o #67 ficar verde.

## O que o `pregen-parity.test.ts` verifica (405 linhas, 4 blocos)

É a **única rede não-circular** do projeto. O `varredura-classes.test.ts` compara a
derivação contra a tabela do próprio pack (esperado e obtido saem da mesma fonte) — foi
assim que 80 testes verdes conviveram com 60 defeitos reais (lição #48).

1. **Chassis vs. o item `class` embutido na ficha oficial** (11 classes): `hp`,
   `perception`, `savingThrows`, `attacks`, `defenses`, `keyAbility`. Pega proficiência
   que a curadoria dropou — foi o que achou o **#50** (arma favorecida da divindade do
   Cleric). **Precisa do vendor.**
2. **HP contra o número impresso oficial** (11 classes × 3 níveis = 33 casos):
   aritmética exata sobre os números da Paizo, isolando ancestry HP e mod de Con.
   **Precisa do vendor.**
3. **Invariantes de regra que não dependem de pack nenhum** (12 classes × 20 níveis):
   teto de skill increase (Master exige nível 7, Legendary 15) e rank ≤ 4. **NÃO precisa
   do vendor.** É o bloco que achou o **#49** — a regra não está implementada em lugar
   nenhum, então quebra nas 12 classes, e a varredura interna nunca poderia pegá-la
   (não há tabela contra a qual comparar uma regra ausente).
4. **Ratchet** (`KNOWN_DIVERGENCES`): divergência nova falha; divergência listada que
   parou de acontecer também falha (a baseline só encolhe). Hoje: `Cleric/classSystem.
   attacks.other` → #50, e `<Classe>/skillIncreaseCeiling` × 12 → #49.

Fonte de dados: `packs/pf2e/iconics` = **26 pastas, 85 fichas JSON**. Fração minúscula
do repo `foundryvtt/pf2e`.

## Decisão pendente (era a pergunta em aberto quando a sessão caiu)

A pergunta era: rodar esse gate só no caminho de integração (a ideia original foi
"staging → main") em vez de em toda branch?

Observações que já estavam levantadas para responder:

- **O repo não tem `staging`**, e `main` está parado desde junho, 238 commits atrás. Um
  gate condicionado a PR para `main` é um gate que **nunca roda** — na prática equivale
  a deletar o teste. Se for por esse caminho, o gate tem que ser no PR para
  `build/app`, que é a integração real. O workflow já tem
  `on: pull_request: branches: [main, master]`, mas os PRs atuais vão para `build/app`
  e disparam pelo `push: branches: ["**"]`.
- **Metade do teste não precisa do vendor.** O bloco 3 (invariantes de regra) é barato
  e é justamente o que pegou o #49. Ele só morre hoje por causa do `loadPregens()` em
  module scope. Separar os blocos deixa o mais valioso rodando em toda branch, de graça.
- **Trazer o vendor no CI é barato se feito certo**: `git clone --depth 1
  --filter=blob:none --sparse` + `sparse-checkout set packs/pf2e/iconics` traz só as 85
  fichas, não o histórico inteiro. Medido na máquina local: o vendor inteiro ocupa
  **429 MB**; a pasta `iconics` sozinha, **12 MB** — ~3% do total, e o `--depth 1
  --filter=blob:none` ainda corta o histórico por cima disso.
- Se os blocos forem separados em arquivos, o `KNOWN_DIVERGENCES` precisa ser dividido
  junto: as 12 entradas `skillIncreaseCeiling` vão com o bloco 3; a entrada do Cleric
  vai com o bloco 1. O ratchet do bloco 4 valida contra o `observed` do próprio arquivo.

**Recomendação registrada:** separar o bloco 3 para rodar sempre + guard lazy nos blocos
1/2/4 com sparse checkout do vendor no CI. Não aplicar guard cego no arquivo inteiro —
isso silenciaria também a única verificação que não custa nada.

## Plano de merge (depois que a decisão acima estiver tomada)

1. Na `fix/b0-gates`: aplicar a decisão sobre o `pregen-parity` + `pnpm format:write`
   nos 5 arquivos. Push → CI verde no #67.
2. Merge #67 → `build/app`.
3. `gh pr edit 70 --base build/app`, merge da `build/app` na b1 para trazer o fix,
   CI verde, merge #70.
4. Mesma coisa para o #74.

## Estado da árvore local (NÃO commitado)

Na `fix/b2-conteudo-packs` há **40 arquivos** modificados/novos do trabalho B3, fora de
qualquer PR: `prerequisiteTranslation.ts`, `documentNamesPt.ts`,
`compendium-source-ref.test.ts`, `traitNames.sync.test.ts`, os arquivos de
`tools/translate-packs/`, entre outros. Dois deles mexem no gate:

- `.github/workflows/ci.yml` — adiciona o step `Test tools (node:test)` rodando
  `@fusion/translate-packs` e `@fusion/importer-pf2e`.
- `tools/importer-pf2e/package.json` — adiciona o script `test`.

Nada disso foi verificado nesta sessão (testes não foram rodados). Commite ou stash antes
de trocar de branch para tocar o merge da stack.

## Comandos de contexto

```bash
gh auth switch --user xansde   # repo é da conta pessoal, não a seazone
gh pr list --repo xansde/fusion --state open
gh run view <id> --repo xansde/fusion --log-failed
```
