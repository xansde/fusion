/**
 * Auth module public API.
 *
 * Re-exports everything needed by other modules (boot, CLI, socket layer).
 */

export { AuthService } from "./service.js";
export type { LoginResult, RefreshResult } from "./service.js";
export { AuthError } from "./service.js";
export { UserStore, Role, toPublic, toJoinInfo, suggestColor } from "./user-store.js";
export type { UserRecord, UserPublic, UserJoinInfo } from "./user-store.js";
export { SessionStore } from "./session-store.js";
export { LockoutStore } from "./lockout.js";
export {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateRandomPassword,
  loadOrCreateSecret,
} from "./crypto.js";
export { registerAuthRoutes } from "./routes.js";
export type { RegisterAuthRoutesOptions } from "./routes.js";
