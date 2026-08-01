# 08 — Relatório de Transformação PF2E → Fusion

> Gerado em: 2026-07-07
> Script: `src/transform.mjs --system pf2e` v0.1.0
> Fonte: vendor/pf2e packs/pf2e branch v14-dev

---

## 1. Sumário por pack

| Pack                   | Total   | Transformados | Excluídos | Parciais | Completos | Substituições de arte |
| ---------------------- | ------- | ------------- | --------- | -------- | --------- | --------------------- |
| **familiar-abilities** | 111     | 111           | 0         | 17       | 94        | 111                   |
| **TOTAL**              | **111** | **111**       | **0**     | **17**   | **94**    | **111**               |

---

## 2. Cobertura de Rule Elements

**Cobertura total:** 27/48 (56.3% suportadas integralmente)

| Rule Key           | Total | Suportadas | Parciais | Não suportadas | Status           |
| ------------------ | ----- | ---------- | -------- | -------------- | ---------------- |
| `ActorTraits`      | 12    | 0          | 0        | 12             | ❌ não suportada |
| `BaseSpeed`        | 7     | 7          | 0        | 0              | ✅ suportada     |
| `Resistance`       | 7     | 7          | 0        | 0              | ✅ suportada     |
| `ChoiceSet`        | 6     | 0          | 0        | 6              | ❌ não suportada |
| `Sense`            | 6     | 6          | 0        | 0              | ✅ suportada     |
| `TokenLight`       | 2     | 0          | 0        | 2              | ❌ não suportada |
| `ActiveEffectLike` | 2     | 2          | 0        | 0              | ✅ suportada     |
| `FlatModifier`     | 2     | 2          | 0        | 0              | ✅ suportada     |
| `Note`             | 1     | 1          | 0        | 0              | ✅ suportada     |
| `Immunity`         | 1     | 0          | 1        | 0              | ⚠️ parcial       |
| `RollOption`       | 1     | 1          | 0        | 0              | ✅ suportada     |
| `GrantItem`        | 1     | 1          | 0        | 0              | ✅ suportada     |

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

| Pack               | Substituições totais |
| ------------------ | -------------------- |
| familiar-abilities | 111                  |
| **TOTAL**          | **111**              |

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
