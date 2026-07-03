/**
 * registerEtmosSheets.ts — Etmos client-side sheet registration.
 *
 * Mirrors registerPf2eSheets.ts: called once during client boot to register
 * the Etmos sheet components into the client sheetRegistry, and exposes
 * `openActorSheet`/`openCompositor` helpers so callers (token double-click,
 * actor directory, the OradorSheet's "Conjurar" button) share ONE code path
 * per window kind.
 *
 * This is the file that closes the D1<->D2 handoff documented in
 * OradorSheet.svelte's docstring: OradorSheet takes an `onConjurar` callback
 * prop (D1's contract) and `openCompositor` below (D2) is what actually gets
 * passed as that callback by whoever mounts OradorSheet.
 *
 * REQ-UIF-018..019, REQ-ETM-001/002. Design doc m5-etmos-compositor.md §3.1.
 */

import { sheetRegistry } from "../sheetRegistry.js";

/**
 * Register all Etmos sheet components with the client sheet registry.
 * Call this once during app boot (mirrors registerPf2eSheets — dynamic
 * imports keep Svelte out of the module-init path for Node/Vitest safety).
 */
export async function registerEtmosSheets(): Promise<void> {
  const [{ default: OradorSheet }, { default: AntagonistaSheet }] = await Promise.all([
    import("../../../components/sheets/etmos/OradorSheet.svelte"),
    import("../../../components/sheets/etmos/AntagonistaSheet.svelte"),
  ]);

  sheetRegistry.register("Actor", "orador", OradorSheet, {
    defaultSize: { width: 820, height: 640 },
    makeDefault: true,
  });

  sheetRegistry.register("Actor", "antagonista", AntagonistaSheet, {
    defaultSize: { width: 640, height: 560 },
    makeDefault: true,
  });
}

/**
 * Open a sheet for an Etmos actor document using the windowManager.
 * Mirrors registerPf2eSheets.ts's openActorSheet — same singletonKey scheme
 * (`sheet:Actor:<actorId>`) so PF2e/SF2e/Etmos sheets never collide.
 */
export function openEtmosActorSheet(
  actorId: string,
  actorDoc: Record<string, unknown>,
  opts: {
    userId: string;
    ownership: number;
    isGm: boolean;
    sendOpFn?: (op: unknown) => void;
    onConjurar?: (actorId: string) => void;
  },
): void {
  void import("$lib/windows/window-manager.js").then(({ windowManager }) => {
    const rawType = actorDoc["type"];
    const subtype = typeof rawType === "string" ? rawType : "orador";
    const rawName = actorDoc["name"];
    const name = typeof rawName === "string" ? rawName : "Orador";
    const singletonKey = `sheet:Actor:${actorId}`;

    const reg = sheetRegistry.resolve("Actor", subtype);
    if (!reg) {
      console.warn(`[openEtmosActorSheet] No sheet registered for Actor:${subtype}`);
      return;
    }

    windowManager.open({
      singletonKey,
      title: `${name} (${subtype})`,
      icon: "✦",
      resizable: true,
      minimizable: true,
      position: {
        width: reg.defaultSize?.width ?? 640,
        height: reg.defaultSize?.height ?? 480,
      },
      component: reg.component,
      componentProps: {
        actorId,
        doc: actorDoc,
        ...opts,
        // Only the Orador sheet declares an onConjurar prop — wire it to open
        // the Compositor unless the caller already supplied its own. Omitted
        // for other subtypes (e.g. antagonista has no such prop).
        ...(subtype === "orador"
          ? {
              onConjurar:
                opts.onConjurar ??
                ((id: string) => {
                  openCompositor(id, actorDoc, opts);
                }),
            }
          : {}),
      },
    });
  });
}

/**
 * Open the Compositor de Magias window for an Orador Actor (design doc §3.1:
 * dedicated window, singletonKey `compositor:<actorId>`, reuses
 * Window.svelte/WindowHost.svelte — NOT a bespoke window shell).
 *
 * `sendOpFn` here receives the CompositorVM's `EtmosConjuracaoProporOp`
 * (`{ type: "etmos:conjuracao:propor", conjuradorActorId, frase }`) — the
 * caller is expected to forward it to the socket exactly like every other
 * sheet's sendOpFn (see Compositor.svelte's docstring).
 */
export function openCompositor(
  actorId: string,
  actorDoc: Record<string, unknown>,
  opts: {
    userId: string;
    ownership: number;
    isGm: boolean;
    sendOpFn?: (op: unknown) => void;
  },
): void {
  void import("$lib/windows/window-manager.js").then(({ windowManager }) => {
    void import("../../../components/sheets/etmos/Compositor.svelte").then(
      ({ default: Compositor }) => {
        const rawName = actorDoc["name"];
        const name = typeof rawName === "string" ? rawName : "Orador";

        windowManager.open({
          singletonKey: `compositor:${actorId}`,
          title: `Compositor de Magias — ${name}`,
          icon: "✦",
          resizable: true,
          minimizable: true,
          position: { width: 480, height: 620 },
          component: Compositor,
          componentProps: {
            actorId,
            doc: actorDoc,
            ownership: opts.ownership,
            userId: opts.userId,
            isGm: opts.isGm,
            sendOpFn: opts.sendOpFn ?? (() => {}),
          },
        });
      },
    );
  });
}
