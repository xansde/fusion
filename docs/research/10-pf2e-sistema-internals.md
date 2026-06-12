# pf2e para Foundry VTT — Internals do Sistema

> Documento de pesquisa para o projeto Fusion (VTT proprietário, abordagem clean-room).
> Código open-source Apache-2.0 de `foundryvtt/pf2e` pode ser estudado e citado com atribuição.
> Código proprietário do Foundry core (não open-source) NÃO deve ser copiado.

---

## 1. Visão Geral do Repositório

- **Repositório:** https://github.com/foundryvtt/pf2e
- **Versão atual:** v8.2.0 (junho/2026), compatível com Foundry v14.360+
- **Linguagem primária:** TypeScript (84,7%), Handlebars (7,8%), SCSS (5,6%), Svelte (1,8%)
- **Build tool:** Vite + pnpm
- **Commits:** 32.562+ no branch de desenvolvimento
- **Escala:** 612 estrelas, 481 forks (repositório de referência para sistemas pf2e)
- **Status declarado no README:** "Work in Progress — funcionalidade não está completa"

### 1.1 Estrutura de Diretórios Principais

```
foundryvtt/pf2e/
├── src/                    TypeScript source
│   ├── module/             Núcleo do sistema
│   │   ├── actor/          Tipos de ator (character, npc, hazard…)
│   │   ├── item/           Tipos de item (feat, spell, weapon…)
│   │   ├── rules/          Motor de Rule Elements
│   │   └── system/         Subsistemas (checks, damage, statistic…)
│   ├── styles/             SCSS
│   └── pf2e.ts             Entry point principal
├── packs/                  Dados dos compendiums (~137 pastas)
├── static/                 Assets estáticos + licenças de arte
├── types/foundry/          Type definitions do Foundry core
├── tests/                  Test suite
└── build/                  Output de build
```

### 1.2 Build e Ferramentas

- **Bundler:** Vite (configurado via `vite.config.ts`)
- **Package manager:** pnpm
- **Linter/Formatter:** Prettier + TypeScript strict mode
- **Extração de packs:** `pnpm run extractPacks <pack-folder-name> --system=pf2e`
- **Build completo:** `pnpm run build --system=pf2e`
- **Packs são LevelDB** em runtime; o processo de contribuição edita via Foundry UI → extrai para JSON com CLI

---

## 2. Licenças

### 2.1 Código-Fonte

| Componente | Licença |
|---|---|
| HTML, CSS, JavaScript/TypeScript | **Apache License v2.0** |
| Art/assets individuais | Documentado em `./static/licenses/` e `./packs/` |
| Foundry VTT platform layer | Limited License Agreement for module development |

**Implicação para Fusion:** O código TypeScript do repositório `foundryvtt/pf2e` pode ser estudado, referenciado e adaptado conceitualmente. A licença Apache-2.0 permite reuso com atribuição, mas um clean-room genuíno exige reimplementação sem copiar código palavra por palavra.

### 2.2 Dados de Jogo (Compendiums)

| Conteúdo | Licença |
|---|---|
| Regras mecânicas (remaster) | **ORC (Open RPG Creative License)** |
| Regras pré-remaster | **OGL v1.0a** |
| Conteúdo de ambientação/lore Paizo | Community Use Policy (CUP) |
| Arte Paizo (tokens, scene maps) | Não redistribuível sem licença específica |

Cada entrada de compendium carrega metadados de publicação:

```json
"publication": {
  "license": "ORC",
  "remaster": true,
  "title": "Player Core"
}
```

**Implicação para Fusion:** Os JSON de regras mecânicas sob ORC/OGL podem ser importados e redistribuídos como dados abertos (com atribuição). Arte/imagens proprietárias da Paizo **não** devem ser redistribuídas sem acordo específico.

---

## 3. Modelo de Actors

O sistema define **9 tipos de ator** (diretórios em `src/module/actor/`):

| Tipo | Uso | Campos notáveis |
|---|---|---|
| `character` | Personagem jogador (PC) | abilities, saves, skills, proficiencies, feats, resources (hero/focus/mythic), classDC, ancestryhp, classhp |
| `npc` | Criatura/NPC com statblock completo | AC (valor + details), saves com base + saveDetail, skills com mod + special, perception, actions (NPCStrike[]) |
| `hazard` | Armadilhas e perigos | Subset de NPC; sem ações ativas por padrão |
| `loot` | Container de itens / baú | Sem statblock; apenas inventário |
| `familiar` | Familiar de personagem | Subset de creature; habilidades derivadas do PC |
| `vehicle` | Veículo | HP, BT (broken threshold), piloting |
| `party` | Grupo de PCs | Agregador; speed coletivo, exploração |
| `army` | Unidade de guerra em massa | Mecanismo de Kingdom/War |
| `creature` | Base abstrata para character/npc/familiar | Classe TypeScript não instanciada diretamente |

