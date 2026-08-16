/**
 * The asset-grant cache must not survive a logout (T025).
 *
 * A grant is an HMAC bound to ONE user id, and the server refuses one whose
 * `au` is not the caller. A cache that outlives the session therefore hands the
 * NEXT user in the same tab URLs signed for the previous one, and every already
 * visited portrait and map comes back broken.
 *
 * The dependency used to be implicit and invisible: it happens to be harmless
 * today only because the app reloads the page on logout. That is a property of
 * a redirect somewhere else, not of the logout path — so it is pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Everything `session.svelte.ts` reaches for on the logout path, and nothing
// else: the point is to exercise `sessionActions.logout()`, not the socket.
vi.mock("../api.js", () => ({
  fusionApi: {
    logout: vi.fn().mockResolvedValue(undefined),
    onSessionExpired: (): void => {},
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock("../socket.js", () => ({
  SocketManager: class {
    socket = null;
    connect(): void {}
    disconnect(): void {}
    subscribe(): () => void {
      return () => {};
    }
  },
}));

vi.mock("../docs/worldSync.js", () => ({ attachWorldSync: () => () => {} }));
vi.mock("../scenes/scenesState.svelte.js", () => ({ attachSceneListSync: () => () => {} }));
vi.mock("../contacts/knowledgeBadge.js", () => ({ attachContactsKnowledgeBadge: () => () => {} }));

import { sessionActions } from "../session.svelte.js";
import {
  assetGrantsFor,
  peekAssetGrants,
  clearAssetGrantCache,
  type AssetDocRef,
} from "../assets/assetGrants.svelte.js";

const SCENE: AssetDocRef = { table: "scenes", id: "scene-1" };
const originalFetch = global.fetch;

describe("sessionActions.logout", () => {
  beforeEach(() => {
    clearAssetGrantCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("drops every cached asset grant", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, exp: Date.now() + 300_000, grants: { "bg.png": "sig" } }),
    }) as unknown as typeof fetch;

    await assetGrantsFor(SCENE, "tok-of-user-a");
    expect(peekAssetGrants(SCENE)).not.toBeNull();

    await sessionActions.logout();

    expect(peekAssetGrants(SCENE)).toBeNull();
  });
});
