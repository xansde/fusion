/**
 * `companion:setActive` — make one animal companion the ACTIVE one of its master (BHR-F4-10,
 * spec 52 REQ-PET-120..121, DC-07). The server flips `system.companion.active` on every companion of the
 * master (exactly one ends up true) and swaps the tokens in the scenes; the client only names the companion.
 */

import { z } from "zod";

export const CompanionSetActivePayloadSchema = z.object({
  companionActorId: z.string().min(1),
});
export type CompanionSetActivePayload = z.infer<typeof CompanionSetActivePayloadSchema>;

/**
 * `companion:command` — the owner commands an animal companion (Command an Animal, L3 I4, BHR-F5-07, D-B10). In a
 * combat the SERVER records it on the combat (`commandMark`), valid for the owner's combatant in that round: the
 * companion acts that turn, and the Support is one of its actions. Outside a combat nothing is recorded.
 */
export const CompanionCommandPayloadSchema = z
  .object({ companionActorId: z.string().min(1) })
  .strict();
export type CompanionCommandPayload = z.infer<typeof CompanionCommandPayloadSchema>;
/** The ack result: whether a mark was stamped on a combat (false outside combat). */
export interface CompanionCommandResult {
  readonly marked: boolean;
}
