/**
 * createGridStrategy — the single place that turns a scene's grid config into
 * a usable GridStrategy.
 *
 * Spec: 06-canvas-e-renderizacao.md REQ-CNV-014.
 * Design: docs/design/wi-mapa-grid-01/arquitetura.md §D3.
 *
 * D3 — fallback, not explosion. Only `square` is implemented in this milestone.
 * `hex` and `gridless` (and a legacy scene with no `grid` block at all) fall
 * back to a square grid with a `console.warn`. The UI keeps hex disabled, so
 * this path is unreachable through the interface — but a scene persisted with
 * `type: "hex"` by any other route must not take the table down mid-session.
 * Same defense-in-depth `GridRenderer.fromGridConfig` already practises when it
 * accepts a null grid.
 *
 * The design said the fallback emits a `console.warn`. It cannot: `@fusion/shared`
 * compiles without the DOM or Node libs (there is not a single `console.` in the
 * package, by construction) so the warning is reported through an `onFallback`
 * hook and logged by the caller, which does have a console. Silent fallback is
 * still not an option — the hook is how the intent survives the constraint.
 */

import { SquareGrid, type GridOrigin } from "./SquareGrid.js";
import type { GridConfig, GridStrategy } from "./types.js";

/**
 * Grid used when a scene carries no grid block at all.
 * Mirrors the `scene.grid?.size ?? 100` default the client already assumed.
 */
const FALLBACK_GRID_CONFIG: GridConfig = {
  type: "square",
  size: 100,
  distance: 5,
  units: "ft",
  color: "#000000",
  alpha: 0.4,
  diagonalRule: "alternating_1",
};

/** Called when the factory had to fall back to a square grid. */
export type GridFallbackReporter = (reason: string) => void;

/**
 * Build the grid strategy for a scene.
 *
 * @param config     Grid configuration from the scene. Null/undefined is tolerated
 *                   (legacy scenes persisted without a grid block).
 * @param origin     Grid origin offset in scene pixels (SceneConfig.gridOffsetX/Y,
 *                   or the scene padding when the canvas draws with padding).
 * @param onFallback Invoked when an unimplemented grid type or a missing grid
 *                   block forced a square fallback. Pass `console.warn` from an
 *                   environment that has one.
 */
export function createGridStrategy(
  config: GridConfig | null | undefined,
  origin: GridOrigin = { x: 0, y: 0 },
  onFallback?: GridFallbackReporter,
): GridStrategy {
  if (!config) {
    onFallback?.("[grid] scene has no grid config; falling back to the default square grid");
    return new SquareGrid(FALLBACK_GRID_CONFIG, origin);
  }

  if (config.type !== "square") {
    onFallback?.(
      `[grid] grid type "${config.type}" is not implemented yet; falling back to square`,
    );
    return new SquareGrid({ ...config, type: "square" }, origin);
  }

  return new SquareGrid(config, origin);
}
