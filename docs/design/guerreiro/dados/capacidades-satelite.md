# Guerreiro (Fighter) — capacidades no satélite `fusion-systems-2e`

Escopo: `external/fusion-systems-2e/{systems/engine-2e/src, systems/pf2e/src, sheets/pf2e/src}`.
Todo caminho abaixo é relativo à raiz do core e já vem prefixado com `external/fusion-systems-2e/`.

---

## WEAPON-STRIKE — Strike com arma equipada

**Status:** parcial
**Evidência:**

- `external/fusion-systems-2e/systems/pf2e/src/actions/strikes.ts:224-340` (`deriveStrikeFromWeapon`) — calcula attackBonus/damage dice/deadly-fatal; chamado de verdade por `external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts:1056` (`stepCharStrikes`, roda no pipeline de derivação real).
- `external/fusion-systems-2e/systems/pf2e/src/actions/strikes.ts:361-391` (`resolveStrikeAttack`, compara contra `targetAc` e calcula `DegreeOfSuccess`) e `:412-473` (`computeStrikeDamage`, crit doubling) — **zero chamadores de produção**; só aparecem em `systems/pf2e/src/__tests__/actions-strikes.test.ts`.
- `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:1016` — botão real `onclick={() => rollStrike(strike.sourceId, i as 0|1|2)}`.
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2222-2233` (`rollStrike`) e `:2242-2251` (`rollStrikeDamage`) — cada um posta uma fórmula de dado crua no chat (`/r 1d20+N # Strike (MAP i)`, `/r <formula> # Dano`); nenhum dos dois lê AC do alvo.
- `external/fusion-systems-2e/sheets/pf2e/src/components/chat/pf2e/AbilityCard.svelte:19` — comentário explícito: "The ATTACK roll ... is NOT a card button: it is fired at announce time ... no crit automation is invented."

**Gatilho na UI:** botões reais na aba Ações — "MAP 0/1/2" por Strike, mais "Dano" e "Crítico" (`CharacterSheet.svelte:1016,1026,1035`).
**O que falta:** nenhuma comparação contra a CA do alvo, nenhum grau de sucesso automático, o crítico é ESCOLHA MANUAL do jogador (clicar "Crítico" em vez de "Dano" — o sistema não decide), e nenhuma aplicação de dano ao alvo (mesma lacuna de `APPLY-DAMAGE`, já ausente).

**NPC (NpcSheet.svelte/npcSheetVM.ts):** mesmo padrão, mas mais pobre — `npcSheetVM.ts:511-525` (`rollStrike`) usa um bônus fixo único (**sem variantes de MAP nenhuma**, NPC não tem 3 botões); o dano do NPC (`NpcSheet.svelte:294-298`) é só TEXTO exibido (`{dmg.formula}`), sem `onclick`, ou seja nem sequer vira botão de rolagem.

---

## MAP-TRACK — Contagem do MAP

**Status:** ausente
**Evidência:**

- `external/fusion-systems-2e/systems/engine-2e/src/map.ts:31-36` — `calculateMapPenalty(attackNumber, weaponAgile)` é uma função pura e sem estado; quem escolhe `attackNumber` é sempre o chamador.
- `external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts:1066` — pré-computa as 3 variantes (m0/m1/m2) sempre, incondicionalmente, a cada derive.
- `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:1013-1021` — `{#each strike.variants as variant, i}`; o índice `i` do loop (0,1,2) É o `attackNumber`, escolhido pelo clique do jogador.
- Busca por `attacksThisTurn|attackCount|turnAttack|mapCounter|attack-count` em todo `systems/`/`sheets/`: zero ocorrências.

**Gatilho na UI:** 3 botões estáticos "MAP 0/1/2", sempre todos visíveis e habilitados.
**O que falta:** não existe contador de ataques no turno, logo não existe reset — o jogador precisa lembrar sozinho qual botão corresponde ao ataque atual.

---

## CRIT-SPEC — Especialização crítica por grupo de arma

**Status:** ausente
**Evidência:**

- `fighter-features.json` → "Fighter Weapon Mastery" (nível 5), campo `unconverted[1]`: `{"key":"CriticalSpecialization", "predicate":[{"gte":["item:proficiency:rank",3]}], "_conversionState":"unsupported"}` — o **próprio importador** marca a regra como não convertida.
- O ChoiceSet companheiro ("escolha um grupo de arma") na mesma feature também está em `unconverted` com `_conversionState:"unsupported"`.
- Busca por `criticalSpec|CriticalSpecialization` em `systems/`/`sheets/` (fora de `packs/*.json`): zero código.
- `computeStrikeDamage` (strikes.ts:412-473, sem chamador de produção) e o caminho real `renderCritDamageRoll` (`character.ts:954-963`, ver DEADLY-FATAL) só dobram o dano — nenhum dos dois aplica um efeito extra por grupo de arma.

