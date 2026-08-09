/**
 * @fusion/system-pf2e — Isekai variant: public API.
 *
 * Only the two things the SERVER side of the layer needs: the tunable
 * parameters, and the Focus-lock arithmetic. The archetype content (blessings,
 * actions, tracker widgets, colours) lives on the client — see the note at the
 * top of `focusLocks.ts` for why the split runs along that line.
 */

export * from "./params.js";
export * from "./focusLocks.js";
