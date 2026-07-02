/**
 * @fusion/system-etmos — Actor `orador` schema.
 *
 * Spec 19-sistema-etmos.md §Modelo de dados → `OradorSystem`.
 * REQ-ETM-001, REQ-ETM-006..014, REQ-ETM-035..039, REQ-ETM-042/043.
 *
 * Grimório, Origens and Habilidades are Items embedded on the Actor — not
 * fields on this schema (design doc §1.1/§1.2).
 */
import { z } from "zod";
import {
  AtributoSchema,
  MundoSchema,
  RecursoSchema,
  EstadoFadigaSchema,
  ComplexidadeSchema,
  TrilhaSchema,
} from "../types.js";

export const OradorAtributosSchema = z.object({
  corpo: AtributoSchema,
  alma: AtributoSchema,
  mente: AtributoSchema,
});

/** Derived (prepareData) — Fadiga estado from (estresse.atual - estresse.limite). */
export const OradorFadigaSchema = z.object({
  estado: EstadoFadigaSchema.default("normal"),
});

export const OradorDadosEmpenhoSchema = z.object({
  atual: z.number().int().min(0).default(0),
});

/** Totem/magia no Mundano — REQ-ETM-042/043. */
export const OradorTotemFlagSchema = z.object({
  possui: z.boolean().default(false),
  rank: z.number().int().min(0).max(5).default(0),
});

export const OradorMarcosCrescimentoSchema = z.object({
  fisicos: TrilhaSchema.default({ value: 0, max: 5 }),
  mentais: TrilhaSchema.default({ value: 0, max: 5 }),
  emocionais: TrilhaSchema.default({ value: 0, max: 5 }),
});

/** Narrative-only fields, no mechanical effect (Q4). */
export const OradorConceitoSchema = z.object({
  basico: z.string().default(""),
  aparencia: z.string().default(""),
  pontos_importancia: z.string().default(""),
  futuro: z.string().default(""),
  valores: z.array(z.object({ polo_a: z.string(), polo_b: z.string() })).default([]),
});

export const OradorSystemSchema = z.object({
  player_name: z.string().default(""),
  ano_escolar: z.string().default(""),
  idade: z.number().int().min(0).default(0),
  nivel: z.number().int().min(1).max(6).default(1),
  especie: z.string().default(""),
  mundo_origem: MundoSchema.default("mundano"),

  atributos: OradorAtributosSchema,

  // --- derivados (calculados em prepareData; cache persistido opcionalmente) ---
  ferimentos: RecursoSchema.default({ atual: 0, limite: 4 }),
  estresse: RecursoSchema.default({ atual: 0, limite: 5 }),
  fadiga: OradorFadigaSchema.default({ estado: "normal" }),
  complexidade_maxima: ComplexidadeSchema.default("regular"),

  dados_empenho: OradorDadosEmpenhoSchema.default({ atual: 0 }),

  totem: OradorTotemFlagSchema.default({ possui: false, rank: 0 }),

  marcos_crescimento: OradorMarcosCrescimentoSchema.default({
    fisicos: { value: 0, max: 5 },
    mentais: { value: 0, max: 5 },
    emocionais: { value: 0, max: 5 },
  }),

  conceito: OradorConceitoSchema.default({
    basico: "",
    aparencia: "",
    pontos_importancia: "",
    futuro: "",
    valores: [],
  }),
});

export type OradorSystem = z.infer<typeof OradorSystemSchema>;

export function parseOradorSystem(data: unknown): OradorSystem {
  return OradorSystemSchema.parse(data);
}
