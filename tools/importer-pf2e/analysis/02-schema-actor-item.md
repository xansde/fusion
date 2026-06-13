# 02 — Schema Actor/Item: Mapeamento PF2E → Fusion

> Análise de campo a campo para os três tipos de documento representativos:
> arma (weapon), magia (spell) e monstro (npc).
> Fonte: JSONs do repositório `foundryvtt/pf2e` (Apache-2.0).
> Regras ORC/OGL ok; arte e lore proprietário — ver seção de licença abaixo.

---

## 1. Exemplo 1 — Arma: Longsword

**Arquivo:** `vendor/pf2e/packs/pf2e/equipment/longsword.json`

```json
{
  "_id": "LJdbVTOZog39EEbi",
  "img": "icons/weapons/swords/sword-guard-blue.webp",
  "name": "Longsword",
  "type": "weapon",
  "system": {
    "ammo": null,
    "baseItem": "longsword",
    "bonus": { "value": 0 },
    "bonusDamage": { "value": 0 },
    "bulk": { "value": 1 },
    "category": "martial",
    "damage": { "damageType": "slashing", "dice": 1, "die": "d8" },
    "description": { "value": "<p>Longswords can be one-edged...</p>" },
    "group": "sword",
    "level": { "value": 0 },
    "price": { "value": { "gp": 1 } },
    "publication": { "license": "ORC", "remaster": true, "title": "Pathfinder Player Core" },
    "quantity": 1,
    "range": null,
    "reload": { "value": "-" },
    "rules": [],
    "runes": { "potency": 0, "property": [], "striking": 0 },
    "size": "med",
    "traits": { "rarity": "common", "value": ["versatile-p"] },
    "usage": { "canBeAmmo": false, "value": "held-in-one-hand" }
  }
}
```

### Mapeamento campo a campo — weapon

| Campo PF2E                 | Status Fusion     | Campo Fusion           | Notas                                                            |
| -------------------------- | ----------------- | ---------------------- | ---------------------------------------------------------------- |
| `_id`                      | Descartar         | —                      | Novo UUID gerado pelo Fusion                                     |
| `img`                      | Substituir        | `img` → placeholder    | Arte proprietária; importer usa `/icons/placeholder-weapon.webp` |
| `name`                     | Mapear            | `name`                 | Texto ORC — ok                                                   |
| `type`                     | Mapear            | `type`                 | "weapon" vira tipo Fusion                                        |
| `system.ammo`              | Mapear            | `system.ammo`          | Referência de ammo vinculada                                     |
| `system.baseItem`          | Mapear            | `system.baseItem`      | Slug canônico (longsword)                                        |
| `system.bonus.value`       | Mapear            | `system.bonus`         | Bônus de item (+X)                                               |
| `system.bonusDamage.value` | Mapear            | `system.bonusDamage`   | Bônus de dano fixo                                               |
| `system.bulk.value`        | Mapear            | `system.bulk`          | Unidade de encumbrance PF2E                                      |
| `system.category`          | Mapear            | `system.category`      | simple / martial / advanced                                      |
| `system.damage`            | Mapear            | `system.damage`        | damageType + dice + die                                          |
| `system.description.value` | Mapear (filtrado) | `system.description`   | Texto lore descritivo — ORC ok; ver nota abaixo                  |
| `system.group`             | Mapear            | `system.weaponGroup`   | club / sword / bow etc. — afeta critical specialization          |
| `system.hardness`          | Mapear            | `system.hardness`      | Para itens com HP                                                |
| `system.hp`                | Mapear            | `system.hp`            | HP do item (armas quebráveis)                                    |
| `system.level.value`       | Mapear            | `system.level`         | Nível do item (0 = base)                                         |
| `system.material`          | Mapear            | `system.material`      | grade + type (cold iron, silver…)                                |
| `system.price.value`       | Mapear            | `system.price`         | { gp, sp, cp }                                                   |
| `system.publication`       | Manter            | `system.publication`   | license/remaster/title — obrigatório para atribuição             |
| `system.quantity`          | Mapear            | `system.quantity`      | Stack count                                                      |
| `system.range`             | Mapear            | `system.range`         | null = melee; número = range em ft                               |
| `system.reload.value`      | Mapear            | `system.reload`        | "-" = sem reload                                                 |
| `system.rules`             | Transformar       | `system.rules`         | Ver `analysis/03-rules-elements.md`                              |
| `system.runes`             | Mapear            | `system.runes`         | potency + striking + property[]                                  |
| `system.size`              | Mapear            | `system.size`          | med / sm / lg / tiny / huge                                      |
| `system.splashDamage`      | Mapear            | `system.splashDamage`  | Para armas de splash                                             |
| `system.traits.rarity`     | Mapear            | `system.traits.rarity` | common/uncommon/rare/unique                                      |
| `system.traits.value`      | Mapear            | `system.traits.value`  | Array de slugs de trait                                          |
| `system.usage.value`       | Mapear            | `system.usage`         | held-in-one-hand, worn, etc.                                     |

