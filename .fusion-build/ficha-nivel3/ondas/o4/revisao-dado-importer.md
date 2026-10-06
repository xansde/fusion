# Revisão adversarial o4 — lente DADO + IMPORTADOR + INTEGRIDADE

Veredito: **nenhum bloqueante**. 1 importante, 3 menores. Diffs: satélite `origin/main...ficha3/o4` (3 commits), core `origin/alfa/app...ficha3/o4` (2 commits).

## O que foi conferido e está certo (com prova)

- **Idempotência do deities-core**: reproduzi o bloco 9b do build (filtro `isDeitiesCoreDoc` + tag `otherTags:["deity"]`) sobre `tools/importer-pf2e/out/deities/transformed.json`: o resultado é **byte-igual** ao `documents.json` commitado (473/473). A tag é aplicada no build (não à mão), então a próxima regeneração preserva a mudança.
- **Identidade**: 473 sourceIds únicos, nenhum ausente; 473 `_id` únicos, derivados de forma determinística (`deriveFusionId = sha1(pack:sourceId)`, transform.mjs:101); **zero homônimos** dentro do pack.
- **Escopo do pack**: o filtro `deity|pantheon|covenant` bate exatamente com o ChoiceSet do vendor (`class-features/deity-{cleric,champion}.json`, `item:category:*`); as 7 `philosophy` excluídas não são opção válida para Clérigo/Campeão. Regra do PF2e e fonte batem.
- **Licença**: 443 ORC + 30 OGL, descrição passa por `stripFlavorProse` (antes caía no passthrough sem checagem de licença; agora está correto). Arte 100% placeholder (`icons/placeholder/item.svg`).
- **Diff de pack só o pretendido**: nenhum outro pack foi tocado; i18n do core só ganhou `SlotLabel.deity` (en + pt-BR).
- **Deific Weapon / Champion's Aura**: o wrapper do vendor carrega os dois GrantItem; `class-features-core` tem os dois docs; o Champion não os recebe por outro caminho (`featuresByLevel` só lista `Deity (Champion)`), então não há duplicata. O predicado `class:champion` é avaliado pelo `evaluateGrantPredicate` (O0 C5).
- **Nome "Deity" em CLASS_CHOICE_SLOTS**: em `classes-core`, só o Clérigo tem uma feature com esse nome, então não colide.
- **T4.2, afirmação central**: comparei pack × vendor nas 23 features de nível ≤3 do Animist. As 17 sem `rules` também têm `rules: []` no vendor, e nenhuma tem `unconvertedRules`. Não é perda do importador, então a decisão de não fabricar RuleElement está certa.
- **T4.3**: Puppeteer/Reaper existem e estão tagueados (ver relatório da lane). Não há dado ausente.
- Issues citadas existem: #22, #58 (com comentário +473), #110 (optionCount 13×14).

## Achados

### A1 — importante — lacuna de Lore das apparitions sem registro nenhum
`tools/importer-pf2e/src/curation/classes/animist.json` (`ruleJustifications` das 14 apparitions + nota #18) e o relatório T4.2 dizem que as lacunas "já estavam registradas como buracos 5/6/8 do plano.md". Mas o buraco 6 do `plano.md` é **"Lista preparada do dia"**. Nenhum buraco, e nenhuma issue (`gh issue list --search "Lore animist"` volta vazio), cobre o **grant dinâmico de Lore skill** das apparitions.
Cenário: um Animist nv1 sintoniza Crafter in the Vault + Witness to Ancient Battles. Pela regra, fica treinado em Architecture Lore e Engineering Lore (mais a Lore da segunda). A ficha não mostra nenhuma dessas Lores. Hoje nada no repo rastreia esse defeito: a próxima pessoa lê "já registrado" e não abre issue. Viola a regra "falha vira issue registrada".
Conserto: abrir a issue no satélite e corrigir a referência nas justificativas e na nota #18.

### A2 — menor — justificativa de "Apparition Attunement" contradiz o código
Em `animist.json`, `ruleJustifications["Apparition Attunement"]` afirma que "a escolha em si não cabe no schema de choiceAxes… sem efeito mecânico automatizável". Só que `planVM.ts:996` (`"Apparition Attunement": "apparition"`), `:1036` (`apparition: 2`) e `:2497` (`CLASS_CHOICE_SLOT_OPTIONS.apparition`) já cabeiam a escolha de 2 apparitions desde a Onda 1.
Cenário: alguém que lê a curadoria para decidir o próximo trabalho conclui que o picker de apparition não existe e duplica ou refaz o trabalho. Corrigir o texto para "a escolha é slot (Onda 1); o efeito da apparition escolhida é que não se aplica".

### A3 — menor — fonte divina ignora a divindade escolhida (agora que o dado existe)
`planVM.ts:2478`: `divineFont: { packSlug: "class-features-core", category: "cleric-divine-font" }` não filtra por `deity.system.font`.
Cenário: Clérigo escolhe Pharasma (`font: ["heal"]` em deities-core) e o picker ainda oferece Harmful Font. O resultado é uma ficha ilegal pela regra. A #22 cobre sanctification/favored weapon/causa, mas não a fonte. Registrar como issue (ou comentar na #22).

### A4 — menor (plausível, não reproduzido vivo) — o "eixo" do inventário não cobre a Dedicação de Campeão
`choiceSetInventory.ts` marca `Deity (Champion)/deity` como `"eixo"`. O slot só nasce de `featuresByLevel` da classe (`CLASS_CHOICE_SLOTS`). Champion Dedication (feat nv2) concede o mesmo wrapper por GrantItem (`Compendium.pf2e.classfeatures.Item.Deity (Champion)`, vendor), e o materializador recursa nele (maxDepth 3).
Cenário: Guerreiro 2 com Champion Dedication recebe o wrapper e o Champion's Aura, mas nenhum picker de divindade. O inventário diz que o caso está coberto. Conferir e, se confirmado, anotar a exceção no inventário.

## Notas fora da lente (não são achados desta revisão)
- Critério de saída da o4 em `execucao.md:119` pede "print da escolha de divindade". A T4.1 declara "Olhado: não capturado", então o gate de UI da onda fica em aberto para quem revisa UI.
- `packs/build-report.json` não lista deities-core. Já estava defasado antes, e ninguém o consome.
