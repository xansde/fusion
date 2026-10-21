import { describe, it, expect, vi } from "vitest";
import { captureView, restoreView } from "../sceneViewKeep.js";

describe("sceneViewKeep", () => {
  const canvas = {
    camera: { tx: -300, ty: -100, scale: 2 },
    viewElement: { clientWidth: 800, clientHeight: 600 },
  };

  it("remembers the view centre relative to the map corner", () => {
    // centre on screen (400,300) -> world ((400+300)/2, (300+100)/2) = (350, 200)
    expect(captureView(canvas, { padX: 100, padY: 50 })).toEqual({
      mapX: 250,
      mapY: 150,
      scale: 2,
    });
  });

  it("puts the same map point back at the centre after the padding changed", () => {
    const kept = captureView(canvas, { padX: 100, padY: 50 });
    const panTo = vi.fn();
    restoreView({ panTo }, kept, { padX: 160, padY: 90 });
    expect(panTo).toHaveBeenCalledWith(410, 240, 2);
  });
});
