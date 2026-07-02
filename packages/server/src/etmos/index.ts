/**
 * Etmos server module public API — Compositor de Magias socket handlers.
 */

export {
  buildConjuracaoProporHandler,
  buildConjuracaoArbitrarHandler,
  buildConjuracaoRolarHandler,
  buildConjuracaoResolverHandler,
  buildConjuracaoCancelarHandler,
} from "./conjuracao-handlers.js";
export type { ConjuracaoHandlerDeps } from "./conjuracao-handlers.js";
