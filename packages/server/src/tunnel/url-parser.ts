/**
 * Parse the public quick-tunnel URL out of `cloudflared`'s stdout/stderr.
 *
 * `cloudflared tunnel --url <local>` (a "quick tunnel", no named-tunnel
 * config/account required — DEC-M6-02) logs its assigned public hostname to
 * stderr as part of a human-readable log line, e.g.:
 *
 *   2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+
 *   2026-07-02T10:15:32Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):   |
 *   2026-07-02T10:15:32Z INF |  https://random-words-here-1234.trycloudflare.com                                          |
 *   2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+
 *
 * The exact box-drawing/whitespace formatting is not a stable contract, so
 * this parser matches only the durable part: an `https://*.trycloudflare.com`
 * URL appearing anywhere in the combined output stream.
 */

const TRYCLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Scan a chunk of cloudflared output for the public tunnel URL.
 * Returns the URL string if found, else undefined (caller keeps buffering).
 */
export function extractTunnelUrl(output: string): string | undefined {
  const match = TRYCLOUDFLARE_URL_RE.exec(output);
  return match?.[0];
}
