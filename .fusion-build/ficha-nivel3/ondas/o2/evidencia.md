# Onda 2 (Conjuração) — Evidência de fecho

Worktree: `wt-o0-grants` (core branch `ficha3/o2`, satélite `external/fusion-systems-2e` branch
`ficha3/o2`). HEAD final: core `bea5bc49dcbc66980821b5e2e119e7ac7a5105fa`... — ver seção "SHAs
finais". Consolida as 5 lanes (T2.1-T2.2, T2.3, T2.4-T2.5, 3 rodadas de revisão adversarial + 3
rodadas de fixer, evidência viva em 2 rodadas) mais o gate mecânico final rodado por esta tarefa
de fecho.

## 1. Linha da tabela da seção 3 do `execucao.md` (Onda 2), preenchida com saída real

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **2** | **Verde.** `characterSheetVM.test.ts` 243/243, `planVM.test.ts` 417/417 (inclui o bloco "C9 gate" com slots/conhecidas nv1 e nv3 para Sorcerer/Oracle/Psychic/Animist/Druid — Bard/Wizard/Witch/Cleric/Druid cobertos em blocos próprios), `varredura-classes.test.ts` 190/190 — **850/850**, rodados isolados nesta tarefa (`npx vitest run` nos 3 arquivos, HEAD final) em 22.13s. `derivations-build.test.ts` (satélite, systems/pf2e) 35/35 e `derive-wiring.test.ts` (core, `packages/server`, consumidor real de `proficiencyUpgrades[]`/T2.4 via handler de socket) 20/20, também rodados isolados nesta tarefa. Gate mecânico completo (`pnpm build/typecheck/lint/lint:boundaries/format:check/spec:report`) verde — ver seção 2. | Confirmado em `evidencia-viva-final.md` (rodada de reverificação pós fix-r3): **Bard_o2 nv3** — `occult Spells` (`spontaneous`, slots 0/1/2 com `spellsKnown`), `Focus Spells` (`isFocusPool:true`) presente, `derived.focusPoints={value:0,max:1}` (pool de foco = 1 correto; `value` fica 0 no primeiro grant — issue **#111**, não desta onda), `proficiency.value:1`, truque "Aproximado" aparece corretamente na seção Truques (não mais invisível — N1 fechado), picker de "conhecidas" não lista truques no Patamar 1 (N2 aplicado ao modo known). **Wizard_o2 nv3** — `arcane Spells` (`prepared`), grimório com "500 Sapos", slot Patamar 1 preenchido, picker "Preparar do grimório…" no Patamar 1 listou só "500 Sapos" (nenhum truque — prova direta do N2 no modo prepare). Servidor real (porta 33013), `world.db` real, 3 atores semeados limpos, console sem erro novo. | `bard-nv3-repertorio-foco-1de1.png` — prova repertório espontâneo escolhido (Aproximado + Agitar) e pool de foco 0/1 visível na aba. `wizard-nv3-grimorio-preparado-final.png` — prova grimório com "500 Sapos" e slot de Patamar 1 preparado/lançável. Extra (3º conjurador, além do mínimo pedido pela tabela): `sorcerer-nv1-linhagem-repertorio-final.png` — Feiticeiro Linhagem Dracônica com "500 Toads" no repertório + magia de linhagem concedida (`grantedSlot:"bloodline-1"`). |

## 2. Gate mecânico final (rodado nesta tarefa, na raiz da worktree, HEAD final)

Todos os 6 comandos pedidos pelo prompt de fecho, sem a suíte completa (suíte completa já coberta
por `gate.md` — commit anterior — e pelo CI dos PRs, passo 5):

| Comando | Exit | Detalhe real |
|---|---|---|
| `pnpm build` | **0** | client+server+shared+system-api+systems-2e via workspace, sem erro. Bundle final `App-hZeqUzcT.js` 1.19 MB / gzip 353.83 kB (mesma ordem de grandeza dos gates anteriores). |
| `pnpm typecheck` | **0** | `COMPLETED 1611 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` — warnings pré-existentes de a11y/CSS não-usado em `CharacterSheet.svelte`/`NpcSheet.svelte`/`FamiliarSheet.svelte`/`TokenConfigDialog.svelte`, nenhum arquivo tocado pela Onda 2. |
| `pnpm lint` | **0** | `✖ 1 problem (0 errors, 1 warning)` — mesmo warning pré-existente de `pregen-parity.test.ts` (`Unused eslint-disable directive`) já visto em todas as rodadas anteriores desta onda. |
| `pnpm lint:boundaries` | **0** | `✔ no dependency violations found (5027 modules, 12116 dependencies cruised)`. |
| `pnpm format:check` | **0** | `All matched files use Prettier code style!`. |
| `pnpm spec:report` | **0** | `cobertura [MVP] com teste: 710 (piso 710)` — sem diff no working tree após rodar (`git status --short` só mostra `tools/importer-pf2e/` untracked, pré-existente, resíduo do core sem código). |

Logs completos: `gate-final-build.log`, `gate-final-typecheck.log`, `gate-final-lint.log`,
`gate-final-lint-boundaries.log`, `gate-final-format.log`, `gate-final-spec-report.log` (este
diretório).

### Testes das tarefas da onda (rodados isolados, HEAD final)

- `characterSheetVM.test.ts` + `planVM.test.ts` + `varredura-classes.test.ts` (satélite,
  `sheets/pf2e`) — **850 passed (850)**, 22.13s, `npx vitest run` nos 3 arquivos.
- `derivations-build.test.ts` (satélite, `systems/pf2e`) — **35 passed (35)**, 5.12s.
- `derive-wiring.test.ts` (core, `packages/server` — caminho real de socket, cobre o
  consumidor de `proficiencyUpgrades[]` da T2.4 e o fix do C1/foco) — **20 passed (20)**, 19.82s.

Log combinado bruto (inclui uma primeira tentativa que rodou o pacote inteiro por engano —
ver nota de flakiness abaixo): `gate-final-tests-full-package-with-flakiness.log`.

### Nota sobre flakiness observada nesta tarefa

Uma primeira tentativa de rodar os 3 arquivos-alvo via `pnpm --filter @fusion/sheets-pf2e test`
acabou rodando o pacote inteiro (29 arquivos, 1610 testes) **em paralelo** com os 4 comandos do
gate (`lint`, `lint:boundaries`, `format:check`, `spec:report`) ainda em background — sob essa
carga, 3 arquivos que leem os packs reais (`choice-sets.test.ts`, `grant-resolution-validator.test.ts`,
`grantMaterializer.test.ts`) estouraram o timeout padrão de 5000ms (`Error: Test timed out in
5000ms`), além dos 2 arquivos já conhecidos como pré-existentes (`pregen-parity.test.ts`,
`actionCategories.test.ts`, mesmas falhas de sempre). Re-rodados isolados (sem concorrência),
os 3 arquivos deram **85/85 verde** em 27.98s — confirma flakiness de infra sob carga (mesmo
padrão do "Timeout calling onTaskUpdate" documentado no CLAUDE.md/execucao.md), não regressão.
Nenhum teste da Onda 2 propriamente dita (T2.1-T2.5) foi afetado por essa flakiness.

## 3. Revisão adversarial — veredito final e re-verificações

- **Rodada 1** (`revisao-adversarial.md`, síntese de 4 lentes): **não mergear** — 2 bloqueantes
  (B1 foco descartado pelo servidor, B2 sem botão de truque), 5 importantes (I1 restAll, I2 teto
  de repertório invertido, I3 pool de foco não detecta 5 classes, I4 Wizard sem currículo, I5 6
  classes sem teste), 3 menores.
- **fix-r1** (commits `1c65658..31d80d0` satélite / `715e7116` core): C1-C9 consertados/registrados.
- **Rodada r1** (`revisao-adversarial-r1.md`): **REPROVADA** — C3 (botão abre picker vazio,
  filtro por `level===0` em vez do traço `cantrip`) e C5 (Psychic nv3 com teto de círculo 2 errado)
  seguiam abertos.
- **fix-r2** (commits `f3d810d`, `ce8e4ba` satélite / `35ebbae8` core): C3 e C5 consertados.
- **Rodada r2** (`revisao-adversarial-r2.md`): **REPROVADA** — C3 fechou só o sintoma (N1
  bloqueante: truque some, vai pro balde errado por agrupar por `system.level` em vez do traço) e
  N2 importante (picker de "preparar" ainda listava truque no círculo ≥1, filtro só cobria o modo
  "known").
- **fix-r3** (commits `5ef4cb8`, `e05a362` satélite / `bea5bc49` core): N1 e N2 consertados, com
  teste sobre o doc real do pack (Daze) provando vermelho→verde pelo motivo certo.
- **Rodada r3** (`revisao-adversarial-r3.md`) — **VEREDITO FINAL: APROVADA.** N1 e N2 confirmados
  fechados por leitura de código + teste (`characterSheetVM.test.ts -t "Daze|resolveSpellPickerCantripOnly|spellcastingEntries"`,
  16/16). Nenhum achado bloqueante/importante novo no ataque ao diff. Uma observação fora de
  escopo (truques do grimório listados todos como lançáveis, sem "preparar N por dia" — não é
  achado desta rodada, candidato a onda futura de preparo).
- **Evidência viva, rodada final** (`evidencia-viva-final.md`, pós fix-r3): N1 e N2 confirmados
  corrigidos AO VIVO (servidor real, `world.db` real) — ver seção 1 desta evidência.

## 4. Pendências, com link da issue de cada uma

Todas abertas em `xansde/fusion-systems-2e` (dado/sistema/ficha, conforme a regra de roteamento
do repo certo). Buscado duplicata antes de cada abertura (`gh issue list --search`).

| Achado | Origem | Issue |
|---|---|---|
| Animist: metade espontânea (aparição) sem entry de conjuração (C8) — nota: `tasks.md:89`/`plano.md:176` (core) ainda listam Animist em "Destrava" da O2, correção pedida em r1 mas não aplicada | `fix-r1.md` pendência 1, `revisao-adversarial-r1.md` C8 | **[#124](https://github.com/xansde/fusion-systems-2e/issues/124)** (nova) |
| Multiclasse por níveis + foco/espontâneo: `repertoireBonus` do `levelSet` só sincroniza pela 1ª classe do doc (N3) + `chooseClassLevel` sem teste dedicado do caminho de 2ª classe com foco (pendência nº3 do fix-r1, repo corrigido para o satélite) | `revisao-adversarial-r2.md` N3, `fix-r1.md` pendência 3 | **[#125](https://github.com/xansde/fusion-systems-2e/issues/125)** (nova) |
| `restAll` sem teste unitário dedicado para entry espontânea (C4) | `fix-r1.md` pendência 4 | **[#126](https://github.com/xansde/fusion-systems-2e/issues/126)** (nova) |
| Botão do picker de repertório espontâneo rotulado "Adicionar ao grimório" em vez de "repertório" (cosmético, sem efeito funcional) | `evidencia-viva.md` / `evidencia-viva-final.md` | **[#127](https://github.com/xansde/fusion-systems-2e/issues/127)** (nova) |
| `focusPoints.value` não enche para o novo `max` quando o pool é concedido pela 1ª vez | `T2.4-T2.5-prof-foco.md` (aberta na lane T2.5), reconfirmada ao vivo em `evidencia-viva-final.md` | [#111](https://github.com/xansde/fusion-systems-2e/issues/111) (já aberta, não nova) |
| Mecanismos faltantes das 15 classes novas (Witch/Summoner-eidolon e outros, fora do escopo de T2.3) | `T2.3-preparadas.md` (comentário adicionado, sem issue nova) | [#59](https://github.com/xansde/fusion-systems-2e/issues/59) (já aberta, não nova) |
| Foco sempre 0/0 apesar de `isFocusPool:true` (Bard/Sorcerer nv1-3) | `evidencia-viva.md`, 1ª rodada | [#112](https://github.com/xansde/fusion-systems-2e/issues/112) — **fechada** nesta onda (confirmado corrigido em `evidencia-viva-final.md`) |
| Bard: `applyClass` não cria a entry de foco (Composition Spells) | `evidencia-viva.md`, 1ª rodada | [#113](https://github.com/xansde/fusion-systems-2e/issues/113) — **fechada** nesta onda (confirmado corrigido em `evidencia-viva-final.md`) |

## 5. SHAs finais (HEAD no momento deste fecho, antes do merge/repin)

| Repo | Branch | HEAD |
|---|---|---|
| `xansde/fusion` (core) | `ficha3/o2` | `bea5bc49dcbc66980821b5e2e119e7ac7a5105fa` |
| `xansde/fusion-systems-2e` (satélite) | `ficha3/o2` | `e05a3622ac672758a1c907e8b93f935d475ce3de` (`v0.2.1-16-ge05a362`) |

Confirmado via `git log`/`git submodule status`/`git ls-tree HEAD external/fusion-systems-2e` no
início desta tarefa — pin do core já apontava para o HEAD correto do satélite, sem necessidade de
commit de repin adicional nesta tarefa.

## Veredito consolidado

**PODE MERGEAR: SIM.** Gate mecânico completo verde no HEAD final (build/typecheck/lint/
lint:boundaries/format:check/spec:report), testes das tarefas da onda 850+35+20 = 905/905 verde
(rodados isolados nesta tarefa), suíte completa sem regressão nova contra o baseline (`gate.md`,
mesmos 2 arquivos pré-existentes), revisão adversarial aprovada na rodada 3 após 2 ciclos de
correção, evidência viva confirmando os 2 achados bloqueantes originais (#112/#113) e os 2 achados
N1/N2 da revisão corrigidos ao vivo em servidor real. 4 pendências novas registradas como issues
(#124-#127), nenhuma bloqueante para o merge desta fatia — todas são gaps de cobertura de teste,
uma classe com mecanismo ainda não modelado (fora do escopo desta onda) e um rótulo cosmético.
Decisão de merge em si é humana/decidida pelo orquestrador do fecho (instrução recebida: PODE
MERGEAR: SIM).