**Gatilho na UI:** nenhum.
**O que falta:** tudo — nem existe onde guardar QUAL grupo de arma o Guerreiro escolheu (ver WEAPON-GROUP), muito menos um motor que aplique o efeito de especialização daquele grupo no crítico.

---

## DEADLY-FATAL — Dados extras no crítico

**Status:** funciona (com ressalva de fidelidade à regra — ver abaixo)
**Evidência:**

- `external/fusion-systems-2e/systems/pf2e/src/actions/strikes.ts:311-312` — `extractTraitDie` lê `deadly-dN`/`fatal-dN` dos traits da arma dentro de `deriveStrikeFromWeapon` (chamador real: `stepCharStrikes`).
- `external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts:954-963` (`renderCritDamageRoll`) — monta a STRING de rolagem: `(dados base)*2` + `+1<deadlyDie|fatalDie>` fora da duplicação; usada em `:1101-1102` para preencher `critDamageRoll`.
- `characterSheetVM.ts:2242-2251` (`rollStrikeDamage(id, crit=true)`) lê `strike.critDamageRoll` e envia ao chat; botão real em `CharacterSheet.svelte:1035-1036` ("Crítico").

**Gatilho na UI:** botão "Crítico" por Strike, na aba Ações.
**O que falta:** ressalva de regra, não de encanamento — `renderCritDamageRoll` trata `fatal` exatamente como `deadly` (soma 1 dado extra não-dobrado do tamanho indicado); não faz o RAW completo de Fatal, que também eleva o dado BASE da arma para o tamanho do fatal na hora de dobrar. O botão funciona ponta a ponta, mas o número final de Fatal pode sair menor do que a regra oficial prevê.

---

## SHIELD-BLOCK — Reação de bloquear com escudo

**Status:** ausente
**Evidência:**

- `external/fusion-systems-2e/systems/pf2e/src/schemas/item-equipment.ts:94-101` — schema do escudo TEM `hardness`, `brokenThreshold` e um comentário para `acBonus` "while raised" — mas é só schema (dado), sem consumidor.
- `external/fusion-systems-2e/systems/pf2e/src/actions/damage.ts:159-165` — `applyDamagePipeline` tem um passo genérico de `hardness` — mas este pipeline **não tem chamador de produção** (fato já verificado no briefing).
- Busca por `raise-shield|shield-block|ShieldBlock|RaiseAShield` em `systems/`/`sheets/`: só aparece como STRING de teste (`planVM.test.ts:227,1787`, nomes de fixture) e como referência de prosa dentro do texto de outros talentos (ex.: Everstand Stance cita `@UUID[...Shield Block]`).
- Nenhuma REACTION-TRIGGER existe no satélite (nenhum código detecta "personagem tomou dano" para oferecer uma reação).

**Gatilho na UI:** nenhum.
**O que falta:** tudo — reação oferecida no momento certo, leitura do hardness/PV do escudo específico, redução de dano, e quebra do escudo ao atingir o limiar.

---

## RAISE-SHIELD — Erguer o escudo

**Status:** ausente
**Evidência:**

- `external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts:279-300` (`stepCharAc`) lê **somente** `doc["_equippedArmor"]` (categoria/acBonus/dexCap/potência da ARMADURA) — nenhuma referência a escudo, "raised" ou item de categoria shield em lugar nenhum do cálculo de CA.
- `external/fusion-systems-2e/systems/pf2e/src/derivations/equipment.ts` — grep por `shield`/`acBonus`/`raised`: os únicos hits de `acBonus` são os da ARMADURA (linhas 85,126), não do escudo.

**Gatilho na UI:** nenhum.
**O que falta:** tudo — nem o bônus de CA do escudo equipado (sem "erguer") é somado, muito menos um bônus temporário que dure "até o início do próximo turno".

---

## MANEUVER — Trip/Grapple/Shove/Disarm/Reposition/Escape

**Status:** ausente
**Evidência:**

