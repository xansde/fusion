# Revisão adversarial — Onda 4 (ficha3/o4) — lente COSTURA + CI + SEGURANÇA + UI

Core `ficha3/o4` @ 3b8ceb6f (vs origin/alfa/app) · satélite `ficha3/o4` @ 52fc0ab (vs origin/main).

## Veredito

Nenhum bloqueante na lente. Costura, CI e segurança estão limpos. Há 2 achados importantes
sobre o gate da onda (critério reescrito / níveis de prova faltando) e 1 menor de regra (multiclasse).

## Verificado e limpo (não são achados)

- **Pin do submodule**: `git ls-tree` do core = `52fc0ab`, igual ao HEAD do satélite `ficha3/o4`.
- **Lockfile**: sem dependência nova, nenhum dos dois lados toca `pnpm-lock.yaml`.
- **Higiene do diff**: core = 4 arquivos (pin, 2 i18n, tasks.md). Satélite = 19 arquivos: código,
  pack `deities-core` (documents 1,37 MB + index 0,26 MB) e 3 samples (o padrão `samples/<pack>/` já existe).
  Sem data-dir, auth_secret, .env, node_modules, out/, vendor ou binário. A junction `vendor` fica fora do diff.
- **Clean-room/licença**: os 473 docs usam `img = icons/placeholder/item.svg`. As descrições são 443 ORC
  e 30 OGL, com 0 sem licença redistribuível. O `transform.mjs` ganhou o ramo `deity` → `stripFlavorProse`
  (antes caía no passthrough sem checar licença).
- **Segurança**: nenhuma mudança no servidor. O pack tem `audience: "all"`, correto para dado de jogador.
  Nenhum predicado de visibilidade novo, nada de redaction duplicada. O tipo `deity` foi registrado em
  `itemTypes` e em `defineModel`, então o servidor valida o item embutido com `DeitySystemSchema`.
- **Descoberta do pack pelo servidor**: `compendium/service.ts:181` faz readdir + `pack.json`. Não existe
  lista fixa a atualizar.
- **Picker**: `PlanColumn.svelte:1002` já é genérico sobre `packSlug`. O `index.json` traz
  `system.traits.otherTags: ["deity"]`, que é o campo lido pelo `filterFn`/`isClassChoiceOption`.
- **CI do satélite**: o `ci.yml` roda `@fusion/importer-pf2e test` (glob `src/__tests__/*.test.mjs`, que pega
  `animist-rule-coverage.test.mjs`), `@fusion/system-pf2e test` (packs-validation) e `@fusion/sheets-pf2e test`.
  Rodei os 4 arquivos isolados: animist 2/2, ficha-nivel3-onda1 + grantMaterializer-realPacks 82/82,
  packs-validation 129/129. Nenhum teste de i18n do satélite depende do `core-ref.txt` (aedda2c) para a chave nova.
- **CI do core**: segundo o gate, não houve regressão (as 23 falhas são o baseline conhecido
  `pregen-parity`/`actionCategories`) e `spec:report` não gerou diff. Não re-rodei a suíte inteira, por instrução.
- **Duplicação de grant**: Champion's Aura e Deific Weapon só aparecem nas rules de `Deity (Champion)`
  (varri class-features-core e feats-core). Colocar esse wrapper em `CHOICE_WRAPPERS_WITH_FIXED_GRANTS`
  não duplica item.
- **T4.3**: a condição não se cumpriu. Fatal Method já estava cabeado na O1, então não há o que revisar.

## Achados

### A1 — importante — o gate da O4 foi declarado sem os níveis "Vivo" e "Olhado"
- Arquivo: `docs/design/ficha-nivel3/execucao.md:119` (critério), `docs/design/ficha-nivel3/tasks.md`
  (linha T4.1 marcada "✅ FEITA") e `ficha3-reports/o4/T4.1-divindades.md:66-70`.
