# Evidência de fecho — Onda 5 (Arquétipos padrão, variante Arquétipo Livre)

Worktree: `wt-c` | Core `ficha3/o5` @ `c8bebc02` | Satélite `ficha3/o5` @ `d88c5ff`
(pino do core aponta exatamente para este commit do satélite).

## PODE MERGEAR: SIM

Revisão adversarial (rodadas 1 e 2) aprovada — zero achado bloqueante ou importante em aberto
após as duas rodadas de fixer. Ver seção "Veredito da revisão adversarial" abaixo.

## 1. Linha da Onda 5 na tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **5** | `pnpm test` isolado em `choice-sets.test.ts` (6 testes), `planVM.test.ts` (414 testes), `grantMaterializer.test.ts` (75 testes) e `classFeatLeakGuard.test.ts` — **500/500 verdes** (rodado agora, HEAD `c8bebc02`/`d88c5ff`); `pack-index-consistency.test.mjs` — **42/42 verde**; teste de census afirmando **129 dedicações padrão** listadas e **0** de multiclasse no slot de nível 2 (ver T5.0-T5.1-dedicacoes.md e T5.2-T5.3-variante-regra.md para o detalhamento por tarefa) | Personagem nv2 (Bárbaro "Novo Ator", mundo `teste_xande` copiado em `<scratchpad>/data-o5`) com **Sanguimancer Dedication** escolhida no slot "Talento de Arquétipo" nível 2, confirmada gravada em `world.db` com `flags.fusion.build.slot === "archetypeFeat-2"` e sem trait `multiclass`; Alchemist/Rogue Dedication (multiclasse) confirmadas **ausentes** do mesmo picker mesmo com "Multiclasse por nível" ligado (condição adversarial) | `prints-final/01` a `06` (config do mundo, picker, defeito fechado ausente, seleção, gravação no slot) — ver seção 3 |

## 2. Saída real dos comandos — gate final local (SEM suíte completa), rodado agora em `wt-c`

```
$ pnpm build
...
packages/client build: ✓ built in 21.26s
packages/client build: Done
(exit 0, todos os pacotes do workspace compilaram)

$ pnpm typecheck
packages/client typecheck: COMPLETED 1612 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS
(exit 0 — 24 warnings pré-existentes, mesma contagem do baseline)

$ pnpm lint
$ eslint .
.../pregen-parity.test.ts
  69:3  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
✖ 1 problem (0 errors, 1 warning)
(exit 0 — warning pré-existente, mesmo do baseline)

$ pnpm lint:boundaries
$ depcruise --config .dependency-cruiser.cjs packages systems tools external/fusion-systems-2e/systems external/fusion-systems-2e/sheets
✔ no dependency violations found (5036 modules, 12139 dependencies cruised)
(exit 0)

$ pnpm format:check
$ prettier --check "**/*.{ts,tsx,json,md}"
Checking formatting...
All matched files use Prettier code style!
(exit 0)

$ pnpm spec:report
$ node --experimental-strip-types tools/spec-lint/bin/report.ts
cobertura [MVP] com teste: 710 (piso 710)
(exit 0 — sem diff a commitar; único item não versionado é tools/importer-pf2e/ residual, não tocado)
```

### Testes das tarefas da onda (arquivos afetados, isolados — não a suíte completa)

```
$ npx vitest run src/lib/sheets/pf2e/__tests__/choice-sets.test.ts \
    src/lib/sheets/pf2e/__tests__/planVM.test.ts \
    src/lib/sheets/pf2e/__tests__/grantMaterializer.test.ts \
    src/lib/sheets/pf2e/__tests__/classFeatLeakGuard.test.ts
  (rodado em external/fusion-systems-2e/sheets/pf2e)

✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/choice-sets.test.ts (6 tests) 414ms
✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/planVM.test.ts (414 tests) 128ms
✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/grantMaterializer.test.ts (75 tests) 897ms
  ✓ issue #16: every declared grant across the 14 real packs resolves (or is a documented
    pre-existing gap) > the 12 issue #16 targets all resolve (a predicate-unsupported report
    is not a resolution failure — O0 C5) 320ms

 Test Files  4 passed (4)
      Tests  500 passed (500)
   Duration  3.73s
```

