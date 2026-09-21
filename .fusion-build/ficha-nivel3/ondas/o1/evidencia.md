# Evidência — Onda 1 (fecho)

Core `ecb0b9ac` (`ficha3/o1`) / satélite `80fb68b` (`ficha3/o1`). Worktree `wt-o0`.
Consolida as evidências das lanes de implementação (`T1-escolhas.md`,
`T1-commander-idiomas.md`), da revisão adversarial (`revisao-adversarial*.md`), do fixer
(`fix-r1.md`, `fix-r2.md`) e da evidência viva pós-fix (`evidencia-viva.md`,
`evidencia-viva-final.md`), todos nesta mesma pasta. Esta seção é a linha da onda na
tabela da seção 3 do `execucao.md`, preenchida com a saída real do gate local deste
fecho (rodado em 2026-09-21, ~06:06–06:10, pós-fixer).

## Linha da tabela (seção 3 do `execucao.md`)

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **1** | Ver "Mecânico" abaixo — 70/70 verdes no teste de gate da onda + gate local completo verde | Exemplar (ikon + epíteto + `Shift Immanence` materializado), Gunslinger (way), Commander (fólio) e Idiomas (pendência visível) confirmados ao vivo no `world.db`, pós-fix | 9 prints em `prints/` (lista abaixo) |

### Mecânico — saída real deste fecho

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
FORMAT:CHECK EXIT 0

$ pnpm spec:report
cobertura [MVP] com teste: 710 (piso 710)
SPEC:REPORT EXIT 0

$ pnpm --filter @fusion/sheets-pf2e exec vitest run src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts
 ✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts (70 tests) 118ms
 Test Files  1 passed (1)
      Tests  70 passed (70)
TEST EXIT 0

$ pnpm --filter @fusion/system-pf2e exec vitest run src/__tests__/derivations.test.ts
 ✓ system-pf2e src/__tests__/derivations.test.ts (72 tests) 46ms
 Test Files  1 passed (1)
      Tests  72 passed (72)
TEST EXIT 0

$ pnpm --filter @fusion/sheets-pf2e exec vitest run src/lib/sheets/pf2e/__tests__/characterSheetVM.test.ts
 ✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/characterSheetVM.test.ts (221 tests) 221ms
 Test Files  1 passed (1)
      Tests  221 passed (221)
