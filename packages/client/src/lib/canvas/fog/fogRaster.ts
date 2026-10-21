/**
 * fogRaster.ts — paints a scene's manual fog onto a 2D canvas context.
 *
 * Opaque black where covered, transparent where revealed. Reveal shapes are
 * punched out with `destination-out`, cover shapes are painted back with
 * `source-over`, replaying the ops in order — the same "last shape wins" rule
 * as `isFogCovered` in @fusion/shared, so the picture and the server agree.
 *
 * The context is a structural subset so tests can feed a recording fake.
 */

import type { FogOp, ManualFogLike } from "@fusion/shared";

export interface FogCtx {
  globalCompositeOperation: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
}

function paintOp(ctx: FogCtx, op: FogOp): void {
  ctx.globalCompositeOperation = op.m === "reveal" ? "destination-out" : "source-over";
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  switch (op.t) {
    case "rect":
      ctx.fillRect(op.x, op.y, op.w, op.h);
      return;
    case "poly": {
      ctx.beginPath();
      ctx.moveTo(op.p[0] as number, op.p[1] as number);
      for (let i = 2; i + 1 < op.p.length; i += 2)
        ctx.lineTo(op.p[i] as number, op.p[i + 1] as number);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "brush": {
      if (op.p.length === 2) {
        ctx.beginPath();
        ctx.arc(op.p[0] as number, op.p[1] as number, op.r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.lineWidth = op.r * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(op.p[0] as number, op.p[1] as number);
      for (let i = 2; i + 1 < op.p.length; i += 2)
        ctx.lineTo(op.p[i] as number, op.p[i + 1] as number);
      ctx.stroke();
      return;
    }
  }
}

/**
 * Repaint the whole fog. `scale` maps scene px to canvas px (the canvas is
 * usually smaller than the scene). Leaves the canvas fully transparent when the
 * fog is off.
 */
export function paintFog(
  ctx: FogCtx,
  fog: ManualFogLike | null | undefined,
  sceneWidth: number,
  sceneHeight: number,
  scale: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, Math.ceil(sceneWidth * scale), Math.ceil(sceneHeight * scale));
  if (fog?.enabled !== true) return;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if ((fog.base ?? "covered") === "covered") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sceneWidth, sceneHeight);
  }
  for (const op of fog.ops ?? []) paintOp(ctx, op);
  ctx.globalCompositeOperation = "source-over";
}
