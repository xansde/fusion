# Baseline — T0.2 (Onda 0, wt-o0)

Worktree: `.../scratchpad/wt-o0` (core `ficha3/onda0`; submodule `external/fusion-systems-2e` em `ficha3/onda0`, tip `073fb5e`).

## `pnpm typecheck`

Exit 0. Sem falhas.

## `pnpm test` (vitest --workspace)

Exit 1. **3 arquivos falharam, 25 testes falharam** (de 8003 testes, 438 arquivos). Duração 385s.
Também 1 "Unhandled Error: [vitest-worker]: Timeout calling 'onTaskUpdate'" — flakiness de infra
conhecida (CLAUDE.md), não teste vermelho.

Nenhuma das falhas toca `KNOWN_CLASS_TRAITS`, `isFeatEligible` ou o picker de talento de classe —
todas são dívidas já documentadas em outras frentes.

| Arquivo | Teste(s) | Causa (uma linha) |
|---|---|---|
| `client/src/lib/compendium/__tests__/traitNames.sync.test.ts` | 2 | `TRAIT_NAMES_PT` desatualizado: faltam 11 chaves (necromancer, runesmith, ikon, additive, additive2, apparition, wandering, modification, mindshift, amp, evolution) — dívida nomeada da leva de 14+2 classes novas (issue #59), não regenerado ainda. |
| `sheets-pf2e/src/lib/sheets/pf2e/__tests__/actionCategories.test.ts` | 1 | 2 pastas do vendor (`impossible-spells`, `naval-combat`) sem grupo de exibição mapeado — vendor novo (Necromancer/Runesmith) sem curadoria de display group ainda. |
| `sheets-pf2e/src/lib/sheets/pf2e/__tests__/pregen-parity.test.ts` | 22 | `CLASSES_WITHOUT_PREGEN` esperava só `["Magus"]` e agora inclui Necromancer/Runesmith (pregens de referência ainda não existem para as 2 classes novas); além disso divergências de `attacks.other`/HP para Alchemist, Gunslinger e Commander contra o pregen oficial (dado de classe incompleto, não relacionado a talentos). |

## Conclusão para a T0.5

Qualquer regressão nova da T0.2 (guard + teste de vazamento) deve aparecer em arquivo diferente
destes 3, ou como falha adicional dentro deles com mensagem distinta das acima. Se
`pregen-parity.test.ts`, `actionCategories.test.ts` ou `traitNames.sync.test.ts` continuarem com
exatamente estas mensagens, não é regressão desta lane.
