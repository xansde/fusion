/**
 * MountState — who is riding whom (BHR-F5-02, spec 52 REQ-PET-123, REQ-BHR-174..176,
 * docs/design/bhrotto/tasks.md §2.5).
 *
 * The state lives on the two tokens of the scene, in `flags.fusion.mount`:
 *   rider token: `{ mountTokenId }`   mount token: `{ riderTokenId }`
 * It is written only by `mount:mount` / `mount:dismount` (the server checks adjacency, size and
 * the companion link). The token carries NO "Montado" badge (Q-BHR-01, DEC-TOK-19): the sheet
 * strip is the only place the state shows.
 */

import { z } from "zod";

/** `flags.fusion.mount` — namespace and key on a Token. */
export const MOUNT_FLAG_NAMESPACE = "fusion" as const;
export const MOUNT_FLAG_KEY = "mount" as const;

export interface MountState {
  /** Set on the MOUNT token: the token riding it. */
  riderTokenId?: string;
  /** Set on the RIDER token: the token being ridden. */
  mountTokenId?: string;
}

/** `mount:mount` — the rider climbs onto the mount. Everything else is decided on the server. */
export const MountMountPayloadSchema = z.object({
  riderTokenId: z.string().min(1),
  mountTokenId: z.string().min(1),
});
export type MountMountPayload = z.infer<typeof MountMountPayloadSchema>;

/** `mount:dismount` — the rider steps down to an adjacent empty square (`to`, scene pixels). */
export const MountDismountPayloadSchema = z.object({
  riderTokenId: z.string().min(1),
  to: z.object({ x: z.number().finite(), y: z.number().finite() }),
});
export type MountDismountPayload = z.infer<typeof MountDismountPayloadSchema>;

/** Read `flags.fusion.mount` off a token-shaped document; never throws, never trusts the shape. */
export function readMountState(token: unknown): MountState {
  if (typeof token !== "object" || token === null) return {};
  const flags = (token as Record<string, unknown>)["flags"];
  if (typeof flags !== "object" || flags === null) return {};
  const ns = (flags as Record<string, unknown>)[MOUNT_FLAG_NAMESPACE];
  if (typeof ns !== "object" || ns === null) return {};
  const raw = (ns as Record<string, unknown>)[MOUNT_FLAG_KEY];
  if (typeof raw !== "object" || raw === null) return {};
  const { riderTokenId, mountTokenId } = raw as Record<string, unknown>;
  return {
    ...(typeof riderTokenId === "string" && riderTokenId !== "" ? { riderTokenId } : {}),
    ...(typeof mountTokenId === "string" && mountTokenId !== "" ? { mountTokenId } : {}),
  };
}

/** True when the token is a rider (mounted on something). */
export function isMounted(token: unknown): boolean {
  return readMountState(token).mountTokenId !== undefined;
}

/**
 * The pack effect "Montado" (-2 circumstance to Reflex saves, BHR-F5-04, REQ-BHR-177): `mount:mount`
 * embeds it on the rider's actor, `mount:dismount` removes it. Looked up in the compendium by the
 * server; the `docId` is also the `system.fusion.origin.itemSourceId` the embedded copy carries.
 */
export const MOUNTED_EFFECT_REF = {
  packId: "pf2e.effects-ranger-homebrew",
  docId: "HbEfMountedStat1",
} as const;
