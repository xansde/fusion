/**
 * @fusion/system-etmos — Item `totem` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `TotemSystem`.
 * REQ-ETM-003, REQ-ETM-042, REQ-ETM-043.
 */
import { z } from "zod";

export const TotemSystemSchema = z.object({
  rank: z.number().int().min(0).max(5).default(0),
  /** Name of the Orador attuned to this Totem, if any. */
  sintonia_com: z.string().nullable().default(null),
  materia_prima: z.string().default(""),
  /** Santuário = a Totem covering an area, not a portable object. */
  is_santuario: z.boolean().default(false),
  area_metros: z.number().min(0).nullable().default(null),
});

export type TotemSystem = z.infer<typeof TotemSystemSchema>;

export function parseTotemSystem(data: unknown): TotemSystem {
  return TotemSystemSchema.parse(data);
}
