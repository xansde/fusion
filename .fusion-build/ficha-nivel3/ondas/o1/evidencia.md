# Evidência — Onda 1 (fecho FINAL, pós fix-r3/r4)

Core `55deffa0` (`ficha3/o1`) / satélite `c7bb7cc` (`ficha3/o1`). Worktree `wt-o0`.
PODE MERGEAR: **SIM** — revisão adversarial da rodada 4 (`revisao-adversarial-r4.md`)
aprovou sem bloqueante nem importante aberto.

Esta é a segunda passada deste arquivo. A primeira (histórico no commit `7ff5f7cb`)
fechava a onda com C3/C4 como bloqueio de merge (pin do submodule preso ao ato de
merge; decisão do Alexandre sobre o corte do picker de idiomas ainda pendente).
Depois dela, duas rodadas de fixer resolveram C4 por completo:

- **fix-r3** (`fix-r3.md`): implementou o picker de idioma bônus fim a fim
  (`stepCharLanguages` no servidor, `chooseLanguage`/`languagePickerOptions` no
  `planVM.ts`, `LanguageDialog.svelte` na UI) — fecha #102 tecnicamente.
- **revisão r3** (`revisao-adversarial-r3.md`): achou N3 (importante) — o pool de
  opções não seguia a regra RAW do Player Core (faltava draconic/jotun/sakvroth,
  sobrava ysoki, e ancestralidades não-Humano não recebiam o pool comum).
- **fix-r4** (`fix-r4.md`): trocou `COMMON_LANGUAGE_FALLBACK` por `COMMON_LANGUAGES`
  (as 10 línguas comuns do remaster), unidas com `additionalLanguages.value` da
  ancestralidade, nos dois lados (`derivations.ts` + `planVM.ts`).
- **revisão r4** (`revisao-adversarial-r4.md`): **APROVADA**, N3 fechado, sem
  regressão.
- **evidência viva final** (`evidencia-viva-final.md`): re-verificação ao vivo do
  picker de idiomas contra o HEAD atual — ator Humano novo (10 línguas comuns, sem
  ysoki, com draconic/jotun/sakvroth) e reabertura do slot de um Elfo (união
  comum+ancestralidade, 11 opções) — confirmado fim a fim: picker → escolha →
  re-render → reload de página → leitura direta do `world.db`.

Issue **#102 fechada** no repo (`gh issue close`, comentário com o resumo acima).

## Linha da tabela (seção 3 do `execucao.md`)

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **1** | Gate local completo verde (abaixo) + 70/70 no teste de gate da onda + 78/78 `derivations.test.ts` + 390/390 `planVM.test.ts` | Exemplar (ikon + epíteto + `Shift Immanence`), Gunslinger (way), Psychic (duas mentes), Animist (2 aparições + prática), Commander (fólio) e **Idiomas** (picker de bônus fim a fim, Humano e Elfo, persistência no `world.db`) confirmados ao vivo, pós fix-r3/r4 | 13 prints em `prints/` (lista abaixo) |

### Mecânico — saída real deste fecho (rodada final, HEAD `55deffa0`/`c7bb7cc`)

```
$ pnpm build
BUILD EXIT 0

$ pnpm typecheck
TYPECHECK EXIT 0

$ pnpm lint
LINT EXIT 0

$ pnpm lint:boundaries
LINT:BOUNDARIES EXIT 0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
FORMAT:CHECK EXIT 0

$ pnpm spec:report
cobertura [MVP] com teste: 710 (piso 710)
SPEC:REPORT EXIT 0

$ pnpm --filter @fusion/sheets-pf2e exec vitest run src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts
 ✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts (70 tests) 126ms
 Test Files  1 passed (1)
      Tests  70 passed (70)
TEST EXIT 0

$ pnpm --filter @fusion/system-pf2e exec vitest run src/__tests__/derivations.test.ts
 ✓ system-pf2e src/__tests__/derivations.test.ts (78 tests) 45ms
 Test Files  1 passed (1)
      Tests  78 passed (78)
TEST EXIT 0

$ pnpm --filter @fusion/sheets-pf2e exec vitest run src/lib/sheets/pf2e/__tests__/planVM.test.ts
 ✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/planVM.test.ts (390 tests) 140ms
 Test Files  1 passed (1)
      Tests  390 passed (390)
TEST EXIT 0
```

Logs completos desta rodada: `fecho2-build.log`, `fecho2-typecheck.log`,
`fecho2-lint.log`, `fecho2-lint-boundaries.log`, `fecho2-format.log`,
`fecho2-spec-report.log`, `fecho2-test-onda1.log`, `fecho2-test-derivations.log`,
`fecho2-test-planVM.log` (todos nesta pasta). A contagem de `derivations.test.ts`
subiu de 72 para 78 (fix-r3 +6 testes de `stepCharLanguages`) e `planVM.test.ts`
passou a ser rodado inteiro (390 testes, incluindo os 15 novos de `chooseLanguage`/
`languagePickerOptions` do fix-r3 e os 3 de N3 do fix-r4) em vez de só
`characterSheetVM.test.ts` (221/221, coberto pela rodada anterior deste mesmo
arquivo, sem mudança nesta rodada).

