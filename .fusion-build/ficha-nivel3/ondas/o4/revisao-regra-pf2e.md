# Revisão adversarial — Onda 4 (dados ausentes) — lente REGRA PF2e + CAMINHO DE PRODUÇÃO

Revisor: somente leitura sobre `wt-c` (core `ficha3/o4` @ 3b8ceb6f, satélite `ficha3/o4` @ 52fc0ab).
Única execução: uma sonda vitest isolada no scratchpad (`scratchpad/o4rev/check.test.ts`, com config
própria só para o alias `$lib`), que chama `checkSlotRequirement` do `planVM.ts` real. Não rodei a
suíte e não editei o repo.

## Veredito

**NÃO PODE MERGEAR como está**: 1 bloqueante e 4 importantes. O pack está bom: 473 docs com
`font`/`skill`/`weapons`/`sanctification` completos, arte placeholder e descoberta automática pelo
`CompendiumService.discoverPacks` (não precisa migrar mundo nem registrar nada). O caminho
pack → picker → item embutido também funciona. O problema aparece depois disso. A divindade
escolhida (1) **marca o próprio slot como erro** e (2) é **só decorativa**: nenhuma regra do PF2e
que dependa dela chega à ficha, e parte dessas lacunas nem está registrada. T4.2 está certa na
decisão (o vendor também tem `rules: []`), mas usou a justificativa para uma lacuna que ninguém
registrou. T4.3 está correta: Puppeteer e Reaper existem, estão tagueados e cabeados desde a O1.

## Achados

### B1 — BLOQUEANTE — Todo slot de divindade preenchido aparece marcado "requer a classe Deity"

- **Arquivo:** `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2541`
  (`deity: { packSlug: "deities-core", category: "deity" }`, sem `requiredClass`). O erro nasce em
  `planVM.ts:2594-2601` (`CHOICE_SLOT_REQUIRED_CLASS`).
- **Mecanismo:** quando falta `requiredClass`, a classe exigida vem de `category.split("-")[0]`.
  Para `"deity"`, isso dá `"deity"`. Aí `checkSlotRequirement` compara `classSlug` com `"deity"`,
  e nenhuma classe se chama assim.
- **Cenário (reproduzido):** chamei
  `checkSlotRequirement({type:"deity",name:"Pharasma",…}, "deity", 1, {classSlug:"cleric"})`.
  A resposta foi `{"reasonKey":"FUSION.Sheet.Plan.Requirement.WrongClass","params":{"class":"Deity"}}`,
  e deu o mesmo com `classSlug:"champion"`.
- **Em produção:** `attachRequirementIssues` (`planVM.ts:3118`) chama essa função para todo slot
  preenchido, e `LevelCard.svelte:98` desenha o aviso. Resultado: todo Clérigo e todo Campeão que
  escolhe divindade (a entrega central da onda) vê no nível 1 o aviso de "classe errada". O
  comentário da própria entrada ("sem requiredClass para não recusar a outra classe") descreve o
  contrário do que o código faz.
- **Por que os testes não pegaram:** o `classBuildHarness` não olha `requirementIssue`. Os "zero
  findings" do relatório não cobrem essa trilha.
- **Correção:** declarar a exigência de forma explícita, com um conjunto `cleric|champion` ou uma
  exceção que pule a verificação de classe, mais um teste de `checkSlotRequirement` para o eixo
  `deity`.

### I1 — IMPORTANTE — A Fonte Divina do Clérigo ignora a fonte da divindade

- **Arquivo:** `planVM.ts:2478` (`divineFont`, filtrado só pela tag `cleric-divine-font`) e
  `PlanColumn.svelte:994-1019` (`filterFn` só olha tags).
- **Regra:** a divindade define a fonte (`font`: `heal`, `harm` ou as duas), e o clérigo só pode
  escolher entre as que ela oferece.
- **Cenário:** Clérigo de Asmodeus (`font:["harm"]` no pack) escolhe "Healing Font". O picker
  oferece a opção e não marca nada. `stepCharDivineFontExtraCastings` (`spellcasting.ts:200`) deriva
  `spell:"heal"`. A ficha sai com a fonte errada, e o inverso também passa (Pharasma, `["heal"]`,
  aceita Harmful Font).
- **Por que é desta onda:** o dado que faltava para aplicar a regra era justamente o pack de
  divindades, que já chegou. Consertar é filtrar ou marcar (DEC-BC-05) a `divineFont` pela
  `system.font` do item `deity` embutido.

### I2 — IMPORTANTE — Santificação × Causa do Campeão: o que a nota da T4.1 prometia ficou de fora e a combinação inválida passa

- **Arquivo:** `tasks.md` T4.1, nota "destrava Champion (**Sanctification**)", e
  `choiceSetInventory.ts` (`Deity (Champion)/-` continua "pendente").
- **Cenário:** Campeão de Asmodeus (`sanctification: {modal:"must", what:["unholy"]}`) escolhe a
  Causa Grandeur (`otherTags:["champion-cause","holy"]`). O picker de Causa (`planVM.ts:2471`)
  oferece e grava sem aviso, e a ficha junta divindade profana com causa sagrada. Com Pharasma
  (`sanctification: null`, ou seja "none"), Redemption e Grandeur (holy) também passam. Além disso,
  nenhum Campeão ou Clérigo ganha o traço holy/unholy nem o traço nos Golpes (`ActorTraits` e
  `AdjustStrike` do wrapper).
