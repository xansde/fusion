# Revisão adversarial Onda 0 — lente COSTURA + CI + HIGIENE (2026-09-21)

Veredito: **REPROVADA para merge** — CI vermelho nos dois repos, no exato commit pinado.

## Evidência de CI (runs reais no GitHub)
- Core `xansde/fusion` run 35558489316 (commit e8460b3f, o pin): **failure** — 2 arquivos / 3 testes:
  - `packages/client/src/lib/compendium/__tests__/traitNames.sync.test.ts` (2): "TRAIT_NAMES_PT has 217 keys but the glossary has 228"; faltam necromancer, runesmith, ikon, additive, additive2, apparition, wandering, modification, mindshift, amp, evolution.
  - `grant-resolution-validator.test.ts` (1): "8 grant(s) do not resolve locally and are NOT on the allowlist".
- Core run anterior (513b971d, só docs, pin ainda em e0597c9=v0.1.1): **success**. Logo as 3 falhas são INTRODUZIDAS pelo pin, não pré-existentes.
- Satélite run 35557899943 (77a31bc, o commit pinado): **failure** em "Test sheets/pf2e" (step sem continue-on-error) — mesmo validador, 8 grants.
- Satélite 073fb5e (tip de feat/classes-necromancer-runesmith): success.

## Achados
### B1 (bloqueante) — validador T0.4 entra vermelho de propósito num step de CI que gateia
`sheets/pf2e/src/lib/sheets/pf2e/__tests__/grant-resolution-validator.test.ts:117` lança para os 8 grants de #88/#89 (Battle Creed x7, Undead Creator). O T0.5 chama isso de "vermelho correto esperado", mas o teste roda em `pnpm --filter @fusion/sheets-pf2e test` (satélite) e em `pnpm test` (core), ambos sem continue-on-error. Consequência: nenhum PR da onda fica verde; pela regra da sessão, não pode mergear; e todo PR futuro em alfa/app e no main do satélite herda o vermelho, anulando o gate para regressões reais. Conserto: registrar os 8 como dívida nomeada (categoria nova, p.ex. `blocked-issue` com o número da issue, que o teste de "stale" já força remover quando resolver) ou consertar os 2 casos.

### B2 (bloqueante) — `traitNames.sync.test.ts` quebra no core com o novo pin
O glossário do satélite (29 classes, PR #57/#65) ganhou 11 traits; `TRAIT_NAMES_PT` do client do core não foi regenerado. O baseline.md classificou como "dívida pré-existente" porque mediu com o submodule já em 073fb5e — relativo a origin/alfa/app é regressão desta onda. Conserto: rodar `node tools/translate-packs/gen-client-maps.mjs` (agora em external/fusion-systems-2e/tools/translate-packs) e commitar o mapa no core junto do pin.

### I1 (importante) — pin aponta para commit de branch de feature, sem tag
`external/fusion-systems-2e` -> 77a31bc, que só existe em `origin/ficha3/onda0` do satélite (não está em main, não tem tag). Convenção do projeto (CLAUDE.md) é "submodule pinado por tag"; o pin anterior era v0.1.1. Os dois repos permitem squash/rebase merge: se o PR do satélite (ainda NÃO aberto — só existem #57 e #65) for mergeado por squash/rebase e a branch apagada, 77a31bc fica inalcançável e `actions/checkout submodules: true` do core falha no clone. Ordem correta: PR #57 -> #65 -> PR ficha3/onda0 no main do satélite com merge commit -> tag v0.1.2 -> re-pin no core no commit tagueado -> só então mergear o core.

### M1 (menor) — dívida vendor-dependente invisível no CI
pregen-parity (22) e actionCategories (1) falham localmente com vendor presente mas se auto-pulam no CI (vendor gitignored). HP/attacks.other divergentes de Alchemist/Gunslinger/Commander nunca aparecem no CI. Já coberto pela issue #91 do satélite — confirmar que #91 lista esses casos por nome.

## Verificado sem achado
- Lockfile: nenhum package.json mudou em e0597c9..77a31bc; `pnpm install --frozen-lockfile` passou no CI do core.
- spec:report: piso 710 bate, sem arquivo gerado alterado.
- Higiene: diff do core = 13 .md de docs + pin; diff do satélite = 3 testes, 1 .mjs de allowlist, 1 export. Nada de data-dir, auth_secret, node_modules, dist, vendor, out/. `tools/importer-pf2e/vendor` (symlink para o checkout principal) está UNTRACKED na worktree do core — não está no diff, mas é armadilha para `git add -A`.
- core-ref.txt (aedda2c, 18 commits atrás de alfa/app): satélite testa sheets contra ele e só o validador falhou — não precisa mudar para esta onda.
- 29 classes x 12 antigas: com o pin novo o core só quebra nos 2 pontos acima; varredura/packs-validation verdes; KNOWN_CLASS_TRAITS com as 29 e teste com prova de vazamento (T0.2) roda no CI. Summoner/Witch spellcasting ficou `it.fails` (issue #59) — dívida nomeada, no escopo das ondas seguintes.
