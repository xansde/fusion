/**
 * @fusion/system-etmos — Item `habilidade` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `HabilidadeSystem`.
 * REQ-ETM-003, REQ-ETM-017, REQ-ETM-046.
 */
import { z } from "zod";

export const HabilidadeCategoriaSchema = z.enum(["pratica", "teorica"]);
export type HabilidadeCategoria = z.infer<typeof HabilidadeCategoriaSchema>;

export const HabilidadeSystemSchema = z.object({
  categoria: HabilidadeCategoriaSchema,
  descricao: z.string().default(""),
  /** Somado em 2d6 + bonus (Teste de Habilidade, REQ-ETM-017). */
  bonus: z.number().int().default(0),
  usos_por_dia: z.number().int().min(0).nullable().default(null),
  requer_acao: z.boolean().default(false),
  /** ex.: Conhecimento, Treinamento Mágico — cada escolha soma bonus/sub-campo. */
  escolhivel_multiplas_vezes: z.boolean().default(false),
});

export type HabilidadeSystem = z.infer<typeof HabilidadeSystemSchema>;

export function parseHabilidadeSystem(data: unknown): HabilidadeSystem {
  return HabilidadeSystemSchema.parse(data);
}
