/**
 * TokenMark — a persistent mark an actor places on a token (BHR-F3-06).
 *
 * The Ranger's Prey is the first user: it is NOT the ephemeral target
 * (REQ-CBT-055 clears that at the end of the targeter's turn). A mark lives on
 * the actor that placed it (`Actor.flags.fusion.tokenMarks`), survives
 * `turnEnd` and a scene change, and leaves only by a new exclusive mark, an
 * explicit `mark:clear`, or the GM.
 *
 * Wire shape: `mark:set` / `mark:clear` (spec 52 REQ-BHR-086..090,
 * docs/design/bhrotto/tasks.md §2.1). The client only DESCRIBES the mark
 * (slug + token); `targetActorId`, `sceneId` and `createdAt` are the server's
 * to write, and `exclusive` is forced on for the slugs that are exclusive by rule.
 */

import { z } from "zod";

/** `flags.fusion.tokenMarks` — namespace and key of the persisted list. */
export const TOKEN_MARKS_FLAG_NAMESPACE = "fusion" as const;
export const TOKEN_MARKS_FLAG_KEY = "tokenMarks" as const;

/** Slug of the Ranger's Hunt Prey mark (`target:mark:hunted-prey`). */
export const HUNTED_PREY_MARK_SLUG = "hunted-prey" as const;
/** Slug of the Monster Hunter mark (`target:mark:monster-hunter`). */
export const MONSTER_HUNTER_MARK_SLUG = "monster-hunter" as const;

/** Slugs whose mark is exclusive per actor by rule — the server forces it, never the client. */
export const EXCLUSIVE_MARK_SLUGS: readonly string[] = [HUNTED_PREY_MARK_SLUG];

export interface TokenMark {
  /** Vocabulary of the `target:mark:<slug>` predicate. */
  slug: "hunted-prey" | "monster-hunter" | (string & {});
  targetTokenId: string;
  /** Kept so the mark can be re-read after the token is replaced. */
  targetActorId: string;
  sceneId: string;
  createdAt: number;
  /** A new mark of the same slug on the same actor REPLACES the previous one. */
  exclusive: boolean;
}

export const TokenMarkSchema = z.object({
  slug: z.string().min(1),
  targetTokenId: z.string().min(1),
  targetActorId: z.string().min(1),
  sceneId: z.string().min(1),
  createdAt: z.number(),
  exclusive: z.boolean(),
});

/** `mark:set` — what the client may say; everything else is resolved on the server. */
export const MarkSetPayloadSchema = z.object({
  sourceActorId: z.string().min(1),
  mark: z.object({
    slug: z.string().min(1),
    targetTokenId: z.string().min(1),
    exclusive: z.boolean().optional(),
  }),
});
export type MarkSetPayload = z.infer<typeof MarkSetPayloadSchema>;

/** `mark:clear` — without `targetTokenId`, every mark of that slug on the actor goes. */
export const MarkClearPayloadSchema = z.object({
  sourceActorId: z.string().min(1),
  slug: z.string().min(1),
  targetTokenId: z.string().min(1).optional(),
});
export type MarkClearPayload = z.infer<typeof MarkClearPayloadSchema>;

/**
 * Read `flags.fusion.tokenMarks` off an actor-shaped document, dropping any
 * entry that is not a well-formed mark (never throws, never trusts the shape).
 */
export function readTokenMarks(actor: unknown): TokenMark[] {
  if (typeof actor !== "object" || actor === null) return [];
  const flags = (actor as Record<string, unknown>)["flags"];
  if (typeof flags !== "object" || flags === null) return [];
  const ns = (flags as Record<string, unknown>)[TOKEN_MARKS_FLAG_NAMESPACE];
  if (typeof ns !== "object" || ns === null) return [];
  const raw = (ns as Record<string, unknown>)[TOKEN_MARKS_FLAG_KEY];
  if (!Array.isArray(raw)) return [];
  const marks: TokenMark[] = [];
  for (const entry of raw) {
    const parsed = TokenMarkSchema.safeParse(entry);
    if (parsed.success) marks.push(parsed.data);
  }
  return marks;
}

/**
 * True when an expanded Actor patch could write or erase `flags.fusion.tokenMarks`:
 * the key itself, the whole `fusion` namespace (an object holding it, or `null`
 * wiping it) or `flags` set to a non-object. The server refuses this for
 * non-privileged writers on `doc:update` — `mark:set`/`mark:clear` are the door.
 */
export function touchesTokenMarksFlag(expanded: unknown): boolean {
  if (typeof expanded !== "object" || expanded === null || !("flags" in expanded)) return false;
  const flags = (expanded as Record<string, unknown>)["flags"];
  if (typeof flags !== "object" || flags === null) return true;
  if (!(TOKEN_MARKS_FLAG_NAMESPACE in flags)) return false;
  const ns = (flags as Record<string, unknown>)[TOKEN_MARKS_FLAG_NAMESPACE];
  if (typeof ns !== "object" || ns === null) return true;
  return TOKEN_MARKS_FLAG_KEY in ns;
}

/**
 * Create-time twin of the `doc:update` guard: a non-privileged creator loses any
 * `flags.fusion.tokenMarks` the payload carries (the player-companion path would
 * otherwise author marks `mark:set` refuses). Same reference when nothing to drop.
 */
export function stripTokenMarksOnCreate<T extends Record<string, unknown>>(
  doc: T,
  privileged: boolean,
): T {
  if (privileged) return doc;
  const flags = doc["flags"];
  if (typeof flags !== "object" || flags === null) return doc;
  const ns = (flags as Record<string, unknown>)[TOKEN_MARKS_FLAG_NAMESPACE];
  if (typeof ns !== "object" || ns === null || !(TOKEN_MARKS_FLAG_KEY in ns)) return doc;
  const { [TOKEN_MARKS_FLAG_KEY]: dropped, ...rest } = ns as Record<string, unknown>;
  void dropped;
  return { ...doc, flags: { ...flags, [TOKEN_MARKS_FLAG_NAMESPACE]: rest } };
}
