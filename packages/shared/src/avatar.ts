/**
 * Character avatar — the shape stored on the Actor document.
 *
 * The avatar is the player's paper-doll built from the `waybuilder-avatar`
 * acervo (a curated Liberated Pixel Cup cut). It is COSMETIC: no rule reads it,
 * so it lives in `flags.fusion.avatar` instead of `system`, which belongs to the
 * game system's own schema.
 *
 * What is stored is the SELECTION, never pixels: which piece sits in each slot
 * and which colour each of its channels got. The atlas offsets, layer order and
 * recolour ramps are all re-derived at draw time from the acervo's catalog —
 * so a piece that moves in the atlas between acervo bumps keeps working, and a
 * saved avatar costs a few hundred bytes on the document.
 *
 * Animation is deliberately NOT stored: it is presentation, chosen by whoever
 * draws (the corner overlay loops `idle`, the creator previews whatever the
 * player is inspecting). Storing it would freeze one screen's choice into every
 * other screen.
 *
 * `flags` is already declared on BaseDocumentSchema as
 * `Record<namespace, Record<key, unknown>>`, so the server persists this
 * without a schema change — but it also does not validate its INSIDE. Every
 * read therefore goes through {@link readAvatarFlag}, which parses defensively:
 * a hand-edited or older-format flag yields null (no avatar) instead of a
 * render-time crash.
 */

import { z } from "zod";

/** Flag namespace. `core` and `world` are reserved for the engine (REQ-DOC-009). */
export const AVATAR_FLAG_SCOPE = "fusion";

/** Flag key inside the namespace. */
export const AVATAR_FLAG_KEY = "avatar";

/** Dot path for doc:update patches — `flags.fusion.avatar`. */
export const AVATAR_FLAG_PATH = `flags.${AVATAR_FLAG_SCOPE}.${AVATAR_FLAG_KEY}`;

/** Current on-document format. Bump only on a breaking shape change. */
export const AVATAR_FORMAT_VERSION = 1;

/**
 * One equipped piece.
 *
 * `cores` is keyed by COLOUR CHANNEL (`cor`, `color_1`, `hat_secondary`…), not
 * by piece id: a helmet has independent metal and cloth axes. Values are either
 * an atlas band name (`black`) or a qualified palette colour (`ulpc:tan`) — the
 * acervo's renderer decides which by looking the value up in the piece's bands,
 * so both worlds coexist in one field.
 */
export const AvatarEscolhaSchema = z.object({
  id: z.string().min(1),
  cores: z.record(z.string(), z.string()).optional(),
});

export type AvatarEscolha = z.infer<typeof AvatarEscolhaSchema>;

/**
 * The stored avatar.
 *
 * `corpo` is the body variant (`male`, `female`, `teen`, `child`, `muscular`,
 * `pregnant`) — it selects which atlas of every piece is used, so it is part of
 * the identity and not a rendering option. Kept as a plain string rather than an
 * enum: the list belongs to the acervo's `recorte`, and hardcoding it here would
 * make a future acervo bump fail validation instead of just working.
 *
 * `selecao` is keyed by slot; pieces in the same slot are mutually exclusive,
 * which is exactly what a Record enforces.
 *
 * `pin` records the acervo's upstream pin at save time. Purely diagnostic —
 * when a piece id goes missing the renderer reports an orphan warning, and this
 * is what tells us whether the avatar predates an acervo bump.
 */
export const AvatarFlagSchema = z.object({
  versao: z.number().int().positive().default(AVATAR_FORMAT_VERSION),
  corpo: z.string().min(1),
  selecao: z.record(z.string(), AvatarEscolhaSchema).default(() => ({})),
  pin: z.string().optional(),
});

export type AvatarFlag = z.infer<typeof AvatarFlagSchema>;

/**
 * Read the avatar flag off a document, or null when there is none / it is junk.
 *
 * Accepts any shape (documents arrive as `Record<string, unknown>` from the
 * mirror) and never throws: an unparseable flag means "this actor has no
 * avatar", which degrades to the plain portrait instead of breaking the table.
 */
export function readAvatarFlag(doc: unknown): AvatarFlag | null {
  if (typeof doc !== "object" || doc === null) return null;
  const flags = (doc as { flags?: unknown }).flags;
  if (typeof flags !== "object" || flags === null) return null;
  const scope = (flags as Record<string, unknown>)[AVATAR_FLAG_SCOPE];
  if (typeof scope !== "object" || scope === null) return null;
  const raw = (scope as Record<string, unknown>)[AVATAR_FLAG_KEY];
  if (raw === undefined || raw === null) return null;

  const parsed = AvatarFlagSchema.safeParse(raw);
  if (!parsed.success) return null;
  // An avatar with nothing equipped draws nothing; treat it as absent so the
  // corner overlay and the sheet badge agree on "has an avatar".
  if (Object.keys(parsed.data.selecao).length === 0) return null;
  return parsed.data;
}

/** True when the document carries a drawable avatar. */
export function hasAvatar(doc: unknown): boolean {
  return readAvatarFlag(doc) !== null;
}
