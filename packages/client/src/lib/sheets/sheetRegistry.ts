/**
 * sheetRegistry.ts — Client-side sheet resolver for (documentType, subtype).
 *
 * REQ-UIF-018: system API exposes registerSheet; engine provides defaults.
 * REQ-UIF-019: resolution order — exact → wildcard → default generic.
 *
 * This module is the CLIENT portion of the sheet contract from
 * spec 11-ui-framework-e-fichas.md §Sistema de Sheets.
 *
 * Usage (called by PF2e system entry point after client mounts):
 *   sheetRegistry.register("Actor", "character", CharacterSheet, { width: 760, height: 600 });
 *   sheetRegistry.register("Actor", "npc", NpcSheet);
 *
 * Usage (called by token double-click or actor directory):
 *   const SheetComponent = sheetRegistry.resolve("Actor", "character");
 *   windowManager.open({ component: SheetComponent, ... });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Svelte 5 component type (opaque — the registry stores it as unknown). */
export type SheetComponent = unknown;

export interface SheetRegistration {
  readonly documentType: string;
  readonly subtype: string; // "*" = fallback for all subtypes of this documentType
  readonly component: SheetComponent;
  readonly defaultSize?: { width: number; height: number };
  readonly makeDefault?: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Client-side registry for sheet components.
 *
 * Stores registrations indexed by "documentType:subtype".
 * The wildcard key "documentType:*" serves as a fallback for all subtypes.
 */
export class SheetRegistryImpl {
  private readonly _registrations: Map<string, SheetRegistration> = new Map();

  /**
   * Register a sheet component for a (documentType, subtype) pair.
   * Pass subtype `"*"` to register a fallback for all subtypes.
   */
  register(
    documentType: string,
    subtype: string,
    component: SheetComponent,
    options: { defaultSize?: { width: number; height: number }; makeDefault?: boolean } = {},
  ): void {
    const key = `${documentType}:${subtype}`;
    this._registrations.set(key, {
      documentType,
      subtype,
      component,
      ...(options.defaultSize !== undefined ? { defaultSize: options.defaultSize } : {}),
      ...(options.makeDefault !== undefined ? { makeDefault: options.makeDefault } : {}),
    });
  }

  /**
   * Resolve the sheet component for a (documentType, subtype) pair.
   *
   * Resolution order (REQ-UIF-019):
   *   1. Exact match: `${documentType}:${subtype}`
   *   2. Wildcard: `${documentType}:*`
   *   3. Returns `null` (caller shows generic sheet or falls back)
   */
  resolve(documentType: string, subtype: string): SheetRegistration | null {
    const exact = this._registrations.get(`${documentType}:${subtype}`);
    if (exact) return exact;

    const wildcard = this._registrations.get(`${documentType}:*`);
    if (wildcard) return wildcard;

    return null;
  }

  /**
   * Default size for a registered sheet, or a sensible fallback.
   */
  defaultSize(documentType: string, subtype: string): { width: number; height: number } {
    const reg = this.resolve(documentType, subtype);
    return reg?.defaultSize ?? { width: 640, height: 480 };
  }

  /** All registered sheets (for debugging / settings UI). */
  get all(): ReadonlyMap<string, SheetRegistration> {
    return this._registrations;
  }

  /** Remove all registrations (useful in tests). */
  clear(): void {
    this._registrations.clear();
  }
}

/** Singleton sheet registry. */
export const sheetRegistry = new SheetRegistryImpl();
