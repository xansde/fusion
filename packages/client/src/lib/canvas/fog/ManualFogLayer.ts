/**
 * ManualFogLayer.ts — draws a scene's manual fog on the canvas "fog" layer.
 *
 * The fog is rasterized to an offscreen 2D canvas (scaled down so the largest
 * side stays under MAX_RASTER_SIDE) and shown as one sprite covering the whole
 * padded scene. Players get it opaque; privileged viewers get it translucent so
 * the GM keeps seeing the map underneath.
 *
 * One instance per FusionCanvas; `sync()` is cheap to call on every scene
 * mutation — it only repaints when the fog, the scene size or the viewer's
 * privilege actually changed.
 */

import { Sprite, Texture, type Container } from "pixi.js";
import type { ManualFog } from "@fusion/shared";
import { paintFog } from "./fogRaster.js";
import { sceneContentOffset, type SceneDimensionsInput } from "../sceneCoords.js";

/** Largest raster side in pixels; bigger scenes are scaled down. */
export const MAX_RASTER_SIDE = 2048;
/** How much of the map a privileged viewer still sees through the fog. */
export const PRIVILEGED_FOG_ALPHA = 0.5;

export interface FogSceneInput extends SceneDimensionsInput {
  readonly manualFog?: ManualFog | undefined;
}

export class ManualFogLayer {
  private readonly _host: Container;
  private readonly _canvas: HTMLCanvasElement;
  private _sprite: Sprite | null = null;
  private _texture: Texture | null = null;
  private _signature = "";

  constructor(host: Container) {
    this._host = host;
    this._canvas = document.createElement("canvas");
  }

  /**
   * Repaint for `scene`. `override` is the GM's optimistic copy (what was just
   * sent and not yet echoed); the scene's own fog is used otherwise.
   */
  sync(scene: FogSceneInput | null, privileged: boolean, override?: ManualFog | null): void {
    const fog = override ?? scene?.manualFog;
    if (!scene || fog?.enabled !== true) {
      this._signature = "";
      this._hide();
      return;
    }
    const { padX, padY } = sceneContentOffset(scene);
    const totalW = scene.width + padX * 2;
    const totalH = scene.height + padY * 2;
    const signature = JSON.stringify([totalW, totalH, privileged, fog]);
    if (signature === this._signature && this._sprite) return;
    this._signature = signature;

    const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(totalW, totalH));
    const rw = Math.max(1, Math.ceil(totalW * scale));
    const rh = Math.max(1, Math.ceil(totalH * scale));
    const resized = this._canvas.width !== rw || this._canvas.height !== rh;
    if (resized) {
      this._canvas.width = rw;
      this._canvas.height = rh;
    }
    const ctx = this._canvas.getContext("2d");
    if (!ctx) return;
    paintFog(ctx, fog, totalW, totalH, scale);

    if (resized || !this._texture) {
      this._texture?.destroy(true);
      this._texture = Texture.from(this._canvas);
      this._sprite?.destroy();
      this._sprite = new Sprite(this._texture);
      this._sprite.label = "scene:manual-fog";
      this._sprite.eventMode = "none";
      this._host.addChild(this._sprite);
    } else {
      this._texture.source.update();
    }
    const sprite = this._sprite;
    if (!sprite) return;
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = totalW;
    sprite.height = totalH;
    sprite.alpha = privileged ? PRIVILEGED_FOG_ALPHA : 1;
    sprite.visible = true;
  }

  private _hide(): void {
    if (this._sprite) this._sprite.visible = false;
  }

  destroy(): void {
    this._sprite?.destroy();
    this._texture?.destroy(true);
    this._sprite = null;
    this._texture = null;
  }
}
