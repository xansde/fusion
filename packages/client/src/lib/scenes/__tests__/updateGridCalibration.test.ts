/**
 * updateGridCalibration — writing a calibrated grid on a scene that already has tokens:
 * the grid goes first, then what is placed is put back where it was on the MAP (the sizes
 * of tokens come from the caller, the plan from gridRecalibration.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultSceneDocument, defaultTokenDocument, createDocumentId } from "@fusion/shared";

const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
vi.mock("../../docs/sendOp.js", () => ({
  OpError: class OpError extends Error {},
  sendOp: (_s: unknown, env: { type: string; payload: Record<string, unknown> }): Promise<void> => {
    sent.push({ type: env.type, payload: env.payload });
    return Promise.resolve();
  },
}));

const { updateGridCalibration } = await import("../sceneController.js");

const DATA = {
  size: 70,
  offsetX: 0,
  offsetY: 0,
  distance: 5,
  units: "ft",
  color: "#000000",
  alpha: 0.2,
};

beforeEach(() => {
  sent.length = 0;
});

describe("updateGridCalibration", () => {
  it("writes the grid first, then re-seats the tokens already on the scene", async () => {
    const id = createDocumentId();
    const scene = {
      ...defaultSceneDocument(id),
      width: 2000,
      height: 1500,
      padding: 0.25,
      grid: { type: "square", size: 100, distance: 5, units: "ft", color: "#000000", alpha: 0.2 },
      tokens: [{ ...defaultTokenDocument(createDocumentId(), createDocumentId()), x: 600, y: 400 }],
    } as never;

    await updateGridCalibration({} as never, id, DATA, {
      scene,
      footprintOf: () => ({ width: 1, height: 1 }),
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]?.type).toBe("doc:update");
    expect(sent[0]?.payload["documentType"]).toBe("Scene");
    expect(sent[1]?.type).toBe("doc:update");
    expect(sent[1]?.payload["documentType"]).toBe("Token");
    const update = (sent[1]?.payload["updates"] as Array<{ diff: { x: number; y: number } }>)[0];
    // New cell 70, new padding 560 x 420 (was 500 x 400): the token moved with the image.
    expect(update?.diff.x).not.toBe(600);
    expect((update?.diff.x ?? 1) % 70).toBe(0);
  });

  it("without the placed scene it is the single write it always was", async () => {
    await updateGridCalibration({} as never, "scene00000000001", DATA);
    expect(sent).toHaveLength(1);
  });
});
