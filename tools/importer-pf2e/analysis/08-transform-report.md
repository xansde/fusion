# 08 — Relatório de Transformação PF2E → Fusion

> Gerado em: 2026-07-05
> Script: `src/transform.mjs --system pf2e` v0.1.0
> Fonte: vendor/pf2e packs/pf2e branch v14-dev

---

## 1. Sumário por pack

| Pack | Total | Transformados | Excluídos | Parciais | Completos | Substituições de arte |
|---|---|---|---|---|---|---|
| **conditions** | 43 | 43 | 0 | 9 | 34 | 43 |
| **equipment** | 5645 | 5645 | 0 | 316 | 5329 | 5645 |
| **spells** | 1796 | 1796 | 0 | 5 | 1791 | 1796 |
| **pathfinder-monster-core** | 492 | 492 | 0 | 0 | 492 | 6695 |
| **classes** | 27 | 27 | 0 | 1 | 26 | 27 |
| **class-features** | 841 | 841 | 0 | 400 | 441 | 841 |
| **feats** | 5987 | 5987 | 0 | 1210 | 4777 | 5987 |
| **ancestries** | 50 | 50 | 0 | 11 | 39 | 50 |
| **heritages** | 322 | 322 | 0 | 107 | 215 | 322 |
| **backgrounds** | 495 | 495 | 0 | 68 | 427 | 495 |
| **TOTAL** | **15698** | **15698** | **0** | **2127** | **13571** | **21901** |

---

## 2. Cobertura de Rule Elements

**Cobertura total:** 7592/11770 (64.5% suportadas integralmente)

| Rule Key | Total | Suportadas | Parciais | Não suportadas | Status |
|---|---|---|---|---|---|
| `FlatModifier` | 2094 | 2094 | 0 | 0 | ✅ suportada |
| `ItemAlteration` | 1542 | 0 | 1542 | 0 | ⚠️ parcial |
| `RollOption` | 1396 | 1396 | 0 | 0 | ✅ suportada |
| `ActiveEffectLike` | 1391 | 1096 | 295 | 0 | ✅ suportada |
| `GrantItem` | 1253 | 1253 | 0 | 0 | ✅ suportada |
| `ChoiceSet` | 620 | 0 | 0 | 620 | ❌ não suportada |
| `Note` | 614 | 614 | 0 | 0 | ✅ suportada |
| `DamageDice` | 388 | 388 | 0 | 0 | ✅ suportada |
| `Resistance` | 359 | 359 | 0 | 0 | ✅ suportada |
| `AdjustDegreeOfSuccess` | 248 | 0 | 0 | 248 | ❌ não suportada |
| `Aura` | 234 | 0 | 0 | 234 | ❌ não suportada |
| `AdjustModifier` | 224 | 0 | 224 | 0 | ⚠️ parcial |
| `Strike` | 223 | 0 | 0 | 223 | ❌ não suportada |
| `BaseSpeed` | 173 | 173 | 0 | 0 | ✅ suportada |
| `MartialProficiency` | 109 | 109 | 0 | 0 | ✅ suportada |
| `Sense` | 108 | 108 | 0 | 0 | ✅ suportada |
| `AdjustStrike` | 102 | 0 | 0 | 102 | ❌ não suportada |
| `DamageAlteration` | 102 | 0 | 0 | 102 | ❌ não suportada |
| `TokenLight` | 101 | 0 | 0 | 101 | ❌ não suportada |
| `CriticalSpecialization` | 100 | 0 | 0 | 100 | ❌ não suportada |
| `CreatureSize` | 61 | 0 | 0 | 61 | ❌ não suportada |
| `ActorTraits` | 54 | 0 | 0 | 54 | ❌ não suportada |
| `TokenEffectIcon` | 48 | 0 | 0 | 48 | ❌ não suportada |
| `EphemeralEffect` | 43 | 0 | 0 | 43 | ❌ não suportada |
| `Immunity` | 41 | 0 | 41 | 0 | ⚠️ parcial |
| `FastHealing` | 37 | 0 | 0 | 37 | ❌ não suportada |
| `Weakness` | 28 | 0 | 0 | 28 | ❌ não suportada |
| `CraftingAbility` | 21 | 0 | 0 | 21 | ❌ não suportada |
| `DexterityModifierCap` | 12 | 0 | 0 | 12 | ❌ não suportada |
| `SpecialStatistic` | 12 | 0 | 0 | 12 | ❌ não suportada |
| `SubstituteRoll` | 9 | 0 | 0 | 9 | ❌ não suportada |
| `RollTwice` | 7 | 0 | 0 | 7 | ❌ não suportada |
| `MultipleAttackPenalty` | 7 | 0 | 0 | 7 | ❌ não suportada |
| `SpecialResource` | 6 | 0 | 0 | 6 | ❌ não suportada |
| `TempHP` | 2 | 2 | 0 | 0 | ✅ suportada |
| `LoseHitPoints` | 1 | 0 | 0 | 1 | ❌ não suportada |

