# Evidência — Onda 0 (Dado das 29 classes)

Worktree `scratchpad/wt-o0`. Core `ficha3/onda0` @ `ac8caf99`; satélite (submodule pinado em
`external/fusion-systems-2e`) `ficha3/onda0` @ `f7bc97e`. Fecho rodado em 2026-09-21.
Estado final: rodada 4 da revisão adversarial FECHOU o último achado importante (N1); **PODE
MERGEAR: SIM** (zero bloqueante/importante aberto ao final).

## 1. Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **0** | **Verde, com dívida rastreada.** Gate LOCAL final (fecho, pós fix-r4, worktree `wt-o0` @ core `ac8caf99`/satélite `f7bc97e`, rodado por mim nesta sessão de fecho, SEM a suíte completa): `pnpm build` exit 0 (client compila, bundle final `App-*.js` 1.19 MB/353 KB gzip); `pnpm typecheck` exit 0, `COMPLETED 1610 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` (mesma contagem do baseline T0.5); `pnpm lint` exit 0, `✖ 1 problem (0 errors, 1 warning)` (warning pré-existente em `pregen-parity.test.ts`, não tocado); `pnpm lint:boundaries` exit 0, `no dependency violations found (5025 modules, 12105 dependencies cruised)`; `pnpm format:check` exit 0, `All matched files use Prettier code style!`; `pnpm spec:report` exit 0, `cobertura [MVP] com teste: 710 (piso 710)`, sem drift. Testes das tarefas da onda (afetados pelo fix-r4, rodados isolados: `updateScheduler.test.ts`, `characterSheetVM.test.ts`, `grant-resolution-validator.test.ts`, `grantMaterializer-realPacks.test.ts`): **4 arquivos, 234 testes, 234 passaram, 0 falharam** (`Test Files 4 passed (4)`, `Tests 234 passed (234)`, 3.15s). A suíte completa (`vitest --workspace`) do ESTADO anterior (T0.5, antes do fix-r4) mediu **441 arquivos (437 passaram, 4 falharam) / 8014 testes (7986 passaram, 26 falharam, 1 skip, 1 todo)** vs. baseline pré-integração (438 arquivos/8003 testes, 3 arquivos/25 testes falhando) — delta exato esperado (+3 arquivos/+11 testes novos, +1 arquivo/+1 teste falho = o vermelho ESPERADO do `grant-resolution-validator.test.ts`, 8 grants bloqueados por #88/#89, não regressão); a suíte completa PÓS fix-r4 roda no CI do PR (seção 2). Contagem de `GrantItem` não resolvível fora da allowlist (T0.4): **0** não-alowlisted (`expect(notAllowlisted).toEqual([])` verde). (`T0.5-test.log`, `T0.5.md`, `fix-r4.md`) | **Monk (Tobias) criado e subido 1→2→3** no mundo real `teste_xande` (cópia isolada, servidor local porta 33005): nível 1→2 concede `classFeature:Flurry of Blows` + `classFeature:Powerful Fist` como item real do ator (confirmado por leitura direta do `world.db`, não só UI); nível 2→3 concede `classFeature:Mystic Strikes` + `classFeature:Incredible Movement` (deslocamento 40 pés = 30 base + 10, batendo com `derivations-speed.test.ts`). **Ranger (Novo Ator)** 1→2→3: Hunt Prey + ação embutida + Hunter's Edge "Precisão" escolhido, Will Expertise no nível 3. **Guardian (GateO0-Guardian)** 1→2→3: as 5 features de nível 1 (Taunt, Guardian's Techniques, Shield Block, Guardian's Armor, Tough To Kill) todas presentes como item, cada uma com ação/feat concedida onde aplicável. (`evidencia-viva-final.md`) | 4 prints em `prints/`, cada um OLHADO (Read na imagem) antes de listar: `monk-tobias-nivel1e2-plano.png` (Nível 2, chips Flurry of Blows + Powerful Fist), `monk-tobias-nivel3-plano.png` (Nível 3, PV 33/33, Deslocamento 40 pés), `ranger-novoator-nivel3-plano.png` (Nível 3, Hunter's Edge "Precisão", chip Hunt Prey), `guardian-gateo0-nivel3-plano.png` (Nível 3, PV 39/39, 5 features de nível 1 visíveis). |

