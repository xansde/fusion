/**
 * previewWindow.ts — previewing a compendium document in a floating window
 * (spec 43 §5.6, DEC-CPD-03).
 *
 * Preview does NOT happen inside the drawer. It opens a window of the window
 * manager (REQ-UIF-009, REQ-CPD-050), for one reason that is a use case and not
 * a taste: comparing two creatures is normal, and a blade that replaces the list
 * inside a 300px panel makes it impossible. Because it is a window, the list
 * stays where it was, the drawer's width never moves (REQ-GAV-012), and closing
 * the drawer closes nothing — the windows live in `WindowHost`, mounted once at
 * the table, with no lifetime relation to the panel that asked (REQ-CPD-054).
 *
 * The singleton key is per DOCUMENT (`compendium:preview:<uuid>`), which is what
 * makes both halves of REQ-CPD-054 true at once: pressing preview twice on the
 * same line focuses the window already open (REQ-UIF-014), while two different
 * documents are two windows side by side.
 *
 * The license block (REQ-CPD-052, DEC-CPD-07) is built here, from the pack's
 * license and the document's own publication: the document's line is shown only
 * when it says something the pack's does not — an override, not an echo. It is
 * the one thing this window may never omit, so the model has no "absent" state:
 * a pack that declares no license produces `null` and the window says so out
 * loud instead of drawing nothing.
 *
 * Kept out of the component (like `chat/rollBuilderWindow.ts`) so it can be
 * exercised without a DOM: the client project runs Vitest in a node environment.
 */

import type { PackLicense } from "@fusion/shared";
import { windowManager } from "../windows/window-manager.js";
import CompendiumPreviewWindow from "../../components/compendium/CompendiumPreviewWindow.svelte";

import type { WindowHandle, WindowOpenOptions } from "../windows/window-manager.js";

// ---------------------------------------------------------------------------
// Window identity
// ---------------------------------------------------------------------------

/** Prefix of every preview window's singleton key. */
export const PREVIEW_WINDOW_KEY_PREFIX = "compendium:preview:";

/**
 * One window per document (REQ-CPD-054). Two different uuids are two windows;
 * the same uuid twice is the same window, brought to the front.
 */
export function previewWindowSingletonKey(uuid: string): string {
  return `${PREVIEW_WINDOW_KEY_PREFIX}${uuid}`;
}

/** True for a window opened by this module — used to reason about the set. */
export function isPreviewWindowKey(key: string | undefined): boolean {
  return key !== undefined && key.startsWith(PREVIEW_WINDOW_KEY_PREFIX);
}

// ---------------------------------------------------------------------------
// Load state (REQ-CPD-051)
// ---------------------------------------------------------------------------

/**
 * The window loads the full document on demand (REQ-CMP-015) and has exactly
 * three states to draw. `error` carries a message and is always recoverable:
 * the window offers another try rather than closing itself.
 */
export type PreviewLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: Record<string, unknown> }
  | { readonly status: "error"; readonly message: string };

export const PREVIEW_LOADING: PreviewLoadState = { status: "loading" };

/** A loaded document, ready to be drawn. */
export function previewReady(document: Record<string, unknown>): PreviewLoadState {
  return { status: "ready", document };
}

/**
 * A failure, carrying whatever the transport said when it said something
 * useful, and the caller's fallback when it did not.
 */
export function previewError(cause: unknown, fallback: string): PreviewLoadState {
  const message = cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
  return { status: "error", message };
}

// ---------------------------------------------------------------------------
// License block (REQ-CPD-052, DEC-CPD-07)
// ---------------------------------------------------------------------------

export interface PreviewLicenseBlock {
  /**
   * The pack's license identifier, e.g. `"ORC"`. `null` only when the pack
   * manifest is unknown or declares none — never silently blank, because the
   * window has to say something either way.
   */
  readonly packLicense: string | null;
  /** Upstream attribution declared by the pack; empty when it declares none. */
  readonly attribution: string;
  /** Reserved-material notice declared by the pack; empty when there is none. */
  readonly reservedNotice: string;
  /** Where the pack came from (`sourceRepo`), when it says. */
  readonly source: string | null;
  /**
   * The document's OWN license, and only when it differs from the pack's — the
   * override of REQ-CPD-052. Equal values are not an override and are not
   * repeated.
   */
  readonly documentLicense: string | null;
  /** The document's publication title, when it carries one. */
  readonly documentTitle: string | null;
}

/** True when the document says something about its license the pack does not. */
export function hasLicenseOverride(block: PreviewLicenseBlock): boolean {
  return block.documentLicense !== null || block.documentTitle !== null;
}

