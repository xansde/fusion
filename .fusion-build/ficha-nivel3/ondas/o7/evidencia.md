# Evidência de fecho — Onda 7 (Aceite não-circular: molde, comparador, roteiro e2e)

**Worktree:** `.../scratchpad/wt-c`. **Core** `ficha3/o7` @ `676e69df`. **Satélite**
`external/fusion-systems-2e` `ficha3/o7` @ `a198986`. Pin do submodule no core confirmado igual
ao HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e` → `a198986`).

**PODE MERGEAR: NÃO.** A revisão adversarial rodada 2 (`revisao-adversarial-r2.md`) reprovou o
estado atual com 1 achado bloqueante novo (N2) e 5 importantes reabertos/parciais (C1, C4, C5,
C6, C7). Nenhum código de produção (`packages/`, `systems/pf2e/src`,
`sheets/pf2e/src/lib/sheets/pf2e/{planVM,characterSheetVM}.ts`) foi tocado por esta lane de
fecho — só consolidação de evidência, abertura de issues e gate mecânico.

## 1. Linha da Onda 7 na tabela do `execucao.md` §3

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **7** | `character-comparator.test.ts` roda **33/33** verde (cobertura 29 classes × 3 níveis = 87 células; pendências contadas com `pendingReason`; zero falso-verde entre células comparadas — ver ressalva abaixo) | — (onda é de aceite/documentação, não introduz personagem nova além das do roteiro e2e) | roteiro `tutorial-e2e` (`docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html`, 48 prints) — **existe, abre e foi olhado**, mas a revisão adversarial r2 achou 5 defeitos concretos nos prints (dádiva de classe errada no Bardo, talentos de nível 2/3 vazios, smoke do player incompleto e com print final trocado) |

**Ressalva que invalida a leitura ingênua de "divergência zero" (achado N2, bloqueante):** o
molde comum (`character-templates.json`) absorveu um defeito real do pack `ancestries-core`
Human (3 boosts livres em vez de 2 do RAW) fixando DES 14 em vez de DES 12. O comparador e o
roteiro e2e dão verde **porque o app e o molde compartilham o mesmo defeito** — é o padrão da
lição #48 (teste circular). Enquanto isso não for corrigido, "divergência zero" não prova
conformidade com o Player Core Remaster, só consistência interna entre molde e app.

## 2. Saída real dos comandos (gate mecânico local, sem suíte completa)

Rodados nesta sessão de fecho, HEAD `676e69df`/`a198986`, worktree `wt-c`:

```
$ pnpm build
packages/client build: ✓ built in 27.10s
packages/client build: Done
(todos os pacotes, incluindo client — verde, exit 0)

$ pnpm typecheck
packages/client typecheck: ... COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS
(exit 0 — idêntico ao baseline de ficha3-reports/o7/gate.md)

$ pnpm lint
✖ 1 problem (0 errors, 1 warning)  — no-unused-disable em pregen-parity.test.ts (pré-existente)
(exit 0 — idêntico ao baseline)

$ pnpm lint:boundaries
✔ no dependency violations found (5049 modules, 12224 dependencies cruised)
(exit 0 — idêntico ao baseline)

$ pnpm format:check
[warn] .claude/skills/tutorial-e2e/roteiros/alq-f2-02-equipment-effects.spec.ts
(exit 1 — só 1 arquivo local não-rastreado de outra frente, não versionado, nunca entra em
 commit/CI; ficha-nivel3.spec.ts NÃO apareceu desta vez — já está formatado)

$ pnpm spec:report
cobertura [MVP] com teste: 719 (piso 719)
(exit 0 — sem diff a commitar, idêntico ao baseline)

$ cd external/fusion-systems-2e/sheets/pf2e && npx vitest run \
    src/lib/sheets/pf2e/__tests__/character-comparator.test.ts
✓ sheets-pf2e src/lib/sheets/pf2e/__tests__/character-comparator.test.ts (33 tests) 83ms
Test Files  1 passed (1)
     Tests  33 passed (33)
