# Onda 4 — evidência (execucao.md §3)

Worktree: `wt-c` (core branch `ficha3/o4`; satélite `external/fusion-systems-2e` branch `ficha3/o4`).
SHAs finais: core `5851e6aa` (aponta o pin para o satélite), satélite `5c28dcb`.

## Linha da tabela da seção 3 (`execucao.md`), preenchida

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **4** | `pnpm build/typecheck/lint/lint:boundaries/format:check` — todos EXIT 0. `pnpm test` (suíte completa, 414.65s): **2 arquivos falhos / 441 passando (443)**, **23 testes falhos / 8134 passando (8159, 1 skip, 1 todo)** — as 23 falhas são exatamente `actionCategories.test.ts` (1) e `pregen-parity.test.ts` (22), idênticas em contagem e causa ao baseline da Onda 0 (`ficha3-reports/o0/baseline.md`: 3 arquivos falhos/25 testes falhos antes do fix da Onda 1) — **sem regressão nova**. Testes específicos da onda: `planVM.test.ts` 397/397, `ficha-nivel3-onda1.test.ts` 71/71, `grantMaterializer-realPacks.test.ts` 11/11, `planColumn-variant-rules.test.ts` 6/6, `animist-rule-coverage.test.mjs` 2/2 — todos verdes. `pnpm spec:report`: cobertura MVP **710/710** (piso), EXIT 0. Animist: 23/23 features de nível 1-3 com `rules` OU `ruleJustifications` (critério do gate trocado e registrado em `tasks.md`/`execucao.md`, achado C4). Pack `deities-core`: 473 documentos (deity/pantheon/covenant) importados e referenciáveis pelo eixo `deity`. | 4 personagens reais, mundo real (cópia de `teste_xande`), cruzados com `world.db` fora da UI: **Tobias** (Cleric nv1) com `items` incluindo `{name:"Cleric",type:"class"}` + `{name:"Sarenrae",type:"deity"}`; **Novo Ator** (Champion nv1) com `{name:"Champion",type:"class"}` + `{name:"Iomedae",type:"deity"}` (Deific Weapon/Champion's Aura materializam via `materializeClassGrants`, fire-and-forget, convergindo em ~4,5s — achado C2, investigado e provado não ser defeito de código); **O4 Animist Test** (Animist) com `system.level.value: 3`, `items` incluindo `Animist` (class) + as 2 apparitions (`Custodian of Groves and Gardens`, `Crafter in the Vault`) como `classFeature`; **O4 Necromancer Test** (Necromancer nv1) com `items` incluindo `Necromancer` (class) + `Reaper` (classFeature, Fatal Method). | **10 prints**, todos lidos (Read) nesta lane de fecho e na lane de reverificação (`evidencia-viva-final.md`), tabela completa abaixo. |

## Prints — o que cada um prova

| # | Arquivo | O que prova |
|---|---|---|
| 01 | `01-cleric-deity-picker-search.png` | Picker de Divindade filtra por nome ("Sarenrae"); preview com edicts/anathema/title reais (não placeholder) |
| 02 | `02-cleric-deity-sarenrae-preview.png` | Preview de Sarenrae antes de confirmar a escolha |
| 03 | `03-cleric-deity-embedded-plan.png` | Ficha "Tobias" nível 1, classe Cleric ✓ e item "Sarenrae — Deity" ✓ marcados no Plano, CD de Magia derivada |
| 04 | `04-champion-deity-picker-search.png` | Dado real de Iomedae chega à UI do picker do Champion |
| 05 | `05-champion-deity-iomedae-preview.png` | Preview de Iomedae (title "The Inheritor", edicts, anathema, sacred animal) |
| 06 | `06-champion-deity-embedded-plan.png` | Ficha "Novo Ator" nível 1, classe Champion ✓ e item "Iomedae — Deity" ✓ marcados no Plano |
| 07 | `07-animist-apparition1-preview.png` | Dialog "Sintonia de Aparição" com 14 opções reais no pack (6 visíveis na rolagem), preview de "Custodian of Groves and Gardens" com skills/spells reais |
| 08 | `08-animist-nv3-plan-granted.png` | Ficha "O4 Animist Test": Nível 2 e Nível 3 marcados ✓ no Plano — classe concedida de verdade até nv3, não só listada |
| 09 | `09-necromancer-fatal-method-options.png` | Dialog "Escolher Método Fatal" com 2 opções reais (Puppeteer, Reaper) e preview de Puppeteer |
| 10 | `10-necromancer-fatal-method-embedded-plan.png` | Ficha "O4 Necromancer Test" nível 1, classe Necromancer ✓ e item "Reaper — Fatal Method" ✓ marcados no Plano |

Observação de qualidade (sem impacto na prova): os prints 01↔02 e 04↔05 capturam painéis muito
parecidos — o par "picker-search" deveria mostrar a lista/busca antes de selecionar, e no caso do
Champion (04) já mostra o preview expandido, igual ao 05. Registrado, não é defeito de produto.

## Veredito da revisão adversarial (e re-verificações)

- **Rodada 0** (`revisao-adversarial.md`, juiz `opus`, consolidando 4 lentes — regra-pf2e,
  dado-importer, testes-contratos, costura-segurança): **APROVADA COM CONSERTOS**. 1 bloqueante
  (C1 — todo slot de divindade preenchido saía marcado "classe errada: Deity"), 3 importantes
  (C2 — features de classe pareciam não embutir no fluxo real; C3 — Fonte Divina do Clérigo não
  filtrada pela divindade; C4 — gate do Animist trocado sem registro + referência falsa a
  "buracos 5/6/8"), 5 menores (C5-C9), 4 refutados.
- **Fixer, rodada 1** (`fix-r1.md`): C1 e C3 consertados com TDD (commits satélite `cff0dbd`,
  `728dc78`); C4 corrigido via documentação + 2 issues novas (satélite `5c28dcb`, core
  `5851e6aa`); C2 investigado a fundo — **não reproduz** num build fresco (2 roteiros Playwright
  ad-hoc contra `wt-c` pós-C1: fluxo completo e isolamento de timing, ambos confirmam que os
  grants materializam em ~4,5s via socket, fire-and-forget). Nenhum achado C5-C9 foi tratado
  nesta rodada (fora do escopo bloqueante/importante que o fixer cobriu).
- **Re-verificação adversarial, rodada 1** (`revisao-adversarial-r1.md`): **APROVADA**. Os 4
  achados (C1-C4) confirmados como FECHADOS, com reprodução independente (Cleric/Animist
  reproduzidos do zero pela lane revisora, além do Champion do fixer). 1 achado menor novo (N1 —
  comentário desatualizado em `planVM.ts:2544`), **já corrigido** (comentário reescrito na mesma
  rodada, conferido nesta lane de fecho lendo o arquivo atual). **Zero achado bloqueante ou
  importante aberto.**
- **Reverificação da evidência viva** (`evidencia-viva-final.md`): leitura independente dos 10
  prints, sem servidor novo — confirma ponto a ponto as alegações da sessão anterior. Nenhuma
  divergência de conteúdo.

**PODE MERGEAR: SIM** — confirmado pelo orquestrador da onda (revisão adversarial passou, zero
bloqueante/importante aberto) e reconfirmado nesta lane de fecho.

## Pendências, com o link da issue de cada uma

| Achado | Severidade | Issue |
|---|---|---|
| Sanctification (holy/unholy/none) do Cleric/Champion sem picker/derivação | pré-existente, ligada por T4.1 | [xansde/fusion-systems-2e#22](https://github.com/xansde/fusion-systems-2e/issues/22) |
| 473 documentos de `deities-core` sem tradução pt-BR | pré-existente, ligada por T4.1 | [xansde/fusion-systems-2e#58](https://github.com/xansde/fusion-systems-2e/issues/58) |
| Eixo `animist-apparition`: `optionCount` (13) diverge do pack real (14, inclui a uncommon "Lamentation of Sinister Deals") | menor/produto, T4.2 | [xansde/fusion-systems-2e#110](https://github.com/xansde/fusion-systems-2e/issues/110) |
| Animist: grant dinâmico de Lore skill por apparition sem motor (sem rule kind suportado) | importante (C4, engine) | [xansde/fusion-systems-2e#114](https://github.com/xansde/fusion-systems-2e/issues/114) |
| Animist: repertório de apparition com 16 magias faltando em spells-core | importante (C4, dado) | [xansde/fusion-systems-2e#115](https://github.com/xansde/fusion-systems-2e/issues/115) |
| C5 — Champion sem perícia divina; Cleric sem magias da divindade | menor (revisão adversarial rodada 0) | comentário em [xansde/fusion-systems-2e#22](https://github.com/xansde/fusion-systems-2e/issues/22#issuecomment-5763130026) |
| C6 — Santificação × Causa do Campeão sem checagem de compatibilidade | menor (revisão adversarial rodada 0) | comentário em [xansde/fusion-systems-2e#22](https://github.com/xansde/fusion-systems-2e/issues/22#issuecomment-5763130026) |
| C7 — Multiclasse (Arquétipo Livre): Cleric→Champion abre um segundo slot de divindade | menor (revisão adversarial rodada 0) | [xansde/fusion-systems-2e#118](https://github.com/xansde/fusion-systems-2e/issues/118) |
| C8 — justificativa de "Apparition Attunement" em `animist.json` contradiz o código (eixo já cabeado desde a Onda 1) | menor (revisão adversarial rodada 0) | [xansde/fusion-systems-2e#119](https://github.com/xansde/fusion-systems-2e/issues/119) |

Nenhuma pendência ficou só no relatório — todas as tabelas acima (achados confirmados +
"Pendências para issue" de cada lane) têm issue linkada.

## CI (a preencher pelo passo 5 do fecho)

Ver `fecho.md` para os números finais do run de CI do PR do satélite (aguardado) e do PR do core
(não aguardado nesta rodada — `PODE MERGEAR: SIM`, então o CI que conta é o de depois do re-pin,
passo 6b).
