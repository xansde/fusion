/**
 * registry.ts — the sidebar (drawer) tab registry.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`), §5.4: the drawer knows nothing about the
 * features it hosts. A tab is a single call — `registerSidebarTab({ id, icon, label,
 * group, component, badge? })` (REQ-GAV-030) — and the core is the registry's first
 * client, which is what keeps the API from rotting.
 *
 * What lives here:
 *  - the registration call and its validation (REQ-GAV-030, REQ-GAV-033);
 *  - the query the rail uses to draw itself for a given role: group "all", then
 *    group "gm", then the settings tab anchored to the footer (DEC-GAV-09);
 *  - the per-tab panel loader, so mounting the rail never pulls panel code in
 *    (RNF-GAV-02).
 *
 * What does NOT live here:
 *  - open/activeTab state and its local persistence → `lib/sidebar/state` (G013);
 *  - badge business rules → the owning child spec, via the `badge` store (REQ-GAV-023);
 *  - any security decision. Hiding a "gm" tab is ergonomics, not a boundary: the data
 *    itself is protected on the server by the owning area's predicate (REQ-GAV-034).
 *
 * Game systems (spec 15) do NOT register tabs in the MVP (REQ-GAV-032) — this module
 * is client-only and is never re-exported through `@fusion/system-api`. Mods will use
 * the very same call when mod loading lands, which is [V2] (REQ-GAV-031, REQ-ESC-012).
 */

import type { Socket } from "socket.io-client";
import { findIconMarkupViolation } from "./iconMarkup.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visibility group of a tab. `"gm"` tabs render only for privileged roles. */
export type SidebarTabGroup = "all" | "gm";

const VALID_GROUPS: ReadonlySet<string> = new Set<SidebarTabGroup>(["all", "gm"]);

/**
 * The well-known id of the Settings tab. It belongs to group `"all"` (DEC-GAV-09)
 * but is anchored to the rail footer instead of rendering inside its group. The
 * anchor is a property of this single core id, never of a group — so a mod tab can
 * never land in the footer (REQ-GAV-003).
 */
export const SETTINGS_TAB_ID = "settings";

/**
 * Props the drawer passes to every tab panel component.
 *
 * This is the whole contract: a panel receives the live socket, the world and user
 * it is rendering for, whether that user is privileged, and the active scene. A tab
 * that needs anything else reads it from its own store — the drawer does not grow
 * per-tab props.
 *
 * Mirrors what the pre-drawer sidebar handed to its panels, so the existing
 * panels can be bridged onto the registry without a redesign (G016).
 */
export interface SidebarPanelProps {
  /** Live world socket. */
  socket: Socket;
  /** Id of the world currently joined. */
  worldId: string;
  /** Id of the local user. */
  userId: string;
  /** Whether the local user's role is privileged (mirrors the server's isRolePrivileged). */
  isGm: boolean;
  /** Id of the active scene, or null when no scene is active. */
  activeSceneId: string | null;
}

/**
 * Svelte 5 component constructor for a panel. Typed loosely for the same reason as
 * `WindowEntry.component` in `lib/windows/window-manager.ts`: Svelte's component
 * type is not expressible here without dragging the compiler's types in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SidebarPanelComponent = any;

/** The module shape a panel loader resolves to — i.e. what `import()` returns. */
export interface SidebarPanelModule {
  readonly default: SidebarPanelComponent;
}

/**
 * How a tab hands its panel to the drawer: an async loader, normally a bare
 * `() => import("../../components/sidebar/ChatTab.svelte")`.
 *
 * A loader (rather than the constructor itself) is what makes RNF-GAV-02 structural:
 * the rail can draw every icon without a single panel module being evaluated. Use
 * `eagerPanel()` when a component is already in hand.
 */
export type SidebarPanelLoader = () => Promise<SidebarPanelModule>;

/** The value a badge can carry: a counter, a state dot, or nothing (REQ-GAV-020). */
export type SidebarBadgeValue = number | boolean | null;

/**
 * Minimal reactive badge store: anything with a readable `value` (REQ-GAV-030).
 * A `$state` object or an object with a getter both satisfy it, so reading
 * `badge.value` inside a template tracks the dependency.
 *
 * The rail only reads it. Counter/dot semantics and the rules that light it up are
 * the owning child spec's (REQ-GAV-022, REQ-GAV-023); `lib/sidebar/badges` (G014)
 * provides the helpers.
 */
