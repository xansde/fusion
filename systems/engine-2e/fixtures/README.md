# engine-2e Golden Fixtures

This directory contains **golden test fixtures** for the `systems/engine-2e` core mechanics.
Each fixture file is a JSON array of test cases with explicit rule citations so the expected
values can be verified against the authoritative sources rather than against the code itself.

---

## File Index

| File                      | Mechanic                                               | Cases | Doubts (verify:true) |
| ------------------------- | ------------------------------------------------------ | ----- | -------------------- |
| `degrees-of-success.json` | Degree of Success calculation (±10, nat20/nat1)        | 20    | 0                    |
| `modifier-stacking.json`  | Modifier stacking rules (7 types, same/different type) | 15    | 2                    |
| `map.json`                | Multiple Attack Penalty — agile vs. non-agile          | 12    | 1                    |
| `iwr.json`                | Immunity / Weakness / Resistance pipeline              | 15    | 2                    |
| `teml-proficiency.json`   | TEML proficiency bonus by rank and level               | 15    | 1                    |
| `dying-wounded.json`      | Dying/Wounded/Doomed condition sequencing              | 17    | 1                    |

**Total: 94 cases, 7 marked `verify:true`.**

---

## Rule Sources

Each case carries a `rule` field citing the exact section of the authoritative research document.
The main source is:

```
docs/research/13-pf2e-sf2e-mecanicas-nucleo.md
```

with supplementary references to:

```
specs/17-sistema-pf2e.md  (REQ-PF2-xxx requirements and DEC-PF2-xx decisions)
```

Both documents cite Archives of Nethys (ORC license) as the primary rule source.

### Section Map

| File                      | Primary sections cited                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `degrees-of-success.json` | §2.1 Quatro Graus, §2.2 Modificações por Dado Natural                               |
| `modifier-stacking.json`  | §3.2 Fórmula Geral de Check; specs/17 ModifierType                                  |
| `map.json`                | §1.4 Multiple Attack Penalty, §1.3 Traits de Ação, §6.3 Agile trait                 |
| `iwr.json`                | §6.4 Immunities/Weaknesses/Resistances, §6.5 Persistent Damage; REQ-PF2-060/062/063 |
| `teml-proficiency.json`   | §3.1 Sistema TEML; specs/17 REQ-PF2-011, TEML formula                               |
| `dying-wounded.json`      | §7.6 Condições (Dying/Wounded/Doomed), §8.1–§8.3; REQ-PF2-070..074                  |

---

## Case Format

Every case has the shape:

```jsonc
{
  "id": "dos-001",           // unique stable ID
  "description": "...",      // human-readable scenario
  // ... scenario-specific input fields ...
  "expected": { ... },       // what the engine MUST produce
  "rule": "§X.Y: ...",       // verbatim citation from the source document

  // Optional fields:
  "verify": true,            // marks a case where the source is ambiguous
  "verifyNote": "..."        // explains the doubt for the M3 implementer
}
```

---

## How M3-B Must Consume These Fixtures

Each fixture file maps directly to a unit/integration test suite in `systems/engine-2e`.

### Mapping

| Fixture file              | Test file (suggested)                              |
| ------------------------- | -------------------------------------------------- |
| `degrees-of-success.json` | `engine-2e/src/__tests__/degreesOfSuccess.test.ts` |
| `modifier-stacking.json`  | `engine-2e/src/__tests__/modifierStacking.test.ts` |
| `map.json`                | `engine-2e/src/__tests__/map.test.ts`              |
| `iwr.json`                | `engine-2e/src/__tests__/iwr.test.ts`              |
| `teml-proficiency.json`   | `engine-2e/src/__tests__/temlProficiency.test.ts`  |
| `dying-wounded.json`      | `engine-2e/src/__tests__/dyingWounded.test.ts`     |

### Pattern (TypeScript/Vitest example)

```typescript
import cases from "../../fixtures/degrees-of-success.json";
import { calculateDegreeOfSuccess } from "../degreesOfSuccess";

describe("Degrees of Success", () => {
  test.each(cases.cases)("$id: $description", ({ check, dc, dieNatural, expected }) => {
    const result = calculateDegreeOfSuccess(check, dc, dieNatural);
    expect(result).toBe(expected);
  });
});
```

The same pattern applies to all other fixture files — import the `cases` array and drive
`test.each` with it. This means **adding a new rule case requires no code change** in the
test file, only a new entry in the JSON fixture.

### Cases marked `verify: true`

These cases encode a rule that the primary source (`13-pf2e-sf2e-mecanicas-nucleo.md`) does
not make explicit enough, or where cross-references between sections introduce ambiguity.
The `verifyNote` field explains the doubt.

Before writing the implementation for these cases, the M3-B implementer MUST:

1. Read the cited `verifyNote`.
2. Check the Archives of Nethys URL referenced in `13-pf2e-sf2e-mecanicas-nucleo.md §17 Fontes`.
3. Resolve the ambiguity and update the fixture `expected` value if needed.
4. Remove `"verify": true` once confirmed.

**Current open doubts (verify:true):**

| ID         | File              | Summary of doubt                                                                                       |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `ms-009`   | modifier-stacking | Untyped bonuses — highest wins (not stacking); confirm this is distinct from untyped penalties         |
| `ms-010`   | modifier-stacking | Untyped penalties (MAP, range) stack with each other — confirm this is the intended engine-2e behavior |
| `ms-011`   | modifier-stacking | Same-type bonus and penalty interact by resolving independently then summing; confirm per PF2e RAW     |
| `map-011`  | map               | Mixed-weapon turn: MAP step based on total attacks made, not per-weapon count                          |
| `iwr-010`  | iwr               | 'physical' as umbrella target covering all three physical subtypes                                     |
| `iwr-011`  | iwr               | Persistent damage goes through IWR pipeline (weakness/resistance apply)                                |
| `dw-016`   | dying-wounded     | Wounded clears on full HP + 10min rest vs. full HP alone                                               |
| `teml-015` | teml-proficiency  | Negative level NPCs: does proficiency bonus floor at 0?                                                |

---

## What Is NOT in These Fixtures

These fixtures cover **engine-2e core mechanics only** — shared between PF2e and SF2e.
The following are intentionally out of scope (belong in system-specific tests):

- Skill formulas (16 PF2e skills, association skill→attribute) → `systems/pf2e`
- Spell DC and spell attack bonus formulas → `systems/pf2e`
- AC formula (dex cap, armor category, broken armor) → `systems/pf2e`
- HP maximum calculation (class HP + CON mod × level) → `systems/pf2e`
- Conditions with PF2e-specific mechanical effects (off-guard, frightened, etc.) → `systems/pf2e`
- Strike derivation from equipped weapons → `systems/pf2e`
- SF2e-specific mechanics (gravity, weapon tiers, starship combat) → `systems/sf2e`