### 3.1 Hierarquia de Classes TypeScript

```
ActorPF2e (base.ts)
└── CreaturePF2e (creature/document.ts)
    ├── CharacterPF2e (character/document.ts)
    ├── NPCPF2e (npc/document.ts)
    └── FamiliarPF2e (familiar/document.ts)
├── HazardPF2e
├── LootPF2e
├── VehiclePF2e
├── PartyPF2e
└── ArmyPF2e
```

### 3.2 Campos Centrais do Character (CharacterSystemData)

- **CharacterAbilities:** Record de ability strings → `{ base: number }` (score antes de modificações de itens)
- **CharacterHitPoints:** `{ value, max, temp, recoveryMultiplier, recoveryAddend, sp? }` (sp = Stamina Points, variante opcional)
- **CharacterSaves:** `{ fortitude, reflex, will }` → `CharacterSaveData { rank: ZeroToFour }`
- **CharacterSkillData:** `{ attribute, rank: ZeroToFour, armor: boolean, lore: boolean, itemId? }`
- **ClassDCData:** `{ label, rank, primary }`
- **CharacterResources:** heroPoints, focusPoints, investiture, mythicPoints — todos com `{ value, max }`
- **MartialProficiency:** `{ definition: Predicate, sameAs?, maxRank, custom }`

### 3.3 Campos Centrais do NPC (NPCSystemData)

- **ac:** `{ value: number, details: string }`
- **NPCHitPoints:** `{ value, max, base?, details }`
- **NPCSaveData:** `{ value, rank, base?, saveDetail }`
- **NPCSkillData:** `{ mod, visible, lore?, itemId?, special: NPCSpecialSkill[] }`
- **NPCPerceptionData:** `{ mod, details, senses: SenseData[] }`
- **actions:** `NPCStrike[]` — ataques e ações especiais
- **customModifiers:** `Record<string, ModifierPF2e[]>`
- **spellcasting:** `{ rituals: { dc: number } }`

---

## 4. Modelo de Items

O sistema define **22+ tipos de item** (diretórios em `src/module/item/`):

### 4.1 Tabela Completa de Tipos

| Tipo | Categoria | Descrição |
|---|---|---|
| `ancestry` | Construção de personagem | Raça/linhagem — hp, speed, size, reach, boosts, flaws, languages, vision |
| `heritage` | Construção de personagem | Sub-raça; herda dados da ancestry |
| `background` | Construção de personagem | Antecedente; boosts + proficiências de skill |
| `class` | Construção de personagem | Classe; define hp/nível, proficiências, saving throws, attack progressions |
| `feat` | Mecânica | Feitos/poderes; level, category, prerequisites, frequency, actionType, subfeatures |
| `ability` | Mecânica | Abilidades de classe/ancestria (subtype de feat) |
| `spell` | Magia | level, traditions, area, range, duration, damage, defense/save, sustained |
| `spellcastingEntry` | Magia | Container de magia; tradition, ability, slots, proficiency, collection type |
| `weapon` | Equipamento físico | category, group, damage (dice/die/type), runes (potency/striking/property), range, reload, material, traits |
| `armor` | Equipamento físico | category, group, AC bonus, dex cap, check penalty, speed penalty, strength, material, runes |
| `shield` | Equipamento físico | AC bonus, hardness, HP, BT (broken threshold) |
| `equipment` | Equipamento físico | Item genérico; bulk, price, usage, traits |
| `consumable` | Equipamento físico | category (scroll/wand/potion…), charges, spell link |
| `container` | Equipamento físico | bulk reduction, capacity (sealed/collapsed) |
| `treasure` | Equipamento físico | Ouro/gemas; value em gp/sp |
| `book` | Equipamento físico | Habilidades contidas; skill outcomes |
| `kit` | Equipamento físico | Bundle com lista de itens incluídos |
| `condition` | Estado | Slug canônico (frightened, prone…); value para condições numeradas |
| `effect` | Estado | Duração e badge; encapsula regras temporárias |
| `affliction` | Estado | Venenos/doenças; stages com duração e efeitos por estágio |
| `lore` | Habilidade | Perícia de lore customizada; rank 0-4 |
| `melee` | NPC-only | Ataque corpo-a-corpo/ranged de NPC |
| `deity` | Referência | Divindade; domains, edicts, anathemas, spell list |
| `campaignFeature` | Campanha | Feature específica de AP (Adventure Path) |