**Suíte completa e CI**: esta lane roda o gate local reduzido (acima), por instrução
do fecho. A suíte completa já foi rodada e comparada ao baseline da Onda 0 em
`gate.md` (23 falhas pré-existentes, 0 regressão nova — rodada contra HEAD anterior a
fix-r3/r4). Os fixers r3 e r4 documentam, cada um, a comparação own dos arquivos
afetados contra o baseline (`fix-r3.md` e `fix-r4.md`, seção "Verificação"): nenhuma
falha nova, as únicas falhas encontradas (`pregen-parity.test.ts`, 22-23 casos) são
pré-existentes e confirmadas via `git stash` das mudanças do fixer. O CI dos PRs é a
segunda confirmação independente — números e links abaixo.

**CI dos PRs** (etapa 5 do fecho, `gh pr checks --watch`):

- Satélite (xansde/fusion-systems-2e#108, "Build, Typecheck & Test (against mounted
  core)"): **pass** nas duas rodadas de checagem —
  https://github.com/xansde/fusion-systems-2e/actions/runs/35587662091/job/106294650409
  (o satélite não mudou desde o push do fix-r4; nenhum commit novo depois do
  `c7bb7cc`, então o CI já reflete o HEAD final).
- Core (xansde/fusion#232, "Build, Lint & Test"): 1ª rodada (contra `75a5090e`)
  falhou por **flakiness de infra** — `Hook timed out in 120000ms` no `beforeAll` de
  `src/__tests__/compendium-audience.test.ts` (441/443 arquivos verdes, 8002 testes
  passando; a suíte não chegou a rodar o corpo do teste, travou no boot do
  `beforeAll`), sem relação com os arquivos tocados pela onda (idiomas). Rerun via
  `gh run rerun --failed`: run
  https://github.com/xansde/fusion/actions/runs/35587682124 —
  **pass** na rerun.

### Vivo — resumo (detalhe completo em `evidencia-viva-final.md`)

Três rodadas de teste ao vivo, mundo `teste_xande`, data-dir isolado
(`scratchpad/data-o1`), nunca tocando `~/.fusion` real:

- **Rodada 1** (`evidencia-viva.md`, HEAD `51696f79`, antes do fixer): 6 prints, achou
  1 bloqueante (C1) + 3 importantes (C2/C3/C4) + 6 menores.
- **Rodada 2** (histórico do `evidencia-viva-final.md`, HEAD `ecb0b9ac`/`80fb68b`,
  pós fixer r1/r2): confirmou C1 e C2 corrigidos; achou pendência nova #106 (táticas
  antigas do Commander ficam ilegais e sem aviso); picker de idioma em si ainda fora
  de escopo (só a pendência ficou visível).
- **Rodada 3 — FINAL** (`evidencia-viva-final.md`, HEAD `75a5090e`/`c7bb7cc`, pós
  fix-r3/r4, rebuild limpo antes de testar): fecha o gap que a rodada 2 tinha deixado
  — o picker de idioma bônus, agora implementado.
  - **Humano `Human_o1_lang`** (ator novo, criado via workaround documentado no
    `gate-runbook.md`, montado inteiramente pela UI real: Ancestralidade → Classe):
    picker "Bonus Language" listou as 10 línguas comuns do Player Core remaster —
    Draconic, Dwarven, Elven, Fey, Gnomish, Goblin, Halfling, Jotun, Orcish, Sakvroth
    — sem `ysoki` e com `draconic`/`jotun`/`sakvroth` (exatamente o conserto do N3).
    Escolhi "Draconic": a ficha atualizou na hora, persistiu após reload completo da
    página, e o `world.db` (lido direto via `better-sqlite3`) confirma
    `{"slot":"language-1-0","type":"language","ref":"draconic"}`.
  - **Elfo `Exemplar_o1`** (reabertura do slot pendente de uma rodada anterior, sem
    tocar código): picker listou 11 opções — as 9 comuns que faltavam + Empyrean e
    Kholo (línguas próprias da ancestralidade Elfo) — confirma a união
    comum∪ancestralidade também para quem tem `additionalLanguages.value` não-vazio.
  - **Regressão checada**: Exemplar (ikon + Shift Immanence), Gunslinger, Psychic,
    Animist, Commander — sem mudança de comportamento (os fixes r3/r4 só tocaram
    `derivations.ts`, `planVM.ts`, `LanguageDialog.svelte`, `classBuildHarness.ts`).

### Olhado — 13 prints (`prints/`)