**Descartados (apenas para armas):** `system.containerId`, `system.expend`, `system.grade`
(campos de estado de ator não relevantes no compendium).

---

## 2. Exemplo 2 — Magia: Fireball

**Arquivo:** `vendor/pf2e/packs/pf2e/spells/spells/rank-3/fireball.json`

```json
{
  "_id": "sxQZ6yqTn0czJxVd",
  "img": "icons/magic/fire/projectile-fireball-orange-yellow.webp",
  "name": "Fireball",
  "type": "spell",
  "system": {
    "area": { "type": "burst", "value": 20 },
    "cost": { "value": "" },
    "counteraction": false,
    "damage": {
      "0": {
        "applyMod": false,
        "category": null,
        "formula": "6d6",
        "kinds": ["damage"],
        "materials": [],
        "type": "fire"
      }
    },
    "defense": { "save": { "basic": true, "statistic": "reflex" } },
    "description": {
      "value": "<p>A roaring blast of fire...</p><hr/><p><strong>Heightened (+1)</strong> The damage increases by 2d6.</p>"
    },
    "duration": { "sustained": false, "value": "" },
    "heightening": { "area": 0, "damage": { "0": "2d6" }, "interval": 1, "type": "interval" },
    "level": { "value": 3 },
    "publication": { "license": "ORC", "remaster": true, "title": "Pathfinder Player Core" },
    "range": { "value": "500 feet" },
    "requirements": "",
    "rules": [],
    "target": { "value": "" },
    "time": { "value": "2" },
    "traits": {
      "rarity": "common",
      "traditions": ["arcane", "primal"],
      "value": ["concentrate", "fire", "manipulate"]
    }
  }
}
```

### Mapeamento campo a campo — spell

| Campo PF2E                 | Status Fusion     | Campo Fusion               | Notas                                            |
| -------------------------- | ----------------- | -------------------------- | ------------------------------------------------ |
| `_id`                      | Descartar         | —                          | Novo UUID Fusion                                 |
| `img`                      | Substituir        | `img` → placeholder        | Arte proprietária                                |
| `name`                     | Mapear            | `name`                     | ORC ok                                           |
| `type`                     | Mapear            | `type`                     | "spell"                                          |
| `system.area`              | Mapear            | `system.area`              | type (burst/cone/line/emanation) + value em ft   |
| `system.cost.value`        | Mapear            | `system.cost`              | Material component cost                          |
| `system.counteraction`     | Mapear            | `system.counteraction`     | bool para contramágica                           |
| `system.damage`            | Mapear            | `system.damage`            | Mapa keyed; cada entrada: formula + type + kinds |
| `system.defense`           | Mapear            | `system.defense`           | save.statistic (reflex/fort/will) + basic        |
| `system.description.value` | Mapear (filtrado) | `system.description`       | HTML com texto ORC ok; ver nota de lore          |
| `system.duration`          | Mapear            | `system.duration`          | sustained + value textual                        |
| `system.heightening`       | Mapear            | `system.heightening`       | type=interval: intervalo + delta por rank        |
| `system.level.value`       | Mapear            | `system.level`             | Rank da magia (1-10)                             |
| `system.publication`       | Manter            | `system.publication`       | Atribuição obrigatória                           |
| `system.range.value`       | Mapear            | `system.range`             | String: "touch", "30 feet", etc.                 |
| `system.requirements`      | Mapear            | `system.requirements`      | String de requisitos                             |
| `system.rules`             | Transformar       | `system.rules`             | Ver análise de rule elements                     |
| `system.target.value`      | Mapear            | `system.target`            | String descritiva do alvo                        |
| `system.time.value`        | Mapear            | `system.castTime`          | "1", "2", "3" actions ou "reaction"              |
| `system.traits.rarity`     | Mapear            | `system.traits.rarity`     |                                                  |
| `system.traits.traditions` | Mapear            | `system.traits.traditions` | arcane/divine/occult/primal                      |
| `system.traits.value`      | Mapear            | `system.traits.value`      | concentrate, manipulate, etc.                    |

**Descartados:** `system.overlays` (overrides de variante — transformados em documentos separados no Fusion se necessário).

---