### 4.2 Estrutura JSON Universal de Compendium

Toda entrada de compendium segue este formato de nível superior:

```json
{
  "_id": "A1B2C3D4E5F6G7H8",
  "name": "Nome do Item",
  "type": "feat",
  "img": "icons/path/icon.webp",
  "system": { /* dados específicos do tipo */ },
  "folder": null
}
```

- **`_id`:** identificador base62 de 16 caracteres, **imutável** — quebra `@UUID` links se alterado
- **`system`:** objeto específico do tipo; contém `rules` (array de Rule Elements) em todos os tipos

### 4.3 Exemplo: Campos de um Weapon

```
system.damage: { dice, die, damageType, modifier, persistent? }
system.category: "simple" | "martial" | "advanced" | "unarmed"
system.group: "sword" | "bow" | "axe" | ...
system.runes: { potency: 0-4, striking: 0-3, property: string[] }
system.material: { type, grade }
system.range: number | null          // metros
system.reload: { value, consumption, label }
system.traits: { value: string[], otherTags: string[], toggles: Record }
system.usage: string                  // "held-in-one-hand" etc.
```

### 4.4 Exemplo: Campos de um Feat

```
system.level: { value: 1-30 }
system.category: "skill" | "general" | "ancestry" | "class" | ...
system.prerequisites: [{ value: string }]
system.actionType: { value: "passive" | "action" | "reaction" | "free" }
system.actions: { value: 1 | 2 | 3 | null }
system.frequency: { max, per, expended }
system.maxTakable: number | null
system.subfeatures: { keyOptions, languages, proficiencies, senses, suppressedFeatures }
system.selfEffect: { uuid, name } | null
system.rules: RuleElement[]
```

### 4.5 Exemplo: Campos de um Spell

```
system.level: { value: 1-10 }
system.traits: { value: string[], traditions: MagicTradition[] }
system.target: { value: string }
system.range: { value: string }
system.area: { type: "burst"|"cone"|"line"|"emanation", value: number } | null
system.time: { value: string }          // "1" | "2" | "3" | "reaction" | "1 minute"
system.duration: { value: string, sustained: boolean }
system.defense: { passive?: { statistic }, save?: { statistic: SaveType, basic: boolean } } | null
system.damage: Record<string, { formula: string, type: DamageType, category: DamageCategoryUnique | null }>
system.rules: RuleElement[]
```

---

## 5. Rule Elements — Motor de Automação Data-Driven

Rule Elements (REs) são a peça central de automação do sistema pf2e. São arrays JSON no campo `system.rules` de qualquer item não-físico. Quando o item está equipado/ativo em um ator, o motor aplica os REs durante a preparação de dados (data preparation lifecycle).

### 5.1 Conceito Central

> "Rule elements are the primary mechanism by which items modify an actor's statistics. Every feat that grants a bonus, every armor that applies a speed penalty, every condition that imposes a penalty uses one or more Rule Elements."

**Fluxo:** `Actor.prepareData()` → itera todos os items → `RuleElements.fromOwnedItem()` → instancia subclasses de `RuleElement` → aplica em ordem de prioridade → popula `actor.synthetics` → cálculos finais de estatísticas.

**Chave:** modificadores são armazenados como _deferred factory functions_ — predicados só são avaliados no momento do roll, não durante a preparação. Isso permite automação condicional eficiente.

### 5.2 Campos Universais (Base)

| Campo | Tipo | Descrição |
|---|---|---|
| `key` | string | Tipo do RE (ex: `"FlatModifier"`) |
| `slug` | string? | Identificador kebab-case para referência cruzada |
| `label` | string? | Texto legível para tooltips |
| `priority` | number | Ordem de execução (padrão 100, menor executa antes) |
| `ignored` | boolean | Desabilita o RE |
| `predicate` | array | Lógica condicional — operadores `or`, `and`, `not`, comparações `gte/lte/gt/lt/eq` |
| `requiresEquipped` | boolean | Só ativa se o item está equipado |
| `requiresInvestment` | boolean | Só ativa se o item está investido |

### 5.3 Listagem Completa de Rule Elements

Extraído de `src/module/rules/rule-element/`:

