/**
 * @fusion/system-etmos — Item `frase_magica` schema (Compositor slots).
 *
 * The heart of the Compositor de Magias data model. Slots reference
 * Partículas by stable `slug` (design doc §1.2), never by embedded `_id` —
 * a saved frase must survive re-import/reset of the packs.
 *
 * `caracteristica_slugs` holds the ordered list of pure Características;
 * `criadores` holds the Complemento Criadores and which Característica (or,
 * for `mut`, which Objeto-used-as-Característica) each applies to; this
 * separation keeps montarFrase()/validarFrase() pure and mirrors the SRD
 * grammar (Criadores modify Características BEFORE assembly; Modificadores
 * are trailing words) — design doc §1.3 nota de design.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `FraseMagicaSystem`.
 * Design doc m5-etmos-compositor.md §1.3.
 *
 * REQ-ETM-027, REQ-ETM-028, REQ-ETM-034 [V2 favoritos].
 */
import { z } from "zod";
import { ComplexidadeSchema } from "../types.js";

/**
 * A Complemento Criador (`ada`, `no`, `mut`, `ag`) applied to a target within
 * the frase.
 *
 * `alvo` is:
 *   - a single index into `caracteristica_slugs` for "prefix" Criadores that
 *     attach to a Característica (`ada`, `no`);
 *   - a single index into `caracteristica_slugs` for `mut` too — `mut`
 *     prefixes an OBJETO used as a Característica, but in the slot model
 *     that Objeto is represented as an entry in `caracteristica_slugs`
 *     carrying an Objeto's slug (see validar-frase.ts / montar-frase.ts for
 *     how `mut`'s target resolution differs from `ada`/`no`'s);
 *   - a tuple `[a, b]` of two DISTINCT indices into `caracteristica_slugs`
 *     for the "connector" Criador (`ag`), which fuses exactly two
 *     Características.
 */
export const CriadorAplicadoSchema = z.object({
  /** "ada" | "no" | "mut" | "ag" */
  slug: z.string().min(1),
  alvo: z.union([
    z.number().int().min(0),
    z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  ]),
});
export type CriadorAplicado = z.infer<typeof CriadorAplicadoSchema>;

export const FraseMagicaSystemSchema = z.object({
  /** Exactly 1 Função (REQ-ETM-028 rule 1) — enforced by validarFrase, not the schema. */
  funcao_slug: z.string().default(""),
  /** ≥1 Objeto (REQ-ETM-028 rule 2) — enforced by validarFrase, not the schema. */
  objeto_slugs: z.array(z.string()).default([]),
  /** 0+ Características, order matters (feeds montarFrase word order). */
  caracteristica_slugs: z.array(z.string()).default([]),
  /** 0+ Complemento Criadores linked to a target inside caracteristica_slugs. */
  criadores: z.array(CriadorAplicadoSchema).default([]),
  /** 0+ Complemento Modificadores (suffix words), in the order chosen. */
  modificador_slugs: z.array(z.string()).default([]),
  /** Free-text declared Intenção — required by the Compositor UI, not the schema. */
  intencao: z.string().default(""),
  /** Cached display output of montarFrase() — regenerated whenever slots change. */
  frase_completa: z.string().default(""),
  /** null until the Narrador arbitrates (D4). */
  complexidade: ComplexidadeSchema.nullable().default(null),
  /** Applied Estresse cost (custoEstresse output, incl. rank Totem). */
  estresse_gerado: z.number().int().min(0).default(0),
  /** True when saved as a reusable "magia conhecida" (REQ-ETM-034 [V2]). */
  favorita: z.boolean().default(false),
});

export type FraseMagicaSystem = z.infer<typeof FraseMagicaSystemSchema>;

export function parseFraseMagicaSystem(data: unknown): FraseMagicaSystem {
  return FraseMagicaSystemSchema.parse(data);
}
