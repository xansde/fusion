# 08 — Relatório de Transformação PF2E → Fusion

> Gerado em: 2026-06-26
> Script: `src/transform.mjs` v0.1.0
> Fonte: vendor/pf2e branch v14-dev

---

## 1. Sumário por pack

| Pack                        | Total    | Transformados | Excluídos | Parciais | Completos | Substituições de arte |
| --------------------------- | -------- | ------------- | --------- | -------- | --------- | --------------------- |
| **conditions**              | 43       | 43            | 0         | 9        | 34        | 43                    |
| **equipment**               | 5645     | 5645          | 0         | 316      | 5329      | 5645                  |
| **spells**                  | 1796     | 1796          | 0         | 5        | 1791      | 1796                  |
| **pathfinder-monster-core** | 492      | 492           | 0         | 0        | 492       | 6695                  |
| **TOTAL**                   | **7976** | **7976**      | **0**     | **330**  | **7646**  | **14179**             |

---

## 2. Cobertura de Rule Elements

**Cobertura total:** 2692/3594 (74.9% suportadas integralmente)

| Rule Key                 | Total | Suportadas | Parciais | Não suportadas | Status           |
| ------------------------ | ----- | ---------- | -------- | -------------- | ---------------- |
| `FlatModifier`           | 1310  | 1310       | 0        | 0              | ✅ suportada     |
| `RollOption`             | 627   | 627        | 0        | 0              | ✅ suportada     |
| `Note`                   | 256   | 256        | 0        | 0              | ✅ suportada     |
| `DamageDice`             | 238   | 238        | 0        | 0              | ✅ suportada     |
| `Aura`                   | 194   | 0          | 0        | 194            | ❌ não suportada |
| `ItemAlteration`         | 136   | 0          | 136      | 0              | ⚠️ parcial       |
| `Resistance`             | 127   | 127        | 0        | 0              | ✅ suportada     |
| `ActiveEffectLike`       | 99    | 43         | 56       | 0              | ✅ suportada     |
| `TokenLight`             | 90    | 0          | 0        | 90             | ❌ não suportada |
| `AdjustModifier`         | 51    | 0          | 51       | 0              | ⚠️ parcial       |
| `Strike`                 | 47    | 0          | 0        | 47             | ❌ não suportada |
| `TokenEffectIcon`        | 46    | 0          | 0        | 46             | ❌ não suportada |
| `AdjustStrike`           | 39    | 0          | 0        | 39             | ❌ não suportada |
| `CreatureSize`           | 37    | 0          | 0        | 37             | ❌ não suportada |
| `GrantItem`              | 36    | 36         | 0        | 0              | ✅ suportada     |
| `DamageAlteration`       | 35    | 0          | 0        | 35             | ❌ não suportada |
| `FastHealing`            | 33    | 0          | 0        | 33             | ❌ não suportada |
| `BaseSpeed`              | 30    | 30         | 0        | 0              | ✅ suportada     |
| `ChoiceSet`              | 30    | 0          | 0        | 30             | ❌ não suportada |
| `Immunity`               | 27    | 0          | 27       | 0              | ⚠️ parcial       |
| `Sense`                  | 24    | 24         | 0        | 0              | ✅ suportada     |
| `AdjustDegreeOfSuccess`  | 21    | 0          | 0        | 21             | ❌ não suportada |
| `EphemeralEffect`        | 19    | 0          | 0        | 19             | ❌ não suportada |
| `Weakness`               | 11    | 0          | 0        | 11             | ❌ não suportada |
| `CriticalSpecialization` | 10    | 0          | 0        | 10             | ❌ não suportada |
| `DexterityModifierCap`   | 6     | 0          | 0        | 6              | ❌ não suportada |
| `ActorTraits`            | 6     | 0          | 0        | 6              | ❌ não suportada |
| `SpecialStatistic`       | 3     | 0          | 0        | 3              | ❌ não suportada |
| `SubstituteRoll`         | 3     | 0          | 0        | 3              | ❌ não suportada |
| `LoseHitPoints`          | 1     | 0          | 0        | 1              | ❌ não suportada |
| `TempHP`                 | 1     | 1          | 0        | 0              | ✅ suportada     |
| `RollTwice`              | 1     | 0          | 0        | 1              | ❌ não suportada |

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

| Pack                    | Substituições totais |
| ----------------------- | -------------------- |
| conditions              | 43                   |
| equipment               | 5645                 |
| spells                  | 1796                 |
| pathfinder-monster-core | 6695                 |
| **TOTAL**               | **14179**            |

---

## 5. Tabela de cobertura declarativa

| Rule Key                 | Estado         | Conversor                   |
| ------------------------ | -------------- | --------------------------- |
| `FlatModifier`           | ✅ supported   | `convertFlatModifier`       |
| `ActiveEffectLike`       | ✅ supported   | `convertActiveEffectLike`   |
| `RollOption`             | ✅ supported   | `convertRollOption`         |
| `Note`                   | ✅ supported   | `convertNote`               |
| `DamageDice`             | ✅ supported   | `convertDamageDice`         |
| `Resistance`             | ✅ supported   | `convertResistance`         |
| `GrantItem`              | ✅ supported   | `convertGrantItem`          |
| `Sense`                  | ✅ supported   | `convertSense`              |
| `BaseSpeed`              | ✅ supported   | `convertBaseSpeed`          |
| `TempHP`                 | ✅ supported   | `convertTempHP`             |
| `MartialProficiency`     | ✅ supported   | `convertMartialProficiency` |
| `ItemAlteration`         | ⚠️ partial     | `convertItemAlteration`     |
| `AdjustModifier`         | ⚠️ partial     | `convertAdjustModifier`     |
| `Immunity`               | ⚠️ partial     | `convertImmunity`           |
| `ChoiceSet`              | ❌ unsupported | `—`                         |
| `Aura`                   | ❌ unsupported | `—`                         |
| `AdjustDegreeOfSuccess`  | ❌ unsupported | `—`                         |
| `Strike`                 | ❌ unsupported | `—`                         |
| `AdjustStrike`           | ❌ unsupported | `—`                         |
| `DamageAlteration`       | ❌ unsupported | `—`                         |
| `Weakness`               | ❌ unsupported | `—`                         |
| `FastHealing`            | ❌ unsupported | `—`                         |
| `TokenLight`             | ❌ unsupported | `—`                         |
| `CreatureSize`           | ❌ unsupported | `—`                         |
| `CriticalSpecialization` | ❌ unsupported | `—`                         |
| `BattleForm`             | ❌ unsupported | `—`                         |
| `TokenMark`              | ❌ unsupported | `—`                         |
| `ActorTraits`            | ❌ unsupported | `—`                         |
| `RollTwice`              | ❌ unsupported | `—`                         |
| `EphemeralEffect`        | ❌ unsupported | `—`                         |
| `TokenEffectIcon`        | ❌ unsupported | `—`                         |
| `CraftingAbility`        | ❌ unsupported | `—`                         |
| `DexterityModifierCap`   | ❌ unsupported | `—`                         |
| `SubstituteRoll`         | ❌ unsupported | `—`                         |
| `SpecialStatistic`       | ❌ unsupported | `—`                         |
| `MultipleAttackPenalty`  | ❌ unsupported | `—`                         |
| `LoseHitPoints`          | ❌ unsupported | `—`                         |
| `SpecialResource`        | ❌ unsupported | `—`                         |
