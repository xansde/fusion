/**
 * show-players.ts — the GM's "Show Players" (an image and/or a short note opened
 * on every connected screen).
 *
 * Travels on the ephemeral channel as `presence:show`: nothing is stored, and a
 * player who connects later does not see it. The server is the gate:
 *   - only a privileged role may send it (the handler checks);
 *   - the image name goes through the same hygiene as the asset mint, and is
 *     refused rather than repaired;
 *   - a player cannot open an arbitrary file, so each recipient gets a DOC-scope
 *     asset grant signed for THAT user and THAT exact name (asset-grant.ts). The
 *     grant rides in the event: no extra round-trip, nothing to mint client-side.
 */

import { z } from "zod";
import { canonicalizeAssetName } from "../assets/asset-name.js";
import { ASSET_GRANT_TTL_MS, signDocGrant } from "../assets/asset-grant.js";
import { assetNameRefusalReason } from "../assets/routes.js";

export const ShowPlayersPayloadSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    text: z.string().trim().max(2000).optional(),
    /** Asset name as stored (percent-decoded), e.g. "maps/castle.webp". */
    image: z.string().max(512).optional(),
  })
  .refine((v) => Boolean(v.title) || Boolean(v.text) || Boolean(v.image), {
    message: "Nothing to show",
  });
export type ShowPlayersPayload = z.infer<typeof ShowPlayersPayloadSchema>;

/** What each recipient receives. */
export interface ShowPlayersBroadcast {
  title?: string;
  text?: string;
  image?: { name: string; token: string; exp: number; userId: string };
  fromName?: string;
}

/**
 * The canonical image name, or null when the name must not be shown.
 * `undefined` input (a note without picture) is not an error.
 */
export function cleanShowImage(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw === "") return undefined;
  const name = canonicalizeAssetName(raw);
  return assetNameRefusalReason(name) === null ? name : null;
}

/** Build the payload for ONE recipient, signing the image grant for them. */
export function showPayloadFor(
  recipientUserId: string,
  base: { title?: string; text?: string; imageName?: string; fromName?: string },
  secret: Uint8Array | undefined,
  nowMs: number = Date.now(),
): ShowPlayersBroadcast {
  const out: ShowPlayersBroadcast = {};
  if (base.title) out.title = base.title;
  if (base.text) out.text = base.text;
  if (base.fromName) out.fromName = base.fromName;
  if (base.imageName !== undefined && secret) {
    const exp = nowMs + ASSET_GRANT_TTL_MS;
    out.image = {
      name: base.imageName,
      exp,
      userId: recipientUserId,
      token: signDocGrant(recipientUserId, exp, base.imageName, secret),
    };
  }
  return out;
}
