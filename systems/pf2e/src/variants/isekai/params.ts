/**
 * @fusion/system-pf2e — Tunable parameters of the "Isekai" variant.
 *
 * EVERY number the house rule can be re-balanced on lives in this file, and
 * nowhere else — same discipline as `variants/classLevels/params.ts`. No
 * derivation step and no VM hard-codes a cap, a floor or a threshold.
 *
 * Clean-room: the Isekai layer is original design by the table (draft v1,
 * received 2026-08-08), sitting on top of published PF2e Remaster rules
 * (ORC/OGL). Nothing here is copied from a proprietary source.
 *
 * Spec: (pending) — the layer is described in the source material bundled
 * with the table's prototype sheet.
 */

/**
 * How many Isekai archetypes a single character may carry.
 *
 * Two is the whole balance premise of the layer: each archetype revokes one
 * PF2e law, and the pairing is where the character's identity comes from.
 * Kept as a parameter so a table playtesting a one- or three-archetype
 * variant changes one number instead of hunting `=== 2` across the client.
 */
export const MAX_ISEKAI_ARCHETYPES = 2;

/**
 * Focus pool floor granted by the layer when the variant is ON and at least
 * one archetype is picked.
 *
 * The Isekai layer spends the SAME Focus Points as PF2e ("Refocus padrão (10
 * min): recupera 1 Ponto de Foco, como no PF2e" — every archetype's recharge
 * panel says so), but a non-caster has `focusPoints.max === 0` and would have
 * no pool to spend. The floor is what hands them one.
 *
 * It equals `FOCUS_POOL_CAP` on purpose: the layer must never WIDEN the
 * published 3-point cap (REQ-PF2-083 / DEC-R10-02), only guarantee it is
 * available. A caster who already has 3 sees no change at all.
 */
export const ISEKAI_FOCUS_FLOOR = 3;

/**
 * Levels at which Minor Blessings unlock, for documentation and for the data
 * invariant test.
 *
 * Every archetype in the source material uses exactly this ladder (the
 * Especialista skips one of the two level-1 entries). A Minor Blessing at a
 * level outside this set is a data-entry mistake, not a design choice — the
 * test enforces it so a typo cannot silently gate a blessing at level 7.
 */
export const ISEKAI_BLESSING_LEVELS: readonly number[] = [1, 3, 4, 5, 6, 8, 12];
