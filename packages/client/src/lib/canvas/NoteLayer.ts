/**
 * NoteLayer.ts - draws the map pins (Scene.notes) in the "controls" layer.
 *
 * A pin keeps its size on screen at any zoom (the container is counter-scaled
 * against the camera, like the ruler labels) and is a screen-space target:
 * clicks are resolved by attachNotes.ts from the pointer, not by PIXI events
 * (the controls layer is eventMode "none" so it never steals a click from a token).
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { MapNote } from "@fusion/shared";
import { labelCounterScale } from "./RulerLayer.js";
import { CANVAS_FONT, CANVAS_TEXT } from "./canvasType.js";

const PUBLIC_COLOR = 0xffcc44;
const GM_ONLY_COLOR = 0xb08cff;
/** Radius of the pin marker in screen pixels (also the click target). */
export const PIN_RADIUS_PX = 11;
const FONT_PX = CANVAS_TEXT.base;

export class NoteLayer {
  private _root: Container;
  private _destroyed = false;

  constructor(parent: Container) {
    this._root = new Container();
    this._root.label = "notes";
    this._root.eventMode = "none";
    parent.addChild(this._root);
  }

  /**
   * Redraw every pin.
   *
   * @param notes     The pins to draw (already filtered for this viewer).
   * @param viewScale Camera zoom, to hold the pins at a constant screen size.
   * @param openId    The pin whose window is open (drawn highlighted), or null.
   */
  render(notes: readonly MapNote[], viewScale: number, openId: string | null): void {
    if (this._destroyed) return;
    this._root.removeChildren().forEach((c) => {
      c.destroy({ children: true });
    });
    const k = labelCounterScale(viewScale);

    for (const note of notes) {
      const box = new Container();
      box.eventMode = "none";
      box.x = note.x;
      box.y = note.y;
      box.scale.set(k);

      const color = note.gmOnly ? GM_ONLY_COLOR : PUBLIC_COLOR;
      const g = new Graphics();
      g.eventMode = "none";
      g.circle(0, 0, PIN_RADIUS_PX).fill({ color: 0x000000, alpha: 0.8 });
      g.circle(0, 0, PIN_RADIUS_PX).stroke({
        width: note.id === openId ? 3 : 2,
        color,
        alpha: 1,
      });
      // A small "page" glyph.
      g.roundRect(-4, -5, 8, 10, 1.5).stroke({ width: 1.4, color, alpha: 1 });
      g.moveTo(-2, -1.5).lineTo(2, -1.5).moveTo(-2, 1.5).lineTo(2, 1.5);
      g.stroke({ width: 1.2, color, alpha: 1 });
      box.addChild(g);

      const label = new Text({
        text: note.gmOnly ? `${note.title} (Mestre)` : note.title,
        style: new TextStyle({
          fontFamily: CANVAS_FONT,
          fontSize: FONT_PX,
          fontWeight: "bold",
          fill: color,
        }),
      });
      label.eventMode = "none";
      const padX = 6;
      const padY = 2;
      label.x = PIN_RADIUS_PX + 6 + padX;
      label.y = -label.height / 2;
      const plate = new Graphics();
      plate.eventMode = "none";
      plate
        .roundRect(
          PIN_RADIUS_PX + 6,
          -label.height / 2 - padY,
          label.width + padX * 2,
          label.height + padY * 2,
          5,
        )
        .fill({ color: 0x000000, alpha: 0.78 });
      box.addChild(plate, label);

      this._root.addChild(box);
    }
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (!this._root.destroyed) this._root.destroy({ children: true });
  }
}
