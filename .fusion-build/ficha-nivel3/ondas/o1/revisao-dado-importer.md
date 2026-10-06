# Revisão adversarial da o1: dado, importador e integridade

Diffs revisados: satélite `origin/main...ficha3/o1` (commits 1a90ad0, ad991ba) e core `origin/alfa/app...ficha3/o1`.

**Nenhum pack (`documents.json`/`index.json`) foi alterado nesta onda.** A onda só muda código
(planVM, derivação, VM e Svelte da ficha, i18n do core). Então não há regressão de tradução, de
`sourceId` ou de homônimos por regeneração. O risco de dado está em outro lugar: **o código usa o
dado de forma errada**, e o conserto do achado A1 exige mexer no importador e regenerar o índice.

Conferido contra os packs (e bate com o que foi afirmado):
- as 19 chaves novas de `CLASS_CHOICE_SLOTS` existem com o nome exato em `featuresByLevel` de uma
  única classe cada (classes-core, 29 classes; nenhuma colide com outra classe);
- as 18 categorias `otherTags` têm opções em class-features-core, todas de nível 1, sem nomes
  repetidos dentro de um mesmo eixo;
- a cardinalidade (ikon=3, apparition=2, tacticKnown=5) bate com `choiceAxes[].picks` da curadoria
  e com a pregen da Ulka (5 táticas no nível 1);
- o tipo de item `action` está registrado em `documentTypes.Item` do pf2e, então dá para embutir
  um item de tática no ator.

## A1 — BLOQUEANTE: o fólio do Commander oferece 37 táticas quando o nível 1 permite 14

- **Arquivos:** `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2306` (`tacticKnown: { packSlug: "actions-core", traitFilter: "tactic", ... }`), com o comentário falso em `:2303` ("all level 1 (no expert/master/legendary tactics imported yet)").
- **Dado real** (actions-core, `system.traits.otherTags`):
  - mobility: 7;
  - offensive: 7;
  - expert: 7;
  - master: 5, mais 1 com o typo do vendor `vcommander-master-tactic` (Ready, Aim, Fire!);
  - legendary: 5 (Cry Havoc!, Executioner's Volley, Insta-Ballista, Sanguine Revitalization, Valkyrie's Charge);
  - sem tier: 5, do Hell's Destiny.
- **Por que o comentário engana:** o `system.level = "1"` das actions é valor padrão do
  importador, não o nível da tática. O vendor marca o tier só pela otherTag.
- **Regra do vendor:** a própria feature Tactics filtra por `item:trait:tactic` E
  (`commander-mobility-tactic` OU `commander-offensive-tactic`). Isso está documentado em
  `tools/importer-pf2e/src/curation/classes/commander.json:94` e foi ignorado.
- **Cenário:** o jogador cria um Commander de nível 1 e abre o picker "Tática Conhecida". A lista
  mostra as 37, e ele consegue pôr Cry Havoc! (tática lendária, nível 19) no fólio. A ficha sai
  ilegal pela regra e o servidor aceita.
- **O teste é circular:** o harness (`__tests__/helpers/classBuildHarness.ts:503`) pega a primeira
  opção livre na ordem do pack. O Commander de teste sai com Alley-Oop (expert), Bloody Guillotine
  (master), Buckle-Cut Blitz (expert), Coordinating Maneuvers (mobility) e Corpse Crenellation
  (sem tier). São 4 de 5 ilegais, e `ficha-nivel3-onda1.test.ts:146` passa, porque só confere que
  os 5 slots foram preenchidos.