- `external/fusion-systems-2e/systems/pf2e/src/actions/` contém só `conditions-manager.ts`, `damage.ts`, `strikes.ts`, `index.ts` — nenhum módulo de manobra.
- Busca por trip/grapple/shove/disarm/reposition/escape em `systems/`/`sheets/`: zero hits reais (só falsos-positivos de `e.key === "Escape"` em ~15 componentes `.svelte`, todos manipuladores de tecla ESC de diálogo).
- As 6 manobras + "Raise a Shield" **existem como documentos navegáveis** em `systems/pf2e/packs/actions-core/documents.json` (confirmado: Trip, Grapple, Shove, Disarm, Reposition, Escape, Raise a Shield todos presentes, `actionType:"action"`).
- `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/ActionsTab.svelte:1-24` — comentário do próprio componente: "Clicking a row opens the shared DocumentDetailsPanel with the full, sanitized description" — é um browser de descrição, não um executor.

**Gatilho na UI:** clique abre um painel de texto (descrição sanitizada); nenhuma rolagem, nenhuma CD, nenhum efeito.
**O que falta:** tudo o que é mecânico — rolagem de Atletismo (ou equivalente) contra a CD/defesa do alvo, grau de sucesso, e o efeito resultante (queda, agarrado, empurrado, etc.) aplicado ao alvo.

---

## STANCE — Postura

**Status:** ausente (confirmado também para o eixo marcial — e aqui o impacto é maior que no Animista)
**Evidência:**