- **Julgamento:** jogar isso para a #22 corta exatamente o escopo que a nota da tarefa nomeia para
  o Campeão. O mínimo nesta onda é marcar ou filtrar a Causa pela santificação da divindade. O dado
  já existe (`system.sanctification`, e as causas já têm a tag holy/unholy). O picker de
  holy/unholy/none pode continuar na #22.

### I3 — IMPORTANTE — A divindade não concede nada no nível 1: perícia divina, arma favorita e magias do clérigo

- **Arquivos:** `systems/pf2e/src/schemas/item-deity.ts:77`, `:79` e `:80`. Um grep em
  `systems/pf2e/src/derivations` e `sheets/pf2e/src` não acha nenhum leitor de item `type:"deity"`.
- **Regra (texto do próprio vendor, `deity-cleric.json` e `deity-champion.json`):** o Clérigo fica
  treinado na perícia divina **e** na arma favorita, e as magias da divindade entram na lista dele.
  O Campeão também fica treinado na perícia divina.
- **Cenários:**
  - Clérigo de Iomedae nível 1: Intimidação não fica treinada e a espada longa (marcial) fica sem
    treino, porque `attacks` do Cleric é martial 0. O ataque sai com +0 em vez de nível+2.
  - Campeão de Pharasma nível 1: Medicina sem treino, e o total de perícias treinadas sai com uma a
    menos.
  - Clérigo de Sarenrae nível 1: não consegue preparar Breathe Fire (`system.spells["1"]`), que é
    uma magia arcana/primal que só a divindade libera.
- **O que falta registrar:** a #22 fala de "favored-weapon/divine-skill **do Cleric**", mas não diz
  que o Campeão também ganha a perícia divina. O comentário do schema chama `spells` de "Domain
  spells by rank" e diz que a lacuna é a mesma pendência de `Deity's Domain`. Está errado: são as
  magias concedidas pela divindade (470/473 docs têm o campo), e isso não é o talento de domínio.
  Essa lacuna não está em issue nenhuma.
- **Correção mínima nesta onda:** corrigir o comentário e registrar as três consequências em issue
  (Clérigo e Campeão). O ideal é consumir `skill` e `weapons` na derivação, já que o dado está no ator.

### I4 — IMPORTANTE — As perícias de Lore das aparições do Animista não estão registradas em lugar nenhum

- **Arquivo:** `tools/importer-pf2e/src/curation/classes/animist.json:391` (nota T4.2) e o
  `ruleJustifications` das 14 aparições (`:394` em diante).
- **O que a justificativa diz:** a falta de consumidor para "grant dinâmico de Lore skill" estaria
  nos "buracos 5/6/8 do plano.md".
- **O que o plano diz:** buraco 5 é repertório, 6 é **lista preparada do dia** e 8 é pool de foco.
  Nenhum deles fala de Lore.
- **Cenário:** Animista nível 1 sintonizado em Custodian of Groves and Gardens deveria ter Farming
  Lore e Herbalism Lore treinadas (prosa do vendor, "Apparition Skills"). A ficha não mostra nenhuma
  das duas, e não existe issue nem buraco do plano apontando isso.
- **Julgamento:** a decisão de não fabricar `rules` está **certa**: conferi três aparições e as duas
  features-wrapper no vendor, e todas têm `rules: []`. Mas a justificativa aponta para um registro
  que não existe. Correção: abrir a issue e corrigir o texto.

### M1 — MENOR — Nem a prova "Vivo" nem a "Olhado" da onda foram feitas

- **Arquivo:** `execucao.md:119`. O gate exige "Cleric e Champion criados com divindade escolhida"
  **num mundo real**, mais "print da escolha de divindade".
- **O que foi feito:** o relatório da T4.1 só usou o harness e declara "Olhado: não capturado".
- **Cenário concreto:** um print do card de nível 1 depois da escolha teria mostrado o aviso do
  B1. O fecho da onda precisa dessa evidência antes do PR.

### M2 — MENOR — `tasks.md` do core só marca a T4.1 como feita

- **Arquivo:** `docs/design/ficha-nivel3/tasks.md` (diff). T4.2 e T4.3 continuam sem nota de estado,
  mesmo com a T4.2 tendo mudado o critério de "23/23 com rules" para "rules OU justificativa" e com
  a T4.3 fechada como não aplicável.
- **Cenário:** quem lê o plano acha que as duas estão abertas, e o critério mecânico de
  `execucao.md:119` fica divergente sem registro.

## O que conferi e NÃO é achado

- Descoberta do pack em produção: `packages/server/src/compendium/service.ts:173` varre os
  diretórios e `pack.json` é válido. Mundo e ator existentes não precisam de migração. Um Clérigo
  antigo só passa a ter o slot de divindade vazio para preencher.
- Pack: 419 deity + 37 pantheon + 17 covenant, igual ao filtro do vendor para os dois wrappers. Sem
  nome duplicado, descrição preenchida e arte placeholder.
- `Deity (Champion)` entrou em `CHOICE_WRAPPERS_WITH_FIXED_GRANTS`: sem isso, ao virar choice slot,
  o Campeão perderia Deific Weapon e Champion's Aura. A mudança está certa. (Obs.: a frase "antes
  ficavam mortos" na #22 é imprecisa. Antes da onda o wrapper não era choice slot e já era
  re-escaneado. Não é defeito.)
- T4.2 não fabricou `rules`. Está correto pela fonte.
- T4.3 não mudou código. Está correto: Puppeteer e Reaper (`necromancer-fatal-method`) estão no pack
  e em `CLASS_CHOICE_SLOT_OPTIONS`.
- Tradução pt-BR dos 473 nomes (#58) e `optionCount` 13×14 da aparição uncommon (#110): já estão
  registradas.
