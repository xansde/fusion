/**
 * Guards RNF-TOK-01 (specs/41-token.md): "the resolution of art, footprint,
 * name and health from the effective actor MUST use a SINGLE shared function
 * between server and client; a second implementation on either side is a
 * defect, not an optimization." REQ-CNV-091 (specs/06-canvas-e-renderizacao.md)
 * states the same requirement for the canvas health bar specifically.
 *
 * The one legal implementation is `resolveEffectiveActor`
 * (packages/shared/src/token/effectiveActor.ts). This test fails the build the
 * moment a second implementation appears in packages/client/src or
 * packages/server/src, instead of waiting for a reviewer to notice the
 * duplication in a diff.
 *
 * ---------------------------------------------------------------------------
 * Detection criterion (documented, not airtight by design — see "Known limits"
 * below):
 *
 * A source file OUTSIDE packages/shared is flagged when it contains either of:
 *
 *  (A) A LOCAL DECLARATION of a function, method, or arrow/function-expression
 *      whose name contains "effectiveActor" (case-insensitive) — e.g.
 *      `function resolveEffectiveActor(...)`, `resolveEffectiveActorForClient(...) {`,
 *      `const getEffectiveActor = (token, actor) => {...}`. This is the literal
 *      "second implementation" RNF-TOK-01 names.
 *
 *  (B) A MANUAL RECONSTRUCTION of an actor from `actorDelta`: a line mentioning
 *      `actorDelta`, within a small window (±3 lines) of either
 *        - a call to a merge-shaped helper (`mergeDeep(`, `deepMerge(`,
 *          `mergeSystem(`, `applyDelta(`, `applyActorDelta(`, case-insensitive), or
 *        - an object-spread of something named like an actor
 *          (`...actor`, `...baseActor`, case-insensitive on the "actor" part).
 *      This catches both "call a merge utility on the delta" and
 *      "hand-roll `{ ...actor, ...delta }`" reimplementations.
 *
 * What is explicitly ALLOWED and must NOT be flagged (this is what makes the
 * criterion usable, not just strict): importing `resolveEffectiveActor` /
 * `ActorDeltaPatch` from `@fusion/shared`; calling `resolveEffectiveActor(...)`;
 * reading, writing, destructuring, or forwarding the bare `token.actorDelta`
 * field as plain data (persistence, redaction, schema validation, negative
 * assertions in tests); spreading the TOKEN itself (`...token`) alongside an
 * `actorDelta` field; mentioning `actorDelta` in comments/JSDoc.
 *
 * Known limits (why "robust", not "airtight"): a sufficiently indirect
 * reimplementation — e.g. spreading a renamed variable, or building the merge
 * across many unrelated lines beyond the ±3 window — will not be caught here.
 * This test is a tripwire for the realistic, straightforward duplication (the
 * shape TK025's handler or a canvas render path would naturally reach for if
 * someone forgot this module exists), not a full data-flow analysis. The
 * actual backstop for the exotic case remains code review against RNF-TOK-01.
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
const SKIP_DIR = /^(node_modules|dist|build|\.git|\.svelte-kit)$/;

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

const LOCAL_DECLARATION_PATTERNS: RegExp[] = [
  // function declarations and method/arrow bodies: `...effectiveActor(...) {`
  /\b\w*[Ee]ffective[Aa]ctor\w*\s*\([^)]*\)\s*\{/,
  // arrow function assigned to an identifier: `const xEffectiveActor = (...) =>`
  /\bconst\s+\w*[Ee]ffective[Aa]ctor\w*\s*(?::[^=\n]*)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]*)?=>/,
  // function-expression assigned to an identifier: `const xEffectiveActor = function`
  /\bconst\s+\w*[Ee]ffective[Aa]ctor\w*\s*(?::[^=\n]*)?=\s*function\b/,
];

const MERGE_CALL = /\b(?:mergeDeep|deepMerge|mergeSystem|applyDelta|applyActorDelta)\s*\(/i;
const ACTOR_SPREAD = /\.\.\.\s*(?:base)?[Aa]ctor\b/;

/** Scans one file's content for RNF-TOK-01 violations. Returns human-readable reasons. */
export function scanFileForViolations(relPath: string, content: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    for (const pattern of LOCAL_DECLARATION_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(
          `${relPath}:${String(i + 1)}: local declaration of an "*EffectiveActor*"-named ` +
            `function — resolveEffectiveActor has exactly one legal implementation, in ` +
            `packages/shared/src/token/effectiveActor.ts (RNF-TOK-01)`,
        );
      }
    }

    if (line.includes("actorDelta")) {
      const windowStart = Math.max(0, i - 3);
      const windowEnd = Math.min(lines.length, i + 4);
      const window = lines.slice(windowStart, windowEnd).join("\n");

      if (MERGE_CALL.test(window)) {
        violations.push(
          `${relPath}:${String(i + 1)}: "actorDelta" appears near a merge-helper call — ` +
            `applying an actorDelta onto an actor must go through resolveEffectiveActor, ` +
            `not a local merge utility (RNF-TOK-01, DEC-DOC-08)`,
        );
      } else if (ACTOR_SPREAD.test(window)) {
        violations.push(
          `${relPath}:${String(i + 1)}: "actorDelta" appears near a "...actor"/"...baseActor" ` +
            `spread — that is a hand-rolled merge; use resolveEffectiveActor instead ` +
            `(RNF-TOK-01, DEC-DOC-08)`,
        );
      }
    }
  }

  return violations;
}

