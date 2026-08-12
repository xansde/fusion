/**
 * mapPackageIo.ts — carrying a region map between worlds, from the GM's side.
 *
 * Spec: 34 §5.5 (REQ-MREG-018/019/022/023/024), DEC-MREG-07.
 *
 * The engine that decides what a package contains lives in `@fusion/shared`
 * (`map-package.ts`) and is deliberately ignorant of browsers. This module is
 * the thin layer between it and the panel: a filename, a download, a file the
 * user picked, and the fields that create the map on the other side.
 *
 * It is a module rather than code inside `RegionMapPanel.svelte` for the usual
 * reason in this codebase — the client's Vitest runs in `environment: "node"`,
 * where a `.svelte` file has no DOM to mount into, and the rules worth testing
 * here (what a wrong file says, and that an imported map arrives hidden) are
 * exactly the ones nobody would catch by clicking around.
 */

import type { Socket } from "socket.io-client";
import {
  FusionMapPackageSchema,
  FUSION_MAP_FORMAT,
  OwnershipLevel,
  mapPackageToRegionMap,
  regionMapToPackage,
  type FusionMapPackage,
  type MapPin,
  type RegionMapDocument,
} from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

/** Document type as the server names it on the wire. */
const DOC_TYPE = "RegionMap";

/** Extension the file gets, so a package is recognisable in a downloads folder. */
export const MAP_PACKAGE_SUFFIX = ".fusion-map.json";

/** Unicode combining marks, which is what NFD leaves behind once folded. */
const COMBINING_MARKS = /[̀-ͯ]/g;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * A filename for the map, safe on any filesystem.
 *
 * Accents are folded rather than stripped so "Ruínas" stays readable as
 * "ruinas"; everything else collapses into hyphens. A name that reduces to
 * nothing (punctuation only, or blank) falls back to `mapa` — the alternative
 * is a file called `.fusion-map.json`, which is a hidden file on every Unix and
 * a confusing one on Windows.
 */
export function packageFilename(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "mapa" : slug}${MAP_PACKAGE_SUFFIX}`;
}

/**
 * The package as the text that goes in the file.
 *
 * Indented on purpose: REQ-MREG-019 wants a file a GM can open in a text
 * editor and change by hand, and a single-line JSON is not that file.
 */
export function serialiseMapPackage(map: RegionMapDocument): string {
  return `${JSON.stringify(regionMapToPackage(map), null, 2)}\n`;
}

/**
 * Hand the browser a download of this map's package.
 *
 * The image does NOT travel inside it (DEC-MREG-07) — the package names the
 * file it expects and the importer picks it on the way in.
 */
export function downloadMapPackage(map: RegionMapDocument): void {
  const blob = new Blob([serialiseMapPackage(map)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = packageFilename(map.name);
  anchor.click();
  // Revoking immediately would race the download in some browsers; a turn of
  // the event loop is enough and leaks nothing.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Read a package out of the text of a file the user chose.
 *
 * Three failures are told apart on purpose, because they need three different
 * things from the GM: this is not JSON (wrong file entirely), this is JSON but
 * not a map (right idea, wrong export), and this is a map from a newer Fusion
 * (REQ-MREG-023 — refuse rather than guess at fields we do not have).
 */
export function parseMapPackage(text: string): FusionMapPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("O arquivo escolhido não é um arquivo JSON.");
  }

  const format = (raw as { format?: unknown } | null)?.format;
  if (typeof format === "number" && format !== FUSION_MAP_FORMAT) {
    throw new Error(
      `Formato de pacote de mapa desconhecido: ${String(format)} ` +
        `(esta versão lê ${String(FUSION_MAP_FORMAT)}).`,
    );
  }

  const parsed = FusionMapPackageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("O arquivo é JSON, mas não é um pacote de mapa do Fusion.");
  }
  return parsed.data;
}

/** The document fields a `doc:create` needs to raise this package as a map. */
export interface MapCreateFields {
  name: string;
  image: string | null;
  imageWidth: number;
  imageHeight: number;
  scaleValue: number;
  scaleUnits: string;
  pins: MapPin[];
  ownership: Record<string, OwnershipLevel>;
}

/**
 * Turn a package into the fields of a new map in THIS world.
 *
 * Every pin arrives hidden and authorless — `mapPackageToRegionMap` is what
 * guarantees it, and the test suite states it as a rule rather than trusting
 * this call site. The map itself arrives open to the table: what a party
 * discovers is the pins, and a map nobody can open is a map the GM has to
 * remember to publish.
 */
export function packageToCreateFields(
  pkg: FusionMapPackage,
  image: string | null,
): MapCreateFields {
  const map = mapPackageToRegionMap(pkg, { image });
  return {
    name: map.name,
    image: map.image,
    imageWidth: map.imageWidth,
    imageHeight: map.imageHeight,
    scaleValue: map.scaleValue,
    scaleUnits: map.scaleUnits,
    pins: map.pins,
    ownership: { default: OwnershipLevel.OBSERVER },
  };
}

/** Create the imported map on the server. GM only — the server enforces it. */
export async function importMapPackage(
  socket: Socket,
  pkg: FusionMapPackage,
  image: string | null,
): Promise<string> {
  const result = await sendOp<{ documents: Array<{ _id: string }> }>(socket, {
    type: "doc:create",
    payload: { documentType: DOC_TYPE, data: [packageToCreateFields(pkg, image)] },
  });
  const id = result.documents[0]?._id;
  if (id === undefined) throw new Error("o servidor não devolveu o mapa importado");
  return id;
}
