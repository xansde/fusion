/**
 * publicarMiniatura.ts — sends the avatar PNG to the asset library.
 *
 * Uses `purpose=avatar`: open to every player (the generic upload needs TRUSTED),
 * PNG only, small, and always filed under the Tokens tab. The file name starts with
 * `avatar-token`/`avatar-retrato`, which is how the canvas later recognises pixel art
 * (see arteDeAvatar.ts) and skips texture smoothing.
 */

import { fusionApi } from "../api.js";
import { uploadAsset } from "../assets/assetApi.js";
import type { ModoMiniatura } from "./miniatura.js";

/** Upload and return the `/assets/<name>` path to store in the actor's `img`. */
export async function publicarMiniatura(png: Blob, modo: ModoMiniatura): Promise<string> {
  const token = await fusionApi.getFreshToken();
  if (token === null) throw new Error("Not authenticated.");
  const arquivo = new File([png], `avatar-${modo}.png`, { type: "image/png" });
  const resultado = await uploadAsset(token, arquivo, undefined, { purpose: "avatar" });
  return `/assets/${resultado.path}`;
}