```

**Suíte completa** (`pnpm test`, `vitest --workspace`): NÃO re-rodada nesta lane de fecho, por
instrução explícita ("SEM a suíte completa"). Números de referência, já verificados e comparados
linha a linha contra o baseline da Onda 0 em `ficha3-reports/o7/gate.md` (rodada anterior, mesmo
HEAD de produção — só um `.html` de documentação mudou desde então, nenhum código):

- `pnpm test`: exit 1, **2 arquivos falharam / 23 testes falharam de 8392** (453 arquivos, 397s).
  Mesmas 2 assinaturas do baseline (`actionCategories.test.ts` 1 falha de mapeamento de vendor
  folder; `pregen-parity.test.ts` 22 falhas de `skillIncreaseCeiling`/HP — dívida já rastreada em
  `xansde/fusion-systems-2e#91`). **Nenhuma regressão nova.**
- CI do PR (passo 5 do fecho): ver seção "CI" abaixo — corre à parte, com a suíte completa do
  workflow do repo.

## 3. Prints — o que cada um prova

Extraídos para `.fusion-build/ficha-nivel3/ondas/o7/prints/` (todos < 130 KB):

| Arquivo | Prova |
|---|---|
| `roteiro-print-01.png` | Passo inicial do roteiro (config do Mestre, variante Arquétipo Livre ligada) — rodada 1 do roteiro (T7.3, antes do fix de chassi). |
| `roteiro-print-12.png` | Estado intermediário da rodada 1 (perícias/dádivas ainda em aberto) — evidência histórica do que a revisão adversarial rodada 1 reprovou (achados A1/A2 de `revisao-testes-contratos.md`). |
| `roteiro-print-23.png` | Print final da rodada 1: Bard nv3 com selo de proficiência "U" nas salvaguardas (achado C8 da revisão original, já corrigido no satélite `c67730c`). |
| `sample-01.png` | Rodada 2 (chassi fixado): tela de Configurações do Mestre, Mundo e Permissões — confirma servidor real, usuário Mestre logado. |
| `sample-25.png` | Rodada 2: diálogo "Talento de Arquétipo" com Acrobat Dedication selecionada, pré-requisito visível — confirma que o fluxo de Arquétipo Livre roda na UI real. |
| `sample-48.png` | Rodada 2: ficha de "Tobias" nível 3 (visão do player) — PV 44/44, saves Especialista, chassi comum (Cooperative Nature, Elven/Dwarven, 5/5 treino) aplicado a uma classe de golpes desarmados. **Este mesmo print é o que a revisão adversarial r2 aponta como divergente (achado C7): é na verdade a tela do Mestre com o Bardo**, porque o passo final não recebeu `"player"` — registrado como contradição a resolver na issue `xansde/fusion-systems-2e#156`. |

## 4. Veredito da revisão adversarial (rodadas e re-verificações)

| Rodada | Veredito | Achados |
|---|---|---|
| `revisao-adversarial.md` (r0, agregando 4 lentes: costura/segurança, dado/importer, regra PF2e, testes/contratos) | **REPROVADA** | 12 confirmados: C1 bloqueante, C2–C8 importantes, C9–C12 menores |
| `fix-r1.md` | fixer | C2/C3/C4/C8 consertados; C1/C5/C6/C7 explicitamente não consertados nesta rodada (decisão registrada: refazer o roteiro e2e inteiro é uma operação indivisível) |
| `revisao-adversarial-r1.md` | (arquivo existe, sem achados registrados — reconfirmação do estado pós fix-r1 antes do fixer r2 seguir para C1/C5/C6/C7) | — |
| `fix-r2.md` | fixer | C1/C2/C3/C5/C7/N1 consertados; C4 parcial; **C6 explicitamente não consertado** (proibido escrever na árvore principal compartilhada a partir da worktree) |
| `revisao-adversarial-r2.md` (rodada mais recente) | **REPROVADA** | 1 bloqueante novo (**N2** — molde absorve defeito do pack Human e torna o aceite circular) + 5 importantes reabertos/parciais: **C1** (confronto não compara abilityChoices/hp/ranks/slots 2-3), **C4** (regra de idioma por chave INT cobre só 4 de 8 classes), **C5** (dádiva de classe errada, talentos nv2/3 vazios, legendas erradas), **C6** (roteiro ainda só na wt-c), **C7** (smoke do player incompleto, print final trocado). C2/C3/N1 confirmados **FECHADOS**. |

