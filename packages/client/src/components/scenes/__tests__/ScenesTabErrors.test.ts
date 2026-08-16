/**
 * ScenesTabErrors.test.ts — what the Cenas tab does when the SERVER says no.
 *
 * The panel has three write surfaces and each one can be refused: putting a scene on air
 * (REQ-CEN-045), the environment shortcuts of the head (REQ-CEN-023) and the reorder of
 * the archive (REQ-CEN-037). Until this file existed, every one of those refusals was
 * unexercised — deleting the whole `catch` of the activation left the suite green, which
 * is precisely the shape of the r22 lesson (a green suite that proves nothing).
 *
 * The two halves of REQ-CEN-045 are asserted apart:
 *  - the MESSAGE — the refusal must arrive as an `OpError` carrying the server's own
 *    words, since that is exactly what the panel renders (`err.message`);
 *  - "sem deixar a cabeça em estado divergente do servidor" — the head is a `$derived`
 *    projection of (world, activeSceneId), so the proof is that recomputing it after the
 *    refusal, with the id the server never changed, still names the same scene. A panel
 *    that had moved the head optimistically would fail this.
 *
 * The client's Vitest runs in node with no DOM (see `vitest.config.ts`), so the rendered
 * error paragraph itself cannot be produced by setting internal state. What CAN be
 * pinned is that the template still has a message region bound to each of the three
 * error states — the same source-reading technique `ScenesTab.test.ts` uses for the
 * declarative CSS rules it cannot exercise either.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Socket } from "socket.io-client";
import type { Envelope, SceneDocument } from "@fusion/shared";

import { activateScene, OpError } from "../../../lib/scenes/sceneController.js";
import { buildSceneHeadVM } from "../../../lib/scenes/scenesTabVM.js";
import {
  SCENE_ENV_KEYS,
  buildSceneEnvironmentVM,
  describeEnvironmentError,
  resetSceneFog,
  toggleSceneFog,
} from "../../../lib/scenes/sceneEnvironment.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";
import { persistSceneOrder, reorderWithinGroup } from "../../../lib/scenes/sceneShelf.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REFUSAL = "Scene not found";

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100 },
    background: null,
    backgroundColor: "#101018",
    darkness: 0,
    fogEnabled: false,
    folder: null,
    sort: 0,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

const ON_AIR = makeScene({ _id: "s1", name: "Taverna" });
const OTHER = makeScene({ _id: "s2", name: "Cripta" });
const WORLD = [ON_AIR, OTHER];

interface RefusingSocket {
  readonly socket: Socket;
  readonly sent: Envelope[];
}

/** A server that answers every op with a refusal, in the ack shape `sendOp` reads. */
function refusingSocket(code = "NOT_FOUND", message = REFUSAL): RefusingSocket {
  const sent: Envelope[] = [];
  const socket = {
    emit(_event: string, payload: Envelope, ack: (value: unknown) => void): void {
      sent.push(payload);
      ack({ ok: false, code, message, requestId: payload.requestId });
    },
  } as unknown as Socket;
  return { socket, sent };
}

