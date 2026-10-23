/**
 * popout.ts — detach a floating window into its own browser window (e.g. a
 * character sheet on a second monitor).
 *
 * Approach: the access token lives only in memory (REQ-SEC-014), so a new route
 * loaded from scratch in a new tab would not be authenticated. Instead the app
 * opens an EMPTY same-origin window (`window.open("")`), mirrors its own
 * stylesheets and theme attributes into it, and mounts the window's content
 * there with Svelte's `mount()` — still running in THIS JS realm, so the stores,
 * the socket and the session are the very same objects. Rolls reach the chat,
 * edits go through the same `sendOp`, live values keep updating.
 *
 * Split of responsibilities:
 *  - `windowManager` (pure) only flips `poppedOut` on the entry;
 *  - this module owns the browser windows (open / hand over / close);
 *  - `PopoutWindow.svelte` (rendered by WindowHost for detached entries) prepares
 *    the child document and mounts `PopoutBody.svelte` in it.
 */

import type { WindowGeometry, WindowId } from "./window-manager.js";
import { windowManager } from "./window-manager.js";
import { t } from "../i18n/i18n.js";

/** Smallest popup the browser is asked for — a sheet narrower than this is unusable. */
const MIN_POPUP_WIDTH = 320;
const MIN_POPUP_HEIGHT = 240;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** `window.open` features: the popup opens where the floating window was, same size. */
export function popupFeatures(
  geo: WindowGeometry,
  screen: { screenX: number; screenY: number },
): string {
  const width = Math.max(MIN_POPUP_WIDTH, Math.round(geo.width));
  const height = Math.max(MIN_POPUP_HEIGHT, Math.round(geo.height));
  const left = Math.max(0, Math.round(screen.screenX + geo.left));
  const top = Math.max(0, Math.round(screen.screenY + geo.top));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

/** Browser window name for a detached window — stable per id, so a second click reuses it. */
export function popupName(id: WindowId): string {
  return `fusion-popout-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

interface HeadNodeLike {
  nodeType: number;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
}

/** True for the head nodes that carry the app's CSS (`<style>`, stylesheet `<link>`). */
export function isMirroredHeadNode(node: HeadNodeLike): boolean {
  if (node.nodeType !== 1 || node.tagName === undefined) return false;
  const tag = node.tagName.toUpperCase();
  if (tag === "STYLE") return true;
  if (tag !== "LINK") return false;
  const rel = (node.getAttribute?.("rel") ?? "").toLowerCase().split(/\s+/);
  return rel.includes("stylesheet");
}

// ---------------------------------------------------------------------------
// Browser-window registry
// ---------------------------------------------------------------------------

const children = new Map<WindowId, Window>();
let unloadHooked = false;

/** Closing or reloading the table closes every detached window (they cannot outlive the realm). */
function hookUnload(): void {
  if (unloadHooked || typeof window === "undefined") return;
  unloadHooked = true;
  window.addEventListener("pagehide", () => {
    for (const child of children.values()) {
      try {
        child.close();
      } catch {
        // already gone
      }
    }
    children.clear();
  });
}

/**
 * Detach a window. MUST run synchronously inside the click handler (user activation),
 * otherwise the browser treats `window.open` as an unsolicited pop-up and blocks it.
 * A blocked pop-up leaves the window inside and shows a notice in its chrome.
 */
export function requestPopout(id: WindowId): void {
  const entry = windowManager.windows.get(id);
  if (!entry || !entry.poppable || entry.poppedOut) return;

  let child: Window | null = null;
  try {
    child = window.open(
      "",
      popupName(id),
      popupFeatures(entry, { screenX: window.screenX, screenY: window.screenY }),
    );
  } catch {
    child = null;
  }
  if (!child) {
    windowManager.setNotice(id, t("FUSION.Window.PopOutBlocked"));
    return;
  }
  hookUnload();
  children.set(id, child);
  windowManager.popOut(id);
}

/** The browser window opened for `id`, if it is still open. */
export function popoutWindowOf(id: WindowId): Window | undefined {
  const child = children.get(id);
  if (child && child.closed) {
    children.delete(id);
    return undefined;
  }
  return child;
}

/** Forget and close the browser window of `id` (no-op when there is none). */
export function closePopoutWindow(id: WindowId): void {
  const child = children.get(id);
  children.delete(id);
  if (child && !child.closed) {
    try {
      child.close();
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Child document preparation (DOM)
// ---------------------------------------------------------------------------

/** Theme/lang live as attributes on <html> (`data-theme`, `lang`, inline CSS vars). */
function copyRootAttributes(src: HTMLElement, dst: HTMLElement): void {
  for (const attr of [...dst.attributes]) {
    if (!src.hasAttribute(attr.name)) dst.removeAttribute(attr.name);
  }
  for (const attr of [...src.attributes]) dst.setAttribute(attr.name, attr.value);
}

function cloneHeadNode(node: Element, dst: Document): Element {
  const clone = dst.importNode(node, true) as Element;
  // An about:blank document has no useful base URL: pin stylesheet links to absolute URLs.
  if (node instanceof HTMLLinkElement) clone.setAttribute("href", node.href);
  return clone;
}

/**
 * Reset the child document and make it look like the app: same stylesheets (kept in sync
 * as lazily-loaded chunks add theirs), same <html> attributes (theme), a mount point.
 * Returns the mount point and a disposer for the observers.
 */
export function prepareChildDocument(
  child: Window,
  title: string,
): { target: HTMLElement; dispose: () => void } {
  const src = document;
  const dst = child.document;

  // A reused window (same name) may still hold a previous body: start clean.
  dst.open();
  dst.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
  dst.close();

  const base = dst.createElement("base");
  base.href = src.baseURI;
  dst.head.appendChild(base);
  dst.title = title;

  for (const node of [...src.head.children]) {
    if (isMirroredHeadNode(node)) dst.head.appendChild(cloneHeadNode(node, dst));
  }
  copyRootAttributes(src.documentElement, dst.documentElement);
  dst.body.className = src.body.className;

  const headObserver = new MutationObserver((records) => {
    for (const r of records) {
      for (const added of r.addedNodes) {
        if (added instanceof Element && isMirroredHeadNode(added)) {
          dst.head.appendChild(cloneHeadNode(added, dst));
        }
      }
    }
  });
  headObserver.observe(src.head, { childList: true });

  const rootObserver = new MutationObserver(() => {
    copyRootAttributes(src.documentElement, dst.documentElement);
  });
  rootObserver.observe(src.documentElement, { attributes: true });

  const target = dst.createElement("div");
  target.className = "fusion-popout-root";
  dst.body.appendChild(target);

  return {
    target,
    dispose: () => {
      headObserver.disconnect();
      rootObserver.disconnect();
    },
  };
}
