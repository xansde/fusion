/**
 * @fusion/system-etmos — shared enums and auxiliary Zod types.
 *
 * Mirrors spec 19-sistema-etmos.md §Modelo de dados (tipos auxiliares) and
 * design doc m5-etmos-compositor.md §1.3. These are the small vocabulary
 * types reused across every schema and the compositor's pure functions.
 *
 * Clean-room: only mechanical identifiers/enum values, no prose from the
 * SRD. Values are Etmos words (slugs) already committed in
 * `systems/etmos/packs-src/*.json` — no proprietary text is redistributed.
 *
 * REQ-ETM-001..003, D6 (binary degree conjunto próprio, no engine-2e reuse).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Complexidade (Tabela A) — REQ-ETM-009, REQ-ETM-024, REQ-ETM-026
// ---------------------------------------------------------------------------

export const ComplexidadeSchema = z.enum(["trivial", "regular", "dificil", "complexa", "milagre"]);
export type Complexidade = z.infer<typeof ComplexidadeSchema>;

// ---------------------------------------------------------------------------
// Estado de Fadiga (Tabela D) — REQ-ETM-010
// ---------------------------------------------------------------------------

export const EstadoFadigaSchema = z.enum(["normal", "cansado", "exausto", "esgotado"]);
export type EstadoFadiga = z.infer<typeof EstadoFadigaSchema>;

// ---------------------------------------------------------------------------
// Partícula: categoria e subtipo de Complemento — REQ-ETM-003/046
// ---------------------------------------------------------------------------

export const CategoriaParticulaSchema = z.enum([
  "funcao",
  "objeto",
  "caracteristica",
  "complemento",
]);
export type CategoriaParticula = z.infer<typeof CategoriaParticulaSchema>;

export const SubtipoComplementoSchema = z.enum(["modificador", "criador"]);
export type SubtipoComplemento = z.infer<typeof SubtipoComplementoSchema>;

/**
 * How a Complemento connects syntactically inside a montarFrase() output.
 * Derived from (categoria, subtipo_complemento) at pack-build time — see
 * particulas-syntax.ts. Design doc §1.4.
 */
export const LigacaoComplementoSchema = z.enum(["prefix", "connector", "suffix"]).nullable();
export type LigacaoComplemento = z.infer<typeof LigacaoComplementoSchema>;

// ---------------------------------------------------------------------------
// Mundo — REQ-ETM-042/043
// ---------------------------------------------------------------------------

export const MundoSchema = z.enum(["mundano", "fantastico"]);
export type Mundo = z.infer<typeof MundoSchema>;

// ---------------------------------------------------------------------------
// Marcos de Crescimento — REQ-ETM-035..039
// ---------------------------------------------------------------------------

export const CategoriaMarcoSchema = z.enum(["fisicos", "mentais", "emocionais"]);
export type CategoriaMarco = z.infer<typeof CategoriaMarcoSchema>;

// ---------------------------------------------------------------------------
// Estado de Conjuração (card, D5) — REQ-ETM-029..033
// ---------------------------------------------------------------------------

export const EstadoConjuracaoSchema = z.enum([
  "proposta",
  "arbitrada",
  "rolada",
  "resolvida",
  "recusada",
  "cancelada",
]);
export type EstadoConjuracao = z.infer<typeof EstadoConjuracaoSchema>;

// ---------------------------------------------------------------------------
// Grau de sucesso binário próprio do Etmos (D6) — REQ-ROL-038/039
// ---------------------------------------------------------------------------

export const EtmosDegreeSchema = z.enum(["success", "failure"]);
export type EtmosDegree = z.infer<typeof EtmosDegreeSchema>;

/** Narrative difficulty class label — separate from the degree (D6). */
export const ClasseDificuldadeSchema = z.enum(["simples", "facil", "mediano", "arduo", "dificil"]);
export type ClasseDificuldade = z.infer<typeof ClasseDificuldadeSchema>;

// ---------------------------------------------------------------------------
// Small reusable primitives (Atributo / Recurso / Trilha) — spec 19 §Tipos auxiliares
// ---------------------------------------------------------------------------

/** Corpo/Alma/Mente — integer 1..6 (D2: minimum 1, no 0). */
export const AtributoSchema = z.object({
  value: z.number().int().min(1).max(6),
  max: z.literal(6).default(6),
});
export type Atributo = z.infer<typeof AtributoSchema>;

/** Antagonistas may have Atributo 0 (spec 19 §Actor Antagonista) — no min(1). */
export const AtributoAntagonistaSchema = z.number().int().min(0);

/** Ferimentos/Estresse tracker: current value + derived limit (read-only in UI). */
export const RecursoSchema = z.object({
  atual: z.number().int().min(0).default(0),
  limite: z.number().int().min(0).default(0),
});
export type Recurso = z.infer<typeof RecursoSchema>;

/** A clickable 0..max progress track (Marcos de Crescimento). */
export const TrilhaSchema = z.object({
  value: z.number().int().min(0).default(0),
  max: z.number().int().min(1),
});
export type Trilha = z.infer<typeof TrilhaSchema>;
