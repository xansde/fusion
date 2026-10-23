/**
 * `system.build.gmExceptions` on create (BHR-F7-02, D-B12, REQ-BHR-226).
 *
 * `doc:update` refuses a player's write to it (see `rejectUnwritableField`); the create path must not be
 * the door left open beside it, so anyone not privileged loses the field from a create payload.
 */
export function stripGmExceptionsOnCreate(
  item: Record<string, unknown>,
  privileged: boolean,
): Record<string, unknown> {
  if (privileged) return item;
  const system = item["system"];
  if (typeof system !== "object" || system === null || Array.isArray(system)) return item;
  const build = (system as Record<string, unknown>)["build"];
  if (typeof build !== "object" || build === null || Array.isArray(build)) return item;
  if (!("gmExceptions" in build)) return item;
  const { gmExceptions: _dropped, ...restBuild } = build as Record<string, unknown>;
  return { ...item, system: { ...(system as Record<string, unknown>), build: restBuild } };
}
