/**
 * GridRenderer.ts — draws a square grid using a single PIXI.Graphics object.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-024
 *
 * Design:
 * - One Graphics instance, redrawn only when config changes (efficient).
 * - Covers the visible area from (0,0) to (totalWidth, totalHeight).
 * - Color and alpha are configurable.
 * - Only redraws when the config passed to update() actually changes.
 */

import { Graphics } from "pixi.js";
import type { GridConfig } from "@fusion/shared";

/** The portion of GridConfig that the renderer cares about. */
export interface GridRenderConfig {
  /** Cell size in pixels (REQ-CNV-017: min 50). */
  size: number;
  /** CSS hex color string, e.g. "#888888". */
  color: string;
  /** Opacity 0–1. */
  alpha: number;
  /** X offset to align a pre-drawn grid in the background image. */
  offsetX: number;
  /** Y offset. */
  offsetY: number;
  /** Total scene width including padding (pixels). */
  totalWidth: number;
  /** Total scene height including padding (pixels). */
  totalHeight: number;
}

/**
 * Parse a CSS hex color string like "#rrggbb" or "#rgb" into a PIXI number.
 */
function parseColor(css: string): number {
  const hex = css.replace("#", "");
  if (hex.length === 3) {
    const ch0 = hex[0] as string;
    const ch1 = hex[1] as string;
    const ch2 = hex[2] as string;
    const r = parseInt(ch0 + ch0, 16);
    const g = parseInt(ch1 + ch1, 16);
    const b = parseInt(ch2 + ch2, 16);
    return (r << 16) | (g << 8) | b;
  }
  return parseInt(hex.padStart(6, "0"), 16);
}

export class GridRenderer {
  /** The PIXI Graphics object — add this to your layer container. */
  readonly graphics: Graphics;

  private _config: GridRenderConfig | null = null;

  constructor() {
    this.graphics = new Graphics();
    // Grid does not need to be interactive
    this.graphics.eventMode = "none";
  }

  /**
   * Update the grid config and redraw if anything changed.
   * Pass null/undefined to hide the grid.
   */
  update(config: GridRenderConfig | null): void {
    if (config === null) {
      this.graphics.clear();
      this._config = null;
      return;
    }

    // Skip redraw if nothing changed
    if (this._configEquals(config)) return;

    this._config = { ...config };
    this._draw(config);
  }

  /**
   * Force a redraw with the current config (e.g. after viewport resize).
   */
  redraw(): void {
    if (this._config) this._draw(this._config);
  }

  /**
   * Build a GridRenderConfig from a shared GridConfig + scene dimensions.
   */
  static fromGridConfig(
    grid: GridConfig,
    totalWidth: number,
    totalHeight: number,
    offsetX = 0,
    offsetY = 0,
  ): GridRenderConfig {
    return {
      size: Math.max(50, grid.size),
      color: grid.color,
      alpha: grid.alpha,
      offsetX,
      offsetY,
      totalWidth,
      totalHeight,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _draw(cfg: GridRenderConfig): void {
    const g = this.graphics;
    g.clear();

    if (cfg.alpha <= 0 || cfg.size <= 0) return;

    const color = parseColor(cfg.color);
    const { size, offsetX, offsetY, totalWidth, totalHeight } = cfg;

    // Compute starting corner (offset may be negative or >0)
    const startX = offsetX % size; // first vertical line
    const startY = offsetY % size; // first horizontal line

    g.setStrokeStyle({ width: 1, color, alpha: cfg.alpha });

    // Vertical lines
    for (let x = startX; x <= totalWidth; x += size) {
      g.moveTo(x, 0).lineTo(x, totalHeight);
    }

    // Horizontal lines
    for (let y = startY; y <= totalHeight; y += size) {
      g.moveTo(0, y).lineTo(totalWidth, y);
    }

    g.stroke();
  }

  private _configEquals(other: GridRenderConfig): boolean {
    if (!this._config) return false;
    const c = this._config;
    return (
      c.size === other.size &&
      c.color === other.color &&
      c.alpha === other.alpha &&
      c.offsetX === other.offsetX &&
      c.offsetY === other.offsetY &&
      c.totalWidth === other.totalWidth &&
      c.totalHeight === other.totalHeight
    );
  }
}
