/**
 * @fusion/system-pf2e — Familiar-grant detection (shared server + client).
 *
 * A single, authoritative predicate for "does this master character have a
 * feat that grants a familiar, and how big is the daily-ability budget?".
 *
 * WHY THIS LIVES IN THE SYSTEM PACKAGE (r17-P1). The client's petsVM enables
 * the "create familiar" CTA from this detection, and the server's doc:create
 * gate must apply the *same* detection to authorize a PLAYER creating their own
 * familiar Actor (companion) without a GM. Duplicating the rule in two packages
 * would let the two drift — a player could see a CTA the server rejects, or
 * (worse) forge a create the client would never offer. Both consumers import
 * this module so there is exactly one definition of "can have a familiar".
 *
 * Pure & synchronous — reads only the master document's embedded items array.
 * No socket, no i18n, no client deps. Safe to import from the server.
 *
 * Clean-room: remaster (ORC) mechanics only. No Foundry/Paizo code copied.
 * REQ-PET-001, REQ-PET-006.
 */

/** Base number of familiar abilities before any feat bumps (remaster). */
export const FAMILIAR_ABILITY_BASE = 2;

/**
 * Curated feat names that grant a familiar/pet. The `familiarAbilities` rule
 * element is the primary, data-driven signal (see isFamiliarAbilitiesRule), but
 * a feat that grants a familiar via GrantItem alone (the base "Familiar" class
 * feat delegates the ability counter to a granted "Pet" item) still needs to
 * count — hence the curated fallback list. Names are matched case-insensitively
 * and exactly (trimmed + lower-cased).
 */
export const FAMILIAR_GRANTING_FEATS: ReadonlySet<string> = new Set([
  "familiar",
  "rat familiar",
  "pet",
  "enhanced familiar",
  "incredible familiar",
  "leshy familiar",
  "faerie dragon familiar",
]);

/** The result of detecting a master's familiar grant. */
export interface FamiliarGrant {
  /** True when the master has a feat/rule that grants a familiar. */
  canHaveFamiliar: boolean;
  /** Daily-ability budget = base 2 + the highest `familiarAbilities` bump. */
  abilityBudget: number;
}

/**
 * The master's embedded items array (feats/heritages/etc.), narrowed to plain
 * objects. Tolerates a master doc with no `items` (returns []).
 */
export function masterItems(
  masterDoc: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const items = masterDoc["items"];
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is Record<string, unknown> => typeof it === "object" && it !== null,
  );
}

/** True when a rule element bumps `system.attributes.familiarAbilities.value`. */
export function isFamiliarAbilitiesRule(
  rule: unknown,
): rule is { value?: unknown; selector?: unknown } {
  if (rule === null || typeof rule !== "object") return false;
  const r = rule as Record<string, unknown>;
  const selector = typeof r["selector"] === "string" ? r["selector"] : "";
  const path = typeof r["path"] === "string" ? r["path"] : "";
  const rawPath =
    typeof (r["raw"] as Record<string, unknown> | undefined)?.["path"] === "string"
      ? ((r["raw"] as Record<string, unknown>)["path"] as string)
      : "";
  return (
    selector.includes("familiarAbilities") ||
    path.includes("familiarAbilities") ||
    rawPath.includes("familiarAbilities")
  );
}

/** The rule-element array of an embedded item (`system.rules`), or []. */
function itemRules(item: Record<string, unknown>): unknown[] {
  const sys = item["system"] as Record<string, unknown> | undefined;
  const rules = sys?.["rules"];
  return Array.isArray(rules) ? rules : [];
}

/**
 * Detect whether the master can have a familiar and how big its daily-ability
 * budget is.
 *
 * Budget = FAMILIAR_ABILITY_BASE (2) + the highest `familiarAbilities` bump
 * found across the master's items (the vendor uses `mode: "upgrade"`, so the
 * max — not sum — is the effective bump). Rat Familiar upgrades to 2 → budget
 * 4; Enhanced Familiar upgrades to 4 → budget 6.
 */
export function detectFamiliarGrant(masterDoc: Record<string, unknown>): FamiliarGrant {
  let hasRuleSignal = false;
  let hasCuratedFeat = false;
  let maxBump = 0;

  for (const item of masterItems(masterDoc)) {
    const type = item["type"];
    const rawName = item["name"];
    const name = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";

    if ((type === "feat" || type === "action") && FAMILIAR_GRANTING_FEATS.has(name)) {
      hasCuratedFeat = true;
    }

    for (const rule of itemRules(item)) {
      if (isFamiliarAbilitiesRule(rule)) {
        hasRuleSignal = true;
        const v = (rule as { value?: unknown })["value"];
        if (typeof v === "number" && v > maxBump) maxBump = v;
      }
    }
  }

  const canHaveFamiliar = hasRuleSignal || hasCuratedFeat;
  const abilityBudget = FAMILIAR_ABILITY_BASE + maxBump;
  return { canHaveFamiliar, abilityBudget };
}