- **Conserto: não basta mudar o planVM.** O filtro da UI (`PlanColumn.svelte:~1000`) lê
  `e.index[...]`, e o índice de actions-core não carrega `system.traits.otherTags`
  (`tools/importer-pf2e/src/build-mvp-subset.mjs:381-389` só indexa `system.traits.value`). É
  preciso:
  1. adicionar `system.traits.otherTags` aos `indexFields` de actions-core;
  2. regenerar o índice;
  3. filtrar por trait `tactic` + tag mobility/offensive;
  4. fazer o teste afirmar que toda tática escolhida no nível 1 tem uma dessas duas tags. É a
     asserção da regra, não a do pack.

  Se só o predicado do planVM mudar, o picker de produção fica **vazio** para o Commander.

## A2 — IMPORTANTE: os idiomas aparecem como slug cru do vendor, em inglês, na ficha pt-BR

- **Arquivos:** `systems/pf2e/src/derivations/character.ts:275` e `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:986` (`vm.languages.join(", ")`).
- **Cenário:** um Anão abre a ficha em pt-BR e vê "Idiomas: common, dwarven". Um Ratfolk vê
  "common, ysoki", um Gnomo vê "common, fey, gnomish".
- **Causa:** não existe tabela de tradução de idioma em nenhum lugar. Procurei "ysoki" e "dwarven"
  em packages/, na lang do pf2e e em sheets/, e o único resultado é a própria derivação e o teste
  dela. O rótulo foi traduzido ("Idiomas"), mas o valor não, o que contraria a régua de pt-BR 100%
  do projeto.
- **Teste:** o da derivação monta o doc à mão. Ele confere a forma do dado, não a exibição.

## A3 — MENOR (issue): o inventário de ChoiceSets continua dizendo "pendente" para os 19 eixos que agora estão cabeados

- **Arquivo:** `sheets/pf2e/src/lib/sheets/pf2e/choiceSetInventory.ts:325-407`. Por exemplo:
  - `Divine Spark and Ikons/firstIkon` em `:339`;
  - `Tactics/firstTactic` em `:404`;
  - Druidic Order, Methodology, Mystery, Patron, Eidolon, Innovation, Gunslinger's Way,
    Swashbuckler's Style, Conscious Mind, Root Epithet, Animistic Practice e Research Field.
- **O que o próprio arquivo define:** o cabeçalho diz que `pendente` significa "a escolha não
  aparece na ficha hoje", e que a entrada vira "eixo" quando o builder for construído (comentário
  da issue #59).
- **Cenário:** quem usa o inventário para medir a dívida da #59 (ou o relatório de ChoiceSets
  pendentes) conta cerca de 25 entradas já resolvidas como fila aberta.
- **Por que a suíte não pega:** nenhum teste verifica que "está em CLASS_CHOICE_SLOTS" implica
  "eixo".

## Observações sem cenário de falha (não são achados)

- **Comentário falso em `planVM.ts:2273`:** ele afirma que a contagem de cada eixo "bate
  exatamente" com `curation/classes/*.json`. Não bate em dois casos:
  - `animist-apparition`: 14 no pack contra 13 na curadoria;
  - `summoner-eidolon`: 15 no pack contra 13 na curadoria.

  As opções a mais parecem legítimas; o que está desatualizado é o `optionCount` da curadoria.
- **Mesma opção em slots irmãos:** nada impede escolher a mesma opção duas vezes (duas Ikons
  iguais, ou a mesma tática no fólio). `isFeatAtRepeatCap` só vale para `type === "feat"`, então
  classFeature e action entram duplicados com o mesmo `sourceId`. Já está registrado como
  fusion-systems-2e#101. Esse registro precisa cobrir `tacticKnown` também, não só ikon e
  apparition.
- **Chave por nome traduzível:** `CLASS_CHOICE_SLOTS` casa por `featuresByLevel[].name` em inglês.
  Se o translate-packs um dia traduzir esses nomes, todos os eixos somem. É um risco que já existia
  antes da onda, e esta onda aumenta a superfície (19 chaves novas).
- **Não rodei a suíte:** a revisão é só leitura, com consultas node aos packs. O comportamento do
  harness foi deduzido da ordem de `pool.find` sobre o pack.
