/**
 * @fusion/system-pf2e — Resolving the level split off an actor document.
 *
 * Turns the raw `system.build.choices` ledger into the `LevelContext` the
 * derivation steps consume, plus the extra facts the sheet needs to EXPLAIN
 * the numbers (which class gave which level — REQ-MCL-082).
 *
 * Reads raw persisted docs (no Zod defaults applied), so every access is
 * guarded and every malformed shape degrades instead of throwing — the same
 * posture the rest of the derivation layer takes (r11 finding).
 *
 * Spec: 30-multiclasse-por-niveis.md §5, §6.2.
 */

import { classLevelContext, singleClassContext, type LevelContext } from "@fusion/engine-2e";
import type { ClassSystem } from "../../schemas/item-equipment.js";

/** An embedded `type: 'class'` item, with a stable identity. */
export interface EmbeddedClass {
  /**
   * Stable identity key for this class within the actor.
   *
   * `flags.fusion.sourceId` when present, else the embedded `_id`, else the
   * name. NEVER the name alone by preference: homonyms are normal in PF2e
   * content, so keying by name silently merges two different classes into
   * one — the exact failure this project already hit once.
   */
  readonly key: string;
  /** Display name, for sheet labels only — never an identity. */
  readonly name: string;
  /** The embedded item's `_id`, when it has one. */
  readonly itemId?: string;
  /** The class item's `system` block. */
  readonly system: ClassSystem;
}

/** One character level, and the class that received it. */
export interface ClassLevelAssignment {
  readonly characterLevel: number;
  readonly classKey: string;
}

/** Everything the derivation steps need to know about the level split. */
export interface ResolvedClassLevels {
  /** True when the variant is on AND a split is actually in play. */
  readonly variantActive: boolean;
  /** The (class level, character level) pair set. */
  readonly ctx: LevelContext;
  /** Key of the class taken at character level 1 (REQ-MCL-013). */
  readonly firstClass: string | undefined;
  /** Per-level assignment, ordered by character level (REQ-MCL-033). */
  readonly assignments: readonly ClassLevelAssignment[];
  /** The embedded class items, by key. */
  readonly classes: ReadonlyMap<string, EmbeddedClass>;
}

interface RawItem {
  _id?: string;
  type?: string;
  name?: string;
  system?: Record<string, unknown>;
  flags?: Record<string, unknown>;
}

function readFusionFlags(item: RawItem): Record<string, unknown> {
  const flags = item.flags;
  if (!flags || typeof flags !== "object") return {};
  const fusion = flags["fusion"];
  return fusion && typeof fusion === "object" ? (fusion as Record<string, unknown>) : {};
}

/**
 * All embedded `type: 'class'` items — the plural successor to the old
 * single-class `findClassItem`.
 *
 * Under the variant there is ONE class item per distinct class (not one per
 * level — REQ-MCL-011): a `Fighter 3 / Wizard 2` carries two.
 */
export function findClassItems(doc: Record<string, unknown>): EmbeddedClass[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const classes: EmbeddedClass[] = [];
  const seenKeys = new Set<string>();

  // Iterated as `unknown` on purpose: this runs against RAW persisted docs,
  // where an entry can be null or a primitive. Casting the array up front
  // would tell the type checker a lie and disable the guard below.
  for (const entry of rawItems as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as RawItem;
    if (raw.type !== "class") continue;

    const fusion = readFusionFlags(raw);
    const sourceId = typeof fusion["sourceId"] === "string" ? fusion["sourceId"] : undefined;
    const name = typeof raw.name === "string" ? raw.name : "";
    const key = sourceId ?? raw._id ?? name;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    classes.push({
      key,
      name,
      ...(raw._id !== undefined ? { itemId: raw._id } : {}),
      system: (raw.system ?? {}) as unknown as ClassSystem,
    });
  }

  return classes;
}

/**
 * Match a `classLevel` choice to one of the embedded class items.
 *
 * Tried in descending order of reliability:
 *   1. `itemId` — an exact pointer at the embedded item;
 *   2. `ref` containing the class's stable `sourceId` (the compendium UUID
 *      the builder records ends with it);
 *   3. `ref` ending in the class's `_id`;
 *   4. name match, normalized — last resort, and the only one that can be
 *      wrong for homonyms, so it comes last and never first.
 *
 * Returns undefined when nothing matches; the caller decides what an
 * unresolvable level means (it must not silently become another class's).
 */
