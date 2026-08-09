/**
 * @fusion/system-pf2e — Isekai variant derivation.
 *
 * ONE step, with one job: reconcile the Isekai layer with the PF2e Focus pool.
 *
 * The layer does not invent a resource — every archetype's recharge panel says
 * "Refocus padrão (10 min): recupera 1 Ponto de Foco, como no PF2e". So a
 * character running Isekai spends `system.resources.focusPoints`, the same
 * pool a caster spends. Two things follow, and they are this file:
 *
 *   1. A non-caster picking Isekai has `max: 0` and nothing to spend. The
 *      layer floors the pool at `ISEKAI_FOCUS_FLOOR` so the archetype's
 *      abilities are reachable. It NEVER raises the published 3-point cap
 *      (REQ-PF2-083 / DEC-R10-02) — the floor equals the cap on purpose.
 *
 *   2. Two archetypes buy power with permanent pool: each ★ Named companion
 *      (Carismático) and each ★ taught Signature (Especialista) locks 1 point
 *      of the maximum, which neither spends nor recharges. `max` keeps
 *      reporting the pool's real size — the sheet needs to render "1/3 · 2
 *      travado", not a mysteriously shrunken pool — and the locked count is
 *      published under `system.derived.isekaiFocusLocked` for the UI to
 *      explain, while `value` is clamped to what is actually spendable.
 *
 * With the variant off, or on with no archetype picked, this step writes
 * NOTHING: an existing sheet derives byte-for-byte what it derived before the
 * variant existed, which is the same contract the class-levels variant holds.
 */

import type { DeriveStep } from "@fusion/system-api";
import { FOCUS_POOL_CAP } from "../variants/classLevels/params.js";
import {
  ISEKAI_FOCUS_FLOOR,
  isekaiLockedFocus,
  type IsekaiTrackerState,
} from "../variants/isekai/index.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Is the Isekai variant on for this actor? */
function isekaiVariantOn(sys: Record<string, unknown>): boolean {
  const build = asRecord(sys["build"]);
  const variantRules = build ? asRecord(build["variantRules"]) : undefined;
  return variantRules?.["isekai"] === true;
}

/** The archetype ids the sheet carries — only real strings, never garbage. */
function pickedArchetypes(sys: Record<string, unknown>): string[] {
  const isekai = asRecord(sys["isekai"]);
  const raw = isekai?.["archetypes"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function trackerState(sys: Record<string, unknown>): IsekaiTrackerState {
  const isekai = asRecord(sys["isekai"]);
  const trackers = isekai ? asRecord(isekai["trackers"]) : undefined;
  return (trackers ?? {}) as IsekaiTrackerState;
}

function setDerived(sys: Record<string, unknown>, key: string, value: unknown): void {
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  (sys["derived"] as Record<string, unknown>)[key] = value;
}

/**
 * Floor the Focus pool for an Isekai character and publish the ★ locks.
 *
 * Writes: system.resources, system.derived
 *
 * `reads` deliberately OMITS `system.resources` even though the step reads
 * the current pool. Declaring it would put this step and `stepCharFocusClamp`
 * in a read↔write cycle on the same path, and the topo-sort rejects the whole
 * pipeline with a `CyclicDependencyError` — every character on the table
 * stops deriving, not just Isekai ones. Omitting it leaves ONE edge (this
 * step writes `system.resources`, the clamp reads it), which orders the clamp
 * AFTER this step: the house rule proposes a pool, the published cap gets the
 * last word on it. That is the safe direction — the clamp can only ever
 * narrow what we wrote, never widen it.
 */
export const stepCharIsekaiFocus: DeriveStep = {
  id: "pf2e.character.base.isekaiFocus",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.build", "system.isekai"],
  writes: ["system.resources", "system.derived"],

  run(doc) {
    const sys = asRecord((doc as Record<string, unknown>)["system"]);
    if (!sys) return;

    if (!isekaiVariantOn(sys)) return;

    const archetypes = pickedArchetypes(sys);
    // The toggle alone grants nothing: a sheet mid-configuration must not
    // sprout a pool out of an empty selection. The archetypes are the grant.
    if (archetypes.length === 0) return;

    const resources = asRecord(sys["resources"]) ?? {};
    sys["resources"] = resources;
    const focus = asRecord(resources["focusPoints"]);

    const rawMax = typeof focus?.["max"] === "number" ? focus["max"] : 0;
    const rawValue = typeof focus?.["value"] === "number" ? focus["value"] : 0;

    // Floor UP to the layer's pool, then clamp DOWN to the published cap —
    // in that order, so a document claiming max 9 still lands on 3.
    const max = Math.min(FOCUS_POOL_CAP, Math.max(rawMax, ISEKAI_FOCUS_FLOOR));

    const locked = isekaiLockedFocus(archetypes, trackerState(sys));
    const spendable = Math.max(0, max - locked);

    // A pool that just came into existence starts FULL: the character never
    // spent the points they didn't have. A pool that already existed keeps
    // whatever was left in it.
    const value = rawMax === 0 ? spendable : Math.min(rawValue, spendable);

    resources["focusPoints"] = { value, max };
    setDerived(sys, "isekaiFocusLocked", locked);
  },
};
