# Fixer O0 — rodada 3

Alvo: satélite `ficha3/onda0` (base `6bb0893`) + core `ficha3/onda0` (base `63cacfed`).
Fonte dos achados: `revisao-adversarial-r2.md` (achado R1, importante, único achado
confirmado desta rodada — R2 do mesmo relatório é "menor" e não está na lista de
achados a consertar).

## Achado -> commit -> teste

| Achado | Severidade | Commit | Teste |
|---|---|---|---|
| R1 — campo de nível do modo edição (`oninput` + debounce 400ms) manda ops completas do `levelSet` para valores intermediários, apagando `classFeature` acima do nível e truncando `prepared` de slots de magia | importante | satélite `4a41939` `fix(pf2e): campo de nível não retrai grants nem trunca prepared em digitação intermediária`; core `b2bf41a1` `chore(ficha3-o0): re-pina o satélite após o fix de nível (fixer r3, R1)` | `characterSheetVM.test.ts` — `describe("CharacterSheetVM — updateLevelDraft")`, 3 casos novos. Vermelho antes (método não existia: `TypeError: vm.updateLevelDraft is not a function`), verde depois. |

## Diagnóstico

`CharacterSheet.svelte:820` (antes) tinha `oninput={handleLevelInput}`, que chamava
`vm.updateLevel(val)` a cada keystroke, agendado via `scheduleUpdate` (debounce de
400ms que só CANCELA o timer anterior — não impede o disparo de um valor
intermediário se o jogador pausar >400ms entre dígitos). `updateLevel` delega para
`planVM.levelSet`, que:
1. escreve `system.level.value`/`system.details.level`;
2. resincroniza `system.slots.<rank>` de toda entrada de conjuração não-focus,
   **truncando o array `prepared`** para o novo `max`;
3. emite `doc:delete` para todo `classFeature` cujo `grantedSlot` fique acima do
   novo nível.

Cenário do achado: Mago nível 12 editado para 10 — o jogador apaga o "2", o campo
fica em "1" por >400ms antes do "0", e o conjunto de ops do nível 1 é enviado:
grants acima do nível 1 são apagados e o `prepared` excedente se perde (o
heal-on-open só rematerializa grants ausentes, nunca repõe `prepared` truncado).

## Conserto

Dividido em dois caminhos, ao invés de só trocar o tipo de evento (o que não seria
testável sem DOM — ver nota abaixo):

- **`characterSheetVM.ts`**: novo método `updateLevelDraft(value)` — escreve
  SOMENTE o dual-write de nível (`system.level.value`/`system.details.level`),
  nunca retrai grant nem mexe em slot. Por construção, não existe caminho para
  esse método emitir `doc:delete` ou truncar `prepared`, então a garantia não
  depende de timing/debounce. `updateLevel` (inalterado) continua delegando para
  `planVM.levelSet`, com docstring atualizada explicando o novo contrato de
  disparo (`onchange`, não `oninput`).
- **`CharacterSheet.svelte`**: `handleLevelInput` (novo corpo, `oninput`) agora
  chama `vm.updateLevelDraft`; novo `handleLevelCommit` (`onchange`, dispara só em
  blur/Enter) chama `vm.updateLevel`. O `<input>` de nível ganhou os dois
  handlers.

## Por que não foi só "trocar `oninput` por `onchange`"

Essa era a sugestão primária da revisão e teria funcionado, mas este pacote
(`sheets/pf2e`, `vitest.config.ts`: `environment: "node"`) não tem jsdom nem
`@testing-library/svelte` — não há como simular digitação/blur num
`<input>` Svelte real neste ambiente, e adicionar dependência está fora de
escopo desta rodada (regra "não adicione dependência nova"). A divisão
draft/commit move a garantia comportamental para dentro de `characterSheetVM.ts`
(camada 100% headless, já é onde TODOS os testes de `updateLevel` existentes
vivem), tornando-a testável sem depender de simular eventos DOM: o teste novo
reproduz exatamente a transição que a review descreveu (nível 3 -> 2, que
`updateLevel` retrai) e prova que `updateLevelDraft` não retrai nada na mesma
transição. A mudança de wiring no `.svelte` (oninput -> draft, onchange -> commit)
foi conferida por leitura + `pnpm build` + `svelte-check` (0 erros), não por teste
automatizado — gap registrado abaixo.

## Verificação

- `characterSheetVM.test.ts` (arquivo completo): 218/218 verdes (antes: 3 vermelhos
  por `TypeError`, motivo certo).
- `planVM.test.ts`: 380/380 verdes (não tocado, rodado para garantir que
  `levelSet`/`updateLevel` continuam corretos).
- `pnpm build`: verde (core inteiro, incl. `packages/client` com o satélite).
- `pnpm typecheck`: verde, 0 erros (`packages/client` via `svelte-check`: 0 ERRORS,
  24 warnings pré-existentes, nenhum nos arquivos tocados além dos já existentes).
- `pnpm lint`: verde, 1 warning pré-existente em `pregen-parity.test.ts` (não
  tocado nesta rodada).
- `pnpm lint:boundaries`: verde, "no dependency violations found".
- `pnpm format:check`: verde.
- `pnpm spec:report`: `cobertura [MVP] com teste: 710 (piso 710)` — sem queda.

Suíte completa (`pnpm test`) NÃO rodada aqui por instrução explícita — fica para o
gate da onda/CI.

## Pendências para issue

Nenhuma pendência nova gerada por este achado. Nota de rastreio (não é issue, é
registro): a divisão draft/commit deixa uma lacuna de cobertura — a ligação real
`oninput`/`onchange` no `.svelte` (qual handler está em qual atributo) não tem
teste automatizado, só revisão manual + typecheck, porque `sheets/pf2e` não tem
harness de teste de componente (sem jsdom/testing-library, e adicionar uma é fora
de escopo desta rodada). Se algum dia esse pacote ganhar jsdom/testing-library
(decisão de outra rodada, não desta), vale um teste de integração que dirija o
`<input>` de verdade e confirme que digitar não emite `doc:delete`.

## Achados NÃO endereçados nesta rodada

- R2 (menor, mesmo relatório) — `self:armored` fica `true` para item de categoria
  `unarmored` — não estava na lista de achados desta rodada (só R1 foi passado no
  prompt do fixer).