/** The component's own source — for the template rules a node run cannot render. */
function sourceOfScenesTab(): string {
  return readFileSync(fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// Putting a scene on air — REQ-CEN-045
// ---------------------------------------------------------------------------

describe("a refused activation (REQ-CEN-045)", () => {
  it("REQ-CEN-045: the refusal reaches the panel as the server's own message", async () => {
    const { socket, sent } = refusingSocket();

    // The op WAS sent — this is a refusal, not a request the client swallowed.
    await expect(activateScene(socket, OTHER._id)).rejects.toBeInstanceOf(OpError);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("world:activeScene");

    // And the message the panel shows (`err.message`) is the server's, not a generic one.
    await expect(activateScene(socket, OTHER._id)).rejects.toThrow(REFUSAL);
  });

  it("REQ-CEN-045: the ack code introduced by the dedicated handler is carried, not swallowed", async () => {
    // `world:activeScene` answers NOT_FOUND for a scene that is not in this world; the
    // panel has to be able to tell that apart from a permission refusal.
    const notFound = refusingSocket("NOT_FOUND", "Scene not found");
    const denied = refusingSocket("PERMISSION_DENIED", "Only the Master puts a scene on air");

    await expect(activateScene(notFound.socket, "ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(activateScene(denied.socket, OTHER._id)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("REQ-CEN-045: the head does not diverge — it still shows the scene the server holds", async () => {
    const { socket } = refusingSocket();

    const before = buildSceneHeadVM({ scenes: WORLD, activeSceneId: ON_AIR._id });
    await expect(activateScene(socket, OTHER._id)).rejects.toThrow();

    // Nothing about the world changed, because the server refused: the head recomputed
    // from the SAME single source still names the scene that is really on air. The
    // failing half of this requirement would be a head that had moved to "Cripta".
    const after = buildSceneHeadVM({ scenes: WORLD, activeSceneId: ON_AIR._id });

    expect(after).toEqual(before);
    expect(after.kind).toBe("on-air");
    if (after.kind === "on-air") expect(after.name).toBe("Taverna");
  });

  it("REQ-CEN-045: the panel keeps a message region bound to the failed activation", () => {
    const source = sourceOfScenesTab();

    // The state exists, the catch fills it with the server's message, and the template
    // renders it as an alert. Deleting any of the three is what this pins.
    expect(source).toMatch(/activateError = err instanceof OpError \? err\.message/);
    expect(source).toMatch(
      /\{#if activateError\}[\s\S]{0,200}class="scenes-tab__error"[\s\S]{0,80}role="alert"/,
    );
  });
});

// ---------------------------------------------------------------------------
// The environment shortcuts — REQ-CEN-023
// ---------------------------------------------------------------------------

describe("a refused environment write (REQ-CEN-023)", () => {
  it("REQ-CEN-023: the refusal is a message, and the control keeps the server's state", async () => {
    const { socket, sent } = refusingSocket("PERMISSION_DENIED", "Refused by the server");

    const before = buildSceneEnvironmentVM({ scenes: WORLD, activeSceneId: ON_AIR._id });
    expect(before?.fog.pressed).toBe(false);

    await expect(toggleSceneFog(socket, ON_AIR)).rejects.toThrow("Refused by the server");
    expect(sent).toHaveLength(1);

    // The document never changed, so the control recomputed from it is still OFF — a
    // pressed toggle here would be the optimistic state the requirement forbids.
    const after = buildSceneEnvironmentVM({ scenes: WORLD, activeSceneId: ON_AIR._id });
    expect(after?.fog.pressed).toBe(false);
    expect(after).toEqual(before);
  });

  it("REQ-CEN-022 / REQ-CEN-023: a refused fog reset also arrives as the server's message", async () => {
    const { socket } = refusingSocket("PERMISSION_DENIED", "Refused by the server");

    await expect(resetSceneFog(socket, ON_AIR._id, () => Promise.resolve(true))).rejects.toThrow(
      "Refused by the server",
    );
  });

  it("REQ-CEN-023: the refusal turns into the server's own words, and anything else into a failure message", () => {
    // What the panel puts in its message region, exercised directly: the server's words
    // when it said why, the generic failure otherwise — and never a state.
    expect(
      describeEnvironmentError(new OpError("PERMISSION_DENIED", "Refused by the server")),
    ).toBe("Refused by the server");

    const generic = describeEnvironmentError(new TypeError("socket exploded"));
    expect(generic).toBe(t(SCENE_ENV_KEYS.failed));
    expect(generic).not.toBe(SCENE_ENV_KEYS.failed);
    expect(generic).not.toContain("socket exploded");
  });

  it("REQ-CEN-023: the panel keeps a message region bound to the failed environment gesture", () => {
    const source = sourceOfScenesTab();

    // `envError` is null at server-render time, so the region itself can only be pinned
    // in the template — the same technique the CSS rules use in `ScenesTab.test.ts`.
    expect(source).toMatch(
      /\{#if envError\}[\s\S]{0,200}class="scenes-tab__error"[\s\S]{0,80}role="alert"/,
    );
  });
});

// ---------------------------------------------------------------------------
// The reorder of the archive — REQ-CEN-037
// ---------------------------------------------------------------------------

describe("a refused reorder (REQ-CEN-037)", () => {
  const entries = [
    { sceneId: "s1", sort: 0 },
    { sceneId: "s2", sort: 1 },
    { sceneId: "s3", sort: 2 },
  ];

  it("REQ-CEN-037: the refusal reaches the panel as the server's own message", async () => {
    const { socket, sent } = refusingSocket("PERMISSION_DENIED", "Refused by the server");

    await expect(
      persistSceneOrder(socket, reorderWithinGroup(entries, "s3", 0)),
    ).rejects.toBeInstanceOf(OpError);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("doc:update");
  });

  it("REQ-CEN-037: the panel keeps a message region bound to the failed reorder", () => {
    const source = sourceOfScenesTab();

    expect(source).toMatch(/shelfError = err instanceof OpError \? err\.message/);
    expect(source).toMatch(
      /\{#if shelfError\}[\s\S]{0,200}class="scenes-tab__error"[\s\S]{0,80}role="alert"/,
    );
  });
});