## 3. Exemplo 3 — Monstro (NPC Actor): Skeleton Guard

**Arquivo:** `vendor/pf2e/packs/pf2e/pathfinder-monster-core/skeleton-guard.json`

```json
{
  "_id": "trchDxbDR2TiPMxT",
  "img": "systems/pf2e/icons/default-icons/npc.svg",
  "name": "Skeleton Guard",
  "type": "npc",
  "system": {
    "abilities": {
      "str": { "mod": 3 }, "dex": { "mod": 4 }, "con": { "mod": 0 },
      "int": { "mod": -4 }, "wis": { "mod": 0 }, "cha": { "mod": 0 }
    },
    "attributes": {
      "ac": { "details": "", "value": 16 },
      "hp": { "details": "void healing", "max": 4, "temp": 0, "value": 4 },
      "immunities": [
        { "type": "death-effects" }, { "type": "disease" },
        { "type": "paralyzed" }, { "type": "poison" }, { "type": "unconscious" }
      ],
      "resistances": [
        { "type": "cold", "value": 5 }, { "type": "electricity", "value": 5 },
        { "type": "fire", "value": 5 }, { "type": "piercing", "value": 5 }
      ],
      "speed": { "otherSpeeds": [], "value": 25 }
    },
    "details": {
      "level": { "value": -1 },
      "languages": { "value": [], "details": "" },
      "publicNotes": "<p>The most common skeletal minions...</p>",
      "publication": { "license": "ORC", "remaster": true, "title": "Pathfinder Monster Core" }
    },
    "initiative": { "statistic": "perception" },
    "perception": { "details": "", "mod": 6, "senses": [{ "type": "darkvision" }] },
    "saves": {
      "fortitude": { "value": 2 }, "reflex": { "value": 9 }, "will": { "value": 2 }
    },
    "skills": { "acr": { "base": 8 }, "ath": { "base": 5 } },
    "traits": {
      "rarity": "common",
      "size": { "value": "med" },
      "value": ["mindless", "skeleton", "undead", "unholy"]
    }
  },
  "items": [
    { "type": "weapon", "name": "Scimitar", "system": { ... } },
    { "type": "weapon", "name": "Shortbow", "system": { ... } },
    { "type": "melee", "name": "Scimitar", "system": { ... } },
    { "type": "action", "name": "Darkvision", "system": { ... } }
  ]
}
```

### Mapeamento campo a campo — npc (actor)

| Campo PF2E                      | Status Fusion     | Campo Fusion                    | Notas                                                                |
| ------------------------------- | ----------------- | ------------------------------- | -------------------------------------------------------------------- |
| `_id`                           | Descartar         | —                               | Novo UUID Fusion                                                     |
| `img`                           | Substituir        | `img` → placeholder             | Arte proprietária da Paizo — path `systems/pf2e/...` NUNCA importado |
| `name`                          | Mapear            | `name`                          | ORC ok                                                               |
| `type`                          | Mapear            | `type`                          | "npc" → "Actor" Fusion com subtype "npc"                             |
| `system.abilities`              | Mapear            | `system.abilities`              | STR/DEX/CON/INT/WIS/CHA com mod                                      |
| `system.attributes.ac.value`    | Mapear            | `system.attributes.ac`          | AC total (NPC usa valor fixo, não derivado)                          |
| `system.attributes.hp`          | Mapear            | `system.attributes.hp`          | max + value + details (ex: "void healing")                           |
| `system.attributes.immunities`  | Mapear            | `system.attributes.immunities`  | Array de {type, exceptions}                                          |
| `system.attributes.resistances` | Mapear            | `system.attributes.resistances` | Array de {type, value}                                               |
| `system.attributes.weaknesses`  | Mapear            | `system.attributes.weaknesses`  | Idem, quando presente                                                |
| `system.attributes.speed`       | Mapear            | `system.attributes.speed`       | value (ft) + otherSpeeds[]                                           |
| `system.attributes.allSaves`    | Mapear            | `system.attributes.allSaves`    | Nota de save especial                                                |
| `system.details.level.value`    | Mapear            | `system.details.level`          | Nível do monstro (-1 a 25)                                           |
| `system.details.languages`      | Mapear            | `system.details.languages`      | Idiomas + details                                                    |
| `system.details.publicNotes`    | Mapear (filtrado) | `system.details.publicNotes`    | HTML ORC ok; lore narrativo ver nota                                 |
| `system.details.privateNotes`   | Descartar         | —                               | Notas do editor, não relevantes                                      |
| `system.details.blurb`          | Mapear            | `system.details.blurb`          | Frase resumida                                                       |
| `system.details.publication`    | Manter            | `system.details.publication`    | Atribuição obrigatória                                               |
| `system.initiative.statistic`   | Mapear            | `system.initiative`             | "perception" ou skill slug                                           |
| `system.perception`             | Mapear            | `system.perception`             | mod + senses[] + details                                             |
| `system.saves`                  | Mapear            | `system.saves`                  | fort/ref/will com value + saveDetail                                 |
| `system.skills`                 | Mapear            | `system.skills`                 | skill slug → { base }                                                |
| `system.traits.rarity`          | Mapear            | `system.traits.rarity`          |                                                                      |
| `system.traits.size.value`      | Mapear            | `system.traits.size`            | tiny/sm/med/lg/huge/grg                                              |
| `system.traits.value`           | Mapear            | `system.traits.value`           | mindless, undead, etc.                                               |
| `items`                         | Transformar       | `items`                         | Array de Items embutidos; ver abaixo                                 |

