/**
 * templateTool.ts — turns a pointer gesture into an area template. Pure.
 *
 * The gesture is press (anchor), drag (aim), release (done; Shift pins):
 *  - burst: the centre follows the cursor, snapped to a grid intersection;
 *  - cone: origin snapped to a corner/edge at the press, direction by the cursor
 *    snapped to 45 degrees;
 *  - line: same origin, direction free;
 *  - emanation: grows from the selected token; the cursor is irrelevant.
 */

import {
  directionDeg,
  snapToCornerOrEdge,
  snapToIntersection,
  templateTitle,
  type AreaFootprint,
  type AreaKind,
  type AreaTemplate,
  type ScenePoint,
  type SquareGrid,
} from "@fusion/shared";

/** What the on-screen tool is set to. */
export type ToolMode = "ruler" | AreaKind;

export const TOOL_MODES: ReadonlyArray<{ mode: ToolMode; label: string }> = [
  { mode: "ruler", label: "Régua" },
  { mode: "burst", label: "Explosão" },
  { mode: "cone", label: "Cone" },
  { mode: "line", label: "Linha" },
  { mode: "emanation", label: "Emanação" },
];

export function isAreaMode(mode: ToolMode | null): mode is AreaKind {
  return mode !== null && mode !== "ruler";
}

/**
 * Build the template for the current pointer state, or null when it cannot be
 * built yet (an emanation with no token selected).
 */
export function buildAreaTemplate(
  kind: AreaKind,
  sizeFt: number,
  press: ScenePoint,
  cursor: ScenePoint,
  grid: SquareGrid,
  source: AreaFootprint | null,
): AreaTemplate | null {
  switch (kind) {
    case "burst":
      return { kind, sizeFt, origin: snapToIntersection(grid, cursor), direction: 0 };
    case "cone":
    case "line": {
      const origin = snapToCornerOrEdge(grid, press);
      const direction = directionDeg(origin, cursor, kind === "cone");
      return { kind, sizeFt, origin, direction };
    }
    case "emanation": {
      if (!source) return null;
      const size = grid.config.size;
      const ox = grid.origin.x;
      const oy = grid.origin.y;
      const origin = {
        x: ox + (source.i + source.width / 2) * size,
        y: oy + (source.j + source.height / 2) * size,
      };
      return { kind, sizeFt, origin, direction: 0, footprint: source };
    }
  }
}

/** Label for the tip of a template: its title, plus up to three affected token names. */
export function areaLabel(t: Pick<AreaTemplate, "kind" | "sizeFt">, names: readonly string[]): string {
  const title = templateTitle(t);
  if (names.length === 0) return title;
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` +${String(names.length - 3)}` : "";
  return `${title} · ${shown}${more}`;
}
