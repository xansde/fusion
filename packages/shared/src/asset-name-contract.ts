/**
 * The canonical-asset-name CONTRACT, shared by both ends of the T025 grant.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES IN `shared` AND NOT IN A TEST FILE
 * ---------------------------------------------------------------------------
 *
 * A grant is an HMAC over a name. The server derives that name from a document
 * field (`assetRefToStorageName` + `canonicalizeAssetName`); the client derives
 * it from the stored path in order to look the signature up (`assetNameFromPath`).
 * If the two expressions disagree about ONE spelling, that spelling either fails
 * to load with the server insisting it authorised it, or — worse — one file's
 * grant opens another.
 *
 * Both sides used to be checked against hand-written literals inside their own
 * package's test file, which is the circular shape this repo has shipped before
 * (#48): each side agreed with the table its own author wrote. The adversarial
 * review then found two REAL divergences that neither suite could see —
 * a malformed percent-escape (`100% real.png`, a name `reconcile.ts` treats as a
 * first-class case) made the client THROW while the server tolerated it, and a
 * `%2F` inside a segment produced `a///b.png` on the client and `a/b.png` on the
 * server.
 *
 * So the table is production code in `shared`, imported by a test on EACH side.
 * The two suites can then only both pass by agreeing with each other, which is
 * the property that actually matters. Adding a row here is how a new spelling
 * gets settled: it fails on whichever side is wrong.
 *
 * ---------------------------------------------------------------------------
 * WHAT A ROW MEANS
 * ---------------------------------------------------------------------------
 *
 *   storedPath   the value as it sits in a document field, i.e. what
 *                `assetUrl()` produced (`/assets/` + per-segment
 *                `encodeURIComponent`) — or what a human typed by hand.
 *   canonical    the key BOTH ends must derive from it: the on-disk name,
 *                percent-DECODED once per segment, with empty segments dropped.
 *
 * Case, Unicode, spaces, punctuation and directory structure are preserved byte
 * for byte on purpose: lowercasing fails OPEN on a case-sensitive filesystem and
 * taking the basename merges two different files into one key. Both mistakes
 * killed an earlier design of this task.
 */

/** One spelling and the single canonical key both ends must produce for it. */
export interface AssetNameCanonicalizationCase {
  /** Why this row exists — printed by the test so a failure explains itself. */
  readonly why: string;
  readonly storedPath: string;
  readonly canonical: string;
}

export const ASSET_NAME_CANONICALIZATION_CASES: readonly AssetNameCanonicalizationCase[] = [
  {
    why: "the ordinary case",
    storedPath: "/assets/mapa.png",
    canonical: "mapa.png",
  },
  {
    why: "a directory survives — the basename is NOT the identity",
    storedPath: "/assets/maps/segredo.jpg",
    canonical: "maps/segredo.jpg",
  },
  {
    why: "case is preserved: lowercasing would fail OPEN on ext4",
    storedPath: "/assets/MAPA.PNG",
    canonical: "MAPA.PNG",
  },
  {
    why: "a space is encoded by assetUrl and decoded exactly once",
    storedPath: "/assets/a%20b.png",
    canonical: "a b.png",
  },
  {
    why: "parentheses: encodeURIComponent leaves them alone",
    storedPath: "/assets/mapa (1).jpg",
    canonical: "mapa (1).jpg",
  },
  {
    why: "accented characters round-trip through the percent encoding",
    storedPath: "/assets/A%C3%A7%C3%A3o-%C3%89bano.png",
    canonical: "Ação-Ébano.png",
  },
  {
    why: "an apostrophe is left unescaped by encodeURIComponent",
    storedPath: "/assets/cofre'do'GM.png",
    canonical: "cofre'do'GM.png",
  },
  {
    why: "a MALFORMED percent escape is tolerated, never thrown on — a GM can drop `100% real.png` into the assets folder by hand, and reconcile.ts treats that as a first-class case",
    storedPath: "/assets/100% real.png",
    canonical: "100% real.png",
  },
  {
    why: "a percent escape that decodes to `%`",
    storedPath: "/assets/100%25%20real.png",
    canonical: "100% real.png",
  },
  {
    why: "an empty segment names the same file: a//b === a/b",
    storedPath: "/assets/a//b.png",
    canonical: "a/b.png",
  },
  {
    why: "an encoded slash INSIDE a segment collapses the same way on both ends",
    storedPath: "/assets/a/%2F/b.png",
    canonical: "a/b.png",
  },
  {
    why: "a trailing slash is not a segment",
    storedPath: "/assets/dir/mapa.png/",
    canonical: "dir/mapa.png",
  },
  {
    why: "nested directories",
    storedPath: "/assets/sub/dir/goblin.png",
    canonical: "sub/dir/goblin.png",
  },
];
