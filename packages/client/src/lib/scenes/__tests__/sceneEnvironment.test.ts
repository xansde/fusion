/**
 * sceneEnvironment.test.ts — the three environment shortcuts of the head (plan G081).
 *
 * The head of the Cenas tab offers exactly three mid-session gestures over the scene ON
 * AIR: toggle darkness, toggle fog and reset fog (DEC-CEN-06). This file pins what the
 * tab is allowed to do with them — the projection that decides whether a control exists
 * and how it reads, and the ops each gesture emits — with no DOM and no socket.
 *
 * The line the tab must not cross is REQ-CEN-025: it ACTIONS the requirements of spec
 * 07 (REQ-VIS-044, REQ-VIS-085, REQ-VIS-086) and defines no semantics of its own. That
 * is asserted here as behaviour: each gesture writes exactly its own field, and the fog
 * reset is delegated to the `fog:reset` op instead of being emulated client-side.
 *
 * Covers REQ-CEN-020, REQ-CEN-021, REQ-CEN-022, REQ-CEN-023, REQ-CEN-024, REQ-CEN-025.
 */

import { describe, it, expect } from "vitest";
import type { Socket } from "socket.io-client";
import type { Envelope, SceneDocument } from "@fusion/shared";

import {
  DEFAULT_DARKNESS,
  SCENE_ENV_KEYS,
  buildSceneEnvironmentVM,
  createDarknessMemory,
  resetSceneFog,
  toggleSceneDarkness,
  toggleSceneFog,
} from "../sceneEnvironment.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100 },
    background: null,
    backgroundColor: "#101018",
    thumb: null,
    darkness: 0,
    fogEnabled: false,
    globalLight: true,
    globalLightThreshold: 0.5,
    tokenVision: false,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

interface FakeSocket {
  readonly socket: Socket;
  readonly sent: Envelope[];
}

/** A socket that records the envelope and acks it successfully, synchronously. */
function fakeSocket(): FakeSocket {
  const sent: Envelope[] = [];
  const socket = {
    emit(_event: string, payload: Envelope, ack: (value: unknown) => void): void {
      sent.push(payload);
      ack({ ok: true, seq: 1, requestId: payload.requestId, result: {} });
    },
  } as unknown as Socket;
  return { socket, sent };
}

/** The `diff` of the single update carried by a doc:update envelope. */
function diffOf(envelope: Envelope): Record<string, unknown> {
  const payload = envelope.payload as {
    updates: { _id: string; diff: Record<string, unknown> }[];
  };
  return payload.updates[0]!.diff;
}

// ---------------------------------------------------------------------------
// What the head shows (REQ-CEN-020/021/022/023/024)
// ---------------------------------------------------------------------------

