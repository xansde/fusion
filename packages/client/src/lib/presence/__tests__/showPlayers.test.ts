import { describe, it, expect, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { shownFromPayload, emitShow, canSendShow } from "../showPlayers.js";

describe("shownFromPayload", () => {
  it("builds the image URL from the grant carried by the event", () => {
    const item = shownFromPayload({
      title: "Mapa",
      image: { name: "maps/a b.webp", token: "tok", exp: 99, userId: "u1" },
      fromName: "Mestre",
    });
    expect(item?.title).toBe("Mapa");
    expect(item?.imageUrl).toBe("/assets/maps/a%20b.webp?at=tok&ae=99&au=u1");
    expect(item?.fromName).toBe("Mestre");
  });

  it("returns null when there is nothing to show", () => {
    expect(shownFromPayload({})).toBeNull();
    expect(shownFromPayload({ image: { name: 1 } })).toBeNull();
  });

  it("shows a note without picture", () => {
    expect(shownFromPayload({ text: "Olhem" })?.imageUrl).toBeUndefined();
  });
});

describe("emitShow", () => {
  const sock = (connected: boolean): Socket & { emit: ReturnType<typeof vi.fn> } =>
    ({ connected, emit: vi.fn() }) as never;

  it("sends the canonical asset name, not the URL path", () => {
    const s = sock(true);
    expect(emitShow(s, { title: " Olá ", imagePath: "/assets/maps/a%20b.webp" })).toBe(true);
    const env = s.emit.mock.calls[0]?.[1] as { type: string; payload: Record<string, unknown> };
    expect(env.type).toBe("presence:show");
    expect(env.payload).toEqual({ title: "Olá", image: "maps/a b.webp" });
  });

  it("does not send an empty request or without a connection", () => {
    const s = sock(true);
    expect(emitShow(s, { title: "  " })).toBe(false);
    expect(emitShow(sock(false), { text: "x" })).toBe(false);
    expect(canSendShow({})).toBe(false);
    expect(s.emit).not.toHaveBeenCalled();
  });
});
