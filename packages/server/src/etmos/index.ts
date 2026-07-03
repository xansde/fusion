/**
 * Etmos server module public API — Compositor de Magias, Teste Contestado,
 * Reação por rodada and Marcos/progressão socket handlers.
 */

export {
  buildConjuracaoProporHandler,
  buildConjuracaoArbitrarHandler,
  buildConjuracaoRolarHandler,
  buildConjuracaoResolverHandler,
  buildConjuracaoCancelarHandler,
} from "./conjuracao-handlers.js";
export type { ConjuracaoHandlerDeps } from "./conjuracao-handlers.js";

export { buildContestadoHandler } from "./contestado-handler.js";
export type { ContestadoHandlerDeps } from "./contestado-handler.js";

export { buildReacaoUsarHandler, registerReacaoResetOnTurnStart } from "./reacao-handler.js";
export type { ReacaoHandlerDeps, ReacaoResetDeps } from "./reacao-handler.js";

export { buildProgressaoConfirmarHandler } from "./progressao-handler.js";
export type {
  ProgressaoHandlerDeps,
  EtmosProgressaoConfirmarPayload,
} from "./progressao-handler.js";
