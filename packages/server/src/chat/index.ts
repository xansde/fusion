/**
 * Chat module public API.
 *
 * Re-exports the RollService and chat handler factories.
 */

export { RollService, RollError } from "./roll-service.js";
export type { RollRequest, RollServiceOptions } from "./roll-service.js";

export {
  buildChatSendHandler,
  buildChatHistoryHandler,
  getRecentChatForUser,
} from "./chat-handler.js";
export type { ChatHandlerDeps } from "./chat-handler.js";
