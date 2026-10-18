import { beforeEach, describe, expect, it } from "vitest";
import { cornerPanel, openCornerPanel, closeCornerPanel, toggleCornerPanel } from "../cornerPanel.svelte.js";
import { fogToolState } from "../../canvas/fog/fogToolState.svelte.js";

describe("cornerPanel", () => {
  beforeEach(() => {
    cornerPanel.open = null;
    fogToolState.tool = "none";
  });

  it("opening one panel closes the others", () => {
    openCornerPanel("ruler");
    expect(cornerPanel.open).toBe("ruler");
    openCornerPanel("fog");
    expect(cornerPanel.open).toBe("fog");
    openCornerPanel("show");
    expect(cornerPanel.open).toBe("show");
  });

  it("leaving the fog panel disarms the fog tool", () => {
    openCornerPanel("fog");
    fogToolState.tool = "brush";
    openCornerPanel("ruler");
    expect(fogToolState.tool).toBe("none");
  });

  it("toggle opens then closes; close of a non-open panel is a no-op", () => {
    toggleCornerPanel("show");
    expect(cornerPanel.open).toBe("show");
    closeCornerPanel("fog");
    expect(cornerPanel.open).toBe("show");
    toggleCornerPanel("show");
    expect(cornerPanel.open).toBeNull();
  });
});
