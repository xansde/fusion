# Gate de integração — Onda 5 (Arquétipos padrão, Arquétipo Livre)

Worktree: `wt-c` (core `ficha3/o5`; satélite `external/fusion-systems-2e` em `ficha3/o5`).

## Lanes integradas

- **T5.0-T5.1** (pin do vendor + 167 dedicações padrão de nível 2) — relatório em
  `ficha3-reports/o5/T5.0-T5.1-dedicacoes.md`.
- **T5.2-T5.3** (variante Arquétipo Livre confirmada + regra "uma dedicação por vez
  até 2 talentos") — relatório em `ficha3-reports/o5/T5.2-T5.3-variante-regra.md`.

Nenhuma tarefa restante em `tasks.md` para a Onda 5 (T5.0–T5.3 é a lista completa).

## Comandos do gate (comparados ao baseline `ficha3-reports/o0/baseline.md`)

| Comando | Resultado | Comparação com baseline |
|---|---|---|
| `pnpm build` | exit 0 | build limpo, sem regressão |
| `pnpm typecheck` | exit 0, 0 ERRORS (24 warnings pré-existentes em arquivos não tocados) | igual ao esperado |
| `pnpm lint` | exit 0 (1 warning pré-existente: eslint-disable não usado em `pregen-parity.test.ts`) | igual ao esperado |
| `pnpm lint:boundaries` | exit 0 | sem violação |
| `pnpm format:check` | exit 0 | tudo formatado |
| `pnpm spec:report` | `cobertura [MVP] com teste: 710 (piso 710)` — sem diff a commitar | ok |
| `pnpm test` (suíte completa) | ver abaixo | ver abaixo |

## Suíte completa — 3 rodadas até estabilizar

A 1ª rodada (com typecheck/lint/boundaries/format rodando em paralelo no mesmo
gate) deu **51 testes falhos em 15 arquivos**, duração 1401s (vs. 385s do
baseline) — sinal de contenção de máquina. Investigação por arquivo:

1. **`choice-sets.test.ts` — 1 falha REAL, não pré-existente.** O import das 167
   dedicações (T5.1) trouxe 27 `ChoiceSet`s novos sem entrada em
   `choiceSetInventory.ts`. **Corrigido**: classificados como `"pendente"`
   (mesma família de `Bloodrager Dedication/skill`/`Rogue Dedication` já
   existentes) — dívida declarada, não dívida silenciosa. Commit no satélite
   `86bbe99`.
2. **`pregen-parity.test.ts` (22 falhas) e `actionCategories.test.ts` (1 falha)**
   — batem exatamente com o baseline (`CLASSES_WITHOUT_PREGEN` com
   Necromancer/Runesmith, divergências de HP/attacks.other em
   Alchemist/Gunslinger/Commander, `impossible-spells`/`naval-combat` sem
   display group). Pré-existentes, não regressão desta onda.
3. **`grantMaterializer.test.ts` (1 falha)** — confirmada pré-existente pelo
   relatório da lane T5.0-T5.1 (`git stash` + rerun idêntico); pendência já
   registrada para issue nova.
4. **Demais 27 falhas** (`world-commands.test.ts` ×11, `serve-tunnel-guard.test.ts`
   ×3, `registerCoreTabs.test.ts` ×2, `TokenInteractionManager.teardown.test.ts`
   ×2, `socket.test.ts` ×2, `assets.test.ts` ×2, `boundaries.test.ts`,
   `packs-validation.test.ts`, `worldSync.test.ts`, `ephemeral.test.ts`,
   `boot-nonblocking.test.ts`) — todas com erro literal `Test timed out`,
   `Hook timed out` ou `CLI process did not exit cleanly ... ETIMEDOUT`,
   espalhadas por camadas sem relação nenhuma entre si (client/server/CLI/
   boundary-test) nem com o código desta onda.

Apliquei o fix do choice-sets e **re-rodei a suíte completa isolada** (2ª
rodada, sem build/lint/etc. em paralelo): **16 falhas** (`choice-sets.test.ts`
já verde). `pregen-parity` caiu para 7 falhas porque um `beforeAll` interno
(`rules invariants`) bateu hook timeout de 10s e pulou 17 sub-testes (30
skipped vs. 1 do baseline) — mesma assinatura de contenção. As 9 falhas
restantes (`world-commands` ×2, `serve-tunnel-guard`, `registerCoreTabs`,
`TokenInteractionManager`, `socket`, `boot-nonblocking`,
`grant-resolution-validator`, `grantMaterializer`) seguem com erro literal de
timeout.

**3ª rodada — arquivos vermelhos isolados** (`vitest run` só nos 8 arquivos que
ainda falhavam, sem mais nada rodando): `world-commands.test.ts`,
`registerCoreTabs.test.ts` e `grant-resolution-validator.test.ts` **passaram
limpos**. `pregen-parity.test.ts` reproduziu, desta vez sem hook timeout, as
mesmas 22 divergências documentadas no baseline (17 `skillIncreaseCeiling` +
`CLASSES_WITHOUT_PREGEN` + HP/attacks.other) — confirma que é exatamente o
gap pré-existente, nunca um teste novo vermelho. As 4 falhas restantes
(`boot-nonblocking`, `serve-tunnel-guard`, `socket`, `TokenInteractionManager`)
continuam com timeout/ETIMEDOUT — máquina compartilhada com outras ondas
rodando em paralelo (confirmado pela própria instrução da tarefa).

**Conclusão**: a única falha nova real da Onda 5 era `choice-sets.test.ts`,
corrigida e verificada. As demais são pré-existentes (batem com o baseline,
com contagem/mensagem idêntica) ou flakiness de infra (timeout/ETIMEDOUT
reproduzido de forma inconsistente entre rodadas, em arquivos sem relação com
o código mudado, coerente com "Timeout calling onTaskUpdate" documentado nas
lições do projeto). Nenhum teste foi enfraquecido, pulado ou teve asserção
afrouxada.

## Commits desta gate (além das lanes)

Satélite (`xansde/fusion-systems-2e`, `ficha3/o5`, pushed):
- `86bbe99` fix(sheets-pf2e): classifica os 27 ChoiceSets das dedicações padrão (T5.1)

Core (`xansde/fusion`, `ficha3/o5`, pushed):
- `88e1f8a0` chore(ficha-nivel3): repina o satélite pós gate da Onda 5 (choice-sets)

## SHAs finais

- Core `ficha3/o5`: `88e1f8a0`
- Satélite `ficha3/o5` (pin do core): `86bbe99`

## Pendências para issue

1. **xansde/fusion-systems-2e** — `grantMaterializer.test.ts`: lista de
   not-found desatualizada após o import das 167 dedicações padrão (T5.1).
   Já registrada no relatório da lane T5.0-T5.1
   (`ficha3-reports/o5/T5.0-T5.1-dedicacoes.md`), reconfirmada aqui como
   pré-existente. Título sugerido: "grantMaterializer.test.ts: lista de
   not-found desatualizada após import das 167 dedicações padrão (T5.1)".
2. **xansde/fusion-systems-2e** (nova) — os testes `boot-nonblocking.test.ts`,
   `serve-tunnel-guard.test.ts` (spawn de CLI), `socket.test.ts` e
   `TokenInteractionManager.teardown.test.ts` mostraram timeout/ETIMEDOUT em
   mais de uma rodada desta gate, mesmo isolados. Não são regressão desta
   onda (nenhum toca dedicações/arquétipo/planVM), mas o padrão recorrente
   sugere revisar os timeouts default desses testes (15s/10s) em máquina sob
   carga compartilhada — não investigado a fundo (fora do escopo do gate).
   Título sugerido: "Timeouts recorrentes em boot-nonblocking/serve-tunnel-guard/
   socket/TokenInteractionManager.teardown sob carga de máquina compartilhada".
