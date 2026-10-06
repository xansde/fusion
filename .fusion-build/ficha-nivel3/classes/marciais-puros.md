# Sonda de criação de ficha — Marciais puros (Fighter, Barbarian, Monk, Rogue, Swashbuckler)

Fonte dos dados: `git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/<pack>/documents.json`
executado de dentro de `external/fusion-systems-2e` (HEAD detached, nenhum checkout/branch alterado).
Packs lidos: `classes-core`, `class-features-core`, `feats-core`. JSONs intermediários ficaram no
scratchpad da sessão (`.../scratchpad/*.json`), não no repo. `weapons-core`/`equipment-core` não
precisaram ser lidos porque as proficiências iniciais já vêm estruturadas no próprio documento da
classe (campos `attacks`/`defenses`/`savingThrows`/`classDC`/`perception`), ver item 5 de cada classe.

Pergunta: o que falta para CRIAR o personagem (nível 1→3), sem nada de combate/dano/efeito em alvo.

---

## Fighter (`1VFFHH43BOrf82SB`)

**1. Features nível 1-3** (campo `featuresByLevel`, filtrado ≤3): 3 features —
Reactive Strike (nv1, 1 rule: GrantItem), Shield Block (nv1, 1 rule: GrantItem), Bravery (nv3, **0 rules**).
→ 1 de 3 com `rules` vazio.

**2. Escolha do jogador na criação**: Fighter tem uma regra **no próprio item de classe** (não em
featuresByLevel), fora do escopo de nível: `system.rules` da classe tem 1 entrada —
`ActiveEffectLike` (`set-property`) com `path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank"`.
Isso expressa uma escolha de perícia via **placeholder de flag** (`flags.system.rulesSelections.fighterSkill`),
não um `ChoiceSet` processável — e **não existe nenhum `ChoiceSet` em pack nenhum** (ver achado
transversal abaixo). Só prosa/placeholder, sem UI de escolha nos dados.

**3. Mecanismo específico**: seleção de perícia amarrada a uma flag (`rulesSelections.fighterSkill`)
sem `ChoiceSet` que a preencha — precisa de um picker de perícia fora do fluxo genérico.

**4. Talentos nível 1-2**: 117 talentos de classe no total; **24** em nível ≤2; **0** com
`prerequisites` não-vazio.

**5. Equipamento/proficiências iniciais**: estruturado — `attacks` (advanced 1, martial 2, simple 2,
unarmed 2), `defenses` (heavy/light/medium/unarmored 1 cada), `savingThrows` (fort 2, reflex 2, will 1),
`classDC` 1, `perception` 2, `keyAbility` ["dex","str"] (escolha dupla — genérica, mesmo campo do Monk).

**Classificação: AMARELO** — falta 1 mecanismo (picker de perícia ligado à flag `fighterSkill`).

---

## Barbarian (`GpVXOuB995Kz1fHI`)

**1. Features nível 1-3**: 4 features — Instinct (nv1, 3 rules: GrantItem + 2× ActiveEffectLike),
Rage (nv1, 1 rule: GrantItem), Quick-Tempered (nv1, 1 rule: GrantItem), Furious Footfalls (nv3, 2 rules:
FlatModifier + AdjustModifier). → 0 de 4 com `rules` vazio.

**2. Escolha do jogador**: "Instinct" é a subclasse do Barbarian — `GrantItem` aponta para
`{item|flags.system.rulesSelections.instinct}` (placeholder), **sem `ChoiceSet`**. As 9 opções
concretas EXISTEM como documentos próprios em `class-features-core` (Animal, Decay, Dragon, Elemental,
Fury, Giant, Ligneous, Spirit, Superstition Instinct) — o dado da opção existe, só falta o elemento
de regra que apresenta a escolha e grava a flag.

**3. Mecanismo específico**: seleção de subclasse (Instinct) com grant em cascata — dado das 9 opções
presente, wiring de escolha ausente.

**4. Talentos nível 1-2**: 96 no total; **15** em nível ≤2; **3** com `prerequisites` não-vazio.

**5. Proficiências iniciais**: estruturado — `attacks` (martial/simple/unarmed 1, advanced 0),
`defenses` (light/medium/unarmored 1, heavy 0), `savingThrows` (fort 2, reflex 1, will 2), `classDC` 1,
`trainedSkills.value` já inclui `athletics` + 3 adicionais.

**Classificação: AMARELO** — falta 1 mecanismo (picker de Instinct); dado das opções já existe.

---

## Monk (`6GhN5PnstY0pPOCL`)

**1. Features nível 1-3**: 4 features — Flurry of Blows (nv1, **0 rules**), Powerful Fist (nv1, 1 rule:
ItemAlteration), Mystic Strikes (nv3, 2 rules: ItemAlteration×2), Incredible Movement (nv3, 1 rule:
FlatModifier). → 1 de 4 com `rules` vazio.

**2. Escolha do jogador**: nenhuma feature de nível 1-3 exige `ChoiceSet`/subclasse. A única escolha
de criação é `keyAbility: ["dex","str"]` — campo do PRÓPRIO item de classe (mesmo mecanismo genérico
do Fighter), não uma feature com regra própria; não achei rule element algum controlando essa escolha
(nem no Monk nem no Fighter) — é resolvida no nível do fluxo genérico de criação (fora do escopo dos
packs de classe/feature/feat).

**3. Mecanismo específico**: nenhum mecanismo NOVO exigido para nível 1-3 além do fluxo genérico.

**4. Talentos nível 1-2**: 127 no total; **25** em nível ≤2; **7** com `prerequisites` não-vazio.