describe("the environment controls of the head", () => {
  it("REQ-CEN-020 / REQ-CEN-021: offers a darkness toggle and a fog toggle for the scene on air", () => {
    const scene = makeScene({ _id: "s1", darkness: 0.6, fogEnabled: true });

    const vm = buildSceneEnvironmentVM({ scenes: [scene], activeSceneId: "s1" });

    expect(vm).not.toBeNull();
    expect(vm?.sceneId).toBe("s1");
    expect(vm?.darkness.pressed).toBe(true);
    expect(vm?.fog.pressed).toBe(true);
  });

  it("REQ-CEN-023: each control reads the document, so a change from another origin flips it", () => {
    const lit = makeScene({ _id: "s1", darkness: 0, fogEnabled: false });
    const dark = makeScene({ _id: "s1", darkness: 0.8, fogEnabled: true });

    const before = buildSceneEnvironmentVM({ scenes: [lit], activeSceneId: "s1" });
    // Same input except the document the server pushed — nothing else may decide this.
    const after = buildSceneEnvironmentVM({ scenes: [dark], activeSceneId: "s1" });

    expect(before?.darkness.pressed).toBe(false);
    expect(before?.fog.pressed).toBe(false);
    expect(after?.darkness.pressed).toBe(true);
    expect(after?.fog.pressed).toBe(true);
  });

  it("REQ-CEN-023: the label of each toggle names the gesture the current state allows", () => {
    const lit = buildSceneEnvironmentVM({
      scenes: [makeScene({ _id: "s1", darkness: 0, fogEnabled: false })],
      activeSceneId: "s1",
    });
    const dark = buildSceneEnvironmentVM({
      scenes: [makeScene({ _id: "s1", darkness: 0.8, fogEnabled: true })],
      activeSceneId: "s1",
    });

    expect(lit?.darkness.actionKey).toBe(SCENE_ENV_KEYS.darknessOn);
    expect(dark?.darkness.actionKey).toBe(SCENE_ENV_KEYS.darknessOff);
    expect(lit?.fog.actionKey).toBe(SCENE_ENV_KEYS.fogOn);
    expect(dark?.fog.actionKey).toBe(SCENE_ENV_KEYS.fogOff);
  });

  it("REQ-CEN-022: the fog reset carries a confirmation message, because it cannot be undone", () => {
    const vm = buildSceneEnvironmentVM({
      scenes: [makeScene({ _id: "s1" })],
      activeSceneId: "s1",
    });

    expect(vm?.fogReset.actionKey).toBe(SCENE_ENV_KEYS.fogReset);
    expect(vm?.fogReset.confirmKey).toBe(SCENE_ENV_KEYS.fogResetConfirm);
    expect(vm?.fogReset.confirmLabelKey).toBe(SCENE_ENV_KEYS.fogResetConfirmLabel);
  });

  it("REQ-CEN-024: no scene on air, no controls at all", () => {
    const scenes = [makeScene({ _id: "s1" }), makeScene({ _id: "s2" })];

    expect(buildSceneEnvironmentVM({ scenes, activeSceneId: null })).toBeNull();
    expect(buildSceneEnvironmentVM({ scenes, activeSceneId: "" })).toBeNull();
  });

  it("REQ-CEN-024: a scene the world says is on air but this client has not received yet gets no controls", () => {
    const vm = buildSceneEnvironmentVM({
      scenes: [makeScene({ _id: "s1" })],
      activeSceneId: "s2",
    });

    expect(vm).toBeNull();
  });

  it("REQ-CEN-024: the controls only ever address the scene on air, never another one", () => {
    const onAir = makeScene({ _id: "s1", darkness: 0, fogEnabled: false });
    const other = makeScene({ _id: "s2", darkness: 1, fogEnabled: true });

    const vm = buildSceneEnvironmentVM({ scenes: [onAir, other], activeSceneId: "s1" });

    expect(vm?.sceneId).toBe("s1");
    expect(vm?.darkness.pressed).toBe(false);
    expect(vm?.fog.pressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What each gesture sends (REQ-CEN-020/021/022/025)
// ---------------------------------------------------------------------------

describe("toggling the darkness of the scene on air (REQ-CEN-020)", () => {
  it("REQ-CEN-020: a dark scene goes to no darkness at all", async () => {
    const { socket, sent } = fakeSocket();
    const scene = makeScene({ _id: "s1", darkness: 0.7 });

    await toggleSceneDarkness(socket, scene, createDarknessMemory());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("doc:update");
    expect(diffOf(sent[0]!)).toEqual({ darkness: 0 });
  });

  it("REQ-CEN-020: switching it back restores the value the scene was configured with", async () => {
    const memory = createDarknessMemory();
    const { socket, sent } = fakeSocket();

    // The GM darkens the room, then puts the lights back on.
    await toggleSceneDarkness(socket, makeScene({ _id: "s1", darkness: 0.65 }), memory);
    await toggleSceneDarkness(socket, makeScene({ _id: "s1", darkness: 0 }), memory);

    expect(diffOf(sent[0]!)).toEqual({ darkness: 0 });
    expect(diffOf(sent[1]!)).toEqual({ darkness: 0.65 });
  });

  it("REQ-CEN-020: with no configured value to go back to, the toggle applies full darkness", async () => {
    const { socket, sent } = fakeSocket();

    await toggleSceneDarkness(
      socket,
      makeScene({ _id: "s1", darkness: 0 }),
      createDarknessMemory(),
    );

    expect(diffOf(sent[0]!)).toEqual({ darkness: DEFAULT_DARKNESS });
    expect(DEFAULT_DARKNESS).toBeGreaterThan(0);
  });

  it("REQ-CEN-020: the remembered value belongs to its own scene, never to another", async () => {
    const memory = createDarknessMemory();
    const { socket, sent } = fakeSocket();

    await toggleSceneDarkness(socket, makeScene({ _id: "s1", darkness: 0.3 }), memory);
    await toggleSceneDarkness(socket, makeScene({ _id: "s2", darkness: 0 }), memory);

    expect(diffOf(sent[1]!)).toEqual({ darkness: DEFAULT_DARKNESS });
  });

  it("REQ-CEN-025: the toggle writes darkness and nothing else — lighting semantics are spec 07's", async () => {
    const { socket, sent } = fakeSocket();
    const scene = makeScene({
      _id: "s1",
      darkness: 0.5,
      globalLight: true,
      globalLightThreshold: 0.5,
      tokenVision: true,
    });

    await toggleSceneDarkness(socket, scene, createDarknessMemory());

    expect(Object.keys(diffOf(sent[0]!))).toEqual(["darkness"]);
  });
});

describe("toggling the fog of the scene on air (REQ-CEN-021)", () => {
  it("REQ-CEN-021: an enabled fog is turned off", async () => {
    const { socket, sent } = fakeSocket();

    await toggleSceneFog(socket, makeScene({ _id: "s1", fogEnabled: true }));

    expect(sent[0]?.type).toBe("doc:update");
    expect(diffOf(sent[0]!)).toEqual({ fogEnabled: false });
  });

  it("REQ-CEN-021 / REQ-CEN-025: a disabled fog is turned on, and token vision is not touched", async () => {
    const { socket, sent } = fakeSocket();

    await toggleSceneFog(socket, makeScene({ _id: "s1", fogEnabled: false, tokenVision: false }));

    expect(diffOf(sent[0]!)).toEqual({ fogEnabled: true });
    expect(Object.keys(diffOf(sent[0]!))).toEqual(["fogEnabled"]);
  });
});

describe("resetting the fog of the scene on air (REQ-CEN-022)", () => {
  it("REQ-CEN-022: confirmed, it resets the exploration of every user of that scene", async () => {
    const { socket, sent } = fakeSocket();

    const done = await resetSceneFog(socket, "s1", () => Promise.resolve(true));

    expect(done).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("fog:reset");
    expect(sent[0]?.payload).toEqual({ sceneId: "s1", target: "all" });
  });

  it("REQ-CEN-022: refused, nothing at all is sent — the reset is irreversible", async () => {
    const { socket, sent } = fakeSocket();

    const done = await resetSceneFog(socket, "s1", () => Promise.resolve(false));

    expect(done).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("REQ-CEN-025: the reset is delegated to spec 07's op, not emulated by this tab", async () => {
    const { socket, sent } = fakeSocket();

    await resetSceneFog(socket, "s1", () => Promise.resolve(true));

    // One op, owned by 07 (REQ-VIS-086/087) — no doc:update pretending to clear fog.
    expect(sent.map((envelope) => envelope.type)).toEqual(["fog:reset"]);
  });
});
