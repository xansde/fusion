/**
 * Avatar acervo SIDECAR for the release (decisoes 2026-10-21, item 10; spec 35 §6.1).
 *
 * The acervo (Liberated Pixel Cup art, per-piece licenses, share-alike pieces
 * among them) is NOT embedded in the executable: it is published as a folder
 * `avatar/` next to it, so the share-alike art stays separate from the Fusion
 * binary, the exe does not grow by ~22 MB, and the avatar creator already
 * degrades without it (REQ-AVT-054). The server finds the folder at
 * `<dir of the executable>/avatar` (packages/server/src/avatar/routes.ts).
 *
 * This module only builds the folder; build-release.mjs calls it after the
 * executable is assembled. Pure Node (fs) so it is unit-testable.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Folder name the server looks for next to the executable. */
export const AVATAR_SIDECAR_DIRNAME = "avatar";

/**
 * Exact names under dist-release/ that phase 0 removes before a new build.
 * Literal names on purpose: cleanup never works from a glob.
 */
export const AVATAR_SIDECAR_STALE_NAMES = [AVATAR_SIDECAR_DIRNAME, "NOTICE"];

/** Prefix of the optional zip of the sidecar (`fusion-avatar-acervo-<version>.zip`). */
export const AVATAR_SIDECAR_ZIP_PREFIX = "fusion-avatar-acervo-";

/**
 * Human-readable license summary from the acervo's own `creditos.json`.
 * Fails on a malformed file: a release must not ship without its attribution.
 */
export function renderAvatarLicenses(creditos) {
  const { fonte, pin, url, autores, licencas } = creditos ?? {};
  if (
    typeof fonte !== "string" ||
    typeof url !== "string" ||
    !Array.isArray(autores) ||
    typeof licencas !== "object" ||
    licencas === null
  ) {
    throw new Error("avatar creditos.json is missing fonte/url/autores/licencas");
  }

  const porLicenca = Object.entries(licencas)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([nome, quantidade]) => `  - ${nome}: ${String(quantidade)} peca(s)`)
    .join("\n");

  return [
    "FUSION VTT - ACERVO DO AVATAR (arte de terceiros)",
    "",
    `Fonte:   ${fonte}`,
    `Origem:  ${url}`,
    `Pin:     ${typeof pin === "string" ? pin : "(desconhecido)"}`,
    "",
    "Esta pasta contem a arte pixel-art do criador de avatar. Cada peca tem a sua",
    "propria licenca (contagem abaixo; autores e licenca de cada peca em creditos.json).",
    "Pecas apenas GPL ja ficam de fora do acervo.",
    "",
    "Licencas presentes:",
    porLicenca,
    "",
    "PNG gerado (token / retrato): tratado como obra derivada sob CC-BY-SA 3.0, a mais",
    "restritiva entre as licencas nao-GPL acima. Quem redistribui o PNG deve manter a",
    "atribuicao (ela vai gravada dentro do proprio PNG, nos chunks Source/License/Credits-URL)",
    "e licenciar a obra derivada sob a mesma licenca (share-alike / mesma licenca).",
    "",
    `Autores (${String(autores.length)}): ${autores.join(", ")}`,
    "",
    "COMO INSTALAR",
    `  Copie a pasta ${AVATAR_SIDECAR_DIRNAME}/ para o MESMO diretorio do executavel do Fusion`,
    `  (<pasta do executavel>/${AVATAR_SIDECAR_DIRNAME}/catalogo.json deve existir). Sem ela o Fusion`,
    "  funciona normalmente; so o criador de avatar fica indisponivel.",
    "  Alternativa: defina FUSION_AVATAR_DIR apontando para a pasta.",
    "",
  ].join("\n");
}

/**
 * Copy the acervo to `<outDir>/avatar/` (replacing a previous copy), add
 * `LICENSES.txt` and the `NOTICE` inside it, and a copy of the `NOTICE` at
 * `<outDir>/NOTICE`, beside the executable.
 */
export function emitAvatarSidecar({ acervoDir, outDir, noticePath }) {
  const creditosPath = join(acervoDir, "creditos.json");
  if (!existsSync(creditosPath)) {
    throw new Error(`avatar acervo at ${acervoDir} has no creditos.json — refusing to ship it`);
  }
  if (!existsSync(noticePath)) {
    throw new Error(`NOTICE not found at ${noticePath} — the avatar attribution lives there`);
  }
  const licenses = renderAvatarLicenses(JSON.parse(readFileSync(creditosPath, "utf8")));
  const notice = readFileSync(noticePath);

  const sidecarDir = join(outDir, AVATAR_SIDECAR_DIRNAME);
  mkdirSync(outDir, { recursive: true });
  rmSync(sidecarDir, { recursive: true, force: true });
  cpSync(acervoDir, sidecarDir, { recursive: true });
  writeFileSync(join(sidecarDir, "LICENSES.txt"), licenses);
  writeFileSync(join(sidecarDir, "NOTICE"), notice);
  writeFileSync(join(outDir, "NOTICE"), notice);

  return { sidecarDir, noticeCopy: join(outDir, "NOTICE") };
}