**5. Proficiências iniciais**: estruturado — `attacks` (simple/unarmed 1, martial/advanced 0),
`defenses.unarmored` 2 (único), `savingThrows` (fort 2, reflex 2, will 2), `classDC` 1,
`trainedSkills.additional` 4.

**Classificação: VERDE** — dá para criar até o nível 3 só com o fluxo genérico (a escolha dex/str é
campo comum a mais de uma classe, não um mecanismo específico do Monk).

---

## Rogue (`nvLkRf5OdaAq9zgU`)

**1. Features nível 1-3**: 4 features — Rogue's Racket (nv1, 1 rule: GrantItem), Sneak Attack (nv1,
5 rules: 2×ActiveEffectLike, RollOption, ItemAlteration, DamageDice), Surprise Attack (nv1, **0 rules**),
Deny Advantage (nv3, 1 rule: ActiveEffectLike). → 1 de 4 com `rules` vazio.

**2. Escolha do jogador**: "Rogue's Racket" é a subclasse — `GrantItem` para
`{item|flags.system.rulesSelections.roguesRacket}`, **sem `ChoiceSet`**. A descrição HTML lista em
prosa as 5 opções (Eldritch Trickster, Mastermind, Ruffian, Scoundrel, Thief), e **todas as 5 existem**
como documentos próprios em `class-features-core` — de novo, dado presente, wiring de escolha ausente.

**3. Mecanismo específico**: seleção de racket (subclasse) com grant em cascata — mesmo padrão do
Barbarian/Swashbuckler.

**4. Talentos nível 1-2**: 111 no total; **17** em nível ≤2; **8** com `prerequisites` não-vazio
(maior contagem do grupo).

**5. Proficiências iniciais**: estruturado — `attacks` (martial/simple/unarmed 1, advanced 0),
`defenses` (light/unarmored 1, heavy/medium 0), `savingThrows` (fort 1, reflex 2, will 2), `classDC` 1,
`trainedSkills.value` já inclui `stealth` + 7 adicionais (maior do grupo) e `skillIncreaseLevels` cobre
todos os níveis de 2 a 20 (não só ímpares).

**Classificação: AMARELO** — falta 1 mecanismo (picker de Racket); dado das 5 opções já existe.

---

## Swashbuckler (`jvGpsslB52DgPXfr`)

**1. Features nível 1-3**: 9 features — Panache (nv1, 4 rules), Precise Strike (nv1, 3 rules),
Confident Finisher (nv1, 1 rule: GrantItem), Swashbuckler's Style (nv1, 1 rule: GrantItem), Stylish
Combatant (nv1, 2 rules: FlatModifier×2), Vivacious Speed (nv3, 2 rules: AdjustModifier×2), Stylish
Tricks (nv3, **0 rules**), Opportune Riposte (nv3, 1 rule: GrantItem), Fortitude Expertise (nv3, 2
rules: ItemAlteration×2). → 1 de 9 com `rules` vazio.

**2. Escolha do jogador**: "Swashbuckler's Style" é a subclasse — `GrantItem` para
`{item|flags.system.rulesSelections.swashbucklersStyle}`, **sem `ChoiceSet`**. A descrição HTML NÃO
lista as opções em prosa (diferente do Rogue), mas as 5 opções reais existem como documentos próprios
em `class-features-core`, identificadas pelo trait `swashbuckler`: Battledancer, Braggart, Fencer,
Gymnast, Wit. Mesmo padrão: dado presente, wiring de escolha ausente.

**3. Mecanismo específico**: seleção de estilo (subclasse) com grant em cascata — mesmo padrão do
Barbarian/Rogue. Adicionalmente, Panache é um recurso/pool de estado (não relevante para criação —
é ativação em jogo, fora do escopo desta sonda).

**4. Talentos nível 1-2**: 77 no total (menor do grupo); **21** em nível ≤2; **7** com
`prerequisites` não-vazio.

**5. Proficiências iniciais**: estruturado — `attacks` (martial/simple/unarmed 1, advanced 0),
`defenses` (light/unarmored 1, heavy/medium 0), `savingThrows` (fort 1, reflex 2, will 2), `classDC` 1,
`trainedSkills.value` já inclui `acrobatics` + 4 adicionais.

**Classificação: AMARELO** — falta 1 mecanismo (picker de Estilo); dado das 5 opções já existe.

---

## Achado transversal (o mecanismo compartilhado mais caro)

**Zero `ChoiceSet` em qualquer lugar do dado**: varri as 3 packs inteiras (`class-features-core` —
milhares de rules — e `feats-core`, 2.759 feats) e não existe UM ÚNICO rule element `ChoiceSet` em
nenhum dos dois. Fighter, Barbarian, Rogue e Swashbuckler (4 das 5 classes da sonda) dependem do
mesmo padrão: uma feature de nível 1 faz `GrantItem` para um placeholder
`{item|flags.system.rulesSelections.<slug>}`, esperando que algo grave essa flag antes — e esse "algo"
não existe em nenhum dos packs lidos. As opções concretas (Instinct×9, Racket×5, Style×5) já foram
migradas para `class-features-core`; falta só o elemento/UI de escolha que resolve a flag. Isso é mais
barato de resolver do que parece por classe isolada (o dado da opção já existe), mas caro por ser
**transversal**: um único mecanismo de seleção genérico (picker de subclasse → grava
`rulesSelections.<slug>` → `GrantItem` resolve) destrava Fighter+Barbarian+Rogue+Swashbuckler de uma
vez — e provavelmente outras classes fora deste grupo também usam o mesmo placeholder.

Monk é a única classe do grupo que não depende desse mecanismo para os níveis 1-3.
