# Revisão adversarial — Onda 1 (ficha3/o1) — lente COSTURA + CI + SEGURANÇA + UI

Revisor: somente leitura. Diffs: core `origin/alfa/app...ficha3/o1` (3 arquivos: pin + 2 i18n);
satélite `origin/main...ficha3/o1` (8 arquivos: planVM, PlanColumn, CharacterSheet, characterSheetVM,
character.ts, 2 testes, harness).

## Veredito

**Sem bloqueante.** Costura, CI e segurança estão limpos. Três achados **importantes** para esta onda:
o fólio do Commander aceita táticas proibidas no nível 1, os idiomas aparecem como slug em inglês na
ficha pt-BR, e o pin do submodule aponta para um commit que só existe na branch de feature do satélite.
A evidência "olhado" da onda também não existe.

## O que foi verificado e está OK

- **Higiene:** core com 3 arquivos (pin + en.json + pt-BR.json); satélite com 8 arquivos, todos de
  código/teste. Nada de data-dir, auth_secret, node_modules, vendor, out/, dist, .env ou binário.
  `git status` do satélite está limpo; o core só tem o `?? tools/importer-pf2e/` pré-existente
  (junction do vendor, fora do índice).
- **Segurança:** nenhuma superfície de servidor mudou. As escolhas continuam passando por
  `chooseFeat` → `doc:create`/`doc:update` genéricos, com a mesma checagem de ownership de antes.
  `redaction.ts`/`isRolePrivileged` não foram tocados e nenhum predicado foi duplicado.
  `system.derived.languages` não é dado sensível.
- **CI:** `ficha-nivel3-onda1.test.ts` roda no core (`pnpm test` → vitest.workspace inclui
  sheets-pf2e) e no satélite (`Test sheets/pf2e`). Rodado isolado: **69/69 verdes, 3,7 s**. Os packs
  que ele lê (`actions-core`, `class-features-core`) estão commitados, então o teste não depende do
  vendor. `derivations.test.ts` entra no `Test systems/*`. `traitNames.sync` e
  `bundle-completeness` também foram rodados isolados: 47/47 verdes.
- **Produção do picker:** o `filterFn` do PlanColumn lê `e.index["system.traits.value"]`, e o
  `pack.json` de `actions-core` declara esse campo em `indexFields`: os 37 docs `tactic` aparecem no
  índice. `actions-core` tem `audience: "all"` e as 37 táticas têm pt-BR em `i18n.pt-BR.json`.
- **Idiomas no servidor:** `embeddedItemPayload` embute o doc de ancestralidade inteiro, sem
  schema que remova campos, então `system.languages.value` chega ao passo de derivação.
- **Gatilho de UI:** os novos eixos aparecem no mesmo picker de `CLASS_CHOICE_SLOT_OPTIONS` que já
  existia, e os idiomas aparecem na aba principal, ao lado de Sentidos. Os dois têm gatilho visível.

## Achados

### I-1 — importante — o fólio do Commander aceita táticas expert/master/legendary no nível 1
- `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2306` (`tacticKnown: { packSlug: "actions-core", traitFilter: "tactic", ... }`)
  e o comentário em `:2303`.
- **Cenário:** um Commander de nível 1 abre o slot "Tática Conhecida". O picker lista as 37 táticas.
  Destas, 22 são de nível superior e o RAW não as permite no nível 1: 9 `commander-expert-tactic`,
  7 `commander-master-tactic` e 6 `commander-legendary-tactic`. Exemplos: "End It!" (legendary) e
  "Alley-Oop" (expert). A descrição de Tactics diz que táticas expert/master/legendary só entram no
  fólio a partir de Expert/Master/Legendary Tactician. O pack **já distingue os tiers** em
  `system.traits.otherTags`: `commander-mobility-tactic` (8) e `commander-offensive-tactic` (7) são as
  15 permitidas no nível 1. Conferido no `actions-core/documents.json` e em
  `vendor/.../actions/class/commander/*.json`.
- Duas afirmações estão erradas. O comentário do código diz "all level 1 (no expert/master/legendary
  tactics imported yet)". E o teste da onda (`ficha-nivel3-onda1.test.ts:146`) preenche o fólio com
  o primeiro doc `tactic` do pack, que é **Alley-Oop (expert)**, e ainda assim declara "zero findings".
  Ou seja, o gate mecânico aprova um estado ilegal.
- **Correção:** o filtro precisa aceitar as duas categorias `commander-mobility-tactic` e
  `commander-offensive-tactic` pelo `otherTags`, que já está no índice de class-features, mas é preciso
  confirmar o `indexFields` de actions-core, que **hoje não inclui `system.traits.otherTags`**. Também
  é preciso uma asserção de que nenhuma tática expert/master/legendary é oferecida.