| Print | O que prova |
|---|---|
| `exemplar-plano-icone-triplicado-sem-epiteto.png` | (rodada 1, pré-fix) estado antes do C1/C10 |
| `exemplar-defeito-2-icones-duplicados.png` | (rodada 1, pré-fix) achado de dedup entre slots-irmãos (issue #101) |
| `exemplar-postfix-plano.png` | (rodada 2, pós C1) `Shift Immanence` materializado + pendência de idioma visível |
| `gunslinger-way-picker-confirmado.png` | Gunslinger: picker de Way + escolha persistida |
| `psychic-duas-mentes-confirmadas.png` | Psychic: duas mentes (conjuração dupla) concedidas |
| `animist-2-aparicoes-e-pratica-confirmadas.png` | Animist: 2 aparições + prática concedidas |
| `commander-folio-5-taticas-confirmadas.png` | (rodada 1) fólio do Commander com 5 táticas conhecidas gravadas |
| `commander-postfix-picker-14-opcoes.png` | (rodada 2, pós C2) picker restrito às 14 táticas legais de nível 1 |
| `commander-postfix-taticas-antigas-ilegais.png` | (rodada 2) táticas gravadas antes do fix, 4/5 ilegais pós-fix, sem aviso (issue #106) |
| `human-idioma-bonus-picker-10-opcoes.png` | **(rodada 3, FINAL)** picker do Humano: exatamente as 10 línguas comuns, sem ysoki, com draconic/jotun/sakvroth |
| `human-idiomas-draconic-escolhido.png` | **(rodada 3, FINAL)** ficha atualizada após escolher Draconic, persistido |
| `elf-idioma-bonus-picker-uniao-comum-mais-ancestralidade.png` | **(rodada 3, FINAL)** picker do Elfo: 11 opções, união comum+ancestralidade |
| `exemplar-final-plano-idiomas-pendente.png` | **(rodada 3, FINAL)** regressão checada — Exemplar sem mudança de comportamento |

## Veredito da revisão adversarial (e re-verificações)

- **Primeira rodada** (`revisao-adversarial.md`, contra `51696f79`): 1 bloqueante (C1),
  3 importantes (C2/C3/C4), 6 menores.
- **`revisao-adversarial-r1.md`**: aprova C1 e C2 (picker) contra o HEAD do fixer r1.
- **`revisao-adversarial-r2.md`**: aprova N1 (idiomas, soma de `additionalLanguages
  .count`) contra o HEAD do fixer r2.
- **`revisao-adversarial-r3.md`**: aprova o mecanismo do picker de idioma (C4/#102),
  mas **REPROVA** por achado novo N3 (pool de opções fora da regra RAW).
- **`revisao-adversarial-r4.md`**: **APROVADA** — N3 fechado, sem regressão, sem
  achado novo. Este é o veredito final desta onda.
- Revisões complementares (rodadas 1-2, sem mudança desde então):
  `revisao-costura-seguranca.md` (redação de visibilidade — sem achado),
  `revisao-dado-importer.md` (dado dos packs vs. regra do PF2e — sem achado
  bloqueante), `revisao-regra-pf2e.md` (conformidade RAW), `revisao-testes-
  contratos.md` (teste não-circular, contrato de retorno das lanes).
- **C3** (pin do submodule preso ao ato de merge humano) não é defeito de código —
  é a ordem de merge exigida (satélite → tag → re-pin do core), executada no passo 6
  deste fecho.

## Pendências (todas já com issue aberta no repo certo)

| id | severidade | título | issue | estado |
|---|---|---|---|---|
| C4/N3 | importante | Picker de idiomas bônus (T1.8) | [fusion-systems-2e#102](https://github.com/xansde/fusion-systems-2e/issues/102) | **FECHADA** (fix-r3/r4, confirmada ao vivo) |
| C3 | processo | Pin do submodule preso ao ato de merge humano | [fusion-systems-2e#105](https://github.com/xansde/fusion-systems-2e/issues/105) | aberta — descreve exatamente a ordem do passo 6 deste fecho; fecha quando o merge completar |
| — | menor | Ikon/Apparition sem dedup entre slots-irmãos | [fusion-systems-2e#101](https://github.com/xansde/fusion-systems-2e/issues/101) | aberta |
| — | menor | Commander: drill diário (preparar 3 de 5) não implementado | [fusion-systems-2e#103](https://github.com/xansde/fusion-systems-2e/issues/103) | aberta |
| 104 | — | refutada e fechada (premissa falsa) | [fusion-systems-2e#104](https://github.com/xansde/fusion-systems-2e/issues/104) | CLOSED |
| — | importante | Commander: táticas gravadas antes do fix C2 ficam ilegais, sem aviso | [fusion-systems-2e#106](https://github.com/xansde/fusion-systems-2e/issues/106) | aberta — reconfirmada nesta rodada, mesmo dado, sem regressão nova |
| — | menor | Troca de classe pela UI acumula class items antigos | [fusion-systems-2e#107](https://github.com/xansde/fusion-systems-2e/issues/107) | aberta |

Nenhuma pendência ficou só no relatório — todas as sete linhas acima têm issue.
Nenhuma issue nova nesta rodada do fecho (a única pendência nova das rodadas r3/r4,
N3, virou commit — não issue — porque foi corrigida na mesma sessão do fixer, antes
deste fecho rodar).
