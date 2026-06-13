# 03 — Rule Elements: Análise Crítica para o Motor de Effects M3-A

> Gerado em: 2026-06-12
> Script: `analysis/scan-rules.mjs`
> Escopo: 21 packs essenciais para o MVP (equipment, spells, feats, class-features,
> monster-core, bestiary-effects, ancestries, heritages, backgrounds, conditions, etc.)

---

## 1. Resultado do scan

| Métrica                               | Valor         |
| ------------------------------------- | ------------- |
| Documentos escaneados                 | 20 458        |
| Documentos com regras                 | 8 511 (41,6%) |
| Total de entradas em `system.rules[]` | 19 753        |
| Chaves únicas de rule element         | 38            |

---

## 2. Tabela de frequência completa

| Rank | Chave                  | Ocorrências | % do total | % acumulado |
| ---- | ---------------------- | ----------- | ---------- | ----------- |
| 1    | **FlatModifier**       | 4 537       | 23,0%      | 23,0%       |
| 2    | **RollOption**         | 2 033       | 10,3%      | 33,3%       |
| 3    | **ItemAlteration**     | 1 803       | 9,1%       | 42,4%       |
| 4    | **ActiveEffectLike**   | 1 667       | 8,4%       | 50,8%       |
| 5    | **GrantItem**          | 1 512       | 7,7%       | 58,5%       |
| 6    | **ChoiceSet**          | 1 252       | 6,3%       | 64,8%       |
| 7    | **Note**               | 881         | 4,5%       | 69,3%       |
| 8    | **DamageDice**         | 876         | 4,4%       | 73,7%       |
| 9    | **Resistance**         | 776         | 3,9%       | 77,6%       |
| 10   | **Aura**               | 545         | 2,8%       | 80,4%       |
| 11   | AdjustModifier         | 447         | 2,3%       | 82,7%       |
| 12   | Strike                 | 374         | 1,9%       | 84,6%       |
| 13   | AdjustDegreeOfSuccess  | 341         | 1,7%       | 86,3%       |
| 14   | BaseSpeed              | 330         | 1,7%       | 88,0%       |
| 15   | AdjustStrike           | 262         | 1,3%       | 89,3%       |
| 16   | TempHP                 | 236         | 1,2%       | 90,5%       |
| 17   | Sense                  | 188         | 1,0%       | 91,4%       |
| 18   | DamageAlteration       | 186         | 0,9%       | 92,4%       |
| 19   | Weakness               | 177         | 0,9%       | 93,3%       |
| 20   | FastHealing            | 176         | 0,9%       | 94,2%       |
| 21   | TokenLight             | 149         | 0,8%       | 94,9%       |
| 22   | CreatureSize           | 120         | 0,6%       | 95,5%       |
| 23   | MartialProficiency     | 112         | 0,6%       | 96,1%       |
| 24   | CriticalSpecialization | 111         | 0,6%       | 96,6%       |
| 25   | BattleForm             | 104         | 0,5%       | 97,2%       |
| 26   | Immunity               | 91          | 0,5%       | 97,6%       |
| 27   | TokenMark              | 86          | 0,4%       | 98,1%       |
| 28   | ActorTraits            | 78          | 0,4%       | 98,5%       |
| 29   | RollTwice              | 78          | 0,4%       | 98,9%       |
| 30   | EphemeralEffect        | 77          | 0,4%       | 99,3%       |
| 31   | TokenEffectIcon        | 50          | 0,3%       | 99,5%       |
| 32   | CraftingAbility        | 23          | 0,1%       | 99,6%       |
| 33   | DexterityModifierCap   | 18          | 0,1%       | 99,7%       |
| 34   | SubstituteRoll         | 18          | 0,1%       | 99,8%       |
| 35   | SpecialStatistic       | 15          | 0,1%       | 99,9%       |
| 36   | MultipleAttackPenalty  | 11          | 0,1%       | 99,9%       |
| 37   | LoseHitPoints          | 7           | 0,0%       | 100,0%      |
| 38   | SpecialResource        | 6           | 0,0%       | 100,0%      |

---

## 3. Top 10 — Detalhamento por rule element

### 1. FlatModifier (4 537 — 23,0%)

