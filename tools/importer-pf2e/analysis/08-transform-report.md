# 08 — Relatório de Transformação PF2E → Fusion

> Gerado em: 2026-07-05
> Script: `src/transform.mjs --system pf2e` v0.1.0
> Fonte: vendor/pf2e packs/pf2e branch v14-dev

---

## 1. Sumário por pack

| Pack | Total | Transformados | Excluídos | Parciais | Completos | Substituições de arte |
|---|---|---|---|---|---|---|
| **classes** | 27 | 27 | 0 | 1 | 26 | 27 |
| **class-features** | 841 | 841 | 0 | 400 | 441 | 841 |
| **TOTAL** | **868** | **868** | **0** | **401** | **467** | **868** |

---

## 2. Cobertura de Rule Elements

**Cobertura total:** 1124/2181 (51.5% suportadas integralmente)

| Rule Key | Total | Suportadas | Parciais | Não suportadas | Status |
|---|---|---|---|---|---|
| `ActiveEffectLike` | 458 | 295 | 163 | 0 | ✅ suportada |
| `ItemAlteration` | 405 | 0 | 405 | 0 | ⚠️ parcial |
| `GrantItem` | 382 | 382 | 0 | 0 | ✅ suportada |
| `ChoiceSet` | 195 | 0 | 0 | 195 | ❌ não suportada |
| `RollOption` | 189 | 189 | 0 | 0 | ✅ suportada |
| `FlatModifier` | 80 | 80 | 0 | 0 | ✅ suportada |
| `AdjustModifier` | 79 | 0 | 79 | 0 | ⚠️ parcial |
| `Note` | 72 | 72 | 0 | 0 | ✅ suportada |
| `Resistance` | 72 | 72 | 0 | 0 | ✅ suportada |
| `AdjustDegreeOfSuccess` | 64 | 0 | 0 | 64 | ❌ não suportada |
| `Strike` | 35 | 0 | 0 | 35 | ❌ não suportada |
| `CriticalSpecialization` | 32 | 0 | 0 | 32 | ❌ não suportada |
| `DamageAlteration` | 18 | 0 | 0 | 18 | ❌ não suportada |
| `MartialProficiency` | 17 | 17 | 0 | 0 | ✅ suportada |
| `DamageDice` | 17 | 17 | 0 | 0 | ✅ suportada |
| `Aura` | 16 | 0 | 0 | 16 | ❌ não suportada |
| `AdjustStrike` | 13 | 0 | 0 | 13 | ❌ não suportada |
| `Immunity` | 7 | 0 | 7 | 0 | ⚠️ parcial |
| `SpecialStatistic` | 7 | 0 | 0 | 7 | ❌ não suportada |
| `Weakness` | 7 | 0 | 0 | 7 | ❌ não suportada |
| `ActorTraits` | 4 | 0 | 0 | 4 | ❌ não suportada |
| `MultipleAttackPenalty` | 4 | 0 | 0 | 4 | ❌ não suportada |
| `CraftingAbility` | 3 | 0 | 0 | 3 | ❌ não suportada |
| `SpecialResource` | 2 | 0 | 0 | 2 | ❌ não suportada |
| `EphemeralEffect` | 2 | 0 | 0 | 2 | ❌ não suportada |
| `TokenLight` | 1 | 0 | 0 | 1 | ❌ não suportada |

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
| classes | 27 |
| class-features | 841 |
| **TOTAL** | **868** |

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
