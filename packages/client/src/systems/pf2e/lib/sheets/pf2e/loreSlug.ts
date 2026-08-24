/**
 * loreSlug.ts — the single convention for keying a Lore proficiency on
 * `system.skills`.
 *
 * Lore skills have no canonical slug (the subject is player/background chosen),
 * so the key IS the identity. Two conventions had grown apart:
 *
 *   - `lore-<subject>` (PREFIX) — written by `addLoreSkill` (manual lore) and
 *     understood by every reader: `skillNamePt`, the sheet's row label, the
 *     skill-training dialog, the ability/skill help text.
 *   - `<subject>-lore` (SUFFIX) — written by the background training path only.
 *     No reader understood it, so a background's Lore rendered as the raw slug
 *     and sat in a namespace nothing else could match.
 *   - `lore-<subject>-lore` (BOTH) — written by the old inline slug inside
 *     `addLoreSkill`, which kept the "Lore" word the player had typed. It reads
 *     as canonical to a prefix test, so it used to survive every heal and stay
 *     mislabelled ("Lore (Warfare Lore)") forever.
 *
 * PREFIX is canonical here. The legacy suffix form stays *readable* (see
 * `isLoreSlug`/`loreSubject`) and `migrateLoreSlug` gives the heal pass the
 * rename it needs, so characters built before this module keep their trained
 * Lore instead of being orphaned.
 */

/** The canonical prefix every Lore slug carries. */
const LORE_PREFIX = "lore-";

/** The legacy suffix the background path used to emit. */
const LORE_SUFFIX = "-lore";

/**
 * slugify — lowercase ASCII words joined by single hyphens. Accents are folded
 * (a background's Lore can be authored in pt-BR), and anything that is not
 * `[a-z0-9]` collapses to one separator.
 */
function slugify(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * loreSlug — the canonical `lore-<subject>` key for a Lore proficiency.
 *
 * A trailing "Lore" word in the source name is dropped before slugifying, so
 * both the pack shape ("Scribing Lore", from `system.trainedSkills.lore`) and a
 * bare subject typed by the player ("Warfare") land on the same key.
 * A name with no subject left over degrades to a bare `"lore"` rather than an
 * empty or dangling key.
 */
export function loreSlug(name: string): string {
  const subject = slugify(name.replace(/\s*lore\s*$/i, ""));
  return subject ? `${LORE_PREFIX}${subject}` : "lore";
}

/**
 * legacyLoreSlug — the `<subject>-lore` key the background path used to write.
 * Kept ONLY so the heal pass can locate the old entries it has to rename; never
 * emit this for new data.
 */
export function legacyLoreSlug(name: string): string {
  const subject = slugify(name.replace(/\s*lore\s*$/i, ""));
  return subject ? `${subject}${LORE_SUFFIX}` : "lore";
}

/**
 * isLoreSlug — does this skill key denote a Lore proficiency, in either
 * convention? None of the 16 canonical skills starts with "lore-" or ends with
 * "-lore", so this never misfires on a real skill.
 */
export function isLoreSlug(slug: string): boolean {
  return slug === "lore" || slug.startsWith(LORE_PREFIX) || slug.endsWith(LORE_SUFFIX);
}

/**
 * bareSubject — the slug stripped of everything that only marks it as a Lore:
 * the canonical prefix AND any trailing "lore" word. `""` means "no subject".
 *
 * The trailing word has to go even when the prefix is already there, because a
 * THIRD shape exists on disk: `lore-<subject>-lore`. `addLoreSkill` used to
 * build its key inline over the raw typed name, and the input's placeholder
 * ("New Lore name…") invites typing the full name — so "Warfare Lore" was
 * stored as `lore-warfare-lore`. Nothing new lands there (`addLoreSkill` goes
 * through `loreSlug` now), but characters built before that fix still carry it.
 *
 * Stripping repeats so the result is a fixed point: normalizing an already
 * normalized slug never moves it again, which is what makes the heal pass safe
 * to run on every load.
 *
 * Only a WHOLE trailing word is redundant — `lore-folklore` keeps its subject,
 * since "folklore" is one word, not "folk" plus the marker.
 */
function bareSubject(slug: string): string {
  let bare = slug.startsWith(LORE_PREFIX) ? slug.slice(LORE_PREFIX.length) : slug;
  while (bare.endsWith(LORE_SUFFIX)) bare = bare.slice(0, -LORE_SUFFIX.length);
  // `lore-lore` (and the bare `lore`) reduce to the marker itself: the old
  // inline slug for the meaningless name "Lore", which `addLoreSkill` now
  // rejects outright. No subject survives.
  return bare === "lore" ? "" : bare;
}

/**
 * canonicalLoreSlug — the one key a Lore slug should live under, whichever
 * convention wrote it. Mirrors `loreSlug` exactly, including its degradation to
 * a bare `"lore"` when no subject is left.
 */
function canonicalLoreSlug(slug: string): string {
  const subject = bareSubject(slug);
  return subject ? `${LORE_PREFIX}${subject}` : "lore";
}

/**
 * loreSubject — the human-readable subject behind a Lore slug, in any
 * convention, with hyphens restored to spaces ("lore-abyssal-history" →
 * "abyssal history"). A bare `"lore"` (or `"lore-lore"`) has no subject and
 * yields `""`.
 * Returns `""` for a non-lore slug — callers should gate on `isLoreSlug`.
 */
export function loreSubject(slug: string): string {
  if (!isLoreSlug(slug)) return "";
  return bareSubject(slug).replace(/-+/g, " ").trim();
}

/**
 * migrateLoreSlug — the canonical key a legacy slug should become, or `null`
 * when there is nothing to heal (already canonical, or not a Lore slug at all).
 *
 * Returning `null` for a non-lore slug is deliberate: the heal pass iterates
 * over every entry of `system.skills`, and renaming a real skill would silently
 * untrain it.
 */
export function migrateLoreSlug(slug: string): string | null {
  if (!isLoreSlug(slug)) return null;
  const canonical = canonicalLoreSlug(slug);
  return canonical === slug ? null : canonical;
}
