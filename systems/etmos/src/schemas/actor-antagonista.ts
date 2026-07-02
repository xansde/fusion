/**
 * @fusion/system-etmos — Actor `antagonista` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `AntagonistaSystem`.
 * REQ-ETM-002, REQ-ETM-049, REQ-ETM-050.
 *
 * Note: antagonistas may have Atributo 0 (unlike Oradores, min 1 per D2) —
 * see packs-src/antagonistas.json "morto-vivo-simples" (mente:0, alma:0).
 */
import { z } from "zod";
import { AtributoAntagonistaSchema, ComplexidadeSchema, RecursoSchema } from "../types.js";

export const FichaBaseSchema = z.enum(["simples", "intermediaria", "avancada"]);
export type FichaBase = z.infer<typeof FichaBaseSchema>;

export const DefesaAtaqueSchema = z
  .enum(["completa", "parcial", "ineficaz", "contestada"])
  .nullable();

export const AntagonistaAtaqueSchema = z.object({
  nome: z.string().min(1),
  /** Exact damage allowed for antagonista attacks (REQ-ETM-050 SRD exception). */
  ferimentos: z.number().int().min(0).nullable().default(null),
  defesa: DefesaAtaqueSchema.default(null),
  alcance: z.string().default(""),
  descricao: z.string().default(""),
});
export type AntagonistaAtaque = z.infer<typeof AntagonistaAtaqueSchema>;

export const AntagonistaAptidaoSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().default(""),
});
export type AntagonistaAptidao = z.infer<typeof AntagonistaAptidaoSchema>;

export const AntagonistaAtributosSchema = z.object({
  corpo: AtributoAntagonistaSchema,
  alma: AtributoAntagonistaSchema,
  mente: AtributoAntagonistaSchema,
});

export const AntagonistaSystemSchema = z.object({
  ficha_base: FichaBaseSchema,
  /** Limits are editable — antagonistas have fixed statblock values, not derived formulas. */
  ferimentos: RecursoSchema.default({ atual: 0, limite: 4 }),
  estresse: RecursoSchema.default({ atual: 0, limite: 4 }),
  complexidade_maxima: ComplexidadeSchema.default("regular"),
  movimentacao: z.number().min(0).default(6),
  comunicacao: z.boolean().default(false),
  atributos: AntagonistaAtributosSchema,
  aptidoes: z.array(AntagonistaAptidaoSchema).default([]),
  ataques: z.array(AntagonistaAtaqueSchema).default([]),
});

export type AntagonistaSystem = z.infer<typeof AntagonistaSystemSchema>;

export function parseAntagonistaSystem(data: unknown): AntagonistaSystem {
  return AntagonistaSystemSchema.parse(data);
}