```
$ node --experimental-strip-types --test src/__tests__/pack-index-consistency.test.mjs
  (rodado em external/fusion-systems-2e/tools/importer-pf2e)

1..42
# tests 42
# pass 42
# fail 0
```

### Suíte completa — números do gate anterior (`ficha3-reports/o5/gate.md`, HEAD `88e1f8a0`, antes dos fixers)

A suíte COMPLETA rodou 3 vezes durante o gate original (antes das rodadas de fixer C-3/C-6). Números
finais, 3ª rodada com arquivos vermelhos isolados: única falha nova real da Onda 5 era
`choice-sets.test.ts` (27 ChoiceSets sem entrada em `choiceSetInventory.ts`), **corrigida e
verificada** dentro do próprio gate (commit `86bbe99` no satélite). As demais falhas restantes
batem exatamente com `pregen-parity`/`actionCategories`/`grantMaterializer` pré-existentes
(mesma contagem do baseline `ficha3-reports/o0/baseline.md`) ou são timeout/ETIMEDOUT de infra
sob carga de máquina compartilhada (`world-commands`, `serve-tunnel-guard`, `registerCoreTabs`,
`TokenInteractionManager`, `socket`, `boot-nonblocking`) — reproduzidos de forma inconsistente
entre rodadas, sem relação com o código da onda; isolados um a um, passaram limpos. Detalhamento
completo em `gate.md` (copiado nesta pasta). A suíte completa pós-fixer e o CI do PR (ver seção 4)
são a verificação que falta — não repetida aqui por instrução explícita da tarefa de fecho.

## 3. Prints — o que cada um prova

`prints/` (lane inicial, achados vivos, ANTES do fix):
- `01-variante-arquetipo-livre-ligada.png` — mundo com a variante Arquétipo Livre habilitada.
- `02-picker-slot-arquetipo-nivel2-lista-inicial.png` — picker do slot "Talento de Arquétipo" nv2 aberto.
- `03-DEFEITO-slot-arquetipo-mostra-multiclasse.png` — Achado 1 (C-3): dedicação de multiclasse vazando no slot padrão.
- `04-DEFEITO-sanguimancer-nao-aparece.png` — Achado 2 (C-6): Sanguimancer Dedication ausente do picker.
- `05-acrobat-dedication-selecionado-antes-confirmar.png` — Acrobat Dedication (dedicação padrão sem defeito) selecionável.
- `06-dedicacao-gravada-no-slot-nivel2.png` — Acrobat Dedication gravada no slot nível 2.

`prints-final/` (lane de reverificação, DEPOIS do fix, contra `c8bebc02`/`d88c5ff`):
- `01-config-mundo-arquetipo-livre-e-multiclasse-ligados.png` — condição adversarial: Arquétipo Livre E Multiclasse por nível ligados ao mesmo tempo.
- `02-picker-slot-arquetipo-nivel2-lista-inicial.png` — picker sem o filtro "multiclasse" (nenhum item carrega mais essa tag).
- `03-sanguimancer-agora-aparece.png` — Achado 2 fechado: Sanguimancer Dedication aparece na busca.
- `04-alchemist-dedication-multiclasse-nao-aparece.png` — Achado 1 fechado: Alchemist Dedication (multiclasse) continua ausente mesmo com o toggle ligado.
- `05-sanguimancer-selecionada-antes-confirmar.png` — Sanguimancer Dedication selecionada.
- `06-sanguimancer-gravada-slot-nivel2.png` — UI mostra "✓ Sanguimancer Dedication" no bloco NÍVEL 2; confirmado no `world.db` (ver evidencia-viva-final.md).

## 4. Veredito da revisão adversarial (e re-verificações)

- **Rodada 1** (`revisao-adversarial.md` + `revisao-adversarial-r1.md`): achados C-1 a C-10
  levantados; C-1, C-3, C-4, C-5 fechados na hora; **C-2 reaberto como IMPORTANTE** (index.json
  não restaurado — drift de 7 entradas incluindo Sanguimancer) e **C-6 confirmado ABERTO**
  (Sanguimancer Dedication invisível no picker, consequência direta do C-2).
