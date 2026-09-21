# Revisão adversarial da O4 (Onda 4: dados ausentes), veredito do juiz

**Veredito: APROVADA COM CONSERTOS.** O bloqueante é de uma linha, mas o conserto é obrigatório antes do merge.

Base verificada: worktree `wt-c` (core `3b8ceb6f`, satélite `52fc0ab`). Nada foi editado.

## Verificação feita
- Leitura de `planVM.ts` (2460-2660, 1005-1020, 1515-1555, 1815-1835, 5890-5960) e de `PlanColumn.svelte` (380-470, 595-625).
- `grantMaterializer-realPacks.test.ts` rodado isolado: **11/11 verde**. O teste **está commitado** no 07d396c. A evidência viva errou ao chamá-lo de "ad-hoc descartado".
- `deities-core/documents.json` lido: Asmodeus tem font `[harm]`, Pharasma e Iomedae têm `[heal]`, e a Sarenrae tem spells `{1: Breathe Fire}`. As categorias são só deity, covenant e pantheon.
- `world.db` de `data-o4` lido em modo somente leitura. Nenhum dos três atores tem classFeature de `featuresByLevel`: o Champion não tem nenhum, o Cleric não tem nenhum e o Animist tem só as 2 apparitions.
- Print `03-cleric-deity-embedded-plan.png` olhado: o slot "Sarenrae" aparece em VERMELHO com "É talento de classe Deity e você não…". Isso é o B1, visível.
- Issues do satélite: #22 (atualizada na T4.1), #59, #110, #34. Nenhuma trata de Lore de apparition, de filtro de fonte divina, de perícia divina do Champion nem de magias da divindade.

## CONFIRMADOS

### C1 — BLOQUEANTE: todo slot de divindade preenchido aparece como "requer a classe Deity"
Juntei B1 (regra-pf2e) com B1 (testes-contratos). A entrada `deity` de `CLASS_CHOICE_SLOT_OPTIONS` não tem `requiredClass`. Por isso `CHOICE_SLOT_REQUIRED_CLASS` deriva `"deity"` do prefixo da categoria, e `checkSlotRequirement` compara esse valor com `cleric`/`champion` e devolve WrongClass. O print 03 mostra o erro em vermelho na ficha real.
- Dono: satélite, `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2541` e `:2594-2601`.
- Conserto: suportar `requiredClass` como lista (`["cleric","champion"]`) ou marcar `deity` como isento da derivação por prefixo. Acrescentar um teste que lê `requirementIssue === undefined` no slot deity preenchido de Cleric e de Champion.

### C2 — IMPORTANTE: features de classe não embutidas no fluxo real (Champion sem Deific Weapon e sem Champion's Aura)
Vem do check que falhou na evidência viva. O `world.db` mostra Champion, Cleric e Animist **sem nenhuma** feature de `featuresByLevel` embutida. O Champion não tem Deific Weapon, Champion's Aura, Shield Block nem Code, e o Cleric também não tem nada. O harness (`healClassGrants`) passa com 11/11, então existe divergência entre o caminho testado e o caminho real (`materializeClassGrants` no apply da UI). A causa não foi determinada. Pode ser um build de client velho ou o reset direto no banco, mas também pode ser defeito real, e ele não é só da O4 (atinge a T0.6/O0 C1).
- Dono: satélite, `sheets/pf2e/src/components/sheets/pf2e/plan/PlanColumn.svelte:429-436` (materializeClassGrants/runClassGrantRefs).
- Conserto: reproduzir com build fresco num ator novo pela UI (tutorial-e2e) antes do fecho. Se reproduzir, abrir uma issue com o cenário e consertar. Também corrigir no relatório de evidência a afirmação de que o teste era ad-hoc.

### C3 — IMPORTANTE: a Fonte Divina do Clérigo não é filtrada pela fonte da divindade
Juntei I1 (regra-pf2e) com A3 (dado-importer). Nenhum código lê `system.font`. Um Clérigo de Asmodeus (`[harm]`) consegue escolher Healing Font e deriva `heal`, o que é ilegal pela regra do PF2e. O mesmo vale para Pharasma com Harmful Font. Nenhuma issue registra isso.
- Dono: satélite, `planVM.ts:2478` (divineFont) e o filtro do picker.
- Conserto: filtrar as opções de divineFont pelo `font` do item deity embutido e marcar requirementIssue quando os dois divergirem. Na falta disso, registrar em issue.