### I-2 — importante — idiomas exibidos como slug em inglês na ficha pt-BR
- `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:986` (`{vm.languages.join(", ")}`).
- **Cenário:** um Ratfolk em mundo pt-BR vê "Idiomas: common, ysoki". Um Anão vê "common, dwarven".
  Os 9 slugs existentes (`common dwarven elven fey gnomish goblin halfling orcish ysoki`) não têm
  tradução em nenhum bundle (grep em `packages/client/src/lib/i18n` e nos packs: zero). A única UI
  nova desta onda sai em inglês minúsculo, contra a regra de pt-BR 100%.

### I-3 — importante — o pin do submodule aponta para um commit que só existe na branch de feature do satélite
- `external/fusion-systems-2e` (gitlink `ad991baf`). `git branch -r --contains ad991ba` devolve só
  `origin/ficha3/o1`; o commit não está em `main` nem em nenhuma tag.
- **Cenário:** o PR do satélite é mergeado com squash (ou a branch é apagada após o merge) e o core é
  mergeado com esse pin. O `actions/checkout` com `submodules: true` falha ao buscar `ad991baf`
  ("not our ref"), e o CI do core cai em toda branch derivada de alfa/app. A Onda 0 evitou isso
  re-pinando no merge commit do satélite (`5a1d262`, "Merge pull request #99").
- **Correção:** mergear o satélite primeiro com merge commit e re-pinar o core no SHA do merge antes
  de mergear o core. Registrar isso no PR.

### I-4 — importante — a evidência "olhado" (e "vivo") da onda não existe
- `docs/design/ficha-nivel3/execucao.md:102-116` exige três níveis obrigatórios. Para a Onda 1:
  print de 3 pickers (um por família) e Exemplar + Gunslinger vivos. Nenhum relatório de lane nem o
  `gate.md` cita print ou `evidencia.md`.
- **Cenário:** o único caminho de produção que nenhum teste cobre é o picker filtrando **entradas de
  índice** (`PlanColumn.svelte:1000-1011`); o teste usa docs completos. Sem o print, o PR fecha a onda
  apenas com o nível mecânico, que é justamente o que o I-1 mostra ser insuficiente.
- O "vivo" é do Alexandre ("quem testa no servidor é ele"). Os prints dos pickers podem ser feitos
  pela skill `tutorial-e2e` antes do PR.

### M-1 — menor — chave i18n duplicada; o commit "traduz Idiomas" não teve efeito
- `packages/client/src/lib/i18n/pt-BR.json:261` e `:289`; `en.json:261` e `:289`.
- `FUSION.Sheet.Labels.Languages` **já existia** na linha 261 de `origin/alfa/app`, e o commit
  `51696f79` a adicionou outra vez. **Cenário:** alguém corrige a tradução na linha 261 e nada muda
  na tela, porque o `JSON.parse` fica com a última ocorrência (289). O `gate.md` também atribui a esse
  commit a "regeneração de traitNames.ts" que teria consertado `traitNames.sync`. O commit não toca
  em `traitNames.ts`, então a atribuição é falsa. A correção de `traitNames.sync` veio de outro lugar,
  provavelmente do pin novo do submodule.

### M-2 — menor — a issue #101 (dedup entre slots-irmãos) não cita o fólio de 5 táticas
- `planVM.ts:1003` (`tacticKnown: 5`).
- **Cenário:** um Commander escolhe "Strike Hard!" nos 5 slots `tacticKnown-1-0..4`. O fólio fica com
  1 tática em vez de 5, sem nenhum aviso. A issue `xansde/fusion-systems-2e#101` cobre só
  Ikon/Apparition e precisa ser ampliada.

### M-3 — menor — o inventário de ChoiceSets ainda diz "pendente" para os eixos que esta onda cabeou
- `sheets/pf2e/src/lib/sheets/pf2e/choiceSetInventory.ts:327-497`: Druidic Order, Eidolon,
  Innovation, Mystery, Patron, Research Field, Methodology, Gunslinger's Way, Swashbuckler's Style,
  Tactics (first..fifthTactic), Divine Spark and Ikons (first/second/thirdIkon), Root Epithet,
  Conscious/Subconscious Mind, Animistic Practice, Fatal Method, Grim Fascination e First Implement.
- **Cenário:** o documento, feito para "tornar o silêncio impossível", passa a afirmar que essas
  escolhas "não aparecem na ficha hoje", o que é falso depois desta onda. A próxima varredura de
  dívida vai contá-las como pendentes. O estado correto é `eixo`.

## Não reportado (sem cenário concreto de produção)
- `resolveAxisChoice` (`systems/pf2e/src/derivations/helpers.ts`) lê só a **primeira** escolha de um
  eixo. Com eixos de várias escolhas (ikon, apparition, tacticKnown), uma `proficiencyUpgrade`
  condicional veria apenas uma delas. Hoje o único eixo condicional nos dados é `doctrine`, então não
  há falha em produção. Fica como risco latente.
