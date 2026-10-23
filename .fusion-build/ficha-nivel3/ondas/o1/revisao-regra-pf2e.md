# Revisão adversarial da o1: regra PF2e + caminho de produção

Escopo: satélite `git diff origin/main...ficha3/o1` (ad991ba) e core `git diff origin/alfa/app...ficha3/o1` (51696f79).
Método: li o diff, rodei node sobre os packs (`classes-core`, `class-features-core`, `actions-core`, `ancestries-core`), comparei com o vendor pinado (`tools/importer-pf2e/vendor/pf2e/packs/pf2e/actions/class/commander/`) e rodei uma sonda vitest isolada fora da árvore (`scratchpad/rev-o1/probe.test.ts`) sobre `classGrantRefsFromClassDoc`. Não rodei a suíte inteira e não editei nada.

## Veredito: NÃO MERGEAR. 1 bloqueante, 3 importantes, 4 menores

---

### B1 (bloqueante): cabear o wrapper como eixo derruba os grants fixos dele. Summoner e Exemplar perdem as ações centrais da classe (regressão contra origin/main)

- **Onde:** `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (bloco novo de `CLASS_CHOICE_SLOTS`, ~l.954-981: `Eidolon: "eidolon"`, `"Divine Spark and Ikons": "ikon"`) combinado com `classGrantRefsFromClassDoc` (~l.5695: `if (isChoiceFeature(f)) continue;`) e com `isChoiceFeature` (~l.1735).
- **Mecanismo:** desde a O0 C1 (PR #99, já em origin/main), toda feature de `featuresByLevel` que não seja placeholder de escolha é embutida no ator, e os `GrantItem` fixos dela são materializados (`runClassGrantRefs`, PlanColumn.svelte ~l.477). A o1 pôs 19 nomes de wrapper em `CLASS_CHOICE_SLOTS`. Com isso eles viram `isChoiceFeature`, e o wrapper deixa de ser embutido junto com todos os grants fixos dele. Os wrappers carregam grants fixos que não são a escolha em si:
  - `Eidolon` (Summoner): `grant-item(Manifest Eidolon)`, `grant-item(Act Together)`, `grant-item(Share Senses)`
  - `Divine Spark and Ikons` (Exemplar): `grant-item(Shift Immanence)`
- **Cenário concreto** (sonda rodada com o build da o1, `classGrantRefsFromClassDoc(<classe>.system, "src", 3)`):
  - Summoner → `["Evolution Feat","Summoner Spellcasting","Spell Repertoire","Link Spells","Shared Vigilance","Signature Spells"]`. `Eidolon` sumiu, e com ele Manifest Eidolon, Act Together e Share Senses. Em origin/main, "Eidolon" não estava em `CLASS_CHOICE_SLOTS` e esses três grants eram materializados. Resultado: um Summoner novo de nível 1 fica sem as ações que definem a classe. A cura ao abrir a ficha (`classFeatureGrantRefs`) usa o mesmo filtro, então não conserta.
  - Exemplar → `["Shield Block","Humble Strikes"]`. `Shift Immanence` (a ação de mover a centelha entre ícones, núcleo do Exemplar) deixa de ser concedida.
  - Os outros 17 wrappers também deixam de ser embutidos (Tactics, Druidic Order, Mystery etc.). Hoje eles só têm `grant-item` dinâmico (`{item|flags.pf2e.rulesSelections.*}`), então a perda neles é só a descrição da feature na ficha. Mesmo assim é o mesmo defeito.
- **Por que a lane não viu:** o harness (`classBuildHarness.ts`) não roda `runClassGrantRefs`, e o teste novo só confere que o slot gravou.
- **Correção sugerida:** separar "o placeholder vira slot" de "o placeholder não é embutido". O wrapper continua em `classGrantRefsFromClassDoc`, com o grant dinâmico ignorado como já é, e só deixa de aparecer como chip travado no Plano. Faltam dois testes: Summoner nível 1 com Manifest Eidolon no ator, e Exemplar nível 1 com Shift Immanence.

### I1 (importante): o fólio do Commander oferece táticas expert, master e legendary no nível 1

- **Onde:** `planVM.ts` ~l.2302-2306, `tacticKnown: { packSlug: "actions-core", traitFilter: "tactic", requiredClass: "commander" }`. O comentário diz "all level 1 (no expert/master/legendary tactics imported yet)" e isso é falso.
- **Fato:** as 37 táticas do `actions-core` têm `system.level: 1` só porque é o default do importador (ação não tem nível). O nível real está em `system.traits.otherTags`, que já existe no nosso pack e vem do vendor: `commander-mobility-tactic` (8), `commander-offensive-tactic` (7), `commander-expert-tactic` (9), `commander-master-tactic` (7) e `commander-legendary-tactic` (6). Pela regra, o fólio do nível 1 só aceita táticas de mobilidade ou ofensivas. Expert entra no 7 (Expert Tactician), master no 15 e legendary no 19.
- **Cenário:** um Commander de nível 1 abre o slot "Tática Conhecida" e o picker lista as 37, incluindo Cry Havoc!, Executioner's Volley e Insta-Ballista (legendary, nível 19) e Bloody Guillotine (master). O jogador escolhe uma e ela grava no ator. O teste da onda passa porque escolhe a primeira opção da lista, que é Alley-Oop, uma tática expert.
- **Correção:** filtrar por `otherTags ∈ {commander-mobility-tactic, commander-offensive-tactic}`. O índice do pack já expõe `system.traits.otherTags`. O mecanismo `category` aceita um valor só, então precisa aceitar lista ou ganhar um segundo eixo.

### I2 (importante): nada impede repetir a mesma opção nos slots-irmãos (ikon, apparition e tacticKnown). A issue #101 não cobre o Commander

- **Onde:** `PlanColumn.svelte` ~l.997-1012 (o `filterFn` só olha a categoria) e `chooseFeat` (`planVM.ts` ~l.4177). O `isFeatAtRepeatCap` não faz nada para doc que não é `feat`, e classFeature e action não são feat.
- **Cenário:** Exemplar com Gleaming Blade em `ikon-1-0`, `ikon-1-1` e `ikon-1-2`. Pela regra são três ícones distintos, e aqui os três ficam embutidos. O mesmo vale para Animist com a mesma aparição duas vezes, e para Commander com "Strike Hard!" cinco vezes no fólio. A #101 fala só de Ikon e Apparition. O `tacticKnown` (count 5) ficou de fora do registro.
- **Correção:** a que a própria #101 descreve. Excluir do `filterFn` os `sourceId` já gravados nos slots do mesmo tipo e nível. É uma linha, e vale fazer nesta onda.

### I3 (importante): T1.8 não cumpre o próprio gate. Idiomas continuam errados para Human e para quem tem Inteligência positiva, e a ficha mostra a lista como se estivesse completa

- **Onde:** `systems/pf2e/src/derivations/character.ts` (`stepCharLanguages`) e `CharacterSheet.svelte` (linha "Idiomas").
- **O que o tasks.md pede para a T1.8:** campo `languages` no schema do personagem, slot de escolha na criação (idiomas da ancestralidade mais bônus por Inteligência) e exibição. A entrega tem só a exibição dos idiomas fixos. Não há campo no `actor-character.ts` nem slot. O corte está documentado e registrado na #102.
- **Cenário:** um Human (`additionalLanguages.count = 1` no `ancestries-core`) com Int +3 deveria ter Comum mais 4 idiomas. A ficha mostra "Idiomas: common" e nada indica que falta escolher. O mesmo vale para qualquer ancestralidade com Int > 0. Como a linha não tem aviso de pendente, a UI afirma um estado errado.
- **Decisão pedida:** ou a T1.8 fecha nesta onda, ou o Alexandre aceita o corte explicitamente e o gate da onda passa a dizer isso. No mínimo, a linha precisa indicar que ainda faltam idiomas a escolher.

---

### M1 (menor): a escolha grava no ator, mas o efeito dela não chega na ficha (já registrado)

A perícia treinada pela escolha não é aplicada. `Braggart` (Swashbuckler) traz `ActiveEffectLike system.skills.intimidation.rank = 1`, e `Animal Order` (Druid) traz o mesmo para athletics. Não existe consumidor de `set-property` sobre `system.skills` (grep em `systems/*/src`). O `stepCharBuildSkills` lê só `trainedSkills` da classe e `build.choices`. Cenário: Swashbuckler Braggart de nível 1 fica destreinado em Intimidação. Isso já existe antes da o1 e está coberto pelas issues #80 e #19, então não bloqueia. Mas o "Destrava: Swashbuckler, Gunslinger, Investigator, Druid, Witch, Oracle…" do `tasks.md` exagera: a classe monta, mas não fica certa pela regra.

### M2 (menor): `choiceSetInventory.ts` continua com esses eixos em "pendente"

`class-features-core/Druidic Order/druidicOrder`, `Divine Spark and Ikons/firstIkon|secondIkon|thirdIkon`, `Conscious Mind/consciousMind`, `Tactics/*` etc. continuam `pendente`. O próprio comentário do bloco (issue #59) manda promover para "eixo" quando o builder cabear. O inventário deixa de refletir o builder.

### M3 (menor): os idiomas aparecem como slug cru e sem tradução

A ficha pt-BR mostra "common, dwarven, ysoki". Não há mapa de nomes de idioma no `pt-BR.json` nem no `documentNamesPt.ts`.

### M4 (menor): o Animist não designa a aparição primária

A regra pede duas aparições no nível 1, uma delas primária (é dela que vem a magia de vaso). Os slots `apparition-1-0/1` são simétricos e não há como marcar a primária. Isso não está registrado em issue.

---

## O que confere pela regra (verificado)

- Os 19 nomes de placeholder batem exatamente com `featuresByLevel` do `classes-core`, sem colisão entre classes (todos no nível 1, exceto Root Epithet no 3).
- As contagens estão certas: 3 ikons (Divine Spark and Ikons), 2 aparições (Apparition Attunement) e 5 táticas no fólio.
- Toda categoria tem opções no pack (de 2 a 21 docs), e os índices dos packs expõem `system.traits.otherTags` (`class-features-core`) e `system.traits.value` (`actions-core`). O picker funciona em produção.
- `chooseClassChoice` com `slotId` explícito só tem um chamador (PlanColumn), então é compatível com os chamadores de antes.
- `stepCharLanguages` deriva no load, então atores já existentes passam a mostrar os idiomas sem migração.