Aplica um modificador numérico fixo a um selector (perícia, atributo, saving throw,
ataque etc.). É o building block mais fundamental do sistema de modifiers PF2E.

**Exemplo:**

```json
{
  "key": "FlatModifier",
  "selector": "arcana",
  "type": "item",
  "value": 3
}
```

**Campos relevantes:**

- `selector` — target do modifier (perícia, "saving-throw:will", "attack", etc.)
- `type` — tipo do bonus (item / status / circumstance / untyped)
- `value` — número fixo (pode ser negativo)
- `predicate` — condição de aplicação (opcional)

**Impacto no motor M3-A:** Exige o sistema de **modifier stacking** com regras de
capping por tipo (somente o maior bônus de mesmo tipo conta, com exceção de
untyped). Este é o RE mais crítico — sem ele, feitos, itens e status não funcionam.

**Packs principais:** equipment(995), feats(586), feat-effects(548), equipment-effects(540)

---

### 2. RollOption (2 033 — 10,3%)

Define uma flag booleana no ator que outras regras podem usar como predicado. Pode
ser toggleável pelo usuário ou automático.

**Exemplo:**

```json
{
  "key": "RollOption",
  "label": "PF2E.SpecificRule.Equipment.AlchemistGoggles.RollOptionLabel",
  "option": "alchemist-goggles-failure",
  "toggleable": true
}
```

**Campos relevantes:**

- `option` — slug da flag (ex: "alchemist-goggles-failure")
- `toggleable` — se aparece como toggle na UI
- `domain` — escopo da flag (all, item, attack, etc.)
- `predicate` — condição para a flag estar ativa

**Impacto no motor M3-A:** Exige sistema de **flags de roll context** que se
propagam durante a resolução de checks. Integra com FlatModifier via predicados.

**Packs principais:** feats(541), equipment(314), pathfinder-monster-core(310)

---

### 3. ItemAlteration (1 803 — 9,1%)

Modifica campos de um item (description, traits, tags) em tempo de execução.
Principal mecanismo de customização de itens por feats e equipamentos.

**Exemplo:**

```json
{
  "key": "ItemAlteration",
  "mode": "add",
  "predicate": ["item:trait:curse"],
  "property": "description",
  "value": [{ "text": "PF2E.SpecificRule.Staff.AccursedStaff.Note" }]
}
```

**Properties mais comuns:** other-tags(605), description(529), traits(412),
pd-recovery-dc(35), runes-potency(27)

**Modes:** add(1529), upgrade(92), override(84), downgrade(47), remove(44)

**Impacto no motor M3-A:** Exige sistema de **item patch** que aplica alterações
sem mutar o documento original. Complexidade média — necessário para itens com
múltiplos efeitos condicional.

**Packs principais:** feats(948), class-features(405), equipment(90)

---

### 4. ActiveEffectLike (1 667 — 8,4%)

Modifica caminhos arbitrários no `system` do ator (como `system.abilities.str.mod`).
Equivalente ao ActiveEffect do Foundry core, mas operando no schema PF2E.

**Exemplo:**

```json
{
  "key": "ActiveEffectLike",
  "mode": "add",
  "path": "system.abilities.{item|system.apex.attribute}.mod",
  "value": 1
}
```

**Modes:** upgrade(745), override(472), add(429), subtract(13), downgrade(5)

**Impacto no motor M3-A:** Exige sistema de **path-based mutations** no actor data
durante o ciclo de `prepareData()`. Os paths suportam interpolação dinâmica
(`{item|...}`). Alta prioridade — afeta diretamente as abilities e stats derivadas.

**Packs principais:** feats(702), class-features(454), pathfinder-monster-core-2(80)

---

### 5. GrantItem (1 512 — 7,7%)

Concede automaticamente outro item ao ator (feat, condition, efeito) quando o item
pai está presente.

**Exemplo:**

```json
{
  "key": "GrantItem",
  "uuid": "Compendium.pf2e.conditionitems.Item.Stupefied",
  "inMemoryOnly": true,
  "predicate": [{ "not": "self:trait:dwarf" }],
  "alterations": [{ "mode": "override", "property": "badge-value", "value": 4 }]
}
```

