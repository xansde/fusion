/**
 * drawerLayout.svelte.ts — how much of the screen the side drawer covers, for whoever has to
 * stay clear of it (BAR-F1-04; spec 53 REQ-BAR-022; spec 36 REQ-GAV-012/013/040).
 *
 * The drawer is an overlay pinned to the right edge (REQ-GAV-013), so it never moves the canvas —
 * and, for the same reason, nothing else knows how wide it is at the moment. The action bar
 * centres itself in the strip the drawer leaves free, so it needs two facts: whether the drawer is
 * open, and how wide that makes it. The first lives inside `SidebarDrawerState` (private, as the
 * spec wants: one gesture, no second control); this module is where that state is PUBLISHED, read
 * only, for the bar to read.
 *
 * The widths mirror the theme tokens in `styles/base.css` (`--fusion-sidebar-rail-width`,
 * `--fusion-sidebar-width`) and the narrow-viewport rule of `Sidebar.svelte`; a test keeps the
 * numbers honest against the stylesheet, like `turnHead.svelte.ts` does for its own tokens.
 *
 * `.svelte.ts` is required, not decorative: `$state` is a compiler rune.
 */

/** Width of the icon rail, always visible (`--fusion-sidebar-rail-width`). */
export const DRAWER_RAIL_WIDTH = 44;

/** Width of the panel an open drawer adds to the rail (`--fusion-sidebar-width`, REQ-GAV-012). */
export const DRAWER_PANEL_WIDTH = 300;

/**
 * Under this viewport width an open drawer stops being 300 px wide and takes everything left of
 * the rail (REQ-GAV-040; `@media (max-width: 899.98px)` in `Sidebar.svelte`).
 */
export const DRAWER_NARROW_BREAKPOINT = 900;

const published: { open: boolean } = $state({ open: false });

/** Called by the drawer's state whenever it opens or collapses; nobody else writes it. */
export function publishDrawerOpen(open: boolean): void {
  published.open = open;
}

/** Whether the drawer is open. Reactive inside a template, `$derived` or `$effect`. */
export function isDrawerOpen(): boolean {
  return published.open;
}

/**
 * The width the drawer covers, in px, at a given viewport width.
 *
 * Closed it is the rail alone. Open it is rail plus panel (344 px) — except under the narrow
 * breakpoint, where it covers the whole viewport (its `left: 0` rule): there the strip left free
 * is the rail itself, which is not worth centring anything in.
 */
export function drawerWidth(open: boolean, viewportWidth: number): number {
  if (!open) return DRAWER_RAIL_WIDTH;
  if (viewportWidth < DRAWER_NARROW_BREAKPOINT) return viewportWidth;
  return DRAWER_RAIL_WIDTH + DRAWER_PANEL_WIDTH;
}
