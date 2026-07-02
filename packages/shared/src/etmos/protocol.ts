/**
 * Etmos — Compositor de Magias socket payload Zod schemas.
 *
 * Client → Server request payloads for the card-of-conjuração lifecycle
 * (spec 19-sistema-etmos.md §Card de Conjuração / §Eventos do Compositor,
 * design doc docs/design/m5-etmos-compositor.md §2.5/§2.7).
 *
 * These schemas validate ONLY the socket request shape — the ConjuracaoCard
 * document shape itself (`flags.etmos.conjuracao`) is `@fusion/system-etmos`'s
 * `ConjuracaoCardSchema` (systems/etmos/src/schemas/conjuracao-card.ts),
 * which `@fusion/shared` intentionally does NOT depend on (REQ-ARQ-002:
 * shared must NOT import from systems/*). The server composes both: it
 * validates the request via these schemas, then builds/patches a
 * ConjuracaoCard using the system's pure functions.
 *
 * REQ-ETM-029..033, CA-9/CA-10/CA-12.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Envelope type literals
// ---------------------------------------------------------------------------

export const ETMOS_CONJURACAO_ENVELOPE_TYPES = [
  "etmos:conjuracao:propor",
  "etmos:conjuracao:arbitrar",
  "etmos:conjuracao:rolar",
  "etmos:conjuracao:resolver",
  "etmos:conjuracao:cancelar",
] as const;

export type EtmosConjuracaoEnvelopeType = (typeof ETMOS_CONJURACAO_ENVELOPE_TYPES)[number];

// ---------------------------------------------------------------------------
// etmos:conjuracao:propor — REQ-ETM-029
// ---------------------------------------------------------------------------

/**
 * The frase snapshot is passed as a loose record — its authoritative shape is
 * `FraseMagicaSystem` (system-etmos), validated server-side by the handler
 * (via `parseFraseMagicaSystem`) rather than re-declared here, so the two
 * schemas can never drift (REQ-ARQ-005: shared does not import systems/*).
 */
export const EtmosConjuracaoProporPayloadSchema = z
  .object({
    conjuradorActorId: z.string().min(1).max(64),
    frase: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EtmosConjuracaoProporPayload = z.infer<typeof EtmosConjuracaoProporPayloadSchema>;

// ---------------------------------------------------------------------------
// etmos:conjuracao:arbitrar — REQ-ETM-030
// ---------------------------------------------------------------------------

export const EtmosConjuracaoArbitrarPayloadSchema = z
  .object({
    messageId: z.string().min(1).max(64),
    /** GM's chosen Complexidade; required unless recusar=true. */
    complexidade: z
      .enum(["trivial", "regular", "dificil", "complexa", "milagre"])
      .nullable()
      .optional(),
    /** Optional GM override of the computed cost (Habilidade "Exceder os Limites"). */
    custoEstresseOverride: z.number().int().min(0).nullable().optional(),
    notasNarrador: z.string().max(2000).optional(),
    /** Optional target DC for the upcoming roll (REQ-ETM-019). */
    dificuldadeAlvo: z.number().int().nullable().optional(),
    /** GM declines the proposal instead of arbitrating it — transitions to recusada. */
    recusar: z.boolean().optional(),
  })
  .strict();

export type EtmosConjuracaoArbitrarPayload = z.infer<typeof EtmosConjuracaoArbitrarPayloadSchema>;

// ---------------------------------------------------------------------------
// etmos:conjuracao:rolar — REQ-ETM-031, design doc §2.5
// ---------------------------------------------------------------------------

export const EtmosConjuracaoRolarPayloadSchema = z
  .object({
    messageId: z.string().min(1).max(64),
  })
  .strict();

export type EtmosConjuracaoRolarPayload = z.infer<typeof EtmosConjuracaoRolarPayloadSchema>;

// ---------------------------------------------------------------------------
// etmos:conjuracao:resolver — REQ-ETM-032, REQ-ETM-024
// ---------------------------------------------------------------------------

export const EtmosConjuracaoResolverPayloadSchema = z
  .object({
    messageId: z.string().min(1).max(64),
  })
  .strict();

export type EtmosConjuracaoResolverPayload = z.infer<typeof EtmosConjuracaoResolverPayloadSchema>;

// ---------------------------------------------------------------------------
// etmos:conjuracao:cancelar — REQ-ETM-033
// ---------------------------------------------------------------------------

export const EtmosConjuracaoCancelarPayloadSchema = z
  .object({
    messageId: z.string().min(1).max(64),
  })
  .strict();

export type EtmosConjuracaoCancelarPayload = z.infer<typeof EtmosConjuracaoCancelarPayloadSchema>;