**Campos relevantes:**

- `uuid` — referência ao item a conceder (UUID do Foundry, precisa ser traduzido para UUID Fusion)
- `inMemoryOnly` — não persiste no banco, apenas no runtime
- `alterations` — modificações adicionais no item concedido

**Impacto no motor M3-A:** Exige sistema de **item granting** com resolução de UUID
cross-compendium. As referências UUID precisam ser atualizadas durante a importação
para apontar para packs Fusion. Alta complexidade, mas fundamental para feats e
class features.

**Packs principais:** feats(616), class-features(382), backgrounds(132), heritages(84)

---

### 6. ChoiceSet (1 252 — 6,3%)

Apresenta uma escolha ao usuário na criação/nível do personagem e armazena a
seleção como flag.

**Exemplo:**

```json
{
  "key": "ChoiceSet",
  "flag": "skill",
  "prompt": "PF2E.SpecificRule.Prompt.Skill",
  "choices": [
    { "label": "PF2E.Skill.Deception", "value": "deception" },
    { "label": "PF2E.Skill.Occultism", "value": "occultism" }
  ],
  "adjustName": false
}
```

**Impacto no motor M3-A:** Exige UI de escolha durante build do personagem e
sistema de persistência da seleção. Integra com GrantItem (choice → grant). Pode
ser deferido para M5 se as escolhas forem fixas nos packs importados.

**Packs principais:** feats(288), equipment-effects(229), feat-effects(196)

---

### 7. Note (881 — 4,5%)

Adiciona nota de regra a uma roll (ex: "Em hit, aplica condição X").

**Exemplo:**

```json
{
  "key": "Note",
  "selector": "{item|id}-ranged-damage",
  "outcome": ["success"],
  "title": "PF2E.AmmunitionNotes.AntlerArrow.Title",
  "text": "PF2E.AmmunitionNotes.AntlerArrow.Text"
}
```

**Impacto no motor M3-A:** Sistema de **roll notes** exibidas no chat quando
condição de outcome é atendida. Complexidade baixa — apenas exibição de texto, sem
efeito mecânico automático.

---

### 8. DamageDice (876 — 4,4%)

Adiciona dados de dano extras a uma roll de dano.

**Exemplo:**

```json
{
  "key": "DamageDice",
  "selector": "strike-damage",
  "diceNumber": 1,
  "dieSize": "d6",
  "damageType": "poison",
  "predicate": ["item:category:unarmed", "twin-venom-strike"]
}
```

**Impacto no motor M3-A:** Exige sistema de **damage dice accumulation** no cálculo
de dano (adicionar 1d6 poison ao strike). Integra com o motor de damage types e
predicados. Alta prioridade para combate funcional.

---

### 9. Resistance (776 — 3,9%)

Define resistência a tipo de dano.

**Exemplo:**

```json
{
  "key": "Resistance",
  "type": "persistent-damage",
  "value": 3
}
```

**Impacto no motor M3-A:** Parte do sistema IWR (Immunity/Weakness/Resistance).
Aplicado durante `applyDamage()`. Pode usar `value: "half"` além de numérico.

---

### 10. Aura (545 — 2,8%)

Define aura com raio, efeitos e condições em tokens próximos.

**Exemplo:**

```json
{
  "key": "Aura",
  "radius": 30,
  "level": 20,
  "predicate": [{ "not": "magical-commanders-banner:arcane-standard-greater" }]
}
```

**Impacto no motor M3-A:** Exige integração com o sistema de canvas (tokens,
medição de distância). Alta complexidade — pode ser deferido para M5 com fallback
de "aura não suportada".

---

## 4. Conjunto que cobre 80% das ocorrências

Os **10 primeiros** rule elements cobrem 80,4% de todas as ocorrências.
O subconjunto **mínimo para cobertura de 80%** é:

```
FlatModifier, RollOption, ItemAlteration, ActiveEffectLike,
GrantItem, ChoiceSet, Note, DamageDice, Resistance, Aura
```

Para cobertura de **90%**, adicionar:

```
AdjustModifier, Strike, AdjustDegreeOfSuccess, BaseSpeed, AdjustStrike, TempHP
```