| Arquivo/Subpasta | RE Key | Função |
|---|---|---|
| `flat-modifier.ts` | **FlatModifier** | Bônus/penalidade numérica tipada a seletores de roll |
| `ae-like.ts` | **AELike** | Modifica propriedades do ator via path (multiply/add/subtract/downgrade/upgrade/override) |
| `adjust-modifier.ts` | **AdjustModifier** | Altera modificadores existentes por slug |
| `damage-dice.ts` | **DamageDice** | Adiciona/modifica dados de dano (size, type, category) |
| `roll-option.ts` / subpasta | **RollOption** | Cria flags booleanas nos domínios de roll para predicados |
| `grant-item.ts` / subpasta | **GrantItem** | Concede outro item automaticamente via UUID |
| `choice-set.ts` / subpasta | **ChoiceSet** | Prompts de seleção; armazena em `flags.pf2e.rulesSelections` |
| `strike.ts` | **Strike** | Cria nova ação de ataque em um ator |
| `adjust-strike.ts` | **AdjustStrike** | Modifica strikes existentes |
| `base-speed.ts` | **BaseSpeed** | Define velocidade base (land/fly/climb/swim/burrow) |
| `base.ts` | — | Classe base abstrata |
| `aura.ts` | **Aura** | Cria emanação com efeitos em aliados/inimigos no raio |
| `battle-form/` | **BattleForm** | Transformação polimórfica complexa (wild shape, formas) |
| `damage-alteration/` | **DamageAlteration** | Modifica propriedades de dados de dano |
| `effect-spinoff.ts` | **EffectSpinoff** | Cria efeito derivado a partir de outro |
| `ephemeral-effect.ts` | **EphemeralEffect** | Efeito temporário apenas durante cálculo (não persiste) |
| `fast-healing.ts` | **FastHealing** | Cura rápida com condição de desativação |
| `iwr/` | **IWR** | Imunidades, Fraquezas e Resistências (a dano ou condições) |
| `item-alteration/` | **ItemAlteration** | Modifica propriedades de itens possuídos |
| `lose-hit-points.ts` | **LoseHitPoints** | Dano automático durante preparação de dados |
| `martial-proficiency.ts` | **MartialProficiency** | Concede proficiência em arma/grupo |
| `multiple-attack-penalty.ts` | **MultipleAttackPenalty** | Define penalidade de ataque múltiplo customizada |
| `roll-note.ts` | **RollNote** | Adiciona texto explicativo ao resultado de roll |
| `roll-twice.ts` | **RollTwice** | Fortune (toma maior) / Misfortune (toma menor) |
| `substitute-roll.ts` | **SubstituteRoll** | Substitui resultado do dado por valor fixo/estatística |
| `sense.ts` | **Sense** | Concede sentido (darkvision, tremorsense, scent…) |
| `special-resource.ts` | **SpecialResource** | Recurso limitado customizado |
| `special-statistic.ts` | **SpecialStatistic** | Estatística customizada não padrão |
| `striking.ts` | **Striking** | Equivalente de runa striking |
| `temp-hp.ts` | **TempHP** | Pontos de vida temporários |
| `token-effect-icon.ts` | **TokenEffectIcon** | Ícone de estado no token (sem efeito permanente) |
| `token-image.ts` | **TokenImage** | Altera imagem do token condicionalmente |
| `token-light.ts` | **TokenLight** | Configura emissão de luz do token |
| `token-mark.ts` / subpasta | **TokenMark** | Marcador visual no token |
| `token-name.ts` | **TokenName** | Altera nome exibido do token |
| `weapon-potency.ts` | **WeaponPotency** | Equivalente de runa de potência |
| `actor-traits.ts` | **ActorTraits** | Adiciona/remove traits do ator dinamicamente |
| `adjust-degree-of-success.ts` | **AdjustDegreeOfSuccess** | Altera degree of success condicional (ex: Evasion) |
| `crafting-ability.ts` | **CraftingAbility** | Define habilidade de crafting customizada |
| `creature-size.ts` | **CreatureSize** | Modifica categoria de tamanho do ator |
| `crit-spec.ts` | **CriticalSpecialization** | Define efeito de especialização crítica |
| `dexterity-modifier-cap.ts` | **DexterityModifierCap** | Limita CAP de DEX para AC |

### 5.4 Seletores e Domínios

Seletores determinam quais rolls/estatísticas o RE afeta. Exemplos canônicos:
- `"perception"`, `"ac"`, `"fortitude"`, `"reflex"`, `"will"`
- `"attack-roll"`, `"damage"`, `"spell-attack-roll"`, `"spell-damage"`
- `"skill:acrobatics"`, `"saving-throw"`
- `"fortitude-dc"`, `"reflex-dc"`, `"will-dc"`
- Seletores de dano: `"piercing"`, `"fire"`, `"persistent-damage"`

