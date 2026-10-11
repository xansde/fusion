/**
 * actionBarRegistry.ts — client-side registry of action-bar providers (BAR-F1-02,
 * DEC-BAR-05, REQ-BAR-012), plus the two helpers a system uses to assemble a provider.
 *
 * Mirrors `sheetRegistry`: a game system registers its provider once at boot
 * (`registerPf2eSheets`, BAR-F2-07) and the core resolves it by the SAME criterion as the
 * sheet — `documentType` + `subtype`, exact → "*" → `null`. An actor without a provider has
 * no bar.
 *
 *     actionBarRegistry.register("Actor", "character", createPf2eCharacterProvider());
 *     actionBarRegistry.resolve("Actor", actor.type); // provider | null
 *
 * Boundary: the satellite imports this module through the `$lib/…` alias; this module
 * imports nothing from the satellite.
 *
 * Reactivity: the registrations live in a `SvelteMap`, like `windowManager` (a plain `.ts`
 * module; `SvelteMap` is a runtime primitive and needs no compiler). `registerPf2eSheets` is
 * async and runs in `TableScreen`'s `onMount`, i.e. AFTER the first render, so a `resolve()`
 * made earlier inside a `$derived` must re-run when the provider arrives — the same reason
 * `chatCardExtensionRegistry` is reactive. Outside a reactive context it behaves as a `Map`.
 */

// Types `import.meta.env.PROD` (read by `isProductionBuild` below); the client loads no other
// ambient Vite types. A triple-slash reference is idempotent, so it cannot clash with a future
// `vite-env.d.ts`.
/// <reference types="vite/client" />

import { SvelteMap } from "svelte/reactivity";
import type {
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarProvider,
  ActionBarSlice,
  ActionBarVariant,
} from "./types.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ActionBarRegistryImpl {
  private readonly _providers = new SvelteMap<string, ActionBarProvider>();

  /**
   * Register the provider for a (documentType, subtype) pair. `documentType` is "Actor";
   * `subtype` is the actor's `type` ("character", "npc", "familiar"…); "*" is the fallback
   * for every subtype of that documentType. Registering a key again replaces its provider.
   */
  register(documentType: string, subtype: string, provider: ActionBarProvider): void {
    this._providers.set(`${documentType}:${subtype}`, provider);
  }

  /**
   * Resolve the provider of a (documentType, subtype) pair, the way the sheet is resolved
   * (REQ-UIF-019): exact match → `${documentType}:*` → `null`. `null` means the actor has no bar.
   */
  resolve(documentType: string, subtype: string): ActionBarProvider | null {
    return (
      this._providers.get(`${documentType}:${subtype}`) ??
      this._providers.get(`${documentType}:*`) ??
      null
    );
  }

  /** Forget every registration — tests only. */
  reset(): void {
    this._providers.clear();
  }
}

/** Singleton registry the systems register into and the shell resolves from. */
export const actionBarRegistry = new ActionBarRegistryImpl();

// ---------------------------------------------------------------------------
// Entry validation (tasks.md §2.2)
// ---------------------------------------------------------------------------

/** What to do with an entry that breaks the contract. */
export type InvalidEntryPolicy = "throw" | "drop";

export interface AssertValidEntriesOptions {
  /**
   * Default: "throw" in development and in tests (a broken provider must be loud), "drop" in a
   * production build (one malformed entry must never take the whole bar down).
   */
  onInvalid?: InvalidEntryPolicy;
}

/** Rule 1 of §2.2 — `<kind>:<origin>`; the prefix must also equal `entry.kind`. */
const ENTRY_ID_PATTERN =
  /^(strike|spell|action|item|reaction|toggle|check):[A-Za-z0-9._:-]{1,120}$/;

/**
 * True in a production build.
 *
 * The expression MUST stay the literal `import.meta.env.PROD`: `vite build` only substitutes that
 * exact text (with `true`), and the dev server only injects `import.meta.env` into modules that
 * contain it. Reading it through a variable (`const meta = import.meta; meta.env?.PROD`) leaves
 * `import.meta` untouched in the bundle, `env` is `undefined` there, and the production default
 * silently becomes "throw". Vitest evaluates it live, so `vi.stubEnv("PROD", true)` reaches it.
 */
function isProductionBuild(): boolean {
  return import.meta.env.PROD;
}

function defaultInvalidPolicy(): InvalidEntryPolicy {
  return isProductionBuild() ? "drop" : "throw";
}

/** Throw or warn, per `policy`. In "drop" mode the caller skips the entry after this returns. */
function rejectEntry(policy: InvalidEntryPolicy, entry: ActionBarEntry, problem: string): void {
  const message = `[actionbar] invalid entry "${entry.id}": ${problem}`;
  if (policy === "throw") throw new Error(message);
  console.warn(`${message} — entry dropped`);
}

/** Rule 3 — one `isDefault` per axis, variant ids unique within the entry. */
function findVariantProblem(variants: readonly ActionBarVariant[] | undefined): string | null {
  if (variants === undefined) return null;
  const ids = new Set<string>();
  const defaultsByAxis = new Map<ActionBarVariant["axis"], number>();
  for (const variant of variants) {
    if (ids.has(variant.id)) return `variant id "${variant.id}" is repeated in the entry`;
    ids.add(variant.id);
    defaultsByAxis.set(
      variant.axis,
      (defaultsByAxis.get(variant.axis) ?? 0) + (variant.isDefault === true ? 1 : 0),
    );
  }
  for (const [axis, defaults] of defaultsByAxis) {
    if (defaults !== 1) {
      return `axis "${axis}" has ${String(defaults)} default variants (exactly one is required)`;
    }
  }
  return null;
}