TEST EXIT 0
```

Logs completos: `fecho-build.log`, `fecho-typecheck.log`, `fecho-lint.log`,
`fecho-lint-boundaries.log`, `fecho-format.log`, `fecho-spec-report.log`,
`fecho-test-onda1.log`, `fecho-test-derivations.log`, `fecho-test-charvm.log` (todos em
`C:/Users/.../scratchpad/ficha3-reports/o1/`, não copiados para o repo por serem saída
de comando, não artefato). Nota: o teste do gate da onda saiu 69/69 na primeira rodada
(`T1-commander-idiomas.md`) e 70/70 agora — o fixer somou um caso ao suíte pelo N1
(soma de `additionalLanguages.count`); ambos verdes, sem regressão.

**Suíte completa e CI**: esta lane roda o gate local reduzido (acima) por instrução do
fecho. A suíte completa (`pnpm test`) já foi rodada e comparada ao baseline da Onda 0 em
`gate.md` (23 falhas pré-existentes, subconjunto idêntico das 25 do baseline, 0
regressão nova — 2 falhas do baseline em `traitNames.sync.test.ts` foram corrigidas pelo
commit T1.8). O CI do PR (rodado no passo 5 do fecho) é a segunda confirmação
independente; números e link ficam registrados abaixo assim que os PRs estiverem
abertos e o CI tiver rodado.

**CI dos PRs** (etapa 5 do fecho, `gh pr checks --watch`):

- Satélite (xansde/fusion-systems-2e#108, "Build, Typecheck & Test (against mounted
  core)"): **pass**, 2m4s —
  https://github.com/xansde/fusion-systems-2e/actions/runs/35582006791/job/106276793738
- Core (xansde/fusion#232, "Build, Lint & Test"): **pass**, 6m31s —
  https://github.com/xansde/fusion/actions/runs/35581978546/job/106276702740

Duas confirmações independentes verdes (gate local deste fecho + CI dos dois PRs), sem
nenhuma tentativa de re-run necessária.

### Vivo — resumo (detalhe completo em `evidencia-viva-final.md`)

Duas rodadas de teste ao vivo, mundo `teste_xande`, data-dir isolado
(`scratchpad/data-o1`), nunca tocando `~/.fusion` real:

- **Rodada 1** (`evidencia-viva.md`, HEAD `51696f79`, antes do fixer): 6 prints, achou 1
  bloqueante (C1 — Exemplar sem `Shift Immanence`) + 3 importantes (C2 — Commander sem
  filtro de tier; C3 — pin do submodule preso ao merge; C4 — pendência de idioma
  escondida) + 6 menores. Revisão adversarial `opus` em `revisao-adversarial.md`.
- **Rodada final** (`evidencia-viva-final.md`, HEAD `ecb0b9ac`/`80fb68b`, pós-fixer,
  rebuild limpo antes de testar): re-verificação ao vivo, mesmo mundo/atores.
  - **Exemplar (C1)**: confirmado corrigido — `Shift Immanence:action` agora materializa
    no `world.db` do mesmo ator. Print `exemplar-postfix-plano.png`.
  - **Commander (C2)**: picker confirmado restrito a exatamente 14 táticas de nível 1.
    Print `commander-postfix-picker-14-opcoes.png`. Achado novo (não é regressão do
    fix, é dado já gravado antes do fix): ator criado na rodada 1 mantém 4/5 táticas
    ilegais sem aviso — issue #106 (fixer não retroage sobre dado existente, por
    desenho). Print `commander-postfix-taticas-antigas-ilegais.png`.
  - **Idiomas (C4/N1)**: pendência de idioma bônus agora **visível** na ficha
    (`"(1 idioma(s) a escolher)"`), confirmando o conserto do N1 (soma de
    `additionalLanguages.count`) e do C4 (visibilidade). Picker do idioma em si segue
    fora de escopo (corte de T1.8, decisão do Alexandre ainda não confirmada — issue
    #102 e pendência C4 abaixo).
  - **Psychic, Animist, Gunslinger**: sem mudança de código nesta rodada; evidência da
    rodada 1 permanece válida (confirmado pelo diff dos fixes, que não tocou nenhum dos
    três).
  - **Achado C10 refutado e corrigido**: a issue #104 ("Exemplar sem slot de
    rootEpithet") tinha premissa falsa — `Root Epithet` é feature de nível 3, não 1; os
    3 slots de Ícone no nível 1 são RAW. Issue fechada nesta rodada com o comentário
    correto.

### Olhado — 9 prints (`prints/`)

| Print | O que prova |
|---|---|
| `exemplar-plano-icone-triplicado-sem-epiteto.png` | (rodada 1, pré-fix) Exemplar nv1 com 3 slots de Ícone, sem epíteto — estado antes do C1/C10 |
| `exemplar-defeito-2-icones-duplicados.png` | (rodada 1, pré-fix) confirma o achado de dedup entre slots-irmãos (issue #101) |
| `exemplar-postfix-plano.png` | (rodada final, pós-fix) `Shift Immanence` materializado + pendência de idioma visível no mesmo print |
| `gunslinger-way-picker-confirmado.png` | Gunslinger: picker de Way com opções reais, escolha persistida |
| `psychic-duas-mentes-confirmadas.png` | Psychic: as duas mentes (conjuração dupla) concedidas e persistidas |
| `animist-2-aparicoes-e-pratica-confirmadas.png` | Animist: 2 aparições + prática concedidas e persistidas |
| `commander-folio-5-taticas-confirmadas.png` | (rodada 1) fólio do Commander com 5 táticas conhecidas gravadas |
| `commander-postfix-picker-14-opcoes.png` | (rodada final, pós-fix C2) picker restrito às 14 táticas legais de nível 1 |
| `commander-postfix-taticas-antigas-ilegais.png` | (rodada final) as 5 táticas gravadas antes do fix, 4 delas ilegais pós-fix e sem aviso (issue #106) |

## Veredito da revisão adversarial (e re-verificações)

- **Primeira rodada** (`revisao-adversarial.md`, `opus`, contra `51696f79`): **1
  bloqueante** (C1 — Shift Immanence não materializa), **3 importantes** (C2 — Commander
  sem filtro de tier no picker; C3 — pin do submodule preso ao ato de merge humano; C4 —
  pendência de idioma escondida), 6 menores. Refutou o próprio Achado 2 da evidência
  viva (C10, ver acima).
- **`revisao-adversarial-r1.md`**: aprova o fix de C1 (Exemplar) e C2 (Commander,
  picker) contra o HEAD do fixer round 1.
- **`revisao-adversarial-r2.md`**: aprova o fix N1 (idiomas) contra o HEAD do fixer
  round 2 (`ecb0b9ac`/`80fb68b`, o HEAD atual desta onda).
- Revisões complementares nesta pasta: `revisao-costura-seguranca.md` (redação de
  visibilidade / `redaction.ts` — sem achado), `revisao-dado-importer.md` (dado dos
  packs vs. regra do PF2e — sem achado bloqueante além do já listado),
  `revisao-regra-pf2e.md` (conformidade RAW), `revisao-testes-contratos.md` (teste
  não-circular, contrato de retorno das lanes).
- **Veredito final**: C1 e C2 (picker) corrigidos e confirmados ao vivo; C3 e a decisão
  de C4 são bloqueios de processo/produto (merge humano; decisão do Alexandre), não
  defeito de código — ambos viram pendência abaixo, não bug reaberto.

## Pendências (todas já com issue aberta no repo certo)

| id | severidade | título | issue | dono / conserto |
|---|---|---|---|---|
| C3 | importante | Pin do submodule (`80fb68b`) só existe em `origin/ficha3/o1` do satélite | [fusion-systems-2e#105](https://github.com/xansde/fusion-systems-2e/issues/105) | Alexandre (ato de merge) — mergear o PR do satélite com merge commit (sem squash), re-pinar o core no merge commit, só então mergear o core |
| C4 (decisão) | importante | Corte do picker de idiomas bônus (T1.8) ainda não confirmado pelo Alexandre | [fusion-systems-2e#102](https://github.com/xansde/fusion-systems-2e/issues/102) | Alexandre (decisão) — confirmar o corte ou pedir o picker; opções já existem no pack |
| — | menor | Ikon/Apparition sem dedup entre slots-irmãos | [fusion-systems-2e#101](https://github.com/xansde/fusion-systems-2e/issues/101) | filtro de `sourceId` já gravado nos slots-irmãos do mesmo eixo |
| — | menor | Commander: drill diário (preparar 3 de 5) não implementado | [fusion-systems-2e#103](https://github.com/xansde/fusion-systems-2e/issues/103) | mecanismo novo de "dia", fora do escopo da criação nv1-3 |
| 104 | — | refutada e fechada nesta rodada | [fusion-systems-2e#104](https://github.com/xansde/fusion-systems-2e/issues/104) (CLOSED) | premissa falsa — Root Epithet é nível 3, não 1 |
| — | importante | Commander: 4/5 táticas gravadas antes do fix ficam ilegais, sem aviso na ficha | [fusion-systems-2e#106](https://github.com/xansde/fusion-systems-2e/issues/106) | fixer não revalida dado já gravado por desenho; precisa de revalidação/migração |
| — | menor | Troca de classe pela UI acumula class items antigos em vez de substituir | [fusion-systems-2e#107](https://github.com/xansde/fusion-systems-2e/issues/107) | aberta neste fecho (achado colateral da evidência viva, fora do escopo direto da onda) |

Nenhuma pendência ficou só no relatório — todas as sete linhas acima têm issue.
