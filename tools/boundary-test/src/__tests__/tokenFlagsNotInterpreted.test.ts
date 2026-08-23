/**
 * Guards REQ-TOK-100 (specs/41-token.md, DEC-TOK-20 — TK093): "O token DEVE
 * aceitar dado próprio de sistema em `flags`, sob namespace (REQ-DOC-009), e
 * a engine NÃO DEVE interpretar o conteúdo desse namespace." A token's
 * `flags` is an extension point a system writes into and reads back FOR
 * ITSELF — the engine (client or server, outside a system package) may pass
 * the whole blob through (persist it, echo it in redaction, validate its
 * shape against the generic schema), but it must never branch on a SPECIFIC
 * KEY inside it. That is exactly the shape TK093 found and removed: a
 * "future-proof" fallback in `canMoveToken`
 * (packages/client/src/lib/canvas/tokens/token-interaction.ts) that read
 * `token.flags.fusion.owner` to grant move permission — a second "who
 * controls this token" predicate REQ-TOK-034/DEC-TOK-06 already forbids on
 * its own, and simultaneously the engine interpreting `flags` content
 * REQ-TOK-100 forbids.
 *
 * ---------------------------------------------------------------------------
 * Detection criterion (documented, not airtight — same discipline as
 * effectiveActorSingleImpl.test.ts, this file's sibling):
 *
 * A source file in packages/client/src or packages/server/src (EXCLUDING
 * systems/* — a system package is allowed, even expected, to read its own
 * namespace inside a Token/Actor/Item's `flags`) is flagged when it contains
 * a property or index access that reaches at least TWO levels into a
 * `flags` member of something that reads as a token — `token.flags.<ns>.<key>`
 * or `token.flags["<ns>"]["<key>"]` (and mixed dot/bracket forms) — where the
 * receiver is named `token`/`tok`, or ends with `Token` (case-insensitive).
 * Reading `token.flags` alone (zero or one level deep) is NOT flagged — that
 * is the pass-through this rule must allow (persistence, redaction, generic
 * schema validation, `{ ...token.flags }`).
 *
 * What is explicitly ALLOWED and must NOT be flagged: reading/writing the
 * bare `token.flags` object as opaque data; reading `flags` on something that
 * is NOT a token (an Actor's `flags.fusion.attitude`/`flags.fusion.knowledge`
 * are spec 39/42 concerns, not this one); code inside `systems/`; comments
 * and JSDoc mentioning `flags`.
 *
 * Known limits: a token variable named something other than
 * `token`/`tok`/`*Token` (e.g. destructured into a differently-named local)
 * will not be caught. This is a tripwire for the realistic shape a "just one
 * more field" hook would take, not a full data-flow analysis — the backstop
 * for the exotic case remains code review against REQ-TOK-100.
 * ---------------------------------------------------------------------------
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tools/boundary-test -> monorepo root */
const MONOREPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const CLIENT_SRC = resolve(MONOREPO_ROOT, "packages", "client", "src");
const SERVER_SRC = resolve(MONOREPO_ROOT, "packages", "server", "src");

const SOURCE_FILE = /\.(ts|svelte)$/;
const SKIP_DIR = /^(node_modules|dist|build|\.git|\.svelte-kit|__tests__)$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.test(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scanner itself — a pure function so it can be unit-tested directly
// against synthetic content, without touching the filesystem.
// ---------------------------------------------------------------------------

/**
 * One member-access "level" after `flags`: `.key` / `?.key` (dot form, the
 * `?` is a standalone optional-chaining marker directly before the
 * mandatory `.`) or `[...]` / `?.[...]` (bracket form — plain bracket access
 * has NO dot, optional-chaining bracket access has `?.` before the `[`).
 */
const LEVEL = String.raw`(?:\??\.\w+|(?:\?\.)?\[\s*["'][^"']+["']\s*\])`;

/**
 * Matches a token-flags read that is at least two levels deep, in either
 * dot or bracket notation, mixed freely:
 *   token.flags.ns.key            token.flags["ns"].key
 *   token.flags["ns"]["key"]      myToken.flags.ns["key"]
 *   tok.flags?.["ns"]?.key
 */
const TOKEN_FLAGS_DEEP_READ = new RegExp(
  String.raw`\b(?:token|tok|\w*[Tt]oken)\s*\.\s*flags\s*${LEVEL}\s*${LEVEL}`,
);

/** Scans one file's content for REQ-TOK-100 violations. */
export function scanFileForTokenFlagsViolations(relPath: string, content: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (TOKEN_FLAGS_DEEP_READ.test(line)) {
      violations.push(
        `${relPath}:${String(i + 1)}: reads at least two levels into a token's ` +
          `\`flags\` (namespace + key) — the engine must treat \`flags\` as an ` +
          `opaque pass-through, never interpret a specific key inside it ` +
          `(REQ-TOK-100, DEC-TOK-20)`,
      );
    }
  }

  return violations;
}

function scanRealTree(): string[] {
  const violations: string[] = [];
  for (const root of [CLIENT_SRC, SERVER_SRC]) {
    for (const file of listSourceFiles(root)) {
      const relPath = file.slice(MONOREPO_ROOT.length + 1).replace(/\\/g, "/");
      violations.push(...scanFileForTokenFlagsViolations(relPath, readFileSync(file, "utf8")));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Scanner self-test
// ---------------------------------------------------------------------------

describe("REQ-TOK-100 scanner — detects the shapes it claims to detect", () => {
  it("flags a dot-notation read two levels into token.flags", () => {
    const src = `
function canMoveToken(token) {
  const owner = token.flags.fusion.owner;
  return owner === "x";
}
`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("flags a bracket-notation read two levels into token.flags", () => {
    const src = `const owner = token.flags["fusion"]["owner"];`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("flags a mixed dot/bracket read, with optional chaining, on a *Token-named variable", () => {
    const src = `const hp = selectedToken.flags?.["mySystem"]?.hp;`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("does NOT flag reading the bare token.flags object as opaque data", () => {
    const src = `
function persist(token) {
  return { ...token, flags: token.flags };
}
`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).toEqual([]);
  });

  it("does NOT flag a single-level read (token.flags.fusion alone)", () => {
    const src = `const fusionNs = token.flags.fusion;`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).toEqual([]);
  });

  it("does NOT flag flags access on a non-token receiver (e.g. an Actor)", () => {
    const src = `const attitude = actor.flags.fusion.attitude;`;
    expect(scanFileForTokenFlagsViolations("fixture.ts", src)).toEqual([]);
  });

  // NOTE: unlike effectiveActorSingleImpl.test.ts's scanner, this one has no
  // comment-awareness — a comment mentioning `token.flags.ns.key` as an
  // example (as this very docstring does, in prose form) WOULD be flagged if
  // it matched the regex verbatim. Documented as a known limit rather than
  // asserted here, to avoid a test that could pass or fail on either outcome.
});

describe("REQ-TOK-100 — the real client/server tree", () => {
  it("has no code path that interprets a specific key inside a token's flags namespace", () => {
    expect(scanRealTree()).toEqual([]);
  });
});