Esta lane de fecho **não rodou uma rodada 3** de fix/revisão — os 6 itens acima (N2, C1, C4, C5,
C6, C7) são exatamente os que o orquestrador listou como "o que ficou aberto" para o corpo do PR,
e ficam registrados como issues (seção 5) em vez de receberem mais uma tentativa de conserto
dentro desta janela de fecho.

## 5. Pendências, com o link da issue de cada uma

| id | severidade | issue |
|---|---|---|
| N2 — molde absorve defeito do Human e torna o aceite circular | bloqueante | https://github.com/xansde/fusion-systems-2e/issues/151 |
| defeito de dado: `ancestries-core` Human com 3 boosts livres (RAW é 2) + falha inerte | importante (causa raiz de N2) | https://github.com/xansde/fusion-systems-2e/issues/152 |
| C1 — confronto do ator persistido não cobre abilityChoices/hp/ranks/slots 2-3 | importante | https://github.com/xansde/fusion-systems-2e/issues/153 |
| C4 — regra de idiomas por chave INT cobre só 4 de 8 classes | importante | https://github.com/xansde/fusion-systems-2e/issues/154 |
| C5 — dádiva de classe errada, talentos nv2/3 vazios, legendas erradas | importante | https://github.com/xansde/fusion-systems-2e/issues/155 |
| C7 — smoke do player não monta níveis 1-3, print final trocado | importante | https://github.com/xansde/fusion-systems-2e/issues/156 |
| C6 — copiar `ficha-nivel3.spec.ts` pro repo principal antes de remover a wt-c | importante | https://github.com/xansde/fusion/issues/255 |
| Scholar/Skilled Human: ChoiceSet de perícia sem slot no Plan | importante | https://github.com/xansde/fusion-systems-2e/issues/157 |
| moldeComparator: nomes de magia fora da comparação (C3, escopo restante) | menor | https://github.com/xansde/fusion-systems-2e/issues/158 |
| `stepCharAc` também descarta o rank (mesmo padrão de C8, não visível na UI) | menor | https://github.com/xansde/fusion-systems-2e/issues/159 |
| Contacts: Actor recém-criado não aparece em "Na mesa" sem reload (já aberta antes desta lane) | menor | https://github.com/xansde/fusion/issues/254 |
| Pré-requisito de rank de perícia em talento de arquétipo não é marcado (já aberta antes desta lane) | menor | https://github.com/xansde/fusion-systems-2e/issues/144 |
| `pregen-parity` — 17 classes sem `skillIncreaseCeiling` em `KNOWN_DIVERGENCES` (já aberta, dívida da Onda 0) | menor | https://github.com/xansde/fusion-systems-2e/issues/91 |

Nenhuma pendência desta onda ficou sem issue. As duas primeiras issues (N2 e o defeito de dado)
são o gate real para reabrir esta onda com "divergência zero" não-circular; as demais (C1/C4/C5/
C6/C7) são o que falta para o roteiro e2e valer como aceite fiel ao molde.

## 6. Próximos passos (fora do escopo deste fecho)

Uma rodada 3 de fixer, focada nos 6 itens acima (issues #151/#153/#154/#155/#156 no satélite +
#255 no core), seguida de nova revisão adversarial, é o caminho para "PODE MERGEAR: SIM". Esta
lane de fecho para aqui por instrução explícita do orquestrador.