### 5.5 Expressões de Valor

Valores suportam fórmulas dinâmicas:

```json
"value": "@actor.level"
"value": "@actor.abilities.str.mod"
"value": "floor(@actor.level / 2)"
"value": "ternary(gte(@actor.level, 3), 2, 1)"
"value": "match(when(gte(@item.level, 17), 4), when(gte(@item.level, 11), 3), when(gte(@item.level, 5), 2), 1)"
```

Referências de string (não numéricas): `{item|flags.pf2e.rulesSelections.damage}`

---

## 6. Sistema de Synthetics

O objeto `RuleElementSynthetics` centraliza todos os dados computados pelos REs durante a preparação:

```typescript
interface RuleElementSynthetics<TActor> {
  // Modificadores e ajustes
  modifiers: Record<string, DeferredModifier[]>      // por seletor
  modifierAdjustments: Record<string, ModifierAdjustment[]>
  degreeOfSuccessAdjustments: Record<string, DegreeOfSuccessAdjustment[]>

  // Combate
  damageDice: Record<string, DamageDicePF2e[]>
  damageAlterations: Record<string, DamageAlteration[]>
  strikeAdjustments: StrikeAdjustment[]
  multipleAttackPenalties: Record<string, MultipleAttackPenalty[]>
  striking: Record<string, StrikingSynthetic[]>
  weaponPotency: Record<string, WeaponPotencySynthetic[]>
  criticalSpecializations: { standard: CritSpecEffect[]; alternate: CritSpecEffect[] }

  // Estatísticas e recursos
  statistics: Map<string, Statistic>
  resources: Map<string, SpecialResourceRuleElement>
  senses: { sense: SenseData; predicate: Predicate; force: boolean }[]
  movementTypes: MovementTypeSynthetic[]

  // Rolls
  rollNotes: Record<string, RollNotePF2e[]>
  rollSubstitutions: Record<string, RollSubstitution[]>
  rollTwice: Record<string, RollTwice[]>
  toggles: Record<string, RollOptionToggle>

  // Tokens e visual
  tokenEffectIcons: TokenEffectIconRuleElement[]
  tokenMarks: Map<string, TokenMarkData>
  tokenOverrides: DeepPartial<TokenDocumentPF2e["_source"]>

  // Itens e efeitos
  itemAlterations: Record<string, ItemAlteration[]>
  ephemeralEffects: Record<string, { origin: ItemPF2e[]; target: ItemPF2e[] }>
}
```

**Fluxo completo de preparação do character:**

1. `prepareBaseData()` — abilities, traits, flags, proficiencies, saves (schema)
2. `prepareEmbeddedDocuments()` — active effects em ability modifiers, status de armor
3. `prepareDataFromItems()` — hierarquia de feats, ABC (ancestry/background/class) boosts
4. `prepareDerivedData()` — HP, saves com modificadores, AC, skills, class DCs, speeds, strikes
   - Internamente usa `extractModifiers()`, `extractModifierAdjustments()`, `extractNotes()` sobre `synthetics`
   - Instancias de `StatisticModifier` agregam os modificadores em estatísticas finais

---

## 7. Sistema de Checks e Degrees of Success

### 7.1 Fluxo de Roll

- **Entry point único:** `Check.roll()` em `src/module/system/check/`
- **Classe de roll:** `CheckRoll extends Roll` com metadados pf2e: `degreeOfSuccess`, opção de reroll
- **Estatísticas:** todas usam `StatisticPF2e` com slug, proficiency rank, modifier stack, sub-objetos check e DC

### 7.2 Tipos de Modificador (7 tipos com stacking rules)

| Tipo | Regra de empilhamento |
|---|---|
| `circumstance` | Apenas maior bônus + menor penalidade |
| `item` | Apenas maior bônus + menor penalidade |
| `status` | Apenas maior bônus + menor penalidade |
| `untyped` | Todos empilham |
| `ability` | Um por estatística |
| `proficiency` | Um por estatística |
| `potency` | Maior aplica |

### 7.3 Degree of Success

```
Critical Success (3): resultado - DC ≥ 10
Success       (2): resultado - DC ≥ 0
Failure       (1): DC - resultado < 10
Critical Failure (0): DC - resultado ≥ 10
```

Ajustes em sequência: margem → natural 20 (sobe 1 grau) / natural 1 (desce 1 grau) → ajustes de REs (ex: `AdjustDegreeOfSuccess` — Evasion, Juggernaut).

