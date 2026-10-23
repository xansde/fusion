/**
 * actorSummaryRegistry.svelte.ts — pluggable "one-screen summary" of an actor, by subtype.
 *
 * The Mestre's party table (`components/party/PartyPanel.svelte`) wants a glance at each player
 * character: hit points, defenses, conditions. What those numbers ARE is the game system's
 * business, and the core cannot import a system's Svelte component (the F3 boundary). So the system
 * plugs its summary component in here, the same shape as `chatCardExtensionRegistry`, keyed by the
 * actor subtype the way `sheetRegistry` is.
 *
 * The component is mounted with `{ doc, actorId, ownership, userId, isGm, worldId }`; `doc` is the
 * live Actor document, so the summary re-renders as the world mirror changes.
 *
 * Reactive (`$state`) so a panel already mounted before the system registered (boot ordering is not
 * guaranteed) picks the summary up on the next render.
 */

/**
 * A Svelte 5 component constructor, loosely typed for the same reason as `ChatCardComponent`; the
 * registering system enforces the prop contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActorSummaryComponent = any;

const registry = $state<{ bySubtype: Readonly<Record<string, ActorSummaryComponent>> }>({
  bySubtype: {},
});

/** Register the summary component of an actor subtype (called once at system boot). */
export function registerActorSummary(subtype: string, component: ActorSummaryComponent): void {
  registry.bySubtype = { ...registry.bySubtype, [subtype]: component };
}

/** The summary component registered for this subtype, or `null` when no system provided one. */
export function resolveActorSummary(subtype: string): ActorSummaryComponent | null {
  return registry.bySubtype[subtype] ?? null;
}

/** Forget every registration — tests only. */
export function resetActorSummaries(): void {
  registry.bySubtype = {};
}
