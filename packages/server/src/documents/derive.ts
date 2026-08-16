/**
 * The one way an Actor's `system.derived` gets recomputed and persisted after
 * a write.
 *
 * Lifted out of net/handlers/doc-handlers.ts when `compendium:importToActor`
 * (spec 43 §5.7, DEC-CPD-05) became a second write path into an Actor's
 * `items[]`: new items change AC/saves/spell slots, so that path has to
 * re-derive too — and a hand-rolled second copy of this logic silently lost
 * both corrections documented below (the clone and the pruning).
 */

import type { Logger } from "pino";
import type { SystemModule } from "@fusion/system-api";
import type { DocumentStore } from "./store.js";
import { prunedPatch } from "./merge.js";
import { runActorDerivation } from "../net/derive-runner.js";

export interface DeriveRecomputeDeps {
  store: DocumentStore;
  systemModule?: SystemModule;
  logger?: Logger;
}

/**
 * Recompute `system.derived` for a persisted Actor document and, if it
 * changed, persist the recomputed subtree via a second store.update() before
 * the caller broadcasts.
 *
 * Only acts on `documentType === "Actor"` when a systemModule is available;
 * every other call is a no-op returning the input doc unchanged. Never
 * touches authored fields — `runActorDerivation` writes exclusively to
 * `doc.system.derived` (see derive-runner.ts docstring for the full
 * contract).
 *
 * The second store.update() bumps `_stats.version` again and re-runs
 * validation, but that is intentional: the persisted document must reflect
 * the derived state that gets broadcast, and `system` is a passthrough
 * z.record so validation always succeeds for these writes.
 *
 * ROBUSTNESS (audit issue 1): a minimal-but-schema-valid Actor doc (e.g.
 * `{name, type: "character"}` with no `system.abilities`/`attributes`) is
 * ACCEPTED by the store's passthrough `system` schema, but the pf2e/sf2e
 * DeriveSteps assume those fields exist and throw a TypeError when they
 * don't. Because this helper runs AFTER the document is already persisted
 * (doc:create/doc:update already committed the write), an uncaught throw
 * here would surface as INTERNAL_ERROR to the client with a ghost write
 * already in the DB (persisted but never broadcast). Every call is
 * therefore wrapped: on failure we log a warning and return the doc
 * UNCHANGED (no derived, or whatever partial derived a previous successful
 * call already produced) rather than let the exception propagate.
 *
 * AUTHORSHIP (audit M4.5-corretor, BAIXA): the second store.update() below
 * MUST be given the same `authorCtx` the caller used for its own write —
 * otherwise DocumentStore.update falls back to `defaultAuthor` and
 * `_stats.lastModifiedBy` on the persisted/broadcast document silently
 * reverts to the default author even though a real, identified user
 * (ctx.userId) triggered the change. Callers therefore pass their resolved
 * `authorCtx` through as the 4th argument.
 */
export function recomputeDerivedIfNeeded(
  deps: DeriveRecomputeDeps,
  documentType: string,
  doc: Record<string, unknown>,
  authorCtx?: { userId: string },
): Record<string, unknown> {
  if (documentType !== "Actor" || !deps.systemModule) return doc;

  try {
    // Deep-clone `system` before handing it to runActorDerivation (audit
    // issue 5): the DeriveSteps' documented contract is "only ever writes to
    // doc.system.derived" (see derive-runner.ts docstring), but several
    // steps ALSO write cache fields outside `derived` for their own internal
    // consumption (e.g. pf2e/sf2e stepCharAbilityMods mirrors the computed
    // mod onto `system.abilities.<ability>.mod`, and stepCharStrikes reads
    // that same cached mod back). A shallow clone of `system` still shares
    // nested objects like `system.abilities.str` by reference with the
    // document already returned by the store — mutating `.mod` on it would
    // silently corrupt an object that may be referenced elsewhere (e.g.
    // computeDiff snapshots taken earlier in the same handler call for other
    // items in a batch). A full structuredClone removes that hazard; only
    // `system.derived` is ever read back out and persisted, so the clone's
    // cost (proportional to one actor's `system` subtree) is paid once per
    // recompute and nothing else from the clone is retained.
    const workingDoc: Record<string, unknown> = { ...doc };
    const sys = doc["system"];
    workingDoc["system"] =
      sys && typeof sys === "object" && !Array.isArray(sys)
        ? structuredClone(sys as Record<string, unknown>)
        : {};

    const derived = runActorDerivation(workingDoc, deps.systemModule);
    if (!derived) return doc;

    const id = doc["_id"] as string | undefined;
    if (!id) return doc;

    const newDerived = (workingDoc["system"] as Record<string, unknown>)["derived"];

    // PRUNING (r24 S2): store.update() deep-merges, and deepMerge PRESERVES
    // any key the patch does not mention. Patching only the new derived is
    // therefore purely additive — `system.derived` grew forever and never
    // shed a key the recompute stopped producing. That is how a Lore skill
    // dropped from `system.skills` (background swap) kept living in
    // `derived.skills` and kept rendering on the sheet.
    //
    // prunedPatch compares the derived ALREADY on the document (`doc` is the
    // untouched original — `workingDoc.system` is a structuredClone, so the
    // derivation mutated the copy, never this one) with the freshly computed
    // one, and adds an explicit null for every vanished key. null inside
    // `system` is deleteKey (REQ-DOC-037), so the single store.update()
    // below both updates and prunes: no second write, no second broadcast,
    // and no window where the sheet has no derived at all.
    const oldSystem = doc["system"];
    const oldDerived =
      oldSystem && typeof oldSystem === "object" && !Array.isArray(oldSystem)
        ? (oldSystem as Record<string, unknown>)["derived"]
        : undefined;
    const derivedPatch = prunedPatch(oldDerived, newDerived);

    const patched = deps.store.update(
      "actors",
      id,
      { system: { derived: derivedPatch } },
      authorCtx,
    );
    return patched ?? doc;
  } catch (err) {
    deps.logger?.warn(
      { err, documentId: doc["_id"], documentType },
      "Actor derivation failed for a single document — skipping derived, document persists without it",
    );
    return doc;
  }
}
