/**
 * arteDeAvatar.ts — recognises the files the avatar creator publishes.
 *
 * Kept apart from the uploader on purpose: the token renderer imports this, and
 * must not pull the HTTP client in with it.
 */

/** Stored names are `<slug>-<8 or 16 hex>.png`; the slug keeps our prefix. */
const ARTE_DE_AVATAR = /(^|\/)avatar-(token|retrato)-[0-9a-f]{8,16}\.png$/;

/** Whether an actor `img` path is avatar pixel art (so it must be drawn without smoothing). */
export function ehArteDeAvatar(caminho: string | null | undefined): boolean {
  return typeof caminho === "string" && ARTE_DE_AVATAR.test(caminho);
}