function matchClass(
  choice: { ref?: string; itemId?: string },
  classes: readonly EmbeddedClass[],
): EmbeddedClass | undefined {
  if (choice.itemId) {
    const byItemId = classes.find((candidate) => candidate.itemId === choice.itemId);
    if (byItemId) return byItemId;
  }

  const ref = choice.ref;
  if (typeof ref === "string" && ref.length > 0) {
    const bySourceId = classes.find((candidate) => ref.includes(candidate.key));
    if (bySourceId) return bySourceId;

    const byItemIdInRef = classes.find(
      (candidate) => candidate.itemId !== undefined && ref.includes(candidate.itemId),
    );
    if (byItemIdInRef) return byItemIdInRef;

    const normalized = ref.toLowerCase();
    const byName = classes.find(
      (candidate) => candidate.name.length > 0 && normalized.includes(candidate.name.toLowerCase()),
    );
    if (byName) return byName;
  }

  return undefined;
}

/**
 * Resolve the level split for a document.
 *
 * The RAW path (variant off, or on but with no split recorded) produces a
 * `singleClassContext` — the same numbers derivation always saw, which is
 * what makes REQ-MCL-002/003 hold by construction rather than by care.
 */
export function resolveClassLevels(
  doc: Record<string, unknown>,
  characterLevel: number,
): ResolvedClassLevels {
  const classes = findClassItems(doc);
  const byKey = new Map(classes.map((entry) => [entry.key, entry]));

  const sys = (doc["system"] as Record<string, unknown> | undefined) ?? {};
  const build = sys["build"] as
    | {
        variantRules?: { classLevels?: boolean };
        choices?: Array<{ level?: number; type?: string; ref?: string; itemId?: string }>;
      }
    | undefined;

  const rawPath = (): ResolvedClassLevels => {
    const primary = classes[0];
    return {
      variantActive: false,
      ctx: primary
        ? singleClassContext(primary.key, characterLevel)
        : { characterLevel, classLevels: {} },
      firstClass: primary?.key,
      assignments: primary
        ? Array.from({ length: characterLevel }, (_, index) => ({
            characterLevel: index + 1,
            classKey: primary.key,
          }))
        : [],
      classes: byKey,
    };
  };

  if (build?.variantRules?.classLevels !== true) return rawPath();

  const choices: unknown[] = Array.isArray(build.choices) ? build.choices : [];
  const splitChoices = choices
    .filter((choice): choice is { level: number; ref?: string; itemId?: string } => {
      if (!choice || typeof choice !== "object") return false;
      const candidate = choice as { type?: unknown; level?: unknown };
      return candidate.type === "classLevel" && typeof candidate.level === "number";
    })
    .sort((a, b) => a.level - b.level);

  // Variant on but nothing recorded yet: read as "all levels in the current
  // class" (REQ-MCL-003) — turning the toggle on must never lose a build.
  if (splitChoices.length === 0) return rawPath();

  const assignments: ClassLevelAssignment[] = [];
  const classLevels: Record<string, number> = {};

  for (const choice of splitChoices) {
    const level = choice.level;
    if (level < 1 || level > characterLevel) continue;
    const matched = matchClass(choice, classes);
    // An unresolvable level is DROPPED, never guessed onto another class:
    // assigning it wrongly would move HP, proficiencies and feat eligibility
    // to a class the player never took. The schema refinement (REQ-MCL-012)
    // is what surfaces the inconsistency to a human.
    if (!matched) continue;
    assignments.push({ characterLevel: level, classKey: matched.key });
    classLevels[matched.key] = (classLevels[matched.key] ?? 0) + 1;
  }

  if (assignments.length === 0) return rawPath();

  return {
    variantActive: true,
    ctx: classLevelContext(classLevels),
    firstClass: assignments.find((entry) => entry.characterLevel === 1)?.classKey,
    assignments,
    classes: byKey,
  };
}
