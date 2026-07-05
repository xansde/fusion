# 08 — Relatório de Transformação SF2E → Fusion

> Gerado em: 2026-07-05
> Script: `src/transform.mjs --system sf2e` v0.1.0
> Fonte: vendor/pf2e packs/sf2e branch v14-dev

---

## 1. Sumário por pack

| Pack | Total | Transformados | Excluídos | Parciais | Completos | Substituições de arte |
|---|---|---|---|---|---|---|
| **conditions** | 3 | 3 | 0 | 0 | 3 | 3 |
| **equipment** | 538 | 538 | 0 | 53 | 485 | 538 |
| **spells** | 159 | 159 | 0 | 0 | 159 | 159 |
| **alien-core-bestiary** | 247 | 247 | 0 | 0 | 247 | 3240 |
| **rulebook-bestiaries** | 46 | 46 | 0 | 0 | 46 | 110 |
| **TOTAL** | **993** | **993** | **0** | **53** | **940** | **4050** |

---

## 2. Cobertura de Rule Elements

**Cobertura total:** 420/703 (59.7% suportadas integralmente)

| Rule Key | Total | Suportadas | Parciais | Não suportadas | Status |
|---|---|---|---|---|---|
| `FlatModifier` | 155 | 155 | 0 | 0 | ✅ suportada |
| `Aura` | 92 | 0 | 0 | 92 | ❌ não suportada |
| `RollOption` | 87 | 87 | 0 | 0 | ✅ suportada |
| `DamageDice` | 64 | 64 | 0 | 0 | ✅ suportada |
| `Note` | 62 | 62 | 0 | 0 | ✅ suportada |
| `ActiveEffectLike` | 48 | 14 | 34 | 0 | ✅ suportada |
| `ItemAlteration` | 29 | 0 | 29 | 0 | ⚠️ parcial |
| `DamageAlteration` | 28 | 0 | 0 | 28 | ❌ não suportada |
| `ChoiceSet` | 27 | 0 | 0 | 27 | ❌ não suportada |
| `Resistance` | 21 | 21 | 0 | 0 | ✅ suportada |
| `AdjustStrike` | 12 | 0 | 0 | 12 | ❌ não suportada |
| `FastHealing` | 12 | 0 | 0 | 12 | ❌ não suportada |
| `Immunity` | 12 | 0 | 12 | 0 | ⚠️ parcial |
| `TokenLight` | 7 | 0 | 0 | 7 | ❌ não suportada |
| `GrantItem` | 6 | 6 | 0 | 0 | ✅ suportada |
| `BaseSpeed` | 6 | 6 | 0 | 0 | ✅ suportada |
| `AdjustModifier` | 6 | 0 | 6 | 0 | ⚠️ parcial |
| `Sense` | 5 | 5 | 0 | 0 | ✅ suportada |
| `Weakness` | 5 | 0 | 0 | 5 | ❌ não suportada |
| `SubstituteRoll` | 4 | 0 | 0 | 4 | ❌ não suportada |
| `TokenEffectIcon` | 3 | 0 | 0 | 3 | ❌ não suportada |
| `AdjustDegreeOfSuccess` | 3 | 0 | 0 | 3 | ❌ não suportada |
| `EphemeralEffect` | 3 | 0 | 0 | 3 | ❌ não suportada |
| `Strike` | 2 | 0 | 0 | 2 | ❌ não suportada |
| `CreatureSize` | 2 | 0 | 0 | 2 | ❌ não suportada |
| `ActorTraits` | 1 | 0 | 0 | 1 | ❌ não suportada |
| `SpecialResource` | 1 | 0 | 0 | 1 | ❌ não suportada |

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
| conditions | 3 |
| equipment | 538 |
| spells | 159 |
| alien-core-bestiary | 3240 |
| rulebook-bestiaries | 110 |
| **TOTAL** | **4050** |

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