export interface SidebarBadgeStore {
  readonly value: SidebarBadgeValue;
}

/** The argument of `registerSidebarTab` (REQ-GAV-030). */
export interface SidebarTabDefinition {
  /** Unique, stable id. Also the value persisted as `activeTab`. */
  readonly id: string;
  /**
   * Drawn icon: inline SVG markup, never an emoji or a symbol character
   * (REQ-NPC-094). Validated against the allowlist in `./iconMarkup`, because the
   * rail injects it verbatim.
   */
  readonly icon: string;
  /** i18n key of the tab name — used for `aria-label` and tooltip (REQ-GAV-002). */
  readonly label: string;
  /** Visibility group (REQ-GAV-004). */
  readonly group: SidebarTabGroup;
  /** Loader of the panel component (RNF-GAV-02). */
  readonly component: SidebarPanelLoader;
  /** Optional reactive badge store (REQ-GAV-020..023). */
  readonly badge?: SidebarBadgeStore;
}

/** A registered tab, as handed back to the rail. */
export type SidebarTabEntry = SidebarTabDefinition;

/** The rail's view of the registry for one role (DEC-GAV-09). */
export interface VisibleSidebarTabs {
  /** Group "all", in registration order. */
  readonly all: readonly SidebarTabEntry[];
  /** Group "gm", in registration order; empty for non-privileged roles. */
  readonly gm: readonly SidebarTabEntry[];
  /** The footer-anchored tab (Settings), or empty when it is not registered. */
  readonly footer: readonly SidebarTabEntry[];
}

/** Thrown by `registerSidebarTab`/`loadSidebarPanel` — never a silent no-op. */
export class SidebarTabRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidebarTabRegistrationError";
  }
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

/** Insertion order is the rail order inside a group — Map preserves it. */
const tabs = new Map<string, SidebarTabEntry>();

/** Resolved panel components, so switching back to a tab does not re-await. */
const loadedPanels = new Map<string, SidebarPanelComponent>();

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SidebarTabRegistrationError(message);
}

