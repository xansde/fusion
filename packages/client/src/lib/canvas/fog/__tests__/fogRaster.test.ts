import { describe, it, expect } from "vitest";
import { paintFog, type FogCtx } from "../fogRaster.js";

function recorder(): { ctx: FogCtx; log: string[] } {
  const log: string[] = [];
  const state = { globalCompositeOperation: "source-over" } as Record<string, unknown>;
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        log.push(`${prop}:${String(target["globalCompositeOperation"])}:${args.join(",")}`);
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as FogCtx;
  return { ctx, log };
}

describe("paintFog", () => {
  it("leaves the canvas empty when the fog is off", () => {
    const { ctx, log } = recorder();
    paintFog(ctx, { enabled: false, base: "covered", ops: [] }, 1000, 800, 0.5);
    expect(log.some((l) => l.startsWith("fillRect"))).toBe(false);
  });

  it("covers everything first when the base is covered", () => {
    const { ctx, log } = recorder();
    paintFog(ctx, { enabled: true, base: "covered", ops: [] }, 1000, 800, 0.5);
    expect(log).toContain("fillRect:source-over:0,0,1000,800");
  });

  it("does not cover a revealed base", () => {
    const { ctx, log } = recorder();
    paintFog(ctx, { enabled: true, base: "revealed", ops: [] }, 1000, 800, 1);
    expect(log.some((l) => l.startsWith("fillRect"))).toBe(false);
  });

  it("punches reveal shapes out and paints cover shapes back, in order", () => {
    const { ctx, log } = recorder();
    paintFog(
      ctx,
      {
        enabled: true,
        base: "covered",
        ops: [
          { t: "rect", m: "reveal", x: 0, y: 0, w: 100, h: 100 },
          { t: "rect", m: "cover", x: 10, y: 10, w: 20, h: 20 },
        ],
      },
      1000,
      800,
      1,
    );
    const rects = log.filter((l) => l.startsWith("fillRect"));
    expect(rects.slice(1)).toEqual([
      "fillRect:destination-out:0,0,100,100",
      "fillRect:source-over:10,10,20,20",
    ]);
  });
});