Implementado em `src/module/system/degree-of-success.ts` como classe `DegreeOfSuccess`.

### 7.4 Roll Options

Roll options são `Set<string>` de flags booleanas que fluem pelo pipeline de roll. Fontes:
- Estado do ator (condições ativas, itens equipados)
- Domínios do check (attack-roll, damage, saving-throw…)
- Itens (traits, rarity, category)
- Alvos (target:trait:*, target:level:*)
- Valores dinâmicos

### 7.5 Inline Enrichers

Conteúdo de texto (ações de NPC, descrições de feitiços) pode conter botões clicáveis:

- `@Check[type:perception dc:20]` — botão de teste com DC fixo
- `@Check[type:reflex dc:18 basic:true]` — saving throw básico
- `@Damage[2d6 fire]` — rolagem de dano direta
- `@Damage[1d8+@actor.abilities.str.mod piercing]` — dano com atributo do ator
- `@Template[type:burst distance:20]` — template de área no canvas

---

## 8. Automação de Condições e IWR

### 8.1 Condições

`ConditionManager` é o registro estático central com dados canônicos do compendium `pf2e.conditionitems`.

**Condições binárias (não-valued):** prone, invisible, unconscious, paralyzed, fleeing, frightened-0, etc.

**Condições numeradas (valued):**
- frightened, clumsy, drained, enfeebled, stupefied, sickened — impõem penalidade de status igual ao valor
- slowed — perde N ações por turno
- stunned — consome o valor imediatamente
- dying, doomed, wounded — mecânicas de limiar de morte

**API programática:** `actor.increaseCondition(slug)`, `actor.decreaseCondition(slug)`, `actor.toggleCondition(slug)`

Imunidade configurada via ActiveEffect ou RE-IWR impede a aplicação automaticamente.

### 8.2 IWR (Immunity, Weakness, Resistance)

Configurados via Rule Element `IWR` com campos:
- `type`: damage type ou condition slug
- `value`: número (para weakness/resistance)
- `exceptions`: `["force", "ghost-touch"]` — tipos que ignoram a resistência
- `doubleVs`: tipos que dobram a fraqueza

Definidos automaticamente via `setImmunitiesFromTraits()` baseado nos traits do ator (ex: criatura com trait `fire` ganha imunidade a fogo).

### 8.3 Spellcasting

**Tipos de SpellcastingEntry:**

| Categoria | Exemplo de Classe |
|---|---|
| `prepared` | Wizard, Cleric, Druid |
| `spontaneous` | Sorcerer, Bard |
| `innate` | Habilidades raciais |
| `focus` | Classe Features (ki spells, etc.) |
| `items` | Scrolls e wands |
| `staff` | Staves mágicas |
| `ritual` | Rituais (sem slots) |

**Campos de SpellcastingEntry:**
```
system.tradition: MagicTradition ("arcane"|"divine"|"occult"|"primal")
system.ability: AttributeString ("int"|"wis"|"cha")
system.proficiency: { slug, value: ZeroToFour }
system.spelldc: { value, breakdown }
system.slots: { slot0..slot10: { prepared[], value, max } }
system.collectionType: { value: SpellcastingCategory, flexible?, validItems }
system.autoHeightenLevel: OneToTen | null
```

### 8.4 Strikes e MAP

- O `synthetics` carrega `multipleAttackPenalties` como Record por seletor
- MAP padrão: 0 / -5 / -10; com agile trait: 0 / -4 / -8
- `MultipleAttackPenalty` RE permite override customizado
- `AdjustStrike` RE modifica traits, dano, categorias de armas existentes

---

## 9. Dados dos Compendium Packs

### 9.1 Escala

O repositório contém **137 pastas de packs** no total.

| Categoria | Qtd aproximada de packs | Escala de documentos |
|---|---|---|
| Bestiários (por livro/AP) | ~60 packs | +1.200 criaturas ao total |
| Equipment | 1 pack | **~5.200+ itens** (GitHub truncou em 1.000) |
| Feats | 1 pack principal | Milhares de feitos |
| Spells | 1 pack | Centenas de feitiços |
| Conditions | 1 pack | ~40 condições |
| Ancestries/Heritages/Backgrounds | 3 packs | Centenas |
| Classes/Class Features | 2 packs | Dezenas/centenas |
| Effects (feat/spell/equipment/campaign) | 5 packs | Centenas |
| Macros/Action Macros | 2 packs | Dezenas |
| Rollable Tables, Journals | 2-3 packs | Dezenas |
| Hazards, Vehicles | 2 packs | Centenas de hazards |
| Deities, Boons | 2 packs | Centenas |