**Items embutidos no NPC:**

| Tipo de item embutido | Ação                | Notas                                            |
| --------------------- | ------------------- | ------------------------------------------------ |
| `melee`               | Mapear              | Estatísticas de ataque melee (to-hit, dano, MAP) |
| `ranged`              | Mapear              | Estatísticas de ataque ranged                    |
| `weapon`              | Mapear              | Arma equipada (mesmos campos de weapon)          |
| `action`              | Mapear              | Ações especiais e habilidades                    |
| `spell`               | Mapear              | Magias inatas                                    |
| `spellcastingEntry`   | Mapear parcialmente | Entrada de spellcasting (DC, mod, tradition)     |
| `effect`              | Mapear              | Efeitos permanentes da criatura                  |
| `lore`                | Mapear              | Skills de Lore específicas                       |

**Descartados em NPC:** `system.resources.focus` (derivado em runtime), campos de estado volátil (`resources.initiative`, `hp.temp` — zeramos ao importar).

---

## 4. Análise de Licença — O que pode entrar no Fusion

### Campos PERMITIDOS (ORC / OGL)

- Todos os campos mecânicos: `damage`, `ac`, `hp`, `saves`, `abilities`, `traits`,
  `skills`, `rules`, `level`, `price`, `bulk`, `category`, `group`, `range`, etc.
- `system.description.value` com **texto de regras puras** (ex: "6d6 fire damage,
  basic Reflex save, heightened (+1) increases by 2d6") — isso é mecânica, coberta
  pela ORC.
- `system.publication` — obrigatório manter para atribuição ORC/OGL.

### Campos com ANÁLISE CASO A CASO

- `system.description.value` com **lore narrativo** (ex: "Longswords are also
  known as arming swords…", "The most common skeletal minions are mere guardians.")
  — texto de ambientação do mundo Golarion pode ser IP da Paizo. O importer deve
  oferecer flag `--strip-lore` que substitui por placeholder.
- `system.details.publicNotes` em NPCs — contém narrativa de bestiary; mesmo critério.

### Campos PROIBIDOS

- `img` com paths `systems/pf2e/icons/...` ou qualquer arte do repositório pf2e —
  ícones e tokens são arte proprietária Paizo. O importer **substitui** todos por:
  - Armas: `/icons/placeholder-weapon.svg`
  - Magias: `/icons/placeholder-spell.svg`
  - NPCs: `/icons/placeholder-npc.svg`
  - Itens: `/icons/placeholder-item.svg`
- Tokens de monstros (não presentes nos JSONs de pack, mas proibidos se existirem).

### Metadados de publicação — obrigações ORC

O campo `system.publication` (`license`, `remaster`, `title`) deve ser preservado
em todos os documentos importados. O Fusion exibirá essa atribuição no compendium
browser (specs/16 § Atribuição).

---

## 5. Resumo de campos descartados globalmente

| Campo                               | Razão                                                               |
| ----------------------------------- | ------------------------------------------------------------------- |
| `_id` original                      | Regenerado pelo Fusion (evita colisão)                              |
| `img` (art paths)                   | Arte proprietária Paizo — substituído por placeholder               |
| `system.containerId`                | Estado de ator; irrelevante em pack                                 |
| `system.hp.temp`                    | Estado volátil; zerado ao importar                                  |
| `system.details.privateNotes`       | Notas internas do editor                                            |
| `folder`                            | Estrutura de pasta do Foundry; Fusion usa organização própria       |
| `sort`                              | Ordem de UI; regenerada                                             |
| `_stats` (compendiumSource interno) | Referências cruzadas internas do pf2e; substituídas por UUID Fusion |
