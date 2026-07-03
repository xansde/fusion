/**
 * @fusion/shared — Etmos Compositor de Magias public API.
 *
 * Exports only the socket-protocol Zod schemas for the conjuração card
 * lifecycle. The ConjuracaoCard document shape itself lives in
 * `@fusion/system-etmos` (REQ-ARQ-002: shared must not depend on systems/*).
 */

export {
  ETMOS_CONJURACAO_ENVELOPE_TYPES,
  EtmosConjuracaoProporPayloadSchema,
  EtmosConjuracaoArbitrarPayloadSchema,
  EtmosConjuracaoRolarPayloadSchema,
  EtmosConjuracaoResolverPayloadSchema,
  EtmosConjuracaoCancelarPayloadSchema,
  EtmosContestadoLadoPayloadSchema,
  EtmosTesteContestadoPayloadSchema,
  EtmosReacaoUsarPayloadSchema,
} from "./protocol.js";

export type {
  EtmosConjuracaoEnvelopeType,
  EtmosConjuracaoProporPayload,
  EtmosConjuracaoArbitrarPayload,
  EtmosConjuracaoRolarPayload,
  EtmosConjuracaoResolverPayload,
  EtmosConjuracaoCancelarPayload,
  EtmosContestadoLadoPayload,
  EtmosTesteContestadoPayload,
  EtmosReacaoUsarPayload,
} from "./protocol.js";
