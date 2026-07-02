/**
 * @fusion/system-etmos — shared test fixture data.
 *
 * `PALAVRA_BY_SLUG` is a slug -> palavra_etmos map covering every Partícula
 * slug referenced by the golden fixtures G1-G10 (+G7b) in
 * `docs/design/m5-etmos-compositor.md` §5. Values verified against the real
 * pack data in `systems/etmos/packs-src/particulas.json` (`palavra_etmos`
 * field), NOT invented — see the batch context transcription.
 *
 * Clean-room: mechanical identifiers only (slugs + single Etmos words already
 * public in the committed packs-src), no SRD prose.
 */

export const PALAVRA_BY_SLUG: Readonly<Record<string, string>> = {
  // Funções used by the fixtures
  et: "Et",
  ev: "Ev",
  al: "Al",
  ar: "Ar",
  un: "Un",
  em: "Em",
  an: "An",
  // Objetos
  imu: "Imu",
  eli: "Eli",
  ayu: "Ayu",
  ivi: "Ivi",
  exa: "Exa",
  // Características
  quan: "Quan",
  aer: "Aer",
  tum: "Tum",
  ast: "Ast",
  phys: "Phys",
  // Complementos (words carry the SRD's trailing "-" for prefix Criadores)
  mor: "Mor",
  min: "Min",
  san: "San",
  sar: "Sar",
  sin: "Sin",
  ag: "Ag",
  ada: "Ada-",
  no: "No-",
  mut: "Mut-",
  itam: "Itam",
};

/** `resolvePalavra` fixture for `montarFrase`, backed by `PALAVRA_BY_SLUG`. */
export function resolvePalavraFixture(slug: string): string {
  const palavra = PALAVRA_BY_SLUG[slug];
  if (palavra === undefined) {
    throw new Error(`[fixtures] unknown slug in test fixture map: "${slug}"`);
  }
  return palavra;
}

/**
 * A permissive Grimório view (design doc §2.2 note 4: level-1 Complementos
 * available by default) that also knows every slug used by the golden
 * fixtures, INCLUDING the higher-level Criadores (ada/no/mut level 3, ag
 * level 2, itam level 4) — this represents an experienced caster whose
 * Grimório level covers every fixture (G1-G8 are all "sim válida" per the
 * design doc, gated only by nivelGrimorio, not by slug absence).
 */
export function fullGrimorioFixture(grimorioLevel = 4): {
  hasSlug(slug: string): boolean;
  grimorioLevel: number;
} {
  return {
    hasSlug: (slug: string) => slug in PALAVRA_BY_SLUG,
    grimorioLevel,
  };
}
