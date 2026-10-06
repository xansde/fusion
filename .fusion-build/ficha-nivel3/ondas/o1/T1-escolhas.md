# Onda 1 — T1-escolhas (T1.1-T1.8) — relatório

## Escopo executado

Todas as tarefas da Onda 1 (T1.1-T1.8), não só T1.1-T1.6 — o título da lane
("+ fólio do Commander + idiomas") e o próprio `tasks.md` listam T1.7/T1.8
dentro da mesma onda de uma lane só, então entraram no mesmo diff.

- **T1.1-T1.5** (15 escolhas): Exemplar (ikon+rootEpithet), Swashbuckler
  (style), Gunslinger (way), Investigator (methodology), Witch (patron),
  Druid (order), Oracle (mystery), Psychic (consciousMind), Animist
  (practice→**animisticPractice**, nome canônico da curadoria), Alchemist
  (researchField), Inventor (innovation), Summoner (eidolon), Thaumaturge
  (implement), Necromancer (fatalMethod). **Desvio deliberado do headline**:
  também cabeei o 2º eixo de Psychic (`subconsciousMind`), o 2º eixo de
  Animist (`apparition`, com cardinalidade) e o 2º de Necromancer
  (`grimFascination`) — nenhum contava nos "15" do resumo, mas são escolhas
  mandatórias de nível 1 sem as quais a classe não fica jogável (mesmo
  raciocínio já usado no código para Doctrine/Divine Font do Cleric).