function validate(def: SidebarTabDefinition): void {
  assert(
    typeof def.id === "string" && def.id.trim().length > 0,
    "Sidebar tab registration needs a non-empty id (REQ-GAV-030).",
  );
  assert(
    typeof def.label === "string" && def.label.trim().length > 0,
    `Sidebar tab "${def.id}" needs a non-empty i18n label key (REQ-GAV-030).`,
  );
  assert(
    VALID_GROUPS.has(def.group),
    `Sidebar tab "${def.id}" declared group "${def.group}"; only "all" and "gm" exist (REQ-GAV-030).`,
  );
  assert(
    typeof def.component === "function",
    `Sidebar tab "${def.id}" needs a panel loader function, e.g. () => import("./Tab.svelte") (RNF-GAV-02).`,
  );
  // The rail injects this markup verbatim (`{@html tab.icon}` in SidebarRail.svelte),
  // so the icon has to be *proven* to be a drawn SVG, not merely to contain "<svg".
  // `findIconMarkupViolation` is an allowlist of shape elements and presentation
  // attributes: a handler, a <script>, a URL attribute or a second root element is
  // rejected because it was never on the list. That is what makes the same call safe
  // for a mod to use in [V2] (REQ-GAV-031) as it is for the core tabs (REQ-NPC-094).
  const iconViolation = typeof def.icon === "string" ? findIconMarkupViolation(def.icon) : null;
  assert(
    typeof def.icon === "string" && iconViolation === null,
    `Sidebar tab "${def.id}" needs a drawn icon as inline SVG markup: ${iconViolation ?? "must be a string"} (REQ-NPC-094).`,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register one sidebar tab (REQ-GAV-030).
 *
 * Registering an id that is already taken throws (REQ-GAV-033) — the registry never
 * replaces a tab silently, so a mod cannot hijack a core tab by shadowing its id.
 */
export function registerSidebarTab(definition: SidebarTabDefinition): SidebarTabEntry {
  validate(definition);

  if (tabs.has(definition.id)) {
    throw new SidebarTabRegistrationError(
      `Sidebar tab "${definition.id}" is already registered; ids are unique and registration never replaces (REQ-GAV-033).`,
    );
  }

  const entry: SidebarTabEntry = {
    id: definition.id,
    icon: definition.icon,
    label: definition.label,
    group: definition.group,
    component: definition.component,
    ...(definition.badge !== undefined ? { badge: definition.badge } : {}),
  };
  tabs.set(entry.id, entry);
  return entry;
}

/**
 * Wrap an already-imported component into a loader.
 *
 * Only for tabs whose panel is genuinely cheap or already in the bundle; the default
 * is a real `() => import(...)` so panel code stays out of the rail (RNF-GAV-02).
 */
export function eagerPanel(component: SidebarPanelComponent): SidebarPanelLoader {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return () => Promise.resolve({ default: component });
}

/** Drop every registration. Test-only; the app registers once at startup. */
export function clearSidebarTabs(): void {
  tabs.clear();
  loadedPanels.clear();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** One registered tab, or undefined. */
export function getSidebarTab(id: string): SidebarTabEntry | undefined {
  return tabs.get(id);
}

/** Every registered tab, in registration order — regardless of role. */
export function listRegisteredSidebarTabs(): SidebarTabEntry[] {
  return [...tabs.values()];
}

/**
 * Whether one registered tab is visible to a role (REQ-GAV-004).
 *
 * The single predicate behind every query in this module. It exists so the rail
 * query and the id check can never disagree about the same tab: the footer is a
 * *position* (DEC-GAV-09), never an exemption from the group filter, so a tab
 * declared `{ id: "settings", group: "gm" }` is as invisible to a player as any
 * other "gm" tab instead of slipping in through the footer block.
 */
function isVisibleTo(tab: SidebarTabEntry, isPrivileged: boolean): boolean {
  return tab.group !== "gm" || isPrivileged;
}

/**
 * The rail's three blocks for a role (REQ-GAV-003, REQ-GAV-004, DEC-GAV-09):
 * group "all" → group "gm" → the footer-anchored Settings tab.
 *
 * `isPrivileged` mirrors the server's `isRolePrivileged` (spec 05). Hiding a "gm"
 * tab is not a security boundary (REQ-GAV-034).
 */
export function getVisibleSidebarTabs(isPrivileged: boolean): VisibleSidebarTabs {
  const all: SidebarTabEntry[] = [];
  const gm: SidebarTabEntry[] = [];
  const footer: SidebarTabEntry[] = [];

  for (const tab of tabs.values()) {
    if (!isVisibleTo(tab, isPrivileged)) continue;
    if (tab.id === SETTINGS_TAB_ID) {
      footer.push(tab);
      continue;
    }
    if (tab.group === "gm") {
      gm.push(tab);
      continue;
    }
    all.push(tab);
  }

  return { all, gm, footer };
}

/** The same three blocks flattened into rail order (all → gm → footer). */
export function listVisibleSidebarTabs(isPrivileged: boolean): SidebarTabEntry[] {
  const visible = getVisibleSidebarTabs(isPrivileged);
  return [...visible.all, ...visible.gm, ...visible.footer];
}

/**
 * Whether a tab id is registered AND visible to this role.
 *
 * Used when restoring a saved `activeTab` that may name a tab the user can no longer
 * see (REQ-GAV-016) — the fallback itself belongs to the drawer state module.
 */
export function isSidebarTabVisible(id: string, isPrivileged: boolean): boolean {
  const tab = tabs.get(id);
  if (tab === undefined) return false;
  return isVisibleTo(tab, isPrivileged);
}

// ---------------------------------------------------------------------------
// Panel loading (RNF-GAV-02)
// ---------------------------------------------------------------------------

/**
 * Resolve the panel component of a tab, importing it on first use and memoising it
 * afterwards. Nothing else in this module ever calls a tab's loader, so drawing the
 * rail costs zero panel modules (RNF-GAV-02).
 */
export async function loadSidebarPanel(id: string): Promise<SidebarPanelComponent> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const cached = loadedPanels.get(id);
  if (cached !== undefined) return cached;

  const tab = tabs.get(id);
  if (tab === undefined) {
    throw new SidebarTabRegistrationError(`Sidebar tab "${id}" is not registered.`);
  }

  const module = await tab.component();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const component: SidebarPanelComponent = module.default;
  loadedPanels.set(id, component);
  return component;
}