### 9.2 Processo de Build dos Packs

1. Editor faz alterações via **Foundry VTT UI** (sheet do item/ator)
2. Foundry escreve para **LevelDB** em `dist/`
3. `pnpm run extractPacks <pack-folder>` exporta LevelDB → arquivos **JSON** individuais por documento
4. Revisão via `git diff` para garantir mudanças intencionais
5. Pull request para o repositório
6. Linting de JSON via `npm run lint:fix` (Prettier)

### 9.3 Links por UUID

Referências internas: `@UUID[Compendium.pf2e.conditionitems.Item.Blinded]`
- Resolvem pelo **nome**, não pelo `_id` → resilientes a rebuilds
- `_id` deve ser tratado como imutável em contribuições

---

## 10. Lógica Pura de Regras vs. Acoplamento ao Foundry

### 10.1 O Que É Reaproveitável Conceitualmente (Regras Puras)

Estes conceitos implementam lógica pf2e que pode ser reimplementada em qualquer engine:

| Subsistema | Localização no pf2e | Natureza |
|---|---|---|
| Degree of Success | `src/module/system/degree-of-success.ts` | Algoritmo puro (d20 + margin + nat20/1) |
| Modifier stacking | `src/module/actor/modifiers.ts` | Algoritmo puro (7 tipos, regras de empilhamento) |
| Predication engine | `src/module/system/predication.ts` | Avaliador de expressões lógicas |
| StatisticModifier | `src/module/actor/modifiers.ts` | Agregador de modificadores por domínio |
| Roll Options Set | Parte do pipeline de check | Conjunto de flags para avaliação condicional |
| RuleElement base + subclasses | `src/module/rules/rule-element/` | Motor de automação data-driven |
| IWR application | `src/module/system/damage/` | Lógica de imunidade/fraqueza/resistência |
| Condition value mechanics | `src/module/system/conditions/` | Mecânicas de condições numeradas |

### 10.2 O Que É Fortemente Acoplado ao Foundry Core

Estas partes dependem de APIs do Foundry VTT que NÃO existem no Fusion:

| Componente | Dependência do Foundry |
|---|---|
| `Actor.prepareData()` e ciclo | `foundry.abstract.Document`, hooks do Foundry |
| Renderização de sheets | Handlebars + `Application` base do Foundry |
| Canvas e tokens | `CanvasLayer`, `Token`, `PlaceableObject` |
| LevelDB compendiums | `CompendiumCollection`, `WorldCollection` |
| Socket/users | `SocketInterface` do Foundry |
| Active Effects | `ActiveEffect` do Foundry core |
| Roll class base | `Roll` do Foundry (estendida para `CheckRoll`) |
| Chat messages | `ChatMessage` do Foundry |

**Conclusão para Fusion:** O Fusion precisará de implementações próprias para todos os equivalentes das APIs do Foundry. A lógica de regras (algoritmos de cálculo, estruturas de dados de items/actors, motor de Rule Elements) pode ser inspirada no pf2e sem copiar código, pois representa conhecimento de domínio das regras pf2e, não código proprietário do Foundry.

---

## 11. SF2e (Starfinder 2e) — Relação com pf2e

- **SF2e é mantido no mesmo repositório** `foundryvtt/pf2e`; há um `CHANGELOG (SF2E).md` dedicado
- O sistema empacota como `sf2e` separado mas compartilha toda a codebase TypeScript do pf2e
- Versão atual: v1.1.2 (Foundry v14)
- **Diferenças principais do SF2e:**
  - Weapon boost automation e configurações de armas modulares
  - Sistema de piloting com sintaxe `/act`
  - Ancestries SF2e (Android, Ysoki, Vlaka, etc.)
  - Economia em créditos
  - Calendario Pact Standard
  - Traits `tech` e `cosmic`
  - Suporte a Starfinder Society (SFS2)
  - Locale overrides para "Home World" e "Port of Call"
- **Compatibilidade:** "Full compatibility with many Pathfinder 2nd edition modules (coming soon)"
- **Etmos:** RPG brasileiro (Editora Balde Galáctico) que usa linguagem mágica; **não possui sistema Foundry existente** — seria desenvolvimento do zero no Fusion

---

## 12. Subsistemas Técnicos Relevantes (`src/module/system/`)

