/**
 * @fusion/system-etmos — Item `item_encantado` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `ItemEncantadoSystem`.
 * REQ-ETM-003, REQ-ETM-044 [V2], REQ-ETM-045 [V2].
 */
import { z } from "zod";
import { FraseMagicaSystemSchema } from "./item-frase-magica.js";

export const GrauSofisticacaoSchema = z.enum(["simples", "sofisticado", "primoroso"]);
export type GrauSofisticacao = z.infer<typeof GrauSofisticacaoSchema>;

export const VeiculoEncantamentoSchema = z.enum(["consumivel", "persistente"]);
export type VeiculoEncantamento = z.infer<typeof VeiculoEncantamentoSchema>;

export const ItemEncantadoSystemSchema = z.object({
  /** The recorded magia, with a fixed Intenção. */
  frase: FraseMagicaSystemSchema,
  grau_sofisticacao: GrauSofisticacaoSchema,
  veiculo: VeiculoEncantamentoSchema,
  /** Base PP required: 5 / 10 / 15 (Simples/Sofisticado/Primoroso). */
  pp_necessarios: z.number().int().min(0).default(0),
  pp_acumulados: z.number().int().min(0).default(0),
  concluido: z.boolean().default(false),
});

export type ItemEncantadoSystem = z.infer<typeof ItemEncantadoSystemSchema>;

export function parseItemEncantadoSystem(data: unknown): ItemEncantadoSystem {
  return ItemEncantadoSystemSchema.parse(data);
}
