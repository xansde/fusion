/**
 * PreyMarker.ts — PIXI seal for the Prey (`TokenMark` `hunted-prey`) (BHR-F3-07).
 *
 * A gold diamond pinned to the top-right corner of the marked token, on the
 * "controls" layer. It is deliberately NOT the corner-bracket reticle of
 * TargetingMarker (the live target): a token can carry both, and the two stay
 * readable side by side. Hovering the seal shows the tooltip text the caller
 * resolved ("Presa de <nome do ator que marcou>" — never hardcoded here).
 *
 * Imperative like TargetingMarkerLayer: `sync()` every frame, `destroy()` on unload.
 * REQ-BHR-091, REQ-CNV-105, REQ-TOK-115.
 */

import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";

export interface PreyMarkerConfig {
  color?: number;
  outlineColor?: number;
  /** Seal size as a fraction of the cell. Default 0.3. */
  sizeFraction?: number;
}

export interface PreySealPosition {
  tokenId: string;
  /** Token top-left in scene pixels. */
  x: number;
  y: number;
  gridSize: number;
  /** Tooltip text, already localized ("Presa de <nome>"). */
  label: string;
}

const DEFAULT_COLOR = 0xf2c230;
const DEFAULT_OUTLINE = 0x3a2a00;
const DEFAULT_SIZE_FRACTION = 0.3;

/**
 * Diamond (8 numbers: x,y × 4) inscribed in the square of side `size*fraction`
 * at the top-right corner of the token footprint — relative to the token origin
 * when called with (0,0). Pure geometry.
 */
export function computeSealDiamond(
  x: number,
  y: number,
  gridSize: number,
  sizeFraction: number,
): [number, number, number, number, number, number, number, number] {
  const s = gridSize * sizeFraction;
  const left = x + gridSize - s;
  const cx = left + s / 2;
  const cy = y + s / 2;
  return [cx, y, left + s, cy, cx, y + s, left, cy];
}

interface Seal {
  root: Container;
  body: Graphics;
  tip: Text;
  label: string;
  sig: string;
}

export class PreyMarkerLayer {
  private _parent: Container;
  private _seals = new Map<string, Seal>();
  private _color: number;
  private _outline: number;
  private _sizeFraction: number;

  constructor(parent: Container, config: PreyMarkerConfig = {}) {
    this._parent = parent;
    this._color = config.color ?? DEFAULT_COLOR;
    this._outline = config.outlineColor ?? DEFAULT_OUTLINE;
    this._sizeFraction = config.sizeFraction ?? DEFAULT_SIZE_FRACTION;
  }

  sync(positions: readonly PreySealPosition[]): void {
    const incoming = new Set<string>();
    for (const p of positions) {
      incoming.add(p.tokenId);
      let seal = this._seals.get(p.tokenId);
      if (!seal) {
        seal = this._create(p.tokenId);
        this._seals.set(p.tokenId, seal);
      }
      const sig = p.gridSize.toFixed(1);
      seal.root.position.set(p.x, p.y);
      if (seal.sig !== sig) {
        this._drawBody(seal.body, p.gridSize);
        seal.tip.position.set(
          p.gridSize * (1 - this._sizeFraction),
          p.gridSize * this._sizeFraction + 4,
        );
        seal.sig = sig;
      }
      if (seal.label !== p.label) {
        seal.label = p.label;
        seal.tip.text = p.label;
      }
    }
    for (const [tokenId, seal] of this._seals) {
      if (!incoming.has(tokenId)) {
        seal.root.destroy({ children: true });
        this._seals.delete(tokenId);
      }
    }
  }

  /** Tooltip text of the seal on `tokenId`, or null when there is none. */
  tooltipOf(tokenId: string): string | null {
    return this._seals.get(tokenId)?.label ?? null;
  }

  clear(): void {
    for (const seal of this._seals.values()) seal.root.destroy({ children: true });
    this._seals.clear();
  }

  destroy(): void {
    this.clear();
  }

  private _create(tokenId: string): Seal {
    const root = new Container();
    root.label = `preySeal:${tokenId}`;
    const body = new Graphics();
    const tip = new Text({
      text: "",
      style: {
        fontSize: 13,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        fontFamily: "sans-serif",
      },
    });
    tip.visible = false;
    tip.anchor.set(1, 0);
    root.addChild(body, tip);
    // Only the seal itself reacts; the token below keeps its own pointer handling.
    root.eventMode = "static";
    root.cursor = "help";
    root.on("pointerover", (_e: FederatedPointerEvent) => {
      tip.visible = true;
    });
    root.on("pointerout", () => {
      tip.visible = false;
    });
    this._parent.addChild(root);
    return { root, body, tip, label: "", sig: "" };
  }

  private _drawBody(g: Graphics, gridSize: number): void {
    g.clear();
    const d = computeSealDiamond(0, 0, gridSize, this._sizeFraction);
    g.poly(d).fill({ color: this._color, alpha: 0.95 });
    g.poly(d).stroke({ color: this._outline, width: 2 });
  }
}
