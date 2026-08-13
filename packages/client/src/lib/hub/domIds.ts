/**
 * domIds.ts — unique element ids for ARIA wiring.
 *
 * Written to replace `crypto.randomUUID()`, which cost a black screen: it is
 * defined only in a **secure context**. On `https://` or `localhost` it works
 * fine, so it survives every local check — and then the GM serves the table at
 * `http://192.168.x.x:33000` and the panel throws the instant it opens.
 *
 * A module counter has no environment to be wrong about. An id needs to be
 * unique inside one document, not across reloads or machines, and a counter is
 * exactly that (and cheaper than a UUID).
 */

let seq = 0;

/**
 * Next unique id carrying `prefix`, e.g. `fusion-sw-title-7`.
 *
 * Pass a prefix that starts with a letter: `getElementById` accepts anything,
 * but a CSS selector written against an id that starts with a digit does not.
 */
export function nextDomId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq)}`;
}
