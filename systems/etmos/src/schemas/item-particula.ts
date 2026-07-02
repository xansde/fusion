/**
 * @fusion/system-etmos — Item `particula` schema (Grimório entries).
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `ParticulaSystem`.
 * Design doc m5-etmos-compositor.md §1.3 (schema esboçado).
 *
 * REQ-ETM-003, REQ-ETM-046, REQ-ETM-047 (icone_runico placeholder slot, D7).
 */
import { z } from "zod";
import { CategoriaParticulaSchema, SubtipoComplementoSchema } from "../types.js";

export const ParticulaSystemSchema = z.object({
  /** Stable slug — the id of the pack entry (design doc §1.2). "et", "imu", "mor", "ada"... */
  slug: z.string().min(1),
  /** Etmos word as written in the SRD, e.g. "Et", "Imu", "Mor", "Ada-". */
  palavra_etmos: z.string().min(1),
  categoria: CategoriaParticulaSchema,
  /** Short meaning gloss, e.g. "Controlar", "Mente", "Maior". */
  significado: z.string().default(""),
  descricao: z.string().default(""),
  /** Only meaningful for categoria === "complemento"; null otherwise. */
  nivel_grimorio: z.number().int().min(1).max(4).nullable().default(null),
  subtipo_complemento: SubtipoComplementoSchema.nullable().default(null),
  /**
   * Placeholder typographic rendering slot (D7, REQ-ETM-047). No proprietary
   * rune art is packaged in the MVP — this stays null until vetorial assets
   * are licensed.
   */
  icone_runico: z.string().nullable().default(null),
  /** True for pack entries with unresolved editorial ambiguity (see packs-src). */
  verify: z.boolean().default(false),
});

export type ParticulaSystem = z.infer<typeof ParticulaSystemSchema>;

export function parseParticulaSystem(data: unknown): ParticulaSystem {
  return ParticulaSystemSchema.parse(data);
}