- **T1.6** (taguear `otherTags`): **nada a fazer** — verifiquei
  `systems/pf2e/packs/class-features-core/documents.json` contra as 16
  categorias e todas já tinham exatamente o número de documentos que
  `choiceAxes[].optionCount` da curadoria previa (ex.: `exemplar-ikon` = 21,
  `necromancer-fatal-method` = 2). T1.5 (nota "sonda não achou os
  documentos") estava desatualizada: os documentos existem e estão
  tagueados; **não caiu para T4.3**.
- **T1.7** (fólio do Commander): "Tactics" (nível 1) → novo slot
  `tacticKnown`, count=5, opções em `actions-core` (37 ações trait
  "tactic") — único eixo cuja fonte não é `class-features-core`;
  `CLASS_CHOICE_SLOT_OPTIONS` ganhou `traitFilter` como alternativa a
  `category`. Fora de escopo: preparação diária (3-de-5 "drilled") — é
  mecanismo separado, sem dado/spec ainda.
- **T1.8** (idiomas): **escopo parcial, deliberado**. Implementado: novo
  `DeriveStep` (`stepCharLanguages`) que deriva `system.derived.languages`
  a partir do `system.languages.value` fixo do item de ancestralidade
  embutido (ex.: Ratfolk → `["common","ysoki"]`), exibido na aba principal
  da ficha ao lado de "Sentidos". **Não implementado**: o picker de idiomas
  BÔNUS (`additionalLanguages.count` da ancestralidade + modificador de
  Inteligência positivo, escolhidos de `additionalLanguages.value`) — esse
  eixo não cabe no mecanismo `CLASS_CHOICE_SLOT_OPTIONS` (as opções são uma
  lista de strings do próprio item de ancestralidade, não documentos de um
  pack) e exigiria um diálogo novo (~600 linhas, molde
  `SkillTrainingDialog.svelte`). Não criei um `PlanSlotType` sem emissor na
  tela — `feedback_gatilho_ui_testavel.md` é explícito que isso é pior que
  não ter o slot. Ver pendência 2 abaixo.

## Mecanismo (cardinalidade — achado da onda)

`CLASS_CHOICE_SLOTS`/`CLASS_CHOICE_SLOT_OPTIONS` assumiam 1 escolha por
placeholder de `featuresByLevel`. Ikon do Exemplar (escolhe 3) e Apparition
Attunement do Animist (escolhe 2) quebravam essa suposição. Resolvido com
`CLASS_CHOICE_SLOT_COUNT` (novo, `slotType -> N`): `derivePlan` emite N
slots independentes (`<tipo>-<nível>-<índice>`); `chooseClassChoice` ganhou
um 5º parâmetro opcional `slotId` (default preserva 100% de compatibilidade
— nenhum chamador existente mudou) para que o picker grave no slot
realmente clicado, não no `<tipo>-<nível>` genérico.

## Prova mecânica (gate da onda)

Teste novo `sheets/pf2e/src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts`
(69 casos): percorre as 28 entradas de `CLASS_CHOICE_SLOT_OPTIONS` afirmando
lista > 0 opções reais (pack certo por entrada — `class-features-core` ou
`actions-core`), builda as 15 classes destravadas a nível 1-3 com o mesmo
harness real do `varredura-classes.test.ts` (op builders de produção,
zero mocks) afirmando zero achados e que cada slot novo gravou no ator,
mais casos dedicados confirmando os 3 slots de ikon, os 2 de apparition e
os 5 de tacticKnown.

## Comandos rodados (saída real, não colada aqui — só o resultado)

- `pnpm --filter @fusion/sheets-pf2e exec vitest run` (arquivos afetados):
  ficha-nivel3-onda1 (69), planVM (380), varredura-classes (190),
  planColumn-variant-rules (6), characterSheetVM (218) — **todos verdes**.
- `pnpm --filter @fusion/system-pf2e exec vitest run` (suíte completa do
  pacote, 22 arquivos): **660/660 verdes**.
- `pnpm --filter @fusion/client typecheck` (svelte-check, 1610 arquivos):
  **0 erros**, 24 warnings pré-existentes (arquivos não tocados).
- `pnpm build` (topológico, raiz do core): **verde**, client compila.
- `prettier --check` nos arquivos tocados: **verde**.
- `eslint` nos arquivos tocados: **0 erros** (2 warnings "no matching
  config" ao invocar arquivo avulso do satélite — mesmo padrão já visto em
  `planVM.ts` antes desta lane, não é regressão).

## Commits (branch `ficha3/o1`, ambos pushed)

- Satélite `xansde/fusion-systems-2e`: `1a90ad0` (T1.1-T1.7), `ad991ba`
  (T1.8), branch pushed.
- Core `xansde/fusion`: `d12d0687` (i18n), `fe96580d` (pin do submodule),
  branch pushed. **Nenhum PR aberto** — deixado para a fase de fecho da
  onda (esta lane é a única da Onda 1; o fecho decide se abre PR agora ou
  espera outra onda compor).

## Pendências (registradas como issue — links abaixo)

1. **Repo `xansde/fusion-systems-2e` — Ikon/Apparition sem dedup entre
   slots-irmãos.** https://github.com/xansde/fusion-systems-2e/issues/101
   Título: `CLASS_CHOICE_SLOT_COUNT: nada impede escolher a mesma opção
   duas vezes (Ikon do Exemplar, Apparition do Animist)`.
   Corpo: Slots `ikon-1-0/1/2` e `apparition-1-0/1` são independentes — o
   picker de cada um não exclui o que já foi escolhido nos irmãos. O
   harness de teste evita isso via um `Set` interno, mas a UI real
   (PlanColumn) não tem esse filtro. Precisa: `pickerConfigFor` excluir, no
   `filterFn`, os `sourceId` já gravados nos outros slots do MESMO eixo
   (mesmo nível, mesmo `type`, `slotId` != o clicado).

2. **Repo `xansde/fusion-systems-2e` — Picker de idiomas bônus (T1.8
   restante).** https://github.com/xansde/fusion-systems-2e/issues/102
   Título: `Idiomas bônus por Inteligência: picker ausente
   (additionalLanguages da ancestralidade)`.
   Corpo: `stepCharLanguages` deriva só os idiomas FIXOS da ancestralidade.
   Falta o eixo de escolha: `additionalLanguages.count` (base 0, a maioria
   das ancestralidades) + max(0, modIntelligência) idiomas extras, opções
   em `additionalLanguages.value` (lista de strings no próprio item de
   ancestralidade — NÃO um pack de documentos, então não cabe em
   `CLASS_CHOICE_SLOT_OPTIONS`). Precisa: novo `PlanSlotType "language"`
   dinâmico por Int (padrão `skillTraining`'s `trainedSkillCount`), escrito
   via `BuildChoiceSchema` (sem item embutido, como `adoptedAncestryChoice`)
   e um diálogo NOVO no molde de `SkillTrainingDialog.svelte` (lista fixa
   de strings, não busca em compêndio).

3. **Repo `xansde/fusion-systems-2e` — Fólio de táticas do Commander:
   preparação diária ausente.** https://github.com/xansde/fusion-systems-2e/issues/103
   Título: `Commander: preparar 3 de 5 táticas do fólio (drill diário)`.
   Corpo: T1.7 cabeou só o FÓLIO (5 conhecidas, `tacticKnown`). RAW exige
   uma segunda etapa — 10 minutos de "drill" prepara 3 das 5 para uso até a
   próxima preparação diária. Sem UI/mecanismo de "dia" no Fusion hoje
   (nenhuma outra classe usa esse conceito), então é mecanismo novo, não
   cabeamento — fora do escopo desta fatia (nível 1-3, criação).

## Resumo (contrato de retorno)

Status: **OK** (T1.1-T1.8 completas dentro do escopo declarado, com 2
cortes de escopo documentados e registrados como issue). 4 commits, 2
branches `ficha3/o1` pushed (satélite + core). 69+218+380+190+6 = 863
testes de superfície diretamente tocada verdes; system-pf2e completo
(660) verde; typecheck do client 0 erros; build verde. Nenhum bloqueio.
