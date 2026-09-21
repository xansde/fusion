# Revisão adversarial o4: lente TESTE NÃO-CIRCULAR + CONTRATOS

Revisor: somente leitura em `wt-c`. Sonda isolada escrita FORA da worktree (`scratchpad/rev-o4/src/__tests__/req.test.ts`),
rodada com o `vitest.config.ts` real do `sheets/pf2e` (`--root scratchpad/rev-o4`). A suíte inteira não foi rodada.

Veredito: **NÃO PODE MERGEAR** (1 bloqueante, 1 importante, 1 menor).

---

## B1 (bloqueante): o slot de divindade preenchido sai marcado como "classe errada: Deity" em TODO Clérigo e Campeão

- Arquivo: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2541` (entrada `deity` sem `requiredClass`)
  combinado com `planVM.ts:2594-2601` (`CHOICE_SLOT_REQUIRED_CLASS`) e `planVM.ts:2654-2659` (`checkSlotRequirement`).
- Mecanismo: sem `requiredClass`, `CHOICE_SLOT_REQUIRED_CLASS` deriva a classe exigida do prefixo da categoria:
  `"deity".split("-")[0]` = `"deity"`. `checkSlotRequirement` compara esse valor com `classSlug` ("cleric"/"champion"),
  vê a diferença e devolve `WrongClass {class:"Deity"}`. O comentário da própria entrada diz que o `requiredClass` foi
  omitido de propósito para não recusar uma das duas classes, mas o fallback recusa as DUAS.
- Cenário reproduzido (sonda real: `buildCharacterToLevel` do harness e depois `derivePlan`, sem fixture):
  - Clérigo nv3 com Abrogail escolhida: slot `deity-1` `filled:true`, `requirementIssue = {reasonKey:"FUSION.Sheet.Plan.Requirement.WrongClass", params:{class:"Deity"}}`.
  - Campeão nv3: mesmo resultado. É o ÚNICO requirementIssue das duas fichas.
  - Na tela, `LevelCard.svelte:97-128` renderiza isso como aviso de requisito não atendido ("requer a classe Deity")
    no slot que é justamente a entrega da onda.
- Por que os testes não pegaram: o "vivo" da lane e o harness contam só `findings`, que ficaram em 0, e nenhum teste lê
  `requirementIssue` do slot de divindade. O item "Olhado" do gate (print da escolha de divindade, `execucao.md:119`)
  não foi feito, e o print mostraria o aviso.
- Correção esperada: pôr `requiredClass` que aceite as duas classes (hoje o campo é uma string só; ou isentar o slot
  `deity` do check 2), mais um teste que afirme `requirementIssue === undefined` no slot `deity-1` de Clérigo e Campeão
  construídos pelo harness.

## I1 (importante): T4.2 redefiniu o gate "23/23 com rules" para "rules OU justificativa", e o Animist continua sem efeito mecânico

- Arquivos: `tools/importer-pf2e/src/__tests__/animist-rule-coverage.test.mjs:501-549`,
  `tools/importer-pf2e/src/curation/classes/animist.json` (`ruleJustifications`).
- O gate da Onda 4 (`docs/design/ficha-nivel3/execucao.md:119`) é "Animist: **23/23** features de nv 1-3 com `rules` (hoje 6/23)".
  Entregue: 6/23 com rules e 17 com texto. O teste novo conta a string de justificativa como cobertura
  (`comRules + comJustificativa === 23`). A regra que o relatório atribui à tarefa ("rules ou justificativa explícita")
  não aparece em `plano.md`, `execucao.md` nem `tasks.md` (conferido com grep).
- Cenário: Animist nv1 sintonizado com Crafter in the Vault. Pela regra (texto do próprio doc no pack), ele fica
  treinado em Architecture Lore e Engineering Lore e ganha magias de aparição (Sigil, Mending...). Na ficha nada disso
  aparece, e o teste novo passa verde. A onda declara "Destrava: Animist" e o relatório diz PODE MERGEAR.
- A decisão de não fabricar RuleElement está certa: conferi que o vendor tem `rules: []` nas 16 features que ele traz
  com o mesmo nome. Mas o resultado é corte de escopo, e foi fechado como cumprido. Além disso, a justificativa de
  "Apparition Attunement" diz que "a escolha em si não cabe no schema de choiceAxes", o que está desatualizado: a
  Onda 1 já liga o eixo `apparition` com 2 slots (`ficha-nivel3-onda1.test.ts:166`).
- Correção esperada: não marcar o gate como atendido; registrar T4.2 como parcial, com issue apontando os buracos de
  motor (grant de Lore skill, repertório de aparição, pool de foco); e corrigir a justificativa desatualizada.
  (`tasks.md` também não marca T4.2 nem T4.3.)

## M1 (menor): o teste de opções de divindade é circular, e nada confere o filtro contra o vendor

- Arquivos: `sheets/pf2e/src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts:48-53`,
  `tools/importer-pf2e/src/build-mvp-subset.mjs:1130-1132` e `1555-1559`.
- O build injeta `otherTags:["deity"]` em TODO documento do pack. Por isso "slot type deity has >0 tagged option
  documents" só prova que o build rodou. Nenhum teste compara o conjunto do pack com o filtro do vendor
  (`item:category:deity|pantheon|covenant`). O schema (`item-deity.ts:409`) aceita `philosophy` no enum.
- Cenário: alguém muda `isDeitiesCoreDoc` e inclui `philosophy` (480 docs). O Clérigo passa a poder escolher Green
  Faith, o que é inválido pela regra, e toda a suíte continua verde. O mesmo vale se `pantheon` sair do filtro.

---

## Conferido e sem achado

- **Contrato core↔satélite**: `PlanSlotType` ganhou `"deity"`; `SLOT_TYPE_LABELS` e a i18n en/pt-BR
  (`FUSION.Sheet.Plan.SlotLabel.deity`) foram atualizados. `deity` foi registrado no `documentTypes.Item` e no
  `defineModel`. O servidor descobre o pack por diretório (`compendium/service.ts:168`), então `deities-core` fica
  visível sem precisar de registro. O SF2e não tem feature "Deity" em classe nenhuma, logo não há colisão de
  `CLASS_CHOICE_SLOTS`.
- `DeitySystemSchema`: o `sanctification` nulo (104 docs) é normalizado, os 473 docs são validados em `packs-validation`,
  todos têm `sourceId`, não há nome duplicado e a arte é 100% placeholder.
- Champion: Deific Weapon e Champion's Aura. O relatório diz que a lane "corrigiu" algo, mas esses grants já
  materializavam antes (`grantMaterializer.test.ts:1822`, `planVM.test.ts:3636`). Pôr `Deity (Champion)` em
  `CHOICE_WRAPPERS_WITH_FIXED_GRANTS` só evita a regressão que a própria lane causaria ao transformá-lo em slot de
  escolha. O teste novo é redundante, mas não é circular: os nomes vêm do pack e a regra é a do PF2e.
- Clérigo: o wrapper "Deity (Cleric)" deixou de ser embutido (virou slot de escolha). A única regra convertida dele
  (`set-property flags.system.favoredWeaponRank`) não tem consumidor, então não há perda mecânica hoje.
- Nenhuma asserção enfraquecida em teste pré-existente: `>=27` subiu para `>=28`.
- T4.3: pelo `grep`, a pré-condição não se cumpriu e os docs Puppeteer/Reaper existem. Sem achado.

## Fora da lente (observação, sem severidade)

- `system.description` das divindades leva lore narrativa integral (ex.: Pharasma, "Before there was time..."), e 24
  descrições contêm `@UUID[Compendium...]` não resolvido. Vale a revisão de licença/REQ-LEG-010 olhar.