/**
 * Build the block the window shows: the pack's license, plus the document's
 * override when there is one.
 *
 * Tolerant on purpose — a document whose `system.publication` is missing, of
 * the wrong shape, or empty simply has no override; it must never throw inside
 * a render, because the license is the one thing that may not disappear.
 */
export function buildPreviewLicense(
  pack: PackLicense | null | undefined,
  doc: Record<string, unknown> | null | undefined,
): PreviewLicenseBlock {
  const packLicense = nonEmpty(pack?.license);
  const publication = readPublication(doc);
  const declared = nonEmpty(asString(publication?.["license"]));
  const title = nonEmpty(asString(publication?.["title"]));

  return {
    packLicense,
    attribution: pack?.attribution ?? "",
    reservedNotice: pack?.reservedNotice ?? "",
    source: nonEmpty(pack?.sourceRepo),
    // An echo of the pack's own license is not an override.
    documentLicense: declared !== null && declared !== packLicense ? declared : null,
    documentTitle: title,
  };
}

/** `doc.system.publication` as an untyped bag; null when absent or malformed. */
function readPublication(
  doc: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!doc) return null;
  const system = doc["system"];
  if (system === null || typeof system !== "object" || Array.isArray(system)) return null;
  const publication = (system as Record<string, unknown>)["publication"];
  if (publication === null || typeof publication !== "object" || Array.isArray(publication)) {
    return null;
  }
  return publication as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Opening the window
// ---------------------------------------------------------------------------

/** Default geometry: tall enough for a stat block, narrow enough to pair up. */
export const PREVIEW_WINDOW_SIZE = { width: 380, height: 520 } as const;
const PREVIEW_MIN_WIDTH = 260;
const PREVIEW_MIN_HEIGHT = 220;

/** What the panel knows about the entry when the reader asks to preview it. */
export interface OpenPreviewInput {
  /** Compendium uuid of the entry — the identity of the window. */
  readonly uuid: string;
  /** Display name, already localized by the line that offered the preview. */
  readonly name: string;
  /** Document type of the entry (`"Actor"`, `"Item"`, …), for the type icon. */
  readonly documentType: string;
  /** Pack the entry belongs to. */
  readonly packId: string;
  /** Pack label, when the caller knows it (the aggregated body always does). */
  readonly packLabel?: string | null;
  /** The pack's license block (REQ-CPD-052) — `null` when the manifest is not loaded. */
  readonly packLicense?: PackLicense | null;
  /**
   * Whether this reader may bring the entry over from the window, under the
   * same rule as the line that opened it (REQ-CPD-053).
   */
  readonly canImport?: boolean;
  /**
   * The SHEET the panel would bring this entry into, when that is the
   * destination in force (DEC-CPD-05, REQ-CPD-061). The window does not resolve
   * ownership of its own — it inherits the destination the line already had, so
   * the two offers can never disagree (REQ-CPD-053).
   */
  readonly sheetTarget?: { readonly actorId: string; readonly name: string } | null;
}

/**
 * The window's options, without the component — pure, so a test can read the
 * identity and the geometry without mounting anything.
 */
export function buildPreviewWindowOptions(
  input: OpenPreviewInput,
  fallbackTitle: string,
): Omit<WindowOpenOptions, "component" | "componentProps"> {
  const name = input.name.trim();
  return {
    singletonKey: previewWindowSingletonKey(input.uuid),
    title: name.length > 0 ? name : fallbackTitle,
    resizable: true,
    minimizable: true,
    minWidth: PREVIEW_MIN_WIDTH,
    minHeight: PREVIEW_MIN_HEIGHT,
    position: { width: PREVIEW_WINDOW_SIZE.width, height: PREVIEW_WINDOW_SIZE.height },
  };
}

/**
 * Open (or focus) the preview of one document (REQ-CPD-050, REQ-CPD-054).
 *
 * The socket is deliberately NOT captured in `componentProps`: the window
 * resolves the live one when it loads and when the reader retries, so a
 * reconnection while the window stays open does not leave it talking to a dead
 * socket — and so the window owes nothing to the panel that opened it.
 */
export function openCompendiumPreviewWindow(
  input: OpenPreviewInput,
  fallbackTitle: string,
): WindowHandle {
  return windowManager.open({
    ...buildPreviewWindowOptions(input, fallbackTitle),
    component: CompendiumPreviewWindow,
    componentProps: {
      uuid: input.uuid,
      name: input.name,
      documentType: input.documentType,
      packId: input.packId,
      packLabel: input.packLabel ?? null,
      packLicense: input.packLicense ?? null,
      canImport: input.canImport ?? false,
      sheetTarget: input.sheetTarget ?? null,
    },
  });
}
