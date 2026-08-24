/**
 * token-preview.test.ts — TK033 (#168), REQ-NET-044.
 *
 * Unit-level coverage of the `token:preview` case in `handleEphemeralEnvelope`
 * (the pure dispatch logic), with mocked `Socket`/`Namespace` — no real
 * socket.io connection, no DB. Full multi-client integration coverage for
 * the OTHER ephemeral types already lives in `__tests__/ephemeral.test.ts`;
 * this file exercises `token:preview` the way `ephemeral-handlers.test.ts`
 * exercises `buildPresenceOnlineBroadcast`: in isolation.
 */

import { describe, it, expect } from "vitest";
import {
  handleEphemeralEnvelope,
  EphemeralRateLimiter,
  TokenPreviewPayloadSchema,
} from "../ephemeral-handlers.js";
import type { Envelope } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Minimal Socket/Namespace mocks
// ---------------------------------------------------------------------------

interface RecordedEmit {
  room: string | null;
  event: string;
  payload: unknown;
}

function makeSocketAndNs(socketId = "socket-1"): {
  socket: Parameters<typeof handleEphemeralEnvelope>[0];
  ns: Parameters<typeof handleEphemeralEnvelope>[3]["ns"];
  emits: RecordedEmit[];
} {
  const emits: RecordedEmit[] = [];

  const socket = {
    id: socketId,
    broadcast: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown): void => {
          emits.push({ room, event, payload });
        },
      }),
      emit: (event: string, payload: unknown): void => {
        emits.push({ room: null, event, payload });
      },
    },
  } as unknown as Parameters<typeof handleEphemeralEnvelope>[0];

  const ns = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown): void => {
        emits.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: unknown): void => {
      emits.push({ room: null, event, payload });
    },
  } as unknown as Parameters<typeof handleEphemeralEnvelope>[3]["ns"];

  return { socket, ns, emits };
}

const noopLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  debug: (): void => undefined,
  error: (): void => undefined,
} as unknown as Parameters<typeof handleEphemeralEnvelope>[3]["logger"];

function baseCtx(userId = "user-1"): Parameters<typeof handleEphemeralEnvelope>[2] {
  return { userId, role: 1, worldId: "world-1" };
}

// ---------------------------------------------------------------------------

describe("token:preview (TK033, #168, REQ-NET-044)", () => {
  it("TokenPreviewPayloadSchema requires sceneId/tokenId/x/y", () => {
    expect(
      TokenPreviewPayloadSchema.safeParse({
        sceneId: "scn-1",
        tokenId: "tok-1",
        x: 100,
        y: 200,
      }).success,
    ).toBe(true);
    expect(
      TokenPreviewPayloadSchema.safeParse({ sceneId: "scn-1", tokenId: "tok-1" }).success,
    ).toBe(false);
  });

  it("broadcasts to the scene room named in the payload, EXCLUDING the sender", () => {
    const { socket, ns, emits } = makeSocketAndNs();
    const previewRateLimiter = new EphemeralRateLimiter(50);
    const cursorRateLimiter = new EphemeralRateLimiter(50);
    const pingRateLimiter = new EphemeralRateLimiter(500);

    const envelope: Envelope = {
      type: "token:preview",
      ts: 1000,
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 300, y: 400 },
    };

    const handled = handleEphemeralEnvelope(socket, envelope, baseCtx("user-1"), {
      ns,
      logger: noopLogger,
      cursorRateLimiter,
      pingRateLimiter,
      previewRateLimiter,
      sceneRooms: new Map(),
    });

    expect(handled).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0]?.room).toBe("scene:scn-1");
    expect(emits[0]?.event).toBe("ephemeral");
    const broadcast = emits[0]?.payload as Envelope<{
      sceneId: string;
      tokenId: string;
      x: number;
      y: number;
      userId: string;
    }>;
    expect(broadcast.type).toBe("token:preview");
    expect(broadcast.payload).toMatchObject({
      sceneId: "scn-1",
      tokenId: "tok-1",
      x: 300,
      y: 400,
      userId: "user-1",
    });
  });

  it("is rate-limited (REQ-NET-071): excess events from the same socket are dropped silently", () => {
    const { socket, ns, emits } = makeSocketAndNs();
    const previewRateLimiter = new EphemeralRateLimiter(50);

    const envelope: Envelope = {
      type: "token:preview",
      ts: 1000,
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 0, y: 0 },
    };

    const opts = {
      ns,
      logger: noopLogger,
      cursorRateLimiter: new EphemeralRateLimiter(50),
      pingRateLimiter: new EphemeralRateLimiter(500),
      previewRateLimiter,
      sceneRooms: new Map<string, string>(),
    };

    const first = handleEphemeralEnvelope(socket, envelope, baseCtx(), opts);
    const second = handleEphemeralEnvelope(socket, envelope, baseCtx(), opts); // same instant — rate-limited

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(emits).toHaveLength(1); // only the first got through
  });

  it("rejects an invalid payload without broadcasting", () => {
    const { socket, ns, emits } = makeSocketAndNs();
    const envelope: Envelope = {
      type: "token:preview",
      ts: 1000,
      payload: { sceneId: "scn-1" }, // missing tokenId/x/y
    };

    const handled = handleEphemeralEnvelope(socket, envelope, baseCtx(), {
      ns,
      logger: noopLogger,
      cursorRateLimiter: new EphemeralRateLimiter(50),
      pingRateLimiter: new EphemeralRateLimiter(500),
      previewRateLimiter: new EphemeralRateLimiter(50),
      sceneRooms: new Map(),
    });

    expect(handled).toBe(false);
    expect(emits).toHaveLength(0);
  });

  it("is NOT persisted: never touches opBuffer/seqStore — handleEphemeralEnvelope's signature has none to give it", () => {
    // Structural guarantee, not a runtime assertion: the ephemeral dispatcher
    // only ever receives {ns, logger, rate limiters, sceneRooms} — there is
    // no OpBuffer/SeqStore parameter for token:preview (or any ephemeral
    // type) to reach, unlike the `op` channel's handlers.
    const { socket, ns } = makeSocketAndNs();
    const envelope: Envelope = {
      type: "token:preview",
      ts: 1000,
      payload: { sceneId: "scn-1", tokenId: "tok-1", x: 1, y: 1 },
    };
    expect(() =>
      handleEphemeralEnvelope(socket, envelope, baseCtx(), {
        ns,
        logger: noopLogger,
        cursorRateLimiter: new EphemeralRateLimiter(50),
        pingRateLimiter: new EphemeralRateLimiter(500),
        previewRateLimiter: new EphemeralRateLimiter(50),
        sceneRooms: new Map(),
      }),
    ).not.toThrow();
  });
});