- Varredura de `fighter-feats.json`: **14 talentos** do Guerreiro carregam o trait `stance` (Everstand Stance, Point Blank Stance, Haft Striker Stance, Disarming Stance, Ricochet Stance, Impassable Wall Stance, Mobile Shot Stance, Disruptive Stance, Dueling Dance, Lunging Stance, Paragon's Guard, Graceful Poise, Multishot Stance, Twinned Defense).
- "Everstand Stance" tem `rules: []`, `rulesFull: []`, `unconverted: []` — o próprio pack do vendor não codifica NENHUM mecanismo para a postura (dependeria de um item "Effect: Nome da Postura" vinculado, e não existe pack de efeitos no Fusion).
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/traitGroups.ts:192` — "stance" só aparece como entrada de uma lista de traits para exibir badge, não como lógica.
- `external/fusion-systems-2e/systems/engine-2e/src/effectsEngine.ts:148-180` — o switch de rule elements só liga/desliga CONDITION (via `toggleCondition`), não uma postura arbitrária.

**Gatilho na UI:** nenhum — o talento de postura aparece como um feat qualquer, só com texto.
**O que falta:** um slot de "postura ativa" no ator (mutuamente exclusivo com outras posturas), uma ação que ligue, e desligamento automático se não sustentada no início do próximo turno.

---

## PROF-TRACK / WEAPON-GROUP — Proficiência de arma

**Status:** parcial — eixo de CATEGORIA funciona; eixo de GRUPO/arma nomeada ausente
**Evidência (categoria — funciona):**

- `external/fusion-systems-2e/systems/pf2e/src/schemas/actor-character.ts:118-124` — `ProficiencyBlockSchema.weapons` tem exatamente 4 chaves fixas: `unarmed/simple/martial/advanced`. **Não existe slot de grupo nem de arma nomeada no schema.**
- `external/fusion-systems-2e/systems/pf2e/src/derivations/build.ts:406-426` — aplica o mapa `attacks` da classe (Guerreiro: `unarmed:2, simple:2, martial:2, advanced:1`, de `fighter-class.json`) nessas 4 categorias, mais os saltos de `system.proficiencyUpgrades` por nível (ex.: nível 13 do Guerreiro: `weapons.advanced→2`, `weapons.martial/simple→3`).
- `external/fusion-systems-2e/systems/pf2e/src/actions/strikes.ts:249-252` lê `proficiencies.weapons[weaponCategory]` de verdade, dentro de `deriveStrikeFromWeapon` (chamador real).

**Evidência (grupo — ausente):**

- "Fighter Weapon Mastery" (nível 5) e "Weapon Legend" (nível 13) carregam `kind:"proficiency"` (`MartialProficiency`, ver JSON completo abaixo) — busca por `MartialProficiency` em todo `systems/`/`sheets/`: **zero hits de código**.
- Mesmo que houvesse consumidor, não haveria onde escrever o resultado: o schema de proficiências só tem as 4 categorias acima.
- O ChoiceSet "escolha um grupo de arma" de ambas as features está em `unconverted`, `_conversionState:"unsupported"`.

**Gatilho na UI:** eixo de categoria — nenhum botão dedicado, o bônus entra silenciosamente no número de ataque; eixo de grupo — nenhum.
**O que falta:** proficiência por grupo de arma e por arma nomeada inteira — schema, derivação e UI.

---

## AEL (rule elements) — o que o engine realmente aplica

**Status:** parcial/ausente — ver detalhamento por `kind`
**Evidência estrutural (achado central, vale para TODOS os kinds):**

- `external/fusion-systems-2e/systems/engine-2e/src/effectsEngine.ts:140-180` (`collectEffects`) só reconhece 5 tipos internos (camelCase): `rollOption/flatModifier/note/toggleCondition/iwr`.
- **`collectEffects(` não tem NENHUM chamador de produção em todo o satélite** — só aparece na própria `effectsEngine.ts`, no teste `effectsEngine.test.ts`, e no harness de teste `classBuildHarness.ts`.
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/helpers/classBuildHarness.ts:188` — o harness que "runs the REAL server-side derivation pipeline" (linha 171) chama `collectEffects([], new Set<string>())` — **array de EffectSource VAZIO, sempre**.
- `external/fusion-systems-2e/systems/pf2e/src/derivations/embeddedModifiers.ts:10-13` (comentário do próprio código-fonte): "NOTHING in the generic EffectSource/Synthetics pipeline visits these item types (only `type:"condition"` items become EffectSources — see `packages/server/src/net/derive-runner.ts materializeEffectSources`)".

Em vez do engine genérico, existem leitores pontuais que leem o `kind` kebab-case cru de `doc.items` para UM propósito específico cada:

| kind (vendor)                            | Fighter usa (n)                                     | Consumidor real                                                                                                                                     | Alcança o Guerreiro?                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flat-modifier`                          | 45                                                  | `embeddedModifiers.ts:75-82` (`isFlatModifierRule`), chamado só por `hp.ts:90` (selector `"hp"`) e `speed.ts:144` (selector `"land-speed"/"speed"`) | **Não.** Seletores do Guerreiro: `ac`(5), `strike-damage`(13), `ranged-attack-roll`(4), `melee-strike-attack-roll`(1), `melee-strike-damage`(2), `saving-throw`(1), `skill-check`(1), `reflex`(1), `initiative`(1), `shield-boss/spikes-damage`(1), `unarmed/weapon-damage`(1), indefinido(11), nulo(3) — nenhum é `hp` nem `speed`. (`ac`/`saving-throw`/`skill-check` até são lidos em outro lugar, mas só de `ctx.synthetics` — que, pela citação acima, só recebe CONDIÇÕES, nunca feats.) |
| `roll-option`                            | 17 (16 `toggleable:true`)                           | só o loop de ponto-fixo de `collectEffects`                                                                                                         | **Não** (collectEffects nunca roda com dado real).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `roll-note`                              | 10                                                  | só `processNote`/`resolveNotesForSelector` dentro de `collectEffects`                                                                               | **Não.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `set-property` (subkind item-alteration) | 6                                                   | `itemAlterations.ts:69-79` — MVP restrito a `selector==="damage-dice-faces", mode==="upgrade"`                                                      | **Não.** Seletores do Guerreiro: `traits`(2), `description`(2), `system.attributes.reach.base`(1), `system.proficiencies.defenses.heavy.rank`(1) — nenhum é `damage-dice-faces`.                                                                                                                                                                                                                                                                                                               |
| `proficiency`                            | 5 (todos `MartialProficiency`)                      | nenhum                                                                                                                                              | **Não** — zero código consome, e não há campo no schema para guardar o resultado (ver WEAPON-GROUP).                                                                                                                                                                                                                                                                                                                                                                                           |
| `grant-item`                             | 3 (Weapon Supremacy, Reactive Strike, Shield Block) | `grantMaterializer.ts:136-163` (`parseGrantItems`) + `materializeGrants` (`:497`), consumido de verdade por `planVM.ts` (5 pontos de uso)           | **Sim.** É o único kind do Guerreiro com efeito real.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Gatilho na UI:** só `grant-item` tem um — tomar o talento/feature no Plan materializa o item concedido no personagem.
**O que falta:** os outros 5 kinds (83 de 86 regras do Guerreiro) não alcançam nenhum pipeline ativo.

---

## ROLL-OPTION toggleável — interruptores de talento

**Status:** ausente
**Evidência:**

- Busca por `toggleable` em todo `external/fusion-systems-2e/sheets/pf2e/src`: **zero ocorrências** fora de `__tests__`.
- Busca por `toggleCondition` em `sheets/pf2e/src`: aparece em `CharacterSheet.svelte`, `NpcSheet.svelte`, `characterSheetVM.ts`, `npcSheetVM.ts` — mas é o mecanismo de CONDIÇÃO (chips), não de roll-option de talento.
- Os 16 talentos toggleable do Guerreiro (Double Slice, Vicious Swing, Assisting Shot, Lunge, United Assault, Double Shot, Dual-Handed Assault, Farabellus Flip, Advantageous Assault, Dazing Blow, Triple Shot, Incredible Aim, Cut From the Air, Brutal Finish, Overwhelming Blow, Agile Shield Grip) não têm nenhum switch renderizado.

**Gatilho na UI:** nenhum.
**O que falta:** tudo — renderização do interruptor, escrita do roll-option ligado/desligado, e (por tabela do item AEL acima) mesmo que existisse o switch, o roll-option não alcançaria `ctx.synthetics` porque feats não viram EffectSource.

---

## TEMP-HP — Pontos de vida temporários

**Status:** parcial
**Evidência:**

- Campo `hp.temp` existe no schema e atravessa todas as etapas de derivação de HP: `external/fusion-systems-2e/systems/pf2e/src/derivations/hp.ts:109`, `character.ts:219,829`, `npc.ts:106`, `familiar.ts:108,135`, `build.ts:641` — sempre repassando um valor já existente, nunca concedendo um novo.
- `external/fusion-systems-2e/systems/pf2e/src/actions/damage.ts:170-182` implementa a absorção de PV temporário ANTES do PV normal (REQ-PF2-022) dentro de `applyDamagePipeline` — sem chamador de produção (fato já verificado).
- `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:598-600` — exibição **somente leitura**: `{#if vm.hpTemp > 0}<span class="sheet-hp__temp">(+{vm.hpTemp})</span>{/if}`.
- Busca por `fieldUpdate("system.attributes.hp.temp"` em `characterSheetVM.ts`: zero — só `hp.value` (:2404,2747) e `hp.max` (:2473) são editáveis.

**Gatilho na UI:** nenhum — o valor só aparece se já vier preenchido de fora (edição manual do JSON do ator, por exemplo); nada no fluxo do jogo o preenche.
**O que falta:** uma fonte que conceda PV temporário (o Guerreiro em si não tem talento nativo de PV temp no PF2e) e um controle de UI para setá-lo/aplicá-lo.

---

## Combat Flexibility (DAILY-CHOICE / WANDERING-FEAT) — talento trocável

**Status:** ausente
**Evidência:**

- `fighter-features.json` → "Combat Flexibility" (nível 9): `rules: []`, `rulesFull: []`, `unconverted: []` — o pack do vendor não codifica NENHUM rule element; é descrição pura ("gain one fighter feat of 8th level or lower... until your next daily preparations").
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2733-2805` (`restAll()`) — o único fluxo de "preparação diária" do Fusion, disparado pelo botão real "Descansar" (`CharacterSheet.svelte:358-359,571`) — só recupera PV, desexpende slots de magia preparada e reabastece focus points. Nenhuma menção a talento/feat temporário.

**Gatilho na UI:** o botão "Descansar" existe e funciona de verdade, mas não faz nada relacionado a Combat Flexibility.
**O que falta:** tudo — slot de talento temporário, filtro de elegibilidade (nível ≤8, pré-requisitos, ainda não conhecido), UI de escolha, e expiração no próximo descanso. Confirma o mesmo padrão já catalogado como `WANDERING-FEAT`/`DAILY-CHOICE` (ausente) para o Animista.

---

## Publicação da classe Fighter — featuresByLevel + classBuildHarness

**Status:** funciona (para o que o harness efetivamente prova — ver ressalva)
**Evidência:**

- `fighter-class.json` → `system.featuresByLevel` lista as 16 class features com o nível correto: 1 (Reactive Strike, Shield Block), 3 (Bravery), 5 (Fighter Weapon Mastery), 7 (Battlefield Surveyor, Weapon Specialization), 9 (Battle Hardened, Combat Flexibility), 11 (Fighter Expertise, Armor Expertise), 13 (Weapon Legend), 15 (Tempered Reflexes, Improved Flexibility, Greater Weapon Specialization), 17 (Armor Mastery), 19 (Versatile Legend) — bate com as "16 class features" do briefing.
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` consome `featuresByLevel` em produção (ex.: linhas 890, 1489, 2479) para dirigir os "autoFeature chips" no level-up.
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/helpers/classBuildHarness.ts:65-70` — usa os construtores REAIS de `planVM.ts` (`applyClass`, `levelUp`, etc.) e roda o pipeline de derivação REAL (`pf2eSystem.deriveSteps`, importado do pacote publicado `@fusion/system-pf2e`, linha 171).
- `varredura-classes.test.ts:50` — `describe.each(CLASSES.map(...))`, varredura dirigida por dado sobre TODAS as classes de `classes-core`; como o Fighter está publicado no pin, ele entra automaticamente. Invariante explícita na linha 71: "every featuresByLevel placeholder is a slot or an autoFeature chip (never vanishes)".
- **Rodei a suíte agora** (`npx vitest run .../varredura-classes.test.ts -t "Fighter"`, dentro de `external/fusion-systems-2e/sheets/pf2e`): **6/6 testes do Guerreiro passaram** (82 outros, das demais 11 classes, skipped pelo filtro). Confirma hoje, neste pin, que montar um personagem Guerreiro nunca perde uma das 16 features.

**Gatilho na UI:** automático — escolher a classe Fighter na aba Plano já dispara `applyClass`/`featuresByLevel`; não há botão separado.
**O que falta / ressalva:** o harness prova que os ITENS de feature são anexados no nível certo como documentos inertes — **não** prova que o conteúdo deles faz algo mecanicamente (a reação do Reactive Strike, a escolha de grupo da Weapon Mastery etc. — exatamente as lacunas descritas acima). Também não existe parity contra pregen oficial da Paizo para o Fighter — `pregen-parity.test.ts` não tem fixture de Fighter/Valeros, só um comentário de gap conhecido ("Fighter/skillIncreaseCeiling: #49"); a única validação é a varredura de consistência interna.

---

## Achados fora do checklist

1. **O "motor de efeitos" está estruturalmente inerte para tudo que não seja condição.** `collectEffects()` nunca é chamado com dado real em lugar nenhum do satélite — nem o harness de teste que "constrói um personagem de verdade" consegue popular `ctx.synthetics` com regras de item (chama `collectEffects([], new Set())`, vazio). Isso não é um problema específico do Guerreiro: os comentários do próprio código (`embeddedModifiers.ts:10-13`, `itemAlterations.ts:6-8`) dizem que só itens `type:"condition"` viram `EffectSource`. Qualquer classe cujos talentos dependam de `flatModifier`/`rollOption`/`note` genéricos tem o mesmo buraco.
2. **A escolha de grupo de arma (Weapon Mastery/Weapon Legend) é uma lacuna de DADO, não só de engine.** O ChoiceSet que pergunta "qual grupo você domina" está `unconverted`/`unsupported` no próprio pack — não existe nem onde o jogador faria essa escolha, muito antes de chegar a um problema de schema ou de motor. Essa é provavelmente a decisão de build mais importante do Guerreiro (análoga à linhagem de um Feiticeiro) e está ausente de ponta a ponta.
3. **`grant-item` é o único kind de regra que funciona de verdade para o Guerreiro hoje.** Tomar Reactive Strike/Shield Block materializa o item de verdade na ficha via `grantMaterializer.ts` + `materializeGrants` (usado por `planVM.ts`). Mas depois de materializado, Reactive Strike vira só mais uma Strike clicável — não existe REACTION-TRIGGER em lugar nenhum do satélite (nenhum código detecta "inimigo saiu do alcance" para oferecer a reação na hora certa), então o efeito de "ataque de oportunidade automático" do Guerreiro nunca dispara sozinho.
4. **Ficha de NPC é estritamente mais pobre que a de personagem para Strikes**: sem variantes de MAP (um único botão de bônus fixo) e sem botão de dano (só texto).
5. **O eixo de proficiência por CATEGORIA (unarmed/simple/martial/advanced) funciona de ponta a ponta hoje** — rank inicial da classe + saltos por nível de `proficiencyUpgrades`, alimentando o bônus de ataque real em `strikes.ts`. Vale como base sólida para o plano de implementação, em contraste com o eixo de grupo (ausente).
6. **Fatal trata a duplicação de forma simplificada**: soma 1 dado extra fora da dobra em vez de também elevar o dado base da arma para o crítico (ver DEADLY-FATAL) — funciona mecanicamente, mas não é 100% fiel ao RAW.
