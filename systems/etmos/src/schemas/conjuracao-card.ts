/**
 * @fusion/system-etmos — Card de Conjuração (Compositor state machine payload).
 *
 * NOT an Item/Actor system schema — this is the shape stored in
 * `flags.etmos.conjuracao` of a ChatMessage (D5, spec 19 §Modelo de dados
 * → `ConjuracaoCard`). Exported here so B2 (compositor pure functions) and
 * M5-C (server socket handlers + state machine) share one definition.
 *
 * REQ-ETM-029..033, design doc §1.3.
 */
import { z } from "zod";
import { ComplexidadeSchema, EstadoConjuracaoSchema } from "../types.js";
import { FraseMagicaSystemSchema } from "./item-frase-magica.js";

export const ControleFadigaSchema = z.object({
  rolou: z.boolean(),
  valor: z.number().int().nullable(),
  falhou: z.boolean(),
  morreu: z.boolean(),
});
export type ControleFadiga = z.infer<typeof ControleFadigaSchema>;

export const ConjuracaoCardSchema = z.object({
  estado: EstadoConjuracaoSchema,
  conjurador_actor_id: z.string(),
  /** Snapshot of the proposed frase — immutable once proposta. */
  frase: FraseMagicaSystemSchema,
  // preenchido pelo Narrador (arbitragem):
  complexidade: ComplexidadeSchema.nullable().default(null),
  custo_estresse: z.number().int().nullable().default(null),
  /**
   * REQ-ETM-026: true when the Narrador chose a `complexidade` above the
   * conjurador's `complexidadeMaxima(mente)` at arbitragem time. This is an
   * ADVISORY flag only — arbitrar is a GM-only action and choosing above the
   * max is a legitimate Narrador override (never blocked); the flag exists
   * purely so the M5-D UI can surface a warning on the card.
   */
  excede_maxima: z.boolean().default(false),
  notas_narrador: z.string().default(""),
  // resultado:
  roll_message_id: z.string().nullable().default(null),
  dificuldade_alvo: z.number().int().nullable().default(null),
  sucesso: z.boolean().nullable().default(null),
  margem: z.number().int().nullable().default(null),
  classe_dificuldade: z.string().nullable().default(null),
  // controle de Fadiga (Exausto/Esgotado — REQ-ETM-025):
  controle_fadiga: ControleFadigaSchema.nullable().default(null),
});

export type ConjuracaoCard = z.infer<typeof ConjuracaoCardSchema>;

export function parseConjuracaoCard(data: unknown): ConjuracaoCard {
  return ConjuracaoCardSchema.parse(data);
}
