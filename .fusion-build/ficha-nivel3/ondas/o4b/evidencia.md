# Evidência de fecho — Onda 4b (T4.4, Aparições do Animist fazem efeito)

Worktree: `scratchpad/wt-d` — core `xansde/fusion`, branch `ficha3/o4b`; submodule
`external/fusion-systems-2e`, branch `ficha3/o4b`.

## SHAs finais (pushados)

- Core `xansde/fusion`, `ficha3/o4b`: **`bb7fe458`** (pin do fixer r2 sobre `075d1587` docs +
  `2f7b980b` prettier + `e7b96f86` pin inicial + `0f84874f` pin do fixer r1).
- Satélite `xansde/fusion-systems-2e`, `ficha3/o4b`: **`8203bae`** (5 commits acima de
  `origin/main`: consumação do Apparition Attunement, fixer r1 C1-C8, fixer r2 N2).

## PRs

- Satélite: [`xansde/fusion-systems-2e#141`](https://github.com/xansde/fusion-systems-2e/pull/141)
  `ficha3/o4b` → `main`.
- Core: [`xansde/fusion#249`](https://github.com/xansde/fusion/pull/249) `ficha3/o4b` →
  `alfa/app`.

## 1. Tabela da seção 3 do `execucao.md` — linha da Onda 4b (preenchida)

| Onda | Mecânico | Vivo | Olhado |
| --- | --- | --- | --- |
| **4b** | 13+9 testes (`apparitionSpellcasting.test.ts` + `planColumn-levelup-apparition.test.ts`) contra o vendor real: entrada "Apparition Spells" criada, repertório+Lore+vessel corretos, swap/remove retraem, level-up materializa rank 2+ sem reabrir | Ator `Fixer_o4b_r2` (mundo `teste_xande`, servidor+browser reais): 1ª aparição escolhida → Patamar 1 na aba Magias sem reabrir; nível 1→2→3 pelo botão → Patamar 2 (Knock) sem reabrir; `world.db` bate com a UI | prints `r2-03`..`r2-10` (`evidencia-viva-r2.md`) — ficha limpa, escolha, magias antes/depois, level-up |

Os três níveis (Mecânico/Vivo/Olhado) estão **FEITOS**. O `execucao.md` (core) foi atualizado
nesta sessão de fecho com esta mesma linha e uma nota de rodapé registrando a rodada 2 do fixer
+ o fecho (commit desta sessão).

## 2. Gate final local (rodado nesta sessão de fecho, HEAD `bb7fe458` / `8203bae`)

Comando `pnpm build` (topológico, todos os pacotes incluindo `external/fusion-systems-2e`):

```
packages/client build: ✓ built in 21.32s
packages/client build: Done
```
Exit 0 — verde, todos os pacotes buildaram sem erro.

Comando `pnpm typecheck` (14 pacotes + `svelte-check`):

```
packages/server typecheck: Done
packages/client typecheck: ... COMPLETED 1612 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS
packages/client typecheck: Done
```
0 erros, 24 warnings — os mesmos 24 warnings pré-existentes já registrados em `gate.md` (a11y e
`state_referenced_locally` em arquivos não tocados por esta onda, incluindo `CharacterSheet.svelte`/
`NpcSheet.svelte`/`FamiliarSheet.svelte` do satélite). Nenhum warning novo.

Comando `pnpm lint`:

```
external/fusion-systems-2e/sheets/pf2e/.../pregen-parity.test.ts
  69:3  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
✖ 1 problem (0 errors, 1 warning)
```
0 erros — o mesmo warning pré-existente (arquivo não tocado nesta onda) já registrado em `gate.md`.

Comando `pnpm lint:boundaries`:

```
✔ no dependency violations found (5038 modules, 12154 dependencies cruised)
```
Verde.

Comando `pnpm format:check`:

```
Checking formatting...
All matched files use Prettier code style!
```
Verde — nenhuma correção necessária nesta rodada (diferente do gate anterior, que precisou de
`prettier --write` em 2 `.md`; já estava commitado).

Comando `pnpm spec:report`:

```
cobertura [MVP] com teste: 710 (piso 710)
```
Sem diff em nenhum arquivo (`git status --short` só mostra o resíduo pré-existente
`tools/importer-pf2e/`, não relacionado).

Testes das tarefas da onda (arquivos afetados, rodados isolados nesta sessão de fecho):

```
$ vitest run apparitionSpellcasting.test.ts planVM.test.ts
✓ apparitionSpellcasting.test.ts (18 tests) 134ms
✓ planVM.test.ts (424 tests) 146ms
Test Files  2 passed (2)
     Tests  442 passed (442)

$ vitest run planColumn-levelup-apparition.test.ts planColumn-variant-rules.test.ts
✓ planColumn-variant-rules.test.ts (6 tests) 48ms
✓ planColumn-levelup-apparition.test.ts (3 tests) 4ms
Test Files  2 passed (2)
     Tests  9 passed (9)
```

Total: **453 testes verdes, 0 falhas** nos arquivos afetados por esta onda (18 + 424 + 6 + 3).

**Suíte completa** não rodada nesta sessão de fecho (por instrução do prompt — só o gate da onda
já executado por `fix-r2.md`/`gate.md` roda a completa, mais o CI). Números da rodada anterior da
suíte completa (`gate.md`, commit `2f7b980b`, 2 commits atrás do HEAD atual — só pin de submodule
mudou depois, sem tocar em testes do core):

```
pnpm test (vitest --workspace): exit 1 — 3 arquivos falharam, 24 testes falharam,
de 8283 testes / 446 arquivos (443 passaram, 1 skip, 1 todo)
```
Comparado ao baseline (`o0/baseline.md`: 3 arquivos, 25 falhas, 8003/438): **nenhuma regressão
nova** — `actionCategories.test.ts` (1, mensagem idêntica), `pregen-parity.test.ts` (22, mesmos
nomes), `traitNames.sync.test.ts` (0, melhorou), `TokenInteractionManager.teardown.test.ts` (1,
flakiness de infra sob carga, verde isolado em 2.3s, arquivo sem relação com o código tocado).
Detalhe completo em `gate.md` (copiado para este diretório).

Suíte completa do pacote `@fusion/sheets-pf2e` (rodada pelo fixer r2, `fix-r2.md`): 25 falhas,
todas em `pregen-parity.test.ts`/`actionCategories.test.ts`, batendo com o baseline; nenhuma em
arquivo tocado pelo fixer.

## 3. CI dos PRs

- **Satélite `xansde/fusion-systems-2e#141`**: `Build, Typecheck & Test (against mounted core)` —
  **SUCCESS** em 2m6s.
  https://github.com/xansde/fusion-systems-2e/actions/runs/35666487226/job/106553294013
- **Core `xansde/fusion#249`**: aguardando o CI pós re-pin (passo 6b do fecho) — o pin do
  submodule para a tag nova invalida o CI rodado antes dele; só o CI depois do re-pin conta.

## 4. Prints — o que cada um prova

### Lane 1 — implementação inicial, TDD (`T4.4-aparicoes.md`, sem prints; só testes)

### Lane 2 — evidência viva, rodada 1 (`evidencia-viva.md`, ator "Novo Ator", pré-fixer r1/r2)

Servidor porta 33033, ator `uPI3hK89HeppNd4a` ("Novo Ator", nível 3). **Nota:** este ator já
vinha contaminado por uma construção Animist anterior (Barbarian fantasma + Knock pré-resolvido)
— por isso a evidência definitiva de C2/N2 foi refeita com ator limpo na rodada 2 (abaixo).

| Print | Prova |
| --- | --- |
| `00-picker-aparicao.png` | Picker de Sintonia de Aparição mostra texto real do livro (skills, magias por patamar, vessel spell, avatar) — não é dropdown genérico. |
| `01-animist-nv1-antes-aparicoes.png` | Trocar a classe para Animist cria os 2 slots "Sintonia de Aparição" + feature "Animist & Apparition Spellcasting". |
| `02-magias-antes-aparicoes.png` | Antes de escolher aparição, aba Magias só tem `divine Spells` (vazio) e `Foco` — sem "Apparition Spells" ainda. |
| `03-magias-depois-1a-aparicao.png` | Escolher a 1ª aparição (Custodian) cria a aba "Apparition Spells" na hora, com truque e Patamar 1. |
| `04-foco-vessel-spell.png` | Aba Foco ganha a vessel spell da aparição (Jardim de Cura / Custodian), 0/1 ponto. |
| `05-pericias-lore-aparicao.png` | As 2 Lore skills da aparição concedidas como treinadas (Saber Farming/Herbalism). |
| `06-magias-repertorio-2-aparicoes.png` | Escolher a 2ª aparição (Lamentation) une o repertório de truques das duas. |
| `07-magias-apos-troca-aparicao.png` | Trocar a 1ª aparição (Custodian → Crafter) troca o repertório dela, preserva a outra. |
| `08-foco-vessel-apos-troca.png` | Vessel spell em Foco trocou junto (Traveling Workshop, de Crafter). |
| `09-apos-reload-magias-persistem.png` | Recarregar a página mantém aba, truques e patamares. |
| `10-defeito-classe-label-stale-apos-reload.png` | **Defeito achado** (não desta lane): trocar classe pelo picker deixa rótulo/features fantasma da classe anterior, sobrevive a reload — virou `xansde/fusion#248`. |

### Lane 3 — evidência viva, rodada 2 / fixer N2+C7 (`evidencia-viva-r2.md`, ator limpo `Fixer_o4b_r2`)

Servidor porta 33045, ator criado do zero (sem classe/features/spellcasting prévios) —
elimina a contaminação da rodada 1.

| Print | Prova |
| --- | --- |
| `r2-03-ficha-aberta.png` | Ator limpo, nível 1, sem classe. |
| `r2-04-animist-escolhido.png` | Escolher classe Animist dá os 2 slots "Sintonia de Aparição". |
| `r2-05-magias-antes.png` | Antes de escolher aparição, aba Magias só tem `divine Spells` e `Foco`. |
| `r2-06-reabertura.png` | Reabertura da ficha ANTES da escolha — "Sintonia de Aparição" ainda vazia (contraste com r2-08). |
| `r2-07-C2-rank1-sem-reabrir.png` | **C2 fechado**: escolher a 1ª aparição (Crafter) e ir direto na aba Magias, SEM reabrir a ficha — Patamar 1 já presente. |
| `r2-08-C2-aba-apparition-spells.png` | Aba "Apparition Spells" com truque Sigilo + Patamar 1 Mending, imediatamente após a escolha. |
| `r2-09-N2-nv3-sem-reabrir.png` | **N2 fechado**: subir de nível 1→2→3 pelo botão, sem reabrir a ficha — Patamar 2 já aparece. |
| `r2-10-N2-knock-visible-full.png` | Patamar 2 com "Knock" visível e "Repertório completo neste patamar", nível 3, sem reload. |
| `r2-00-home.png`, `r2-01-contatos.png`, `r2-02-after-reload.png` | Setup do browser (home, lista de contatos, ficha após reload) — contexto do fluxo, não prova isolada. |

### Lane 4 — evidência viva adicional, pós-aprovação (`evidencia-viva-final.md`, mesmo ator `Fixer_o4b_r2` já em nível 3)

Cobertura extra do cenário de 2 aparições simultâneas e troca — não exigida pela revisão, gerada
para mais confiança; achou 2 defeitos novos (P1, P2, viraram issue) e confirmou a #115 com caso
concreto (P3, comentário já existente).

| Print | Prova |
| --- | --- |
| `01-magias-antes-2a-aparicao.png` | Animist nv1 com só 1 das 2 Sintonias escolhidas — repertório só do Crafter. |
| `02-foco-vessel-crafter-in-the-vault.png` | Vessel do Crafter (Traveling Workshop) em Foco, 0/1. |
| `03-picker-2a-aparicao.png` | Picker da 2ª Sintonia lista as 11 aparições do vendor com texto completo. |
| `04-magias-depois-2a-aparicao.png` | Escolher a 2ª aparição (Custodian) soma truques das duas na aba Magias. |
| `05-adicionar-magia-lista-nao-filtrada.png` | **Defeito achado (P2)**: picker de "Adicionar magia conhecida" lista toda a tradição divina, não filtra pelas aparições atuneadas — virou `fusion-systems-2e#139`. |
| `06-pericias-lore-2-aparicoes.png` | Perícias lista as 4 Lore skills das duas aparições, todas treinadas. |
| `07-magias-apos-reload.png` | Reload no meio do teste mantém sessão e repertório das duas aparições. |
| `08-plano-2-aparicoes-nv3.png` | Nível 3 com slots de Patamar 1 e 2 sempre disponíveis (não só Patamar 1). |
| `09-picker-troca-echo-of-lost-moments.png` | Troca de aparição (Custodian → Echo of Lost Moments) pelo picker de edição. |
| `10-magias-apos-troca-echo.png` | **Defeito achado (P1)**: após a troca, Patamar 1 fica com 2 magias conhecidas (Mending + Déjà Vu) contra `max: 1` — virou `fusion-systems-2e#138`. |

## 5. Veredito da revisão adversarial (e re-verificações)

- **Rodada 1** (`revisao-adversarial.md`, sobre a implementação inicial `497313a8`):
  **REPROVADA** — 3 achados bloqueantes + 4 importantes. A própria queixa do Alexandre ("não
  adicionou nada na minha lista de magia") tinha causa raiz não fechada: círculo 1 do repertório
  vazio no primeiro pick (C2), escolha da aparição podia sumir de `system.build.choices` no mesmo
  lote (C1).
- **Fixer r1** (`fix-r1.md`): consertou os 7 achados confirmados (C1-C7), satélite `497313a8` →
  posteriormente evoluído.
- **Rodada 2** (`revisao-adversarial-r1.md`, sobre o fixer r1): confirmou **2 achados
  importantes** — **N2** (level-up não materializa repertório de rank 2+ até reabrir a ficha) e
  **C7** (evidência viva ainda não refeita no pin pós-fixer).
- **Fixer r2** (`fix-r2.md`): corrigiu N2 (`handleLevelUp` chama `materializeApparitionSpells`,
  satélite `8203bae`) e refez a evidência viva do zero com ator limpo (Lane 3 acima).
- **Rodada 3** (`revisao-adversarial-r2.md`, sobre o fixer r2): **APROVADA** — zero achado
  bloqueante ou importante. Um achado menor (N3: campo de edição direta de nível não materializa
  o repertório, mesma lacuna que os grants de classe já têm nesse caminho) registrado para virar
  issue, **não bloqueia** o merge.
- **Revisões de apoio** (`revisao-costura-seguranca.md`, `revisao-dado-importer.md`,
  `revisao-regra-pf2e.md`, `revisao-testes-contratos.md`) — cobrem redação/segurança,
  fidelidade ao dado do vendor (sem fabricação, lição #48), regra PF2e remaster e não-circularidade
  dos testes; nenhuma reprovou o merge.

**Veredito final: PODE MERGEAR — SIM.** Confirmado por este gate de fecho: build, typecheck,
lint, lint:boundaries, format:check e spec:report verdes no HEAD atual (`bb7fe458`/`8203bae`),
sem regressão nova contra o baseline, revisão adversarial aprovada, evidência Vivo/Olhado
completa.

## 6. Pendências e issues

| Pendência | Repo | Issue/comentário |
| --- | --- | --- |
| Slot de repertório excede `max` quando magia manual sobrevive à troca de aparição (P1) | `xansde/fusion-systems-2e` | [#138](https://github.com/xansde/fusion-systems-2e/issues/138) (nova) |
| Picker de "Adicionar magia conhecida" não filtra pela lista das aparições atuneadas (P2) | `xansde/fusion-systems-2e` | [#139](https://github.com/xansde/fusion-systems-2e/issues/139) (nova) |
| Edição direta de nível não materializa repertório de Apparition (achado menor N3) | `xansde/fusion-systems-2e` | [#140](https://github.com/xansde/fusion-systems-2e/issues/140) (nova) |
| Trocar classe pelo picker deixa item/features fantasma da classe anterior | `xansde/fusion` | [#248](https://github.com/xansde/fusion/issues/248) (nova) |
| 16 magias de aparição faltando em `spells-core` (confirmado com caso concreto: Protector Tree, Blistering Invective) | `xansde/fusion-systems-2e` | [#115](https://github.com/xansde/fusion-systems-2e/issues/115) (já aberta; comentário do fixer r1) |
| Reseleção da aparição primária a cada Refocus (RAW) — sem UI de sub-escolha | `xansde/fusion-systems-2e` | comentário em [#124](https://github.com/xansde/fusion-systems-2e/issues/124#issuecomment-5769316936) |
| Reescolha diária das aparições (sem passo de preparação diária na fatia) | `xansde/fusion-systems-2e` | comentário em [#124](https://github.com/xansde/fusion-systems-2e/issues/124#issuecomment-5769316936) |
| Grant dinâmico de Lore skill por aparição | `xansde/fusion-systems-2e` | comentário em [#114](https://github.com/xansde/fusion-systems-2e/issues/114#issuecomment-5769317129) (já fechado por esta onda, registrado) |
| Mesma aparição escolhida duas vezes (sem validação) | `xansde/fusion-systems-2e` | [#101](https://github.com/xansde/fusion-systems-2e/issues/101) (já aberta, não tocada) |
| Eixo animist-apparition: 13×14 opções / raridade uncommon | `xansde/fusion-systems-2e` | [#110](https://github.com/xansde/fusion-systems-2e/issues/110) (já aberta, não tocada) |
| Justificativa de curadoria desatualizada | `xansde/fusion-systems-2e` | [#119](https://github.com/xansde/fusion-systems-2e/issues/119) (já aberta, não tocada) |

Nenhuma pendência ficou só no relatório.
