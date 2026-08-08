/**
 * Loading the avatar acervo (catalog, palettes, credits) over HTTP.
 *
 * The acervo is published at `/avatar/*` by the Vite plugin in
 * vite-plugins/waybuilder-avatar.ts — out of node_modules in dev, out of
 * `dist/avatar/` (and therefore out of the packaged executable) in production.
 *
 * Nothing here is imported statically: the catalog alone is 1.7 MB, which as an
 * `import` would be inlined into a JS chunk that every page load pays for. It is
 * fetched the first time an avatar has to be drawn and then cached for the
 * session — the acervo is immutable per pinned commit, so a second read can only
 * return the same bytes.
 *
 * The in-flight promise is cached, not just the result: the corner overlay and
 * the creator window can both ask on the same tick, and two 1.7 MB fetches for
 * the same file would be pure waste.
 */

import type { Catalogo } from "waybuilder-avatar";
import type { ArquivoDePaleta, PaletasCarregadas } from "./paletas.js";

/** URL prefix; mirrors AVATAR_URL_PREFIX in the Vite plugin. */
export const AVATAR_BASE = "/avatar/";

/** Absolute URL of an acervo-relative path (`atlas/body/L1/male.png`). */
export function acervoUrl(relativo: string): string {
  return `${AVATAR_BASE}${relativo}`;
}

/** Raised when the acervo is not reachable — surfaced in the UI, never swallowed. */
export class AcervoIndisponivel extends Error {
  constructor(
    readonly arquivo: string,
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `acervo do avatar indisponível: ${arquivo}`
        : `acervo do avatar indisponível: ${arquivo} (HTTP ${String(status)})`,
    );
    this.name = "AcervoIndisponivel";
  }
}

async function lerJson<T>(relativo: string): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(acervoUrl(relativo));
  } catch {
    throw new AcervoIndisponivel(relativo);
  }
  if (!resposta.ok) throw new AcervoIndisponivel(relativo, resposta.status);
  return (await resposta.json()) as T;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

let catalogoEmVoo: Promise<Catalogo> | null = null;

export function carregarCatalogo(): Promise<Catalogo> {
  if (catalogoEmVoo === null) {
    catalogoEmVoo = lerJson<Catalogo>("catalogo.json").catch((erro: unknown) => {
      // Drop the rejected promise so a retry (reopening the creator after the
      // server came back) actually re-fetches instead of replaying the failure.
      catalogoEmVoo = null;
      throw erro;
    });
  }
  return catalogoEmVoo;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const paletas = new Map<string, ArquivoDePaleta>();
const paletasEmVoo = new Map<string, Promise<void>>();

/**
 * Ensure the given palette files are loaded, then hand back everything loaded
 * so far (which is what resolverRampas takes).
 *
 * A file that fails to load is remembered as EMPTY rather than retried on every
 * frame: resolverRampas then returns null for colours that needed it and those
 * layers draw in their base art — a wrong colour beats a request storm.
 */
export async function garantirPaletas(arquivos: readonly string[]): Promise<PaletasCarregadas> {
  const pendentes: Promise<void>[] = [];
  for (const arquivo of arquivos) {
    if (paletas.has(arquivo)) continue;
    let voo = paletasEmVoo.get(arquivo);
    if (voo === undefined) {
      voo = lerJson<ArquivoDePaleta>(arquivo)
        .then((conteudo) => {
          paletas.set(arquivo, conteudo);
        })
        .catch(() => {
          paletas.set(arquivo, {});
        })
        .finally(() => {
          paletasEmVoo.delete(arquivo);
        });
      paletasEmVoo.set(arquivo, voo);
    }
    pendentes.push(voo);
  }
  if (pendentes.length > 0) await Promise.all(pendentes);
  return paletas;
}

/** Palettes loaded so far — synchronous, for a draw pass that cannot await. */
export function paletasCarregadas(): PaletasCarregadas {
  return paletas;
}

// ---------------------------------------------------------------------------
// Credits (REQ-LEG: attribution is mandatory for the LPC art)
// ---------------------------------------------------------------------------

/**
 * The acervo's generated attribution: upstream source, pin and author list.
 *
 * Shape is whatever `build.py` emits from the upstream `CREDITS.csv`; the UI
 * treats it as opaque display data, so it is typed loosely on purpose — a
 * stricter type here would turn an upstream field rename into a broken panel.
 */
export type Creditos = Record<string, unknown>;

let creditosEmVoo: Promise<Creditos> | null = null;

export function carregarCreditos(): Promise<Creditos> {
  if (creditosEmVoo === null) {
    creditosEmVoo = lerJson<Creditos>("creditos.json").catch((erro: unknown) => {
      creditosEmVoo = null;
      throw erro;
    });
  }
  return creditosEmVoo;
}

/** Drop every cache. Tests only — the acervo does not change at runtime. */
export function limparAcervo(): void {
  catalogoEmVoo = null;
  creditosEmVoo = null;
  paletas.clear();
  paletasEmVoo.clear();
}