function scanRealTree(): string[] {
  const violations: string[] = [];
  for (const root of [CLIENT_SRC, SERVER_SRC]) {
    for (const file of listSourceFiles(root)) {
      const relPath = file.slice(MONOREPO_ROOT.length + 1).replace(/\\/g, "/");
      violations.push(...scanFileForViolations(relPath, readFileSync(file, "utf8")));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Scanner self-test: proves the criterion actually fires on synthetic
// violations and stays quiet on the legitimate patterns it must allow.
// ---------------------------------------------------------------------------

describe("RNF-TOK-01 scanner — detects the shapes it claims to detect", () => {
  it("flags a locally declared function named like resolveEffectiveActor", () => {
    const src = `
export function resolveEffectiveActor(token, actor) {
  return actor;
}
`;
    expect(scanFileForViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("flags a locally declared arrow function named like getEffectiveActor", () => {
    const src = `const getEffectiveActor = (token, actor) => actor;`;
    expect(scanFileForViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("flags actorDelta merged via a local mergeDeep-style helper", () => {
    const src = `
function drawToken(token, baseActor) {
  const system = mergeDeep(baseActor.system, token.actorDelta.system);
  return system;
}
`;
    expect(scanFileForViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("flags actorDelta reconstructed via a hand-rolled {...actor, ...delta} spread", () => {
    const src = `
function drawToken(token, actor) {
  const delta = token.actorDelta;
  const effective = { ...actor, ...delta };
  return effective;
}
`;
    expect(scanFileForViolations("fixture.ts", src)).not.toEqual([]);
  });

  it("does NOT flag calling the real resolveEffectiveActor from @fusion/shared", () => {
    const src = `
import { resolveEffectiveActor } from "@fusion/shared";

function drawToken(token, baseActor) {
  const effective = resolveEffectiveActor(token, baseActor);
  return effective.name;
}
`;
    expect(scanFileForViolations("fixture.ts", src)).toEqual([]);
  });

  it("does NOT flag reading/writing the bare actorDelta field as plain data", () => {
    const src = `
// Persist whatever the client sent for actorDelta as-is; validation elsewhere.
function toRow(token) {
  const { actorDelta } = token;
  return { ...token, actorDelta };
}
`;
    expect(scanFileForViolations("fixture.ts", src)).toEqual([]);
  });

  it("does NOT flag a comment/JSDoc mentioning actorLink/actorDelta", () => {
    const src = `
/**
 * Whether a token is *linked* or *unlinked* (the \`actorLink\`/\`actorDelta\`
 * pair spec 02 describes) is not decided by this module.
 */
export const NOTE = 1;
`;
    expect(scanFileForViolations("fixture.ts", src)).toEqual([]);
  });

  it("does NOT flag a negative test assertion about actorDelta", () => {
    const src = `
it("carries only actorId, no actorDelta", () => {
  expect(push).not.toHaveProperty("actorDelta");
});
`;
    expect(scanFileForViolations("fixture.ts", src)).toEqual([]);
  });
});

describe("RNF-TOK-01 — the real client/server tree", () => {
  it("has no second implementation of resolveEffectiveActor in packages/client/src or packages/server/src", () => {
    expect(scanRealTree()).toEqual([]);
  });
});
