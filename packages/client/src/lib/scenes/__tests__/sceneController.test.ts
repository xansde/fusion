/**
 * sceneController.test.ts — unit tests for scene form validation and
 * list helper (pure logic, no sockets required).
 */

import { describe, it, expect } from "vitest";
import {
  validateSceneForm,
  isFormValid,
  defaultSceneFormData,
  listScenes,
  type SceneFormData,
} from "../sceneController.js";
import { DocumentMirror } from "../../docs/DocumentMirror.js";
import type { WorldSnapshotPayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// validateSceneForm
// ---------------------------------------------------------------------------

describe("validateSceneForm", () => {
  function makeValid(overrides: Partial<SceneFormData> = {}): SceneFormData {
    return { ...defaultSceneFormData(), name: "My Scene", ...overrides };
  }

  it("returns empty errors for valid data", () => {
    const errors = validateSceneForm(makeValid());
    expect(errors).toEqual({});
  });

  it("isFormValid: true when no errors", () => {
    expect(isFormValid({})).toBe(true);
  });

  it("isFormValid: false when there are errors", () => {
    expect(isFormValid({ name: "required" })).toBe(false);
  });

  it("requires a non-empty name", () => {
    const errors = validateSceneForm(makeValid({ name: "" }));
    expect(errors.name).toBeDefined();
  });

  it("requires a name of 128 chars or fewer", () => {
    const errors = validateSceneForm(makeValid({ name: "a".repeat(129) }));
    expect(errors.name).toBeDefined();
  });

  it("accepts a name of exactly 128 chars", () => {
    const errors = validateSceneForm(makeValid({ name: "a".repeat(128) }));
    expect(errors.name).toBeUndefined();
  });

  it("requires width >= 100", () => {
    expect(validateSceneForm(makeValid({ width: 99 })).width).toBeDefined();
    expect(validateSceneForm(makeValid({ width: 100 })).width).toBeUndefined();
  });

  it("requires width <= 20000", () => {
    expect(validateSceneForm(makeValid({ width: 20_001 })).width).toBeDefined();
    expect(validateSceneForm(makeValid({ width: 20_000 })).width).toBeUndefined();
  });

  it("requires integer width", () => {
    expect(validateSceneForm(makeValid({ width: 1000.5 })).width).toBeDefined();
  });

  it("requires height >= 100", () => {
    expect(validateSceneForm(makeValid({ height: 99 })).height).toBeDefined();
    expect(validateSceneForm(makeValid({ height: 100 })).height).toBeUndefined();
  });

  it("requires height <= 20000", () => {
    expect(validateSceneForm(makeValid({ height: 20_001 })).height).toBeDefined();
    expect(validateSceneForm(makeValid({ height: 20_000 })).height).toBeUndefined();
  });

  it("requires gridSize >= 50", () => {
    expect(validateSceneForm(makeValid({ gridSize: 49 })).gridSize).toBeDefined();
    expect(validateSceneForm(makeValid({ gridSize: 50 })).gridSize).toBeUndefined();
  });

  it("requires gridSize <= 500", () => {
    expect(validateSceneForm(makeValid({ gridSize: 501 })).gridSize).toBeDefined();
    expect(validateSceneForm(makeValid({ gridSize: 500 })).gridSize).toBeUndefined();
  });

  it("requires integer gridSize", () => {
    expect(validateSceneForm(makeValid({ gridSize: 100.1 })).gridSize).toBeDefined();
  });

  it("accepts empty background (optional)", () => {
    const errors = validateSceneForm(makeValid({ background: "" }));
    expect(errors.background).toBeUndefined();
  });

  it("rejects background longer than 1024 chars", () => {
    const errors = validateSceneForm(makeValid({ background: "x".repeat(1025) }));
    expect(errors.background).toBeDefined();
  });

  it("accepts a background URL of exactly 1024 chars", () => {
    const errors = validateSceneForm(makeValid({ background: "x".repeat(1024) }));
    expect(errors.background).toBeUndefined();
  });

  it("trims name before validating (whitespace-only is invalid)", () => {
    const errors = validateSceneForm(makeValid({ name: "   " }));
    expect(errors.name).toBeDefined();
  });

  it("can have multiple errors simultaneously", () => {
    const errors = validateSceneForm(makeValid({ name: "", width: 50, gridSize: 10 }));
    expect(errors.name).toBeDefined();
    expect(errors.width).toBeDefined();
    expect(errors.gridSize).toBeDefined();
    expect(isFormValid(errors)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defaultSceneFormData
// ---------------------------------------------------------------------------

describe("defaultSceneFormData", () => {
  it("produces a form with sensible defaults", () => {
    const form = defaultSceneFormData();
    expect(form.name).toBe("");
    expect(form.width).toBe(4000);
    expect(form.height).toBe(4000);
    expect(form.gridSize).toBe(100);
    expect(form.background).toBe("");
  });
});

// ---------------------------------------------------------------------------
// listScenes
// ---------------------------------------------------------------------------

describe("listScenes", () => {
  function makeSnapshot(scenes: Array<{ _id: string; name: string }>): WorldSnapshotPayload {
    return {
      seq: 0,
      documents: {
        Scene: scenes.map((s) => ({
          _id: s._id,
          name: s.name,
          active: false,
          ownership: {},
          width: 4000,
          height: 4000,
          padding: 0.25,
          background: null,
          backgroundColor: "#000000",
          grid: {
            type: "square",
            size: 100,
            distance: 5,
            units: "ft",
            color: "#000000",
            alpha: 0.2,
          },
          initialView: null,
          tokenVision: false,
          navigation: true,
          navName: null,
          thumb: null,
          playlistId: null,
          journalId: null,
          tokens: [],
          walls: [],
          lights: [],
          sounds: [],
          tiles: [],
          drawings: [],
          templates: [],
          notes: [],
          _stats: {
            version: 1,
            createdTime: 0,
            modifiedTime: 0,
            createdBy: null,
            modifiedBy: null,
          },
          flags: {},
        })),
      },
      activeSceneId: null,
    };
  }

  it("returns empty array when mirror has no scenes", () => {
    const mirror = new DocumentMirror();
    mirror.applySnapshot({ seq: 0, documents: {}, activeSceneId: null });
    expect(listScenes(mirror)).toEqual([]);
  });

  it("returns scenes sorted by name", () => {
    const mirror = new DocumentMirror();
    mirror.applySnapshot(
      makeSnapshot([
        { _id: "BBBBBBBBBBBBBBBB", name: "Zebra Scene" },
        { _id: "AAAAAAAAAAAAAAAA", name: "Alpha Scene" },
        { _id: "CCCCCCCCCCCCCCCC", name: "Middle Scene" },
      ]),
    );
    const names = listScenes(mirror).map((s) => s.name);
    expect(names).toEqual(["Alpha Scene", "Middle Scene", "Zebra Scene"]);
  });

  it("does not mutate the mirror's internal array", () => {
    const mirror = new DocumentMirror();
    mirror.applySnapshot(
      makeSnapshot([
        { _id: "BBBBBBBBBBBBBBBB", name: "B" },
        { _id: "AAAAAAAAAAAAAAAA", name: "A" },
      ]),
    );
    const first = listScenes(mirror);
    const second = listScenes(mirror);
    // Calling twice should not error and both should be sorted
    expect(first.map((s) => s.name)).toEqual(["A", "B"]);
    expect(second.map((s) => s.name)).toEqual(["A", "B"]);
  });
});
