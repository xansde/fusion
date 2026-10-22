# Fix O0 — rodada 4

Alvo: achado N1 (importante) de `revisao-adversarial-r3.md`.

## Achado -> commit -> teste

| Achado | Conserto | Commit (satélite) | Commit (core) | Teste |
|---|---|---|---|---|
| N1 — commit de nível (`onchange` -> `handleLevelCommit` -> `vm.updateLevel`, dual-write + resync de slots + retração de grants acima do nível novo) passava pelo `scheduleUpdate` compartilhado; editar QUALQUER outro campo em <400ms cancelava o `clearTimeout` e descartava o commit — ator ficava no nível novo com grants/slots do nível antigo (regressão do C6) | Extraído `updateScheduler.ts` (headless, testável sem harness de componente Svelte — ambiente vitest do pacote é `node`). `commitNow()` é atômico: cancela um draft pendente da MESMA op (superado pelo valor final) e envia **sincronamente**, fora do timer compartilhado — nenhuma `schedule()` POSTERIOR pode cancelá-lo. `handleLevelCommit` agora chama `commitUpdate` (-> `commitNow`) em vez de `scheduleUpdate`. | `f7bc97e` (fusion-systems-2e, `ficha3/onda0`) | `ac8caf99` (core, `ficha3/onda0`, pin atualizado) | `sheets/pf2e/src/lib/sheets/pf2e/__tests__/updateScheduler.test.ts` (6 testes, novos) + `characterSheetVM.test.ts` (218, regressão) |

## TDD — vermelho pelo motivo certo

Antes de escrever o fix definitivo, `commitNow` foi temporariamente aliasado a `schedule()`
(mesmo comportamento do bug: timer único compartilhado) e o teste
`"a later schedule() for a DIFFERENT field does not discard an already-sent commitNow() op (N1)"`
rodou e **falhou** com a mensagem exata prevista — o op do commit de nível nunca chegava a `sent`
porque o `schedule()` do campo seguinte (`speed`) cancelava o timer antes dele disparar. Restaurado
`commitNow` para o envio síncrono/atômico, o mesmo teste (e os outros 5 do arquivo) passou.

## Gates rodados (pasta `wt-o0`, core root)

- `pnpm build` — verde (client compila `CharacterSheet.svelte` sem erro).
- `pnpm typecheck` — **0 erros**, 24 warnings (mesma contagem do baseline; um warning novo
  `state_referenced_locally` em `sendOpFn` apareceu e foi eliminado envolvendo a chamada num
  closure `(op) => sendOpFn(op)`).
- `pnpm lint` — 0 erros (1 warning pré-existente em `pregen-parity.test.ts`, não tocado nesta
  rodada).
- `pnpm lint:boundaries` — sem violações (5025 módulos).
- `pnpm format:check` — todos os arquivos no padrão Prettier.
- `pnpm spec:report` — `cobertura [MVP] com teste: 710 (piso 710)`.
- Testes AFETADOS: `updateScheduler.test.ts` (6/6 verde) + `characterSheetVM.test.ts` (218/218
  verde, regressão da VM que constrói os ops de nível). Suite completa NÃO rodada (roda no CI do
  fecho, conforme instrução).
- Falhas em `pregen-parity.test.ts` (Necromancer/Runesmith `skillIncreaseCeiling`) observadas ao
  rodar com filtro amplo são **pré-existentes** — confirmadas em `baseline.md` (T0.2), não
  relacionadas a este fix, arquivo não tocado.

## Pendências para issue

Nenhuma pendência nova aberta nesta rodada — o conserto fechou o achado N1 no escopo pedido. As
observações menores de `revisao-adversarial-r3.md` (fechar a janela sem blur; R2 da rodada 2,
`self:armored` em `unarmored`) seguem fora do escopo desta rodada de fix e não foram tocadas.