- **Fixer rodada 1** (`fix-r1.md`): conserta C-2 (regenera `index.json` a partir do `documents.json`
  via `regenerate-pack-index.mjs`) e C-6 decorre do mesmo conserto. C-7/C-8/C-9/C-10 documentados
  como pendências menores fora do escopo desta rodada.
- **Fixer rodada 2** (`fix-r2.md`): confirma que o `index.json` regenerado é servido preferencialmente
  pelo `CompendiumService`, fecha o ciclo.
- **Rodada 2** (`revisao-adversarial-r2.md`): **APROVADA**. C-2 e C-6 reverificados FECHADOS
  (0 divergências entre índice pré-onda e pós-fix nas 2759 entradas antigas; teste
  `pack-index-consistency.test.mjs` 42/42 verde, e provado que ele pega o defeito rodando contra
  o estado anterior ao conserto). Nenhum achado novo bloqueante ou importante.
- **Reverificação viva final** (`evidencia-viva-final.md`, lane independente, contra `c8bebc02`/`d88c5ff`):
  reconfirma ao vivo, na UI e no banco, que Achado 1 (multiclasse vazando) e Achado 2 (Sanguimancer
  invisível) seguem fechados sob a condição mais adversarial (Multiclasse por nível ligado).

## 5. Pendências e issues

Todas as pendências identificadas nos relatórios da Onda 5, com issue já criada ou já existente:

| # | Origem | Repo | Issue |
|---|---|---|---|
| 1 | T5.0-T5.1 | fusion-systems-2e | [#121](https://github.com/xansde/fusion-systems-2e/issues/121) — pt-BR: traduzir as 167 dedicações novas |
| 2 | T5.0-T5.1 | fusion-systems-2e | [#122](https://github.com/xansde/fusion-systems-2e/issues/122) — importar talentos de seguimento (nv4+) dos mesmos arquétipos |
| 3 | T5.0-T5.1 | fusion-systems-2e | [#123](https://github.com/xansde/fusion-systems-2e/issues/123) — drift entre `transform.mjs` e packs committed em 2026-09-15 |
| 4 | fix-r1 (C-7) | fusion-systems-2e | [#142](https://github.com/xansde/fusion-systems-2e/issues/142) — planVM: seguimento com pré-requisito composto "A or B" não reconhecido |
| 5 | fix-r1 (C-8) | fusion-systems-2e | [#143](https://github.com/xansde/fusion-systems-2e/issues/143) — PlanColumn: dedicação bloqueada some do picker sem motivo visível |
| 6 | fix-r1 (C-9) | fusion-systems-2e | [#144](https://github.com/xansde/fusion-systems-2e/issues/144) — pool de 166 dedicações não checa pré-requisito/raridade/arquétipo de classe |
| 7 | fix-r1 (C-10) | fusion-systems-2e | duplicata de [#121](https://github.com/xansde/fusion-systems-2e/issues/121) (mesma pendência: 163/167 dedicações sem pt-BR) — não recriada |
| 8 | T5.2-T5.3 / gate.md #1 | fusion-systems-2e | [#145](https://github.com/xansde/fusion-systems-2e/issues/145) — `grantMaterializer.test.ts`: lista de not-found desatualizada após import das 167 dedicações |
| 9 | gate.md #2 | fusion-systems-2e | [#146](https://github.com/xansde/fusion-systems-2e/issues/146) — timeouts recorrentes em boot-nonblocking/serve-tunnel-guard/socket/TokenInteractionManager sob carga compartilhada |

Nenhuma pendência ficou só no relatório.

## 6. Não verificado (herdado das lanes, não refeito nesta lane de fecho)

- Não foi feita amostragem das 165 dedicações padrão restantes (fora Acrobat e Sanguimancer).
- Não testado o comportamento com "Multiclasse por nível" desligado (testado só com o toggle
  ligado, condição mais adversarial).
- Suíte completa pós-fixer (com `c8bebc02`/`d88c5ff`) não foi re-rodada nesta lane de fecho —
  por instrução explícita da tarefa, essa verificação fica para o CI do PR.
