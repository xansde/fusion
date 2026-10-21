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
import { caminhoDeArteValido } from "./imagemDoAtor.js";

/** Upload and return the `/assets/<name>` path to store in the actor's `img`. */
export async function publicarMiniatura(png: Blob, modo: ModoMiniatura): Promise<string> {
  const token = await fusionApi.getFreshToken();
  if (token === null) throw new Error("Not authenticated.");
  const arquivo = new File([png], `avatar-${modo}.png`, { type: "image/png" });
  const resultado = await uploadAsset(token, arquivo, undefined, { purpose: "avatar" });
  const caminho: unknown = `/assets/${resultado.path}`;
  // Never hand back something that, written to `img`, would blank or break the
  // actor's art: a missing/odd name from the server aborts the whole operation.
  if (!caminhoDeArteValido(caminho))
    throw new Error(`Unexpected upload path: ${JSON.stringify(caminho)}`);
  return caminho;
}