---

## 2.1 Política de prosa de flavor (clean-room)

Nomes de itens e campos **mecânicos** estruturados (`system.damage`, `traits`,
`level`, `price`, `category`, `rules[]`, etc.) são Open Game Content (ORC) e
**permanecem** nos packs. A **prosa** de `system.description` (e notas de flavor:
`gmNotes`, `publicNotes`, `privateNotes`) é Reserved Material sob copyright da
Paizo e é **descartada** (zerada) em todos os normalizadores de item, espelhando
o tratamento já aplicado a `details.publicNotes`/`blurb` em NPCs.

Para condições, o efeito mecânico vive em `rules[]`; apenas a prosa sai.
Itens embarcados (ataques/equipamento de NPC) recebem o mesmo strip.

Referências: spec 26 §D4, REQ-LEG-010. Guarda de regressão:
`src/__tests__/transform.test.mjs` (nenhum `system.description` de prosa nos packs).

---

## 3. Placeholders de arte aplicados

Todos os campos de arte foram substituídos por placeholders livres.
Nenhum arquivo de imagem do repositório pf2e é incluído.

| Pack | Substituições totais |
|---|---|
| conditions | 43 |
| equipment | 5645 |
| spells | 1796 |
| pathfinder-monster-core | 6695 |
| classes | 27 |
| class-features | 841 |
| feats | 5987 |
| ancestries | 50 |
| heritages | 322 |
| backgrounds | 495 |
| **TOTAL** | **21901** |

---

## 5. Tabela de cobertura declarativa

| Rule Key | Estado | Conversor |
|---|---|---|
| `FlatModifier` | ✅ supported | `convertFlatModifier` |
| `ActiveEffectLike` | ✅ supported | `convertActiveEffectLike` |
| `RollOption` | ✅ supported | `convertRollOption` |
| `Note` | ✅ supported | `convertNote` |
| `DamageDice` | ✅ supported | `convertDamageDice` |
| `Resistance` | ✅ supported | `convertResistance` |
| `GrantItem` | ✅ supported | `convertGrantItem` |
| `Sense` | ✅ supported | `convertSense` |
| `BaseSpeed` | ✅ supported | `convertBaseSpeed` |
| `TempHP` | ✅ supported | `convertTempHP` |
| `MartialProficiency` | ✅ supported | `convertMartialProficiency` |
| `ItemAlteration` | ⚠️ partial | `convertItemAlteration` |
| `AdjustModifier` | ⚠️ partial | `convertAdjustModifier` |
| `Immunity` | ⚠️ partial | `convertImmunity` |
| `ChoiceSet` | ❌ unsupported | `—` |
| `Aura` | ❌ unsupported | `—` |
| `AdjustDegreeOfSuccess` | ❌ unsupported | `—` |
| `Strike` | ❌ unsupported | `—` |
| `AdjustStrike` | ❌ unsupported | `—` |
| `DamageAlteration` | ❌ unsupported | `—` |
| `Weakness` | ❌ unsupported | `—` |
| `FastHealing` | ❌ unsupported | `—` |
| `TokenLight` | ❌ unsupported | `—` |
| `CreatureSize` | ❌ unsupported | `—` |
| `CriticalSpecialization` | ❌ unsupported | `—` |
| `BattleForm` | ❌ unsupported | `—` |
| `TokenMark` | ❌ unsupported | `—` |
| `ActorTraits` | ❌ unsupported | `—` |
| `RollTwice` | ❌ unsupported | `—` |
| `EphemeralEffect` | ❌ unsupported | `—` |
| `TokenEffectIcon` | ❌ unsupported | `—` |
| `CraftingAbility` | ❌ unsupported | `—` |
| `DexterityModifierCap` | ❌ unsupported | `—` |
| `SubstituteRoll` | ❌ unsupported | `—` |
| `SpecialStatistic` | ❌ unsupported | `—` |
| `MultipleAttackPenalty` | ❌ unsupported | `—` |
| `LoseHitPoints` | ❌ unsupported | `—` |
| `SpecialResource` | ❌ unsupported | `—` |
