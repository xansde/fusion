/**
 * sceneCoords.ts — the one place that computes a scene's padding offset and
 * the one place a grid size is defaulted, so neither formula is re-derived
 * (or drifts) at each call site.
 *
 * "Scene coordinates" (REQ-CNV-011, spec 06 glossary) are defined with the
 * origin at the corner of the PADDED area — `sceneLoader.ts` draws the
 * background sprite at `(padX, padY)`, not `(0, 0)`, and every placeable
 * (`TokenDocument.x`/`y` included, read directly by
 * `TokenSprite._applyPosition` with no offset of its own) already lives in
 * that one system. `TableScreen.handleCanvasDrop`'s `worldX`/`worldY` (the
 * inverse camera transform of an actual click) and `TokenAddDialog.svelte`'s
 * raw "X"/"Y" fields both feed `Token.x`/`y` unconverted — there is no unit
 * mismatch between the two token-creation paths to convert away.
 *
 * `sceneContentOffset` is that `padX`/`padY` formula, reused by
 * `sceneLoader.ts`, `TableScreen.svelte` and `TokenAddDialog.svelte` (the
 * last one uses it only to pick a sane DEFAULT position — see that
 * component's docstring for why a raw `(0, 0)` default was defect 1 of the
 * Fase 1 e2e: it is a corner of the padding margin REQ-CNV-066 describes as
 * staging space outside the main map, not the map itself, so a token created
 * without the GM touching "X"/"Y" landed invisibly off to the side).
 *
 * `effectiveGridSize` closes a related, narrower gap: `scene.grid?.size ??
 * 100` only covers a MISSING `grid` (the common case — a document persisted
 * before REQ-CNV-067 added the field, see r7.1). A `grid.size` that is
 * PRESENT but non-positive would slip through the same `??` unchanged and
 * zero out `tokenPixelSize`'s `footprint × gridSize` multiplication
 * (`token-visuals.ts`). No validated write can produce that today
 * (`GridConfigSchema.size` is `min(50)`), but a hand-edited/legacy document
 * is not something Zod ever re-validated on disk, so the guard is real
 * defense, not decoration — and every caller that used to inline `scene.
 * grid?.size ?? 100` (TableScreen.svelte, scene-orchestrator.ts,
 * scenesTabVM.ts) now shares this one definition instead of drifting. It
 * also fixes a real, user-visible bug: `scenesTabVM.ts`'s OWN `grid?.size ??
 * 0` (a different, undocumented fallback) is what actually produced the
 * "Grade quadrada · 0 px" label on a legacy scene — a value the scene was
 * never rendered/snapped at (every render path already defaults to 100).
 */

/** REQ-CNV-067's own default when `scene.grid` is absent (`packages/shared/src/scene.ts`). */
const DEFAULT_GRID_SIZE = 100;

/** The minimal shape `effectiveGridSize` needs — a real `SceneDocument` satisfies it. */
export interface GridSizeInput {
  readonly grid?: { readonly size?: number } | null;
}

/**
 * The grid cell size (px) actually used to render/snap this scene — never
 * zero, never negative. Falls back to `DEFAULT_GRID_SIZE` when `grid` is
 * absent (legacy document) OR when `grid.size` is present but not a
 * positive number.
 */
export function effectiveGridSize(scene: GridSizeInput | null | undefined): number {
  const size = scene?.grid?.size;
  return typeof size === "number" && size > 0 ? size : DEFAULT_GRID_SIZE;
}

/** The minimal shape `sceneContentOffset` needs. */
export interface SceneDimensionsInput extends GridSizeInput {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

export interface SceneContentOffset {
  readonly padX: number;
  readonly padY: number;
}

/**
 * The offset (px), in scene coordinates, of the visible map's own top-left
 * corner from the scene's origin. Mirrors `sceneLoader.ts`'s own `padX`/
 * `padY` formula exactly — one definition, not three.
 */
export function sceneContentOffset(scene: SceneDimensionsInput): SceneContentOffset {
  // The padding is rounded UP to whole grid cells (as Foundry does). The grid
  // is drawn from (padX, padY) while token snapping, drops and arrow moves are
  // anchored at the scene origin; with a padding that is not a multiple of the
  // cell size the two lattices drifted apart and tokens snapped between lines.
  const size = effectiveGridSize(scene);
  const toCells = (raw: number): number => Math.ceil(raw / size) * size;
  return {
    padX: toCells(scene.width * scene.padding),
    padY: toCells(scene.height * scene.padding),
  };
}

/** What the grid helpers need from a scene. */
export interface SceneGridInput extends GridSizeInput {
  readonly gridOffsetX?: number | null;
  readonly gridOffsetY?: number | null;
}

/**
 * Where the grid starts relative to the map corner (grid calibration), wrapped
 * into one cell. Zero for a scene that was never calibrated. The scene padding
 * is a whole number of cells, so this is also the offset of the lattice in
 * scene coordinates — which is what token snapping needs.
 */
export function sceneGridOffset(scene: SceneGridInput): { x: number; y: number } {
  const size = effectiveGridSize(scene);
  const wrap = (v: number | null | undefined): number =>
    typeof v === "number" && Number.isFinite(v) ? ((v % size) + size) % size : 0;
  return { x: wrap(scene.gridOffsetX), y: wrap(scene.gridOffsetY) };
}

/**
 * A string that changes exactly when something about how the grid is drawn or
 * measured changes. The canvas reloads the scene when it does (the padding
 * depends on the cell size, so the background moves with it).
 */
export function sceneGridSignature(
  scene: SceneGridInput & {
    readonly grid?: {
      readonly size?: number;
      readonly color?: string;
      readonly alpha?: number;
      readonly distance?: number;
      readonly units?: string;
      readonly type?: string;
    } | null;
  },
): string {
  const g = scene.grid;
  const off = sceneGridOffset(scene);
  return [
    effectiveGridSize(scene),
    off.x,
    off.y,
    g?.color ?? "",
    g?.alpha ?? "",
    g?.distance ?? "",
    g?.units ?? "",
    g?.type ?? "",
    g ? "g" : "-",
  ].join("|");
}