---

## 5. Recomendações de prioridade para M3-A

### Tier 1 — Implementar no M3-A (bloqueadores de combate básico)

| RE                   | Razão                                                   |
| -------------------- | ------------------------------------------------------- |
| **FlatModifier**     | Toda feat e item depende; sem ele, bônus não funcionam  |
| **ActiveEffectLike** | Modifica abilities/stats derivadas — core do personagem |
| **RollOption**       | Flags de contexto para predicados — usado em 1/3 dos RE |
| **DamageDice**       | Dano extra por feats e itens — combate                  |
| **Resistance**       | IWR — apply damage não funciona sem                     |
| **Note**             | Baixa complexidade, alto valor visual para GMs          |

### Tier 2 — Implementar no M3-B / M4

| RE                        | Razão                                                           |
| ------------------------- | --------------------------------------------------------------- |
| **GrantItem**             | Complexo (UUID cross-compendium); crítico para feats com grants |
| **ItemAlteration**        | Necessário para muitos itens mágicos                            |
| **ChoiceSet**             | Necessário para build de personagem                             |
| **AdjustModifier**        | Refina FlatModifier — mais contexto                             |
| **Strike**                | Attacks de NPCs com múltiplos attacks                           |
| **BaseSpeed**             | Speed modificada por condições e feats                          |
| **AdjustDegreeOfSuccess** | Crítico para mecânicas de success/crit (hero points, etc.)      |
| **TempHP**                | HP temporário — comum em spells e feats                         |
| **DamageAlteration**      | Muda tipo de dano (DamageAlteration.override)                   |

### Tier 3 — Deferido para M5 / post-MVP

| RE                                  | Razão                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| **Aura**                            | Requer integração com canvas                           |
| **BattleForm**                      | Polimorfismo complexo (Wild Shape)                     |
| **CreatureSize**                    | Muda size token — canvas dependency                    |
| **TokenLight**                      | Apenas visual                                          |
| **TokenMark / TokenEffectIcon**     | Apenas visual                                          |
| **MartialProficiency**              | Específico de classes; tratar como FlatModifier em MVP |
| **CriticalSpecialization**          | Efeitos de crit por weapon group                       |
| **RollTwice**                       | Fortune/Misfortune — adicionar depois                  |
| **SubstituteRoll**                  | Raro (18 ocorrências)                                  |
| **SpecialStatistic**                | Raro (15 ocorrências)                                  |
| **MultipleAttackPenalty**           | MAP customizado — 11 ocorrências                       |
| **LoseHitPoints / SpecialResource** | Raro, casos especiais                                  |

### Rule Elements sem suporte (fallback)

Para rule elements não suportados, o importer deve:

1. Incluir o documento no pack Fusion com o RE original intacto em `system.rules`.
2. Adicionar `"_unsupported": true` ao RE específico.
3. O motor de effects do Fusion ignora entradas `_unsupported` sem erro.
4. O relatório de importação lista quais documentos têm REs não suportados.

---

## 6. Observações sobre predicados

Os predicados (`predicate[]`) são usados em **83%** dos FlatModifiers e RollOptions.
O sistema de predicados do PF2E usa um mini-DSL:

```js
// Exemplos de predicados
["item:trait:curse"][{ not: "self:trait:dwarf" }]["target:trait:undead"]["mode:encounter"]; // item tem trait // ator NÃO é dwarf // alvo tem trait // em modo de encontro
```

O motor de effects do Fusion **deve** implementar a resolução de predicados
antes de implementar qualquer RE, pois sem predicados os REs serão aplicados
incondicionalmente — gerando resultados incorretos.

---

## 7. UUID cross-compendium — problema chave para GrantItem

Os campos `uuid` em `GrantItem` apontam para o formato Foundry:

```
Compendium.pf2e.conditionitems.Item.Stupefied
Compendium.pf2e.spells-srd.Item.XXX
```

O importer deve construir um **mapa de UUID** durante a importação:

```
pf2e UUID → Fusion UUID
```

Este mapa é persistido em `packs/fusion-uuid-map.json` e usado pelo motor de
effects em runtime para resolver `GrantItem` e links `@UUID[...]` nas descriptions.
