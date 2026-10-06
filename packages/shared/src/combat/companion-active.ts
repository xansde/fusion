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