| Subdiretório/Arquivo | Função |
|---|---|
| `check/` | Entry point único `Check.roll()`, `CheckRoll` class |
| `damage/` | Cálculo e aplicação de dano, IWR processing |
| `statistic/` | `StatisticPF2e` — wrapper para qualquer estatística rolável |
| `conditions/` | `ConditionManager`, aplicação e remoção de condições |
| `degree-of-success.ts` | `DegreeOfSuccess` class com lógica de margem+nat20/1 |
| `predication.ts` | Motor de predicados (`and`, `or`, `not`, comparações) |
| `effect-tracker.ts` | Rastreamento de efeitos ativos com duração |
| `rolls.ts` | Utilitários de dice rolling |
| `schema-data-fields.ts` | Campos customizados do schema (Foundry DataField extensions) |
| `text-editor.ts` | Enrichers inline (@Check, @Damage, @Template, @UUID) |
| `action-macros/` | Macros de ações básicas (Aid, Grapple, Trip, etc.) |
| `settings/` | Configurações do sistema (variantes, opções) |
| `html-elements/` | Componentes HTML customizados (Svelte) |

---

## 13. Informações sobre a Política de Contribuição

- Todo conteúdo PF2e deve ser adicionado apenas após a data de "street release" da Paizo
- Texto de regras mecânicas pode ser incluído; lore de ambientação pode ter restrições
- Personagens de Pathfinder Society devem ser inseridos exatamente como escrito (sem interpretação)
- O projeto usa um sistema de Steering Committee para aprovação de trabalho remunerado

---

## Fontes

- [GitHub - foundryvtt/pf2e (Repositório principal)](https://github.com/foundryvtt/pf2e)
- [Quickstart guide for rule elements (GitHub Wiki)](https://github.com/foundryvtt/pf2e/wiki/Quickstart-guide-for-rule-elements)
- [Rule Elements Overview — Mintlify Docs](https://mintlify.wiki/foundryvtt/pf2e/rule-elements/overview)
- [Common Rule Elements — Mintlify Docs](https://mintlify.wiki/foundryvtt/pf2e/rule-elements/common-rule-elements)
- [Adding compendium content — Mintlify Docs](https://mintlify.wiki/foundryvtt/pf2e/guides/adding-compendium-content)
- [Checks and Rolls — Mintlify Docs](https://mintlify.wiki/foundryvtt/pf2e/guides/checks-and-rolls)
- [Conditions — Mintlify Docs](https://mintlify.wiki/foundryvtt/pf2e/guides/conditions)
- [Pathfinder Second Edition | Foundry Virtual Tabletop (Package page)](https://foundryvtt.com/packages/pf2e/)
- [Starfinder Second Edition | Foundry Virtual Tabletop (Package page)](https://foundryvtt.com/packages/sf2e)
- [Project Charter and Policies (GitHub Wiki)](https://github.com/foundryvtt/pf2e/wiki/Project-Charter-and-Policies)
- [src/module/actor - GitHub](https://github.com/foundryvtt/pf2e/tree/master/src/module/actor)
- [src/module/item - GitHub](https://github.com/foundryvtt/pf2e/tree/master/src/module/item)
- [src/module/rules/rule-element - GitHub](https://github.com/foundryvtt/pf2e/tree/master/src/module/rules/rule-element)
- [src/module/system - GitHub](https://github.com/foundryvtt/pf2e/tree/master/src/module/system)
- [packs/ directory - GitHub](https://github.com/foundryvtt/pf2e/tree/master/packs)
- [README.md - GitHub](https://github.com/foundryvtt/pf2e/blob/master/README.md)
- [CHANGELOG (SF2E).md - GitHub](https://github.com/foundryvtt/pf2e/blob/v14-dev/CHANGELOG%20(SF2E).md)
- [synthetics.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/rules/synthetics.ts)
- [character/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/actor/character/data.ts)
- [npc/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/actor/npc/data.ts)
- [spell/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/item/spell/data.ts)
- [weapon/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/item/weapon/data.ts)
- [feat/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/item/feat/data.ts)
- [ancestry/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/item/ancestry/data.ts)
- [spellcasting-entry/data.ts — GitHub](https://github.com/foundryvtt/pf2e/blob/master/src/module/item/spellcasting-entry/data.ts)
- [packs/equipment directory — GitHub](https://github.com/foundryvtt/pf2e/tree/master/packs/equipment)
- [Etmos RPG — Editora Balde Galáctico](https://baldegalactico.com.br/jogo/etmos/)
- [Open Game License — Archives of Nethys](https://2e.aonprd.com/Licenses.aspx)
