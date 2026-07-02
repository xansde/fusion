/**
 * @fusion/system-etmos — Complemento connectivity table.
 *
 * Pure data table for the 10 Complemento (Complement) Partículas of the Etmos
 * grammar (design doc §1.4, spec 19 §Modelo de dados / REQ-ETM-028). Each
 * Complemento has a syntactic role (`ligacao`) that determines how it
 * attaches to the rest of a Frase Mágica when composed by `montarFrase` and
 * checked by `validarFrase`:
 *
 *   - `suffix`    — Modificador; a trailing word appended after everything
 *                   else, in the order the caster chose (Mor/Min/San/Sar/Sin/Itam).
 *   - `prefix`    — Criador; prefixes exactly ONE Característica (Ada-/No-)
 *                   or ONE Objeto used as a Característica (Mut-), lowercasing
 *                   the target's word and gluing it to the Complemento's word.
 *   - `connector` — Criador; sits BETWEEN exactly two Características (Ag),
 *                   fusing all three words into one (`QuanAgAer`).
 *
 * `nivelGrimorio` is the minimum Grimório level (1..4) the caster's copy of
 * the Complemento must have for it to be usable — cross-checked against the
 * real pack data in `systems/etmos/packs-src/particulas.json` (`complementos`
 * array, fields `id`/`nivel_grimorio`/`subtipo`) as of this writing:
 *
 *   mor/min/san/sar/sin → modificador, suffix,    nivel_grimorio: 1
 *   ag                  → criador,     connector, nivel_grimorio: 2
 *   ada/no/mut          → criador,     prefix,    nivel_grimorio: 3
 *   itam                → modificador, suffix,    nivel_grimorio: 4
 *
 * `ada`/`no` prefix a Característica; `mut` prefixes an OBJETO used as a
 * Característica — same `ligacao` value ("prefix") but a different target
 * kind. validarFrase/montarFrase distinguish them by slug (PREFIX_OBJETO_SLUG
 * vs. the rest), not by `ligacao` alone.
 *
 * This table is NOT a copy of the pack — it is the pure syntactic contract
 * the compositor functions depend on, independent of pack loading order.
 *
 * Clean-room: only mechanical identifiers (slugs, Etmos words, grimório
 * levels) are encoded — no book prose. Spec: 19-sistema-etmos.md (REQ-ETM-028).
 * Design doc: docs/design/m5-etmos-compositor.md §1.4.
 */
import type { LigacaoComplemento, SubtipoComplemento } from "./types.js";

/** One row of the Complemento connectivity table. */
export interface ComplementoSyntaxEntry {
  /** Stable slug — matches the `id` field in packs-src/particulas.json. */
  readonly slug: string;
  /** Etmos word as written in the SRD (trailing "-" marks a prefix glyph). */
  readonly palavra: string;
  readonly subtipo: SubtipoComplemento;
  readonly ligacao: NonNullable<LigacaoComplemento>;
  /** Minimum Grimório level (1..4) required to use this Complemento. */
  readonly nivelGrimorio: number;
}

/**
 * The 10 Complemento entries, in canonical pack order (modificadores de nível
 * 1, depois criadores, depois o modificador de nível 4 — Itam).
 */
export const PARTICULAS_SYNTAX: readonly ComplementoSyntaxEntry[] = [
  { slug: "mor", palavra: "Mor", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 1 },
  { slug: "min", palavra: "Min", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 1 },
  { slug: "san", palavra: "San", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 1 },
  { slug: "sar", palavra: "Sar", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 1 },
  { slug: "sin", palavra: "Sin", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 1 },
  { slug: "ag", palavra: "Ag", subtipo: "criador", ligacao: "connector", nivelGrimorio: 2 },
  { slug: "ada", palavra: "Ada-", subtipo: "criador", ligacao: "prefix", nivelGrimorio: 3 },
  { slug: "no", palavra: "No-", subtipo: "criador", ligacao: "prefix", nivelGrimorio: 3 },
  { slug: "mut", palavra: "Mut-", subtipo: "criador", ligacao: "prefix", nivelGrimorio: 3 },
  { slug: "itam", palavra: "Itam", subtipo: "modificador", ligacao: "suffix", nivelGrimorio: 4 },
] as const;

/** Lookup map by slug for O(1) access. */
export const PARTICULAS_SYNTAX_BY_SLUG: ReadonlyMap<string, ComplementoSyntaxEntry> = new Map(
  PARTICULAS_SYNTAX.map((entry) => [entry.slug, entry]),
);

/** Returns the syntax entry for a Complemento slug, or `undefined` if the slug isn't a Complemento. */
export function getComplementoSyntax(slug: string): ComplementoSyntaxEntry | undefined {
  return PARTICULAS_SYNTAX_BY_SLUG.get(slug);
}

/** True if `slug` identifies one of the 10 Complementos. */
export function isComplementoSlug(slug: string): boolean {
  return PARTICULAS_SYNTAX_BY_SLUG.has(slug);
}

/** Slugs of "prefix" Complementos that attach to exactly ONE Característica. */
export const PREFIX_CARACTERISTICA_SLUGS: ReadonlySet<string> = new Set(["ada", "no"]);

/** Slug of the Complemento that prefixes an Objeto (not a Característica). */
export const PREFIX_OBJETO_SLUG = "mut";

/** Slug of the único connector Complemento (links exactly 2 Características). */
export const CONNECTOR_SLUG = "ag";