/** The first rule the entry breaks, or `null` when it is valid. `seenIds` = ids already accepted in this list. */
function findProblem(entry: ActionBarEntry, seenIds: ReadonlySet<string>): string | null {
  // Rule 1: id shape, prefix equal to kind, no repeated id (REQ-BAR-017).
  if (!ENTRY_ID_PATTERN.test(entry.id)) {
    return `id does not match <kind>:<origin> (${ENTRY_ID_PATTERN.source})`;
  }
  const prefix = entry.id.slice(0, entry.id.indexOf(":"));
  if (prefix !== entry.kind) return `id prefix "${prefix}" differs from kind "${entry.kind}"`;
  if (seenIds.has(entry.id)) return "id is repeated in the list";

  // Rule 2: only the impossible disappears; the unavailable stays, faded, WITH its reason
  // (REQ-BAR-031). The state comes from a real resource or state, never an action count (REQ-BAR-032).
  if (
    (entry.state === "unavailable" || entry.state === "spent-until-recharge") &&
    (entry.reason ?? "").trim() === ""
  ) {
    return `state "${entry.state}" needs a non-empty reason`;
  }

  // Rule 3: variants.
  const variantProblem = findVariantProblem(entry.variants);
  if (variantProblem !== null) return variantProblem;

  // Rule 4 is not a check: `cost`, `badge`, `uses` and `groupUses` are display data and nothing
  // here reads them as a rule (D-15).
  // Rule 5: `label` is the pack's pt-BR name (REQ-BAR-021). Whether it IS the pack's name only
  // the system's own provider test can prove; the core can only refuse a label that is not there.
  if (entry.label.trim() === "") return "label is empty";

  return null;
}

/**
 * Check a provider's entries against the five rules of tasks.md §2.2 and return the valid ones,
 * in the same order and as the same objects.
 *
 *  1. `id` is `<kind>:<origin>`, its prefix equals `kind`, and it is not repeated in the list;
 *  2. `state` `unavailable` / `spent-until-recharge` carries a non-empty `reason`;
 *  3. `variants` have exactly one `isDefault` per axis and ids unique within the entry;
 *  4. `cost`, `badge`, `uses` and `groupUses` are display only (D-15) — nothing to check;
 *  5. `label` is the pack's name, never an invented one — the core checks that it exists.
 *
 * An invalid entry throws in development and in tests; in a production build it is dropped
 * (the first occurrence of a repeated id stays) and `console.warn` names it.
 */
export function assertValidEntries(
  entries: readonly ActionBarEntry[],
  options: AssertValidEntriesOptions = {},
): ActionBarEntry[] {
  const policy = options.onInvalid ?? defaultInvalidPolicy();
  const valid: ActionBarEntry[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    const problem = findProblem(entry, seenIds);
    if (problem !== null) {
      rejectEntry(policy, entry, problem);
      continue;
    }
    seenIds.add(entry.id);
    valid.push(entry);
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Composition (tasks.md §2.1)
// ---------------------------------------------------------------------------

/**
 * Assemble a provider from the slices of a system.
 *
 *  - `entries(ctx)` concatenates the slices' entries in the order the slices come, then passes
 *    them through {@link assertValidEntries}. A slice that returns a kind it does not declare is
 *    a contract error too (its `execute` would never be routed to it). Nothing is cached: the
 *    shell calls it inside a `$derived` and any reactive read in a slice must re-run the bar.
 *  - `execute(entry, choice, services, ctx)` routes by `entry.kind` to the slice that declares
 *    it, passing `ctx` (the owner's context) through; a kind without a slice REJECTS.
 *  - `status`, `details` and `seed` are the system's own and pass through untouched.
 *
 * Throws at composition time when two slices declare the same kind.
 */
export function composeActionBarProvider(parts: {
  slices: readonly ActionBarSlice[];
  status: ActionBarProvider["status"];
  details?: ActionBarProvider["details"];
  seed?: ActionBarProvider["seed"];
}): ActionBarProvider {
  const slices = [...parts.slices];
  const sliceByKind = new Map<ActionBarEntryKind, ActionBarSlice>();
  for (const slice of slices) {
    for (const kind of slice.kinds) {
      if (sliceByKind.has(kind))
        throw new Error(`[actionbar] two slices declare the kind "${kind}"`);
      sliceByKind.set(kind, slice);
    }
  }

  return {
    entries(ctx) {
      const policy = defaultInvalidPolicy();
      const collected: ActionBarEntry[] = [];
      for (const slice of slices) {
        for (const entry of slice.entries(ctx)) {
          if (sliceByKind.get(entry.kind) !== slice) {
            rejectEntry(
              policy,
              entry,
              `kind "${entry.kind}" is not declared by the slice that built it`,
            );
            continue;
          }
          collected.push(entry);
        }
      }
      return assertValidEntries(collected, { onInvalid: policy });
    },
    status: parts.status,
    async execute(entry, choice, services, ctx) {
      const slice = sliceByKind.get(entry.kind);
      if (slice === undefined) {
        throw new Error(
          `[actionbar] no slice declares the kind "${entry.kind}" (entry "${entry.id}")`,
        );
      }
      await slice.execute(entry, choice, services, ctx);
    },
    ...(parts.details !== undefined ? { details: parts.details } : {}),
    ...(parts.seed !== undefined ? { seed: parts.seed } : {}),
  };
}
