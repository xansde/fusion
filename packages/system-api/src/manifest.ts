/**
 * SystemManifest schema and types.
 *
 * REQ-SYS-002: Manifest must be validated by Zod on load.
 * REQ-SYS-003: Minimum required fields: id, title, version, engineCompat, authors,
 *              documentTypes, languages.
 * REQ-SYS-004: Optional fields: grid, initiative, primaryBarAttribute, secondaryBarAttribute.
 * REQ-SYS-005: Manifest must declare packs[].
 * REQ-SYS-009: Optional field: sizeToFootprint (size category → token footprint).
 */
import { z } from "zod";
import semver from "semver";

/** Zod refinement: validates a semver string. */
function isSemver(val: string): boolean {
  return semver.valid(val) !== null;
}

/** Zod refinement: validates a semver range string. */
function isSemverRange(val: string): boolean {
  return semver.validRange(val) !== null;
}

// Document types that can have system subtypes
export const DocumentTypeSchema = z.union([
  z.literal("Actor"),
  z.literal("Item"),
  z.literal("ActiveEffect"),
  z.literal("JournalPage"),
  z.literal("ChatMessage"),
  z.literal("Combatant"),
  z.literal("Scene"),
  z.literal("JournalEntry"),
  z.literal("RollTable"),
  z.literal("Playlist"),
  z.literal("Macro"),
  z.literal("Combat"),
  z.literal("Folder"),
  z.literal("Setting"),
  z.literal("World"),
  z.literal("User"),
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const SystemManifestSchema = z.object({
  /** Stable identifier, e.g. "pf2e". Must be lowercase kebab. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab-case"),

  /** Display name, e.g. "Pathfinder 2e (Remaster)". */
  title: z.string().min(1),

  /** SemVer version of the system itself. */
  version: z.string().refine(isSemver, { message: "version must be a valid semver string" }),

  /** SemVer range of engine versions this system is compatible with. */
  engineCompat: z
    .string()
    .refine(isSemverRange, { message: "engineCompat must be a valid semver range" }),

  /** Authors of the system. */
  authors: z
    .array(
      z.object({
        name: z.string().min(1),
        url: z.string().url().optional(),
      }),
    )
    .min(1),

  /**
   * Document subtypes registered by this system.
   * Key is DocumentType, value is an array of subtype strings.
   * Keys are validated against DocumentTypeSchema at runtime (a typo such as
   * "Actr" must fail manifest validation); the permissive string index keeps
   * the inferred type assignable from partial manifests.
   */
  documentTypes: z.record(z.string(), z.array(z.string())).superRefine((rec, ctx) => {
    for (const key of Object.keys(rec)) {
      if (!DocumentTypeSchema.safeParse(key).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `unknown document type "${key}" in documentTypes`,
        });
      }
    }
  }),

  /** Language bundles provided by the system. */
  languages: z.array(
    z.object({
      lang: z.string().min(1),
      name: z.string().min(1),
      path: z.string().min(1),
    }),
  ),

  /** Compendium packs announced by this system. */
  packs: z
    .array(
      z.object({
        name: z.string().min(1),
        label: z.string().min(1),
        documentType: z.string().min(1),
        system: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .optional(),

  /** Default grid configuration. */
  grid: z
    .object({
      distance: z.number().positive(),
      units: z.string().min(1),
    })
    .optional(),

  /** ID of the InitiativeFormula registered by this system. */
  initiative: z.string().optional(),

  /** Path to the primary token bar attribute, e.g. "attributes.hp". */
  primaryBarAttribute: z.string().optional(),

  /** Path to the secondary token bar attribute. */
  secondaryBarAttribute: z.string().optional(),

  /**
   * Size category → token footprint (grid cells occupied), e.g.
   * `{ med: { width: 1, height: 1 }, lg: { width: 2, height: 2 } }`.
   *
   * REQ-SYS-009 (spec 15, emenda obrigada por 41-token.md DEC-TOK-03): the
   * `TokenDocument` carries no footprint field of its own — the engine derives
   * occupied cells from the effective actor's size category through this
   * mapping, never arbitrating the conversion itself. Optional; a system that
   * declares nothing produces no multi-cell footprint (every token occupies
   * one cell).
   */
  sizeToFootprint: z
    .record(
      z.string(),
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .optional(),

  /**
   * DEC-SYS-06-bis (spec 15, emenda 2026-09-24, mundo misto PF2e+SF2e): IDs
   * of the systems whose compendium packs this system *composes* — i.e. a
   * *composite* `SystemModule` that does not ship its own `packs/` directory,
   * but discovers and serves the real, already-registered packs of N other
   * systems side by side (no copy — REQ-SYS-006 stays intact in the letter:
   * "exactly one system active per world" remains true, the active system is
   * the composite itself).
   *
   * Absent/undefined = a normal, non-composite system (resolves its own
   * `systems/<id>/packs` as before). When present, `resolveSystemPacksDir`
   * is called once per id in this list instead of once for `manifest.id`
   * (see boot.ts / compendium/service.ts).
   */
  sourceSystemIds: z.array(z.string().min(1)).min(1).optional(),

  /**
   * I1 (spec 15, revisão adversarial 3, mundo misto pf2e+sf2e): the system's
   * VOCABULARY — skills (with governing ability), currency denominations and
   * spell traditions — as a single source a ficha package can read over the
   * wire (`system:vocabulary`, mirrors `system:footprint`/`system:conditions`
   * — REQ-ARQ-005: the client cannot import `systems/*`). Replaces the
   * hand-copied tables `sheets/pf2e/src/lib/sheets/pf2e/systemSheetConfig.ts`
   * used to keep (`SKILL_SLUGS`/`SKILL_ABILITY`/currency literals duplicated
   * per system, by hand, at the ficha layer — a skill added to a system
   * needed a ficha edit to ever appear there). A COMPOSITE system computes
   * its own vocabulary as the UNION of its `sourceSystemIds`' vocabularies
   * (skills by slug, spell traditions by value) with `currency` from its own
   * declaration (e.g. pf2e-sf2e keeps the PF2e coin shape, DEC-SYS-06-bis) —
   * never a copy of either source's literal list.
   *
   * Optional: a system that declares nothing here has no vocabulary door
   * (the ficha falls back to its own PF2e-shaped default, same "degrade
   * open" posture as `sizeToFootprint`).
   */
  vocabulary: z
    .object({
      skills: z.array(
        z.object({
          slug: z.string().min(1),
          ability: z.string().min(1),
        }),
      ),
      currency: z.array(z.string().min(1)),
      spellTraditions: z.array(z.string().min(1)),
    })
    .optional(),
});

export type SystemManifest = z.infer<typeof SystemManifestSchema>;

/**
 * Whether a world's active system "includes" `targetSystemId`'s behavior —
 * true when the active system IS `targetSystemId`, or (DEC-SYS-06-bis) it is
 * a *composite* system whose `sourceSystemIds` list it (spec 15, mundo misto
 * pf2e+sf2e).
 *
 * WHY THIS EXISTS: several server-side gates were written comparing a raw
 * `systemId` string against a single literal (`"pf2e"`, `"sf2e"`) — familiar
 * creation, the SF2e augmentation slot limit, etc. Under the composite
 * system those gates silently turned OFF, because the world's `systemId` is
 * `"pf2e-sf2e"`, never `"pf2e"` or `"sf2e"` themselves (I4, revisão
 * adversarial 3). Any gate that should apply transparently inside a
 * composite must go through this helper instead of `systemId === "..."`.
 *
 * Accepts either the systemId string, the sourceSystemIds list, or both
 * (whatever the caller already has on hand) so it works from both a bare
 * `systemId` and a resolved `SystemModule.manifest`.
 */
export function systemIncludes(
  info: { systemId?: string | undefined; sourceSystemIds?: readonly string[] | undefined },
  targetSystemId: string,
): boolean {
  if (info.systemId === targetSystemId) return true;
  return info.sourceSystemIds?.includes(targetSystemId) ?? false;
}
