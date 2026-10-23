import { beforeEach, describe, expect, it } from "vitest";
import {
  rulerTool,
  selectRulerMode,
  selectTargetArea,
  setRulerTool,
} from "../rulerToolStore.svelte.js";

describe("ruler tool purpose (measure vs target selector)", () => {
  beforeEach(() => {
    setRulerTool(null);
  });

  it("the ruler's modes measure; the target button's areas select", () => {
    selectRulerMode("cone");
    expect(rulerTool).toMatchObject({ mode: "cone", purpose: "measure" });
    selectTargetArea("cone");
    expect(rulerTool).toMatchObject({ mode: "cone", purpose: "target" });
    selectRulerMode("cone");
    expect(rulerTool).toMatchObject({ mode: "cone", purpose: "measure" });
  });

  it("choosing the active selector again switches it off; switching the tool off resets the purpose", () => {
    selectTargetArea("line");
    selectTargetArea("line");
    expect(rulerTool.mode).toBeNull();
    selectTargetArea("burst");
    setRulerTool(null);
    expect(rulerTool).toMatchObject({ mode: null, purpose: "measure" });
  });
});