- Pela `execucao.md` §3, os três níveis são obrigatórios. Para a onda 4 isso significa **Cleric e Champion
  criados num mundo, com divindade escolhida**, e **print da escolha de divindade**.
- Estado real:
  - `ficha3-reports/o4/prints/` está vazio.
  - O "Vivo" foi um teste ad-hoc do harness (`_tmp-deity-check`), rodado e descartado.
  - O relatório admite que "a UI do picker de divindade (473 opções…) não foi testada com prints".
- Cenário: o picker genérico abre `deities-core` com 473 linhas, todas em EN (não há i18n pt-BR, a #58
  está pendente), misturando deity, pantheon e covenant sem distinção. Ninguém viu essa tela nem gravou um
  Cleric num mundo real. Mesmo assim, o tasks.md declara a T4.1 feita.
- É o padrão que a regra "não inferir funcionalidade" proíbe (memória US12).
- Correção: rodar o roteiro `tutorial-e2e` (Cleric e Champion nv1, escolher divindade, recarregar e ver o
  item persistido) e anexar os prints. Até lá, marcar a T4.1 como "mecânico ok, vivo/olhado pendente".

### A2 — importante — a T4.2 reescreveu o critério do gate: 6/23 com rules + 17 justificativas no lugar de 23/23 com rules
- Arquivo: `execucao.md:119` ("Animist: **23/23** features de nv 1-3 com `rules` (hoje 6/23)") ×
  `external/fusion-systems-2e/tools/importer-pf2e/src/curation/classes/animist.json` (`ruleJustifications`,
  17 entradas) e `animist-rule-coverage.test.mjs` (aceita rules OU justificativa).
- A frase "rules ou justificativa explícita" que o relatório da T4.2 cita como prevista pela tarefa não
  existe em `plano.md`, `tasks.md` nem `execucao.md`. O critério foi relaxado na própria lane.
- Cenário (regra do PF2e): um Animist nv1 sintoniza Crafter in the Vault. O doc diz "Apparition Skills:
  Architecture Lore, Engineering Lore", então o personagem deveria ser treinado nas duas Lores enquanto
  estiver sintonizado. A ficha gerada continua sem essas Lores, e o mesmo vale para as 14 apparitions.
  Com isso, a mecânica do Animist continua ausente no nv1, que era o que a O4 dizia destravar
  ("Destrava: … Animist").
- A justificativa (vendor com `rules: []`, sem consumidor de Lore dinâmica nem de repertório espontâneo)
  é honesta. O problema é que ela converte um buraco de mecanismo em "23/23 cumprido".
- Correção: o gate declara 6/23 com rules. Os dois mecanismos faltantes (grant de Lore por apparition
  sintonizada e repertório de apparition) viram issue no satélite com dono. Hoje só a #110 (optionCount)
  foi aberta. A nota da tarefa no tasks.md registra que o critério não foi atingido.

### A3 — menor — na variante multiclasse, Cleric→Champion abre um segundo slot de divindade
- Arquivo: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:1009-1017`. O comentário
  diz "a character only ever has ONE of the two classes' wrapper active at a time, so there is no collision".
  Isso é falso sob a multiclasse por níveis de classe: `planVM.ts:1523-1549` emite os choice slots da
  classe dona de cada nível (`classOwnerAt`).
- Cenário:
  1. Com a variante ligada, o personagem é Cleric no nv1 e compra Champion no nv2.
  2. O `featuresByLevel` do Champion (classLevel 1) emite `deity-2` ao lado do `deity-1`.
  3. O jogador escolhe Pharasma e depois Iomedae, e o ator fica com dois itens `type: "deity"`.
- Pela regra do PF2e, o personagem tem uma só divindade (a rule vendor traz `predicate: [{not: "deity"}]`
  justamente para não conceder a segunda).
- Correção: o slot do segundo wrapper herda ou trava na divindade já escolhida, ou o picker recusa quando
  já existe um item `deity`. Pode ir para issue.
