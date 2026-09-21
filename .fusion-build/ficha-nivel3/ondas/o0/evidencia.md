# Evidência — Onda 0 (Dado das 29 classes)

Worktree `scratchpad/wt-o0`. Core `ficha3/onda0` @ `b2bf41a1`; satélite (submodule pinado em
`external/fusion-systems-2e`) `ficha3/onda0` @ `4a41939`. Fecho rodado em 2026-09-21.

## 1. Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **0** | **Verde, com dívida rastreada.** `pnpm build` exit 0 (`T0.5-build.log`), `pnpm typecheck` exit 0 (`T0.5-typecheck.log`), `pnpm lint` exit 0 (`T0.5-lint.log`), `pnpm lint:boundaries` exit 0, 0 violações/5023 módulos (`T0.5-lint-boundaries.log`), `pnpm format:check` exit 0 (`T0.5-format.log`), `pnpm spec:report` exit 0, "cobertura [MVP] com teste: 710 (piso 710)" sem drift (`T0.5-spec-report.log`). `pnpm test` (suíte completa, vitest --workspace): **441 arquivos (437 passaram, 4 falharam) / 8014 testes (7986 passaram, 26 falharam, 1 skip, 1 todo)** — delta exato vs. baseline pré-integração (438 arquivos/8003 testes, 3 arquivos/25 testes falhando): +3 arquivos novos, +11 testes novos, +1 arquivo falho e +1 teste falho, ambos o vermelho ESPERADO do `grant-resolution-validator.test.ts` (8 grants bloqueados por issue #88/#89, não regressão). Script de contagem de `GrantItem` não resolvível fora da allowlist (T0.4, `grant-resolution-validator.test.ts` rodado isolado): **0** não-alowlisted (`expect(notAllowlisted).toEqual([])` verde) — critério do gate bate exato. (`T0.5-test.log`, `T0.5.md`) | **Monk (Tobias) criado e subido 1→2→3** no mundo real `teste_xande` (cópia isolada, servidor local porta 33005): nível 1→2 concede `classFeature:Flurry of Blows` + `classFeature:Powerful Fist` como item real do ator (confirmado por leitura direta do `world.db`, não só UI); nível 2→3 concede `classFeature:Mystic Strikes` + `classFeature:Incredible Movement` (deslocamento 40 pés = 30 base + 10, batendo com `derivations-speed.test.ts`). **Ranger (Novo Ator)** 1→2→3: Hunt Prey + ação embutida + Hunter's Edge "Precisão" escolhido, Will Expertise no nível 3. **Guardian (GateO0-Guardian)** 1→2→3: as 5 features de nível 1 (Taunt, Guardian's Techniques, Shield Block, Guardian's Armor, Tough To Kill) todas presentes como item, cada uma com ação/feat concedida onde aplicável. (`evidencia-viva-final.md`) | 4 prints em `prints/`, cada um OLHADO (Read na imagem) antes de listar: `monk-tobias-nivel1e2-plano.png` (Nível 2, chips Flurry of Blows + Powerful Fist), `monk-tobias-nivel3-plano.png` (Nível 3, PV 33/33, Deslocamento 40 pés), `ranger-novoator-nivel3-plano.png` (Nível 3, Hunter's Edge "Precisão", chip Hunt Prey), `guardian-gateo0-nivel3-plano.png` (Nível 3, PV 39/39, 5 features de nível 1 visíveis). |

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
| r3 (`revisao-adversarial-r3.md`) | **APROVADA COM RESSALVA — PODE MERGEAR: NÃO** | R1 (no seu escopo literal — `updateLevelDraft` sem op destrutiva) | **N1 novo (importante) — commit de nível pode ser cancelado pelo debounce compartilhado de outro campo, regressão do C6** (issue [#94](https://github.com/xansde/fusion-systems-2e/issues/94)) |

**Veredito final consolidado: gate mecânico/vivo/olhado da Onda 0 PASSA** (critério da
tabela da seção 3 do `execucao.md` cumprido pelos 3 chassis testados), **mas a integração
NÃO pode ser mergeada como está** — o achado N1 da r3 é uma regressão funcional real
(commit de nível descartado por edição concorrente de outro campo), documentado e com
issue aberta, mas sem fix aplicado nesta rodada (orçamento de re-verificação já em 3
rodadas). PR aberto para review; merge fica para depois do fix de N1.

Revisões adicionais rodadas nesta onda (fora do ciclo fix↔revisão principal), todas sem
achado bloqueante remanescente: `revisao-teste-contratos.md`, `revisao-costura-ci-higiene.md`,
`revisao-REGRA-PF2E.md` (não-circularidade dos testes), `revisao-integridade-importador.md`
(B1/B2 daquela rodada resolvidos por C2/C3 do fix-r1; I1 resolvido por C7/#92; M1–M3 são
achados menores de uma rodada anterior às r1–r3, não reabertos nesta consolidação).

## 5. Pendências, com link da issue de cada uma

| # | Título | Severidade | Repo | Issue |
|---|---|---|---|---|
| N1 | Commit de nível cancelado pelo debounce compartilhado (regressão do C6) | importante | fusion-systems-2e | [#94](https://github.com/xansde/fusion-systems-2e/issues/94) |
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
fix-r2); #94–#98 foram abertas por este fecho, cobrindo os achados desta onda que ainda não
tinham issue (N1 do gate do prompt, A1/A2 de `evidencia-viva-final.md`, N2 de
`revisao-adversarial-r1.md`/`fix-r1.md`, R2 de `revisao-adversarial-r2.md`/`fix-r3.md`).

## 6. Observação de rota (não é issue)

`docs/design/ficha-nivel3/plano.md`, buraco 3, já estava marcado fechado antes deste fecho
(commit `92763cca`, T0.2) — nada a fazer aqui além de confirmar (feito).