### C4 — IMPORTANTE: gate do Animist trocado sem registro, e Lore das apparitions sem rastreio
Juntei I4 (regra-pf2e), A1 (dado-importer), I1 (testes-contratos) e A2 (costura-seguranca).
- A decisão de não fabricar `rules` está **certa**, porque o vendor tem `rules: []` nas 14 apparitions.
- O problema é que o gate de `execucao.md:119` ("23/23 com rules") foi trocado por "rules OU justificativa" sem anotação no plano, no tasks ou na execução.
- Além disso, a nota #18 de `animist.json:391` diz que as Lores dinâmicas estão nos "buracos 5/6/8". Isso é falso: o 5 é repertório, o 6 é lista do dia e o 8 é pool de foco, e nenhum deles fala de Lore. `gh issue list` também não tem nada sobre isso.
- Consequência: um Animist nv1 com Crafter in the Vault fica sem Architecture Lore e sem Engineering Lore, e ninguém rastreia essa falta.
- Dono: satélite, `tools/importer-pf2e/src/curation/classes/animist.json` (nota #18). Core, `docs/design/ficha-nivel3/execucao.md:119` e `tasks.md` (T4.2).
- Conserto: abrir uma issue para o grant dinâmico de Lore por apparition sintonizada e para o repertório de apparition. Corrigir a referência "5/6/8" e anotar a troca de critério do gate no tasks/execução.

### C5 — MENOR: a divindade não concede perícia, arma favorita nem magias, e parte disso não está registrado (I3)
Nenhum código lê o item `deity`. A #22 cobre a sanctification e a arma e perícia do **Cleric**. Faltam registrar a perícia divina do **Champion** (Iomedae → Intimidation) e as magias da divindade para o Clérigo (Sarenrae → Breathe Fire).
- Dono: satélite, issue #22 e `systems/pf2e/src/schemas/item-deity.ts:77-80`.
- Conserto: estender a #22 (ou abrir uma issue nova) com esses dois itens.

### C6 — MENOR: Santificação × Causa do Campeão sem checagem de compatibilidade (I2)
Um Campeão de Asmodeus (`must unholy`) consegue escolher Grandeur (holy) sem aviso. A sanctification ficou fora de escopo e está registrada na #22, e a decisão de adiar é aceitável. O que não está registrado é a restrição de compatibilidade entre causa e divindade.
- Dono: satélite, issue #22 e `planVM.ts:2471` (cause).
- Conserto: acrescentar à #22 a regra "causa holy/unholy exige divindade que permita essa santificação".

### C7 — MENOR: com a variante de multiclasse, Cleric→Champion abre um segundo slot de divindade (A3 costura)
Com a variante ligada, `classOwnerAt` emite os choice slots da classe que comprou o nível. O "Deity (Champion)" gera `deity-2` além do `deity-1`. O comentário "no collision" (`planVM.ts:1014-1016`) está errado, e a regra do PF2e admite uma só divindade.
- Dono: satélite, `planVM.ts:1009-1017` e `:1541`.
- Conserto: não emitir o slot `deity` se já existir um item deity ou um slot deity anterior. Corrigir o comentário.

### C8 — MENOR: justificativa de "Apparition Attunement" contradiz o código (A2 dado-importer)
A justificativa diz que "a escolha não cabe no schema de choiceAxes", mas `CLASS_CHOICE_SLOTS['Apparition Attunement']='apparition'`, com contagem 2, está cabeado desde a O1.
- Dono: satélite, `animist.json` (`ruleJustifications['Apparition Attunement']`).
- Conserto: reescrever a justificativa: o eixo existe com 2 slots, e o que falta é a reescolha diária e o aumento no 7 e no 15.

### C9 — MENOR (processo): tasks.md sem T4.2/T4.3, e "Olhado" declarado ok sem ver o defeito (M2 regra)
No `tasks.md`, a T4.2 e a T4.3 continuam abertas. O check "Olhado" da evidência viva saiu ok, mas o print 03 mostra o erro vermelho do C1 sem que ninguém o apontasse.
- Dono: core, `docs/design/ficha-nivel3/tasks.md`.
- Conserto: marcar a T4.2 (com o critério trocado, ver C4) e a T4.3, e citar o C1 no fecho da onda.

## REFUTADOS (4)
- **M1 regra-pf2e e A1 costura-seguranca**, "Vivo/Olhado não feitos": a lane de evidência viva fez 4 atores reais e 10 prints. A lacuna de processo foi fechada. O que ela deixou passar está em C9.
- **M1 testes-contratos**, "teste de divindade circular": hoje o filtro só inclui deity, covenant e pantheon (medido), e não há philosophy no pack. O cenário é hipotético e não foi demonstrado.
- **A4 dado-importer**, "Champion Dedication sem picker": o próprio autor diz que não reproduziu, e o caso é arquétipo (O5).
- **Duplicatas absorvidas**: B1 (testes) entrou em C1; I1/A3 entraram em C3; A1/I4/I1(testes)/A2(costura) entraram em C4. As duplicatas não entram na contagem de refutados.
