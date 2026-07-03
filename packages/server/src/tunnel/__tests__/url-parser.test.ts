/**
 * Tests for extractTunnelUrl (M6/B4 — parsing the public URL out of
 * cloudflared's stdout/stderr).
 */

import { describe, it, expect } from "vitest";
import { extractTunnelUrl } from "../url-parser.js";

// A trimmed but faithful fixture of real `cloudflared tunnel --url ...`
// stderr output (box-drawing formatting + surrounding log lines), so the
// regex is exercised against realistic noise, not just a bare URL string.
const REAL_CLOUDFLARED_OUTPUT = `
2026-07-02T10:15:30Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee.
2026-07-02T10:15:30Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+
2026-07-02T10:15:32Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):   |
2026-07-02T10:15:32Z INF |  https://random-words-here-1234.trycloudflare.com                                          |
2026-07-02T10:15:32Z INF +--------------------------------------------------------------------------------------------+
2026-07-02T10:15:32Z INF Cannot determine default configuration path. No file [config.yml config.yaml] found.
2026-07-02T10:15:32Z INF Version 2026.6.1
2026-07-02T10:15:33Z INF Registered tunnel connection connIndex=0
`;

describe("extractTunnelUrl", () => {
  it("extracts the public URL from a realistic cloudflared output block", () => {
    expect(extractTunnelUrl(REAL_CLOUDFLARED_OUTPUT)).toBe(
      "https://random-words-here-1234.trycloudflare.com",
    );
  });

  it("extracts a bare URL with no surrounding noise", () => {
    expect(extractTunnelUrl("https://a.trycloudflare.com")).toBe("https://a.trycloudflare.com");
  });

  it("returns undefined when no trycloudflare.com URL is present yet", () => {
    expect(
      extractTunnelUrl("2026-07-02T10:15:30Z INF Requesting new quick Tunnel..."),
    ).toBeUndefined();
  });

  it("returns undefined for an empty buffer", () => {
    expect(extractTunnelUrl("")).toBeUndefined();
  });

  it("ignores a non-https trycloudflare mention (does not match plain http)", () => {
    expect(extractTunnelUrl("http://random-words.trycloudflare.com")).toBeUndefined();
  });

  it("is case-insensitive on the scheme/host", () => {
    expect(extractTunnelUrl("HTTPS://Random-Words.TryCloudflare.Com")).toBe(
      "HTTPS://Random-Words.TryCloudflare.Com",
    );
  });

  it("finds the URL even when split across multiple accumulated chunks (buffer concatenation)", () => {
    const chunk1 = "2026-07-02T10:15:32Z INF |  https://random-w";
    const chunk2 = "ords-here-1234.trycloudflare.com                |\n";
    // Simulates the TunnelManager's buffering: chunks are concatenated
    // before extractTunnelUrl runs on the full buffer, not per-chunk.
    expect(extractTunnelUrl(chunk1 + chunk2)).toBe(
      "https://random-words-here-1234.trycloudflare.com",
    );
  });
});
