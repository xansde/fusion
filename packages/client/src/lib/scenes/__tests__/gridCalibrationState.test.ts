import { beforeEach, describe, expect, it } from "vitest";
import { cornerPanel, openCornerPanel } from "../../ui/cornerPanel.svelte.js";
import { rulerTool, setRulerTool } from "../../presence/rulerToolStore.svelte.js";
import {
  gridCalibrationState,
  startGridCalibration,
  stopGridCalibration,
} from "../gridCalibrationState.svelte.js";

describe("gridCalibrationState", () => {
  beforeEach(() => {
    cornerPanel.open = null;
    gridCalibrationState.sceneId = null;
    setRulerTool(null);
  });

  it("starting aims at the scene and opens the calibrate corner panel", () => {
    startGridCalibration("scene-1");
    expect(gridCalibrationState.sceneId).toBe("scene-1");
    expect(cornerPanel.open).toBe("calibrate");
  });

  it("closes any other corner panel (one panel at a time)", () => {
    openCornerPanel("ruler");
    startGridCalibration("scene-1");
    expect(cornerPanel.open).toBe("calibrate");
    openCornerPanel("show");
    expect(cornerPanel.open).toBe("show");
  });

  it("disarms the ruler so the two tools never share a drag", () => {
    setRulerTool("ruler");
    expect(rulerTool.mode).toBe("ruler");
    startGridCalibration("scene-1");
    expect(rulerTool.mode).toBeNull();
  });

  it("stopping clears the scene and closes the panel", () => {
    startGridCalibration("scene-1");
    stopGridCalibration();
    expect(gridCalibrationState.sceneId).toBeNull();
    expect(cornerPanel.open).toBeNull();
  });
});
