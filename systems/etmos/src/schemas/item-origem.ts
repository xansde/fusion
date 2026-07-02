/**
 * @fusion/system-etmos — Item `origem` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `OrigemSystem`.
 * REQ-ETM-003, REQ-ETM-046.
 */
import { z } from "zod";

export const OrigemMundoAssociadoSchema = z.enum(["mundano", "fantastico", "ambos"]);
export type OrigemMundoAssociado = z.infer<typeof OrigemMundoAssociadoSchema>;

export const OrigemSystemSchema = z.object({
  mundo_associado: OrigemMundoAssociadoSchema,
  /** true = only obtainable by the matching mundo_associado type. */
  exclusiva: z.boolean().default(false),
  descricao: z.string().default(""),
  /** Free text; application is manual/arbitrated (D8). */
  efeito_mecanico: z.string().default(""),
});

export type OrigemSystem = z.infer<typeof OrigemSystemSchema>;

export function parseOrigemSystem(data: unknown): OrigemSystem {
  return OrigemSystemSchema.parse(data);
}
