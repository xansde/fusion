# Revisão adversarial da o1: veredito do juiz

**Veredito: REPROVADA.** Há 1 bloqueante, 3 importantes e 6 menores confirmados, e 3 achados refutados.
Worktree: scratchpad/wt-o0. Core 51696f79, satélite ad991ba. Verifiquei tudo lendo o código e os packs com node, sem editar nada.

## Confirmados

### C1 [bloqueante] Wrappers de classe viraram eixo e os grants fixos deles sumiram (B1)
- Evidência: `planVM.ts:5695` (`classGrantRefsFromClassDoc`) pula todo nome que está em `CLASS_CHOICE_SLOTS`. A o1 adicionou `Eidolon`, `Divine Spark and Ikons` e `Tactics` a esse mapa. No pack class-features-core, o wrapper `Eidolon` tem GrantItem fixo para Manifest Eidolon, Act Together e Share Senses, e `Divine Spark and Ikons` tem GrantItem para Shift Immanence. `grantMaterializer.ts:302` resolve `actionspf2e`, então em 5a1d262 essas ações eram materializadas. Nenhum código novo da o1 embute o wrapper.
- A evidência viva confirma: o Exemplar ficou só com `Exemplar:class`, `Gleaming Blade` e `Flowing Spirit Strike`, sem Shift Immanence.
- Dono: fusion-systems-2e, `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`.
- Conserto: ao pular um wrapper de eixo, materializar mesmo assim os GrantItem dele cujo uuid não é placeholder `{item|...}`, ou embutir o wrapper e deixar o materializer ignorar os placeholders. Incluir um teste que confirme que Summoner L1 tem Manifest Eidolon e Exemplar L1 tem Shift Immanence.

### C2 [importante] O fólio do Commander aceita táticas de tier superior no nível 1 (I1, A1 do dado-importer, A1 da lente de testes, I-1)
- Evidência: `planVM.ts:2306` usa só `traitFilter: "tactic"`, o que dá 37 opções. O pack tem 7 expert, 5 master, 1 `vcommander-master` (typo no vendor), 5 legendary, 5 de AP sem tag, 7 mobility e 7 offensive. O comentário em :2302-2305 ("all level 1, no expert…") é falso. O `index.json` de actions-core não indexa `system.traits.otherTags`, então o filtro de PlanColumn:1000 não tem como separar. O teste ao vivo gravou Buckle-Cut Blitz e Wait For It… (AP), e o harness monta um fólio ilegal e passa verde.
- Dono: fusion-systems-2e, `planVM.ts` (CLASS_CHOICE_SLOT_OPTIONS.tacticKnown), `tools/importer-pf2e/src/build-mvp-subset.mjs` (indexFields) e `__tests__/ficha-nivel3-onda1.test.ts`.
- Conserto: indexar otherTags em actions-core e filtrar por `commander-mobility-tactic` ou `commander-offensive-tactic` (14 táticas). O teste deve afirmar esse conjunto a partir do pack, não pegar a primeira opção.

### C3 [importante] O pin do submodule aponta para um commit que só existe na branch de feature (I-3)
- `git branch -r --contains ad991ba` devolve só `origin/ficha3/o1`.
- Dono: core, gitlink `external/fusion-systems-2e`.
- Conserto: mergear o PR do satélite com merge commit (sem squash), re-pinar o core no merge commit e só então mergear o core.

### C4 [importante] T1.8 entregue parcial sem decisão (I3)
- O tasks.md:66 pede o campo `languages` em actor-character.ts e o slot de escolha com bônus por Int. A entrega é só a exibição dos idiomas fixos da ancestralidade. O corte está na #102, mas o Alexandre não decidiu, e a ficha não indica que falta escolher idiomas.
- Dono: fusion-systems-2e, `systems/pf2e/src/derivations/character.ts` + schema. Decisão do Alexandre.
- Conserto: aceitar o corte explicitamente, com a pendência visível na ficha ("N idiomas a escolher"), ou implementar o slot.

### C5 [menor] Slots-irmãos aceitam a mesma opção repetida, e a #101 não cita o Commander (I2, A2 da lente de testes, M-2)
- O próprio código admite o "KNOWN GAP" em planVM.ts:~997. O harness deduplica com `used.add`, o que esconde o problema.
- Conserto: excluir do picker as opções já escolhidas nos slots do mesmo tipo, e ampliar a #101 para `tacticKnown`.

### C6 [menor] Idiomas aparecem como slug cru em inglês (M3, A2 do dado-importer, A5 da lente de testes, I-2)
- Em `CharacterSheet.svelte:986`, `vm.languages.join(", ")` mostra "common, dwarven" sem tradução.
- Conserto: mapa de tradução dos 9 slugs no i18n e aplicar `t()` na exibição.

### C7 [menor] choiceSetInventory continua marcando os eixos cabeados como "pendente" (M2, A3 das lentes de dado-importer e de testes, M-3)
- Exemplos em choiceSetInventory.ts:344, 345 e 404.
- Conserto: marcar como "eixo" e adicionar um teste que exija "eixo" para todo nome em CLASS_CHOICE_SLOTS.

### C8 [menor] `derived.languages` está fora do tipo CharacterDerived, e o getter lê por cast (A4)
- Conserto: tipar a chave em derivedTypes/types e testar o getter com applyAncestry real.

### C9 [menor] Chave i18n duplicada e o gate atribui um conserto que o commit não fez (M-1, A6)
- `FUSION.Sheet.Labels.Languages` aparece em pt-BR.json:261 e :289, e o mesmo em en.json. O commit 51696f79 só mexe em en.json e pt-BR.json, mas o gate.md atribui a ele a correção de traitNames.sync.
- Conserto: remover a duplicata e corrigir a nota do gate. Tratar as falhas do traitNames.sync como algo do ambiente.

### C10 [menor] A evidência viva abriu a #104 com premissa falsa
- No pack, o Exemplar tem `3:Root Epithet`, e os 3 slots de ícone no nível 1 são RAW (CLASS_CHOICE_SLOT_COUNT). A falta real do Exemplar é o Shift Immanence (C1), que o teste ao vivo não notou.
- Conserto: corrigir ou fechar a #104 e redirecioná-la para o C1.

## Refutados (3)
- M1 (set-property sem consumidor): defeito anterior à o1 e já registrado nas #80/#19. Não é regressão da onda.
- M4 (aparição primária do Animist): pela regra, a primária se escolhe na preparação diária, não na construção. Não cabe como slot do builder.
- I-4 (faltam prints e evidência viva): a evidência viva rodou, com 6 prints lidos e o world.db consultado.