## 2. CI dos PRs

- Satélite: PR `ficha3/onda0` → `main` (xansde/fusion-systems-2e) — ver número/URL no corpo do PR aberto por este fecho; `gh pr checks --watch` rodado, resultado registrado no próprio fecho.
- Core: PR `ficha3/onda0` → `alfa/app` (xansde/fusion) — idem.

(Números de run/CI ficam no `fecho.md` do orquestrador, que roda `gh pr checks --watch` depois de abrir/atualizar os PRs — este arquivo documenta o gate LOCAL, que é o que a instrução pediu para constar aqui.)

## 3. Prints — uma linha do que cada um prova

- `monk-tobias-nivel1e2-plano.png` — Tobias (Monk) Nível 2, classe "Monge"✓, bloco NÍVEL 1 com os chips Sequência de Golpes/Flurry of Blows + Punho Poderoso/Powerful Fist. Prova que as features de nível 1 chegaram como item real após o primeiro level-up.
- `monk-tobias-nivel3-plano.png` — Tobias Nível 3, PV 33/33, Deslocamento 40 pés. Prova visual da derivação de Incredible Movement (30+10) e o estado final 1→2→3.
- `ranger-novoator-nivel3-plano.png` — Novo Ator (Ranger) Nível 3, "Patrulheiro 1"✓, "Precisão"✓ (Hunter's Edge escolhido), chip "Caçar Presa/Hunt Prey". Prova Ranger nível 1 completo (incl. escolha) sobrevivendo até nível 3.
- `guardian-gateo0-nivel3-plano.png` — GateO0-Guardian Nível 3, PV 39/39, bloco NÍVEL 1 com Taunt, Guardian's Techniques, Bloqueio com Escudo/Shield Block, Guardian's Armor, Interceptar Ataque/Intercept Attack. Prova as 5 features de nível 1 do Guardian.
- `monk-tobias-nivel1-plano.png` — print intermediário (Tobias antes do reset limpo/nível 1 isolado), mantido como registro do estado inicial anômalo (ver A1 abaixo).

## 4. Veredito da revisão adversarial (e re-verificações)

| Rodada | Veredito | Achados fechados | Achados abertos ao final |
|---|---|---|---|
| r1 (`revisao-adversarial-r1.md`) | APROVADA COM CONSERTOS | C1–C5, C7, DOC | C6 (parcial), N1 (importante), N2 (menor) |
| r2 (`revisao-adversarial-r2.md`) | (fixes de N1/C6 verificados; achados novos) | N1 (predicate), C6 (retração; subida registrada em #93) | R1 (importante, regressão do debounce), R2 (menor, self:armored/unarmored) |
| r3 (`revisao-adversarial-r3.md`) | APROVADA COM RESSALVA — PODE MERGEAR: NÃO | R1 (no seu escopo literal — `updateLevelDraft` sem op destrutiva) | N1 novo (importante) — commit de nível pode ser cancelado pelo debounce compartilhado de outro campo, regressão do C6 (issue [#94](https://github.com/xansde/fusion-systems-2e/issues/94), fechada nesta rodada — ver r4) |
| r4 (`revisao-adversarial-r4.md`) | **FECHADA — PODE MERGEAR: SIM** | N1 (extraído `updateScheduler.commitNow()`, satélite `f7bc97e`, core `ac8caf99`; envio síncrono fora do timer compartilhado, `updateScheduler.test.ts` 6/6 verde) | Zero bloqueante/importante. Menores: M1 (processo — issue #94 sem `Closes` no commit, corrigido no fecho por fechamento manual com referência ao commit) e M2 (pré-existente, fora do escopo da O0 — debounce único também descarta draft de OUTRO campo, não só o de nível; registrado em issue nova [#100](https://github.com/xansde/fusion-systems-2e/issues/100)) |

**Veredito final consolidado: gate mecânico/vivo/olhado da Onda 0 PASSA** (critério da
tabela da seção 3 do `execucao.md` cumprido pelos 3 chassis testados) **e a integração PODE
SER MERGEADA** — a rodada 4 da revisão adversarial fechou o último achado importante (N1,
commit de nível descartado por edição concorrente de outro campo) com TDD (vermelho pelo
motivo certo, depois verde) e sem regressão no diff. Zero bloqueante ou importante aberto ao
final da Onda 0; restam só achados menores, todos com issue própria (#97, #98, #100) ou já
rastreados por lanes anteriores (#88–#93).

Revisões adicionais rodadas nesta onda (fora do ciclo fix↔revisão principal), todas sem
achado bloqueante remanescente: `revisao-teste-contratos.md`, `revisao-costura-ci-higiene.md`,
`revisao-REGRA-PF2E.md` (não-circularidade dos testes), `revisao-integridade-importador.md`
(B1/B2 daquela rodada resolvidos por C2/C3 do fix-r1; I1 resolvido por C7/#92; M1–M3 são
achados menores de uma rodada anterior às r1–r3, não reabertos nesta consolidação).

## 5. Pendências, com link da issue de cada uma

| # | Título | Severidade | Repo | Issue |
|---|---|---|---|---|
| N1 | Commit de nível cancelado pelo debounce compartilhado (regressão do C6) | importante → **FECHADA** (fix N1 rodada 4) | fusion-systems-2e | [#94](https://github.com/xansde/fusion-systems-2e/issues/94) (closed) |
| M2 | Debounce único compartilhado também descarta draft de OUTRO campo (não só nível) | menor | fusion-systems-2e | [#100](https://github.com/xansde/fusion-systems-2e/issues/100) |
| A1 | Dois campos de nível divergentes (`system.level` vs `system.details.level`) | importante | fusion-systems-2e | [#95](https://github.com/xansde/fusion-systems-2e/issues/95) |
| A2 | Class-pick isolado não materializa `featuresByLevel` de nível 1 sem level-up | importante | fusion-systems-2e | [#96](https://github.com/xansde/fusion-systems-2e/issues/96) |
| N2 | 11 traits novos sincronizados sem acentuação (`ACCENT_FIXES` desatualizado) | menor | fusion-systems-2e | [#97](https://github.com/xansde/fusion-systems-2e/issues/97) |
| R2 | `self:armored` fica `true` para armadura categoria `unarmored` | menor | fusion-systems-2e | [#98](https://github.com/xansde/fusion-systems-2e/issues/98) |
| — | Battle Creed não concede nenhuma das 7 Creed | bloqueante (allowlist) | fusion-systems-2e | [#88](https://github.com/xansde/fusion-systems-2e/issues/88) |
| — | Undead Creator → Create Undead (ritual, spells-core sem suporte) | bloqueante (allowlist) | fusion-systems-2e | [#89](https://github.com/xansde/fusion-systems-2e/issues/89) |
| — | 7157 links @UUID quebrados na prosa (não afeta concessão) | menor | fusion-systems-2e | [#90](https://github.com/xansde/fusion-systems-2e/issues/90) |
| — | 23 falhas pré-existentes no gate do sheets-pf2e | dívida rastreada | fusion-systems-2e | [#91](https://github.com/xansde/fusion-systems-2e/issues/91) |
| — | Allowlist rotula 4 dedicações de arquétipo nível 1 como "multiclasse" | importante | fusion-systems-2e | [#92](https://github.com/xansde/fusion-systems-2e/issues/92) |
| — | Campo de nível do modo edição não materializa grants ao SUBIR | importante | fusion-systems-2e | [#93](https://github.com/xansde/fusion-systems-2e/issues/93) |

Todas as issues #88–#93 já existiam antes deste fecho (abertas pelas lanes T0.3/T0.4/fix-r1/
fix-r2); #94–#98 foram abertas pelas rodadas de revisão desta onda, cobrindo os achados que
ainda não tinham issue (N1 do gate do prompt, A1/A2 de `evidencia-viva-final.md`, N2 de
`revisao-adversarial-r1.md`/`fix-r1.md`, R2 de `revisao-adversarial-r2.md`/`fix-r3.md`); #94
foi FECHADA por este fecho (fix N1 da rodada 4, satélite `f7bc97e`); #100 foi ABERTA por este
fecho, cobrindo o achado menor M2 da rodada 4 (`revisao-adversarial-r4.md`/`fix-r4.md`).

## 6. Observação de rota (não é issue)

`docs/design/ficha-nivel3/plano.md`, buraco 3, já estava marcado fechado antes deste fecho
(commit `92763cca`, T0.2) — nada a fazer aqui além de confirmar (feito).
