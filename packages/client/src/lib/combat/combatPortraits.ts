/**
 * combatPortraits.ts — the Combate panel's portraits, signed through the asset grant.
 *
 * The asset route (`GET /assets/*`) needs a query grant an `<img>` cannot send as a header; the queue and the turn
 * head used to put the stored path straight into `src` and every portrait came back 401 (a broken image, seen live
 * 22/10/2026). The panel resolves each distinct image once against the Combat document (`combatants[].img` is a
 * grantable field of `combats`) and draws the drawn initial for whatever is not resolved.
 */
import { isPortraitPlaceholder } from "../common/portrait.js";

export interface CombatPortraitRow {
  readonly id: string;
  readonly img: string | null;
}

/** img → fetchable URL; rejects when the image cannot be signed. */
export type CombatPortraitResolver = (img: string) => Promise<string>;

/** combatant id → fetchable portrait URL, only for the rows whose image is real and was signed. */
export async function resolveCombatPortraits(
  rows: readonly CombatPortraitRow[],
  resolve: CombatPortraitResolver,
): Promise<Map<string, string>> {
  const byImage = new Map<string, Promise<string | null>>();
  for (const row of rows) {
    if (row.img === null || isPortraitPlaceholder(row.img) || byImage.has(row.img)) continue;
    byImage.set(
      row.img,
      resolve(row.img).then(
        (url) => url,
        () => null,
      ),
    );
  }
  const out = new Map<string, string>();
  for (const row of rows) {
    const pending = row.img === null ? undefined : byImage.get(row.img);
    if (pending === undefined) continue;
    const url = await pending;
    if (url !== null) out.set(row.id, url);
  }
  return out;
}
