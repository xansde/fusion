/**
 * Tunnel module public API (M6/B4 — REQ-DST-034).
 */

export { TunnelManager, TunnelStartError } from "./tunnel-manager.js";
export type {
  TunnelState,
  TunnelStatus,
  TunnelStateListener,
  TunnelManagerOptions,
} from "./tunnel-manager.js";
export { ensureCloudflared, HashMismatchError, UnsupportedPlatformError } from "./downloader.js";
export { extractTunnelUrl } from "./url-parser.js";
export { registerTunnelRoutes, tunnelStateToAdminNetwork } from "./routes.js";
export type { RegisterTunnelRoutesOptions } from "./routes.js";
export {
  CLOUDFLARED_VERSION,
  CLOUDFLARED_ASSETS,
  resolveCloudflaredAsset,
} from "./cloudflared-releases.js";
export { encodeQr, renderQrAscii, qrAsciiFor, QrTooLargeError } from "./qr-ascii.js";
export type { QrMatrix } from "./qr-ascii.js";
