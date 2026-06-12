/**
 * Ownership resolution for documents.
 *
 * REQ-DOC-028: resolveOwnership (getUserLevel with GM + folder inheritance).
 * REQ-DOC-029: default ownership for newly created documents.
 * REQ-DOC-030: testUserLevel boolean check.
 *
 * Note: The *enforcement* of ownership checks per CRUD operation is specified
 * in spec 05 (usuarios-e-permissoes.md) and is outside M0-B scope.
 * This module implements the pure resolution logic.
 */

import { OwnershipLevel, getUserLevel as baseGetUserLevel, defaultOwnership } from "@fusion/shared";
import type { Ownership } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Role enum (subset — M0-B does not import the full permission spec yet)
// ---------------------------------------------------------------------------

/**
 * User roles, matching spec 05-usuarios-e-permissoes.md.
 * GAMEMASTER always receives OwnershipLevel.OWNER on every document.
 */
export enum UserRole {
  NONE = 0,
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT_GM = 3,
  GAMEMASTER = 4,
}

// ---------------------------------------------------------------------------
// Privilege threshold (single source of truth)
// ---------------------------------------------------------------------------

/** Minimum role that bypasses ownership checks and hidden-token redaction. */
const PRIVILEGED_ROLE_THRESHOLD: number = UserRole.ASSISTANT_GM;

/**
 * Every emission path (snapshot, live broadcast, delta resync, ack) MUST use
 * this predicate so the privilege threshold can never drift between paths.
 */
export function isRolePrivileged(role: number): boolean {
  return role >= PRIVILEGED_ROLE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Folder ownership context (minimal interface for inheritance)
// ---------------------------------------------------------------------------

/** Minimal representation of a folder for ownership inheritance. */
export interface FolderOwnership {
  _id: string;
  ownership: Ownership;
  parentId?: string | null;
}

// ---------------------------------------------------------------------------
// resolveOwnership
// ---------------------------------------------------------------------------

/**
 * Resolve the effective ownership level for a user on a document.
 *
 * Resolution order (REQ-DOC-028):
 *   1. GM role → always OWNER.
 *   2. Explicit userId entry in ownership map (unless INHERIT).
 *   3. "default" key in ownership map.
 *   4. If resolved level is INHERIT → walk up folder hierarchy.
 *   5. If root reached with INHERIT → NONE.
 *
 * @param ownership   The document's ownership map.
 * @param userId      The requesting user's id (null → NONE).
 * @param role        The user's global role.
 *
 * Note: INHERIT resolution via folder chain requires the document's folderId.
 * Use resolveOwnershipWithFolder for full INHERIT support.
 */
export function resolveOwnership(
  ownership: Ownership,
  userId: string | null | undefined,
  role: UserRole,
): OwnershipLevel {
  // 1. GM always owns everything.
  if (role === UserRole.GAMEMASTER) {
    return OwnershipLevel.OWNER;
  }

  if (!userId) return OwnershipLevel.NONE;

  // 2 + 3. Resolve using base helper (explicit entry or default).
  let level = baseGetUserLevel(ownership, userId);

  // 4. If INHERIT and no folder context is available → default to NONE.
  // Full INHERIT resolution (REQ-DOC-028 d) requires the document's folderId;
  // callers that need it must use resolveOwnershipWithFolder instead.
  if (level === OwnershipLevel.INHERIT) {
    level = OwnershipLevel.NONE;
  }

  return level;
}

/**
 * Full ownership resolution with folder-chain inheritance.
 *
 * @param docOwnership  The document's ownership map.
 * @param docFolderId   The document's folder id (may be null).
 * @param userId        The requesting user's id.
 * @param role          The user's global role.
 * @param getFolder     Lookup a folder by id; returns undefined if not found.
 */
export function resolveOwnershipWithFolder(
  docOwnership: Ownership,
  docFolderId: string | null | undefined,
  userId: string | null | undefined,
  role: UserRole,
  getFolder?: (id: string) => FolderOwnership | undefined,
): OwnershipLevel {
  // 1. GM always owns everything.
  if (role === UserRole.GAMEMASTER) {
    return OwnershipLevel.OWNER;
  }

  if (!userId) return OwnershipLevel.NONE;

  // 2 + 3. Resolve on the document itself.
  let level = baseGetUserLevel(docOwnership, userId);
  if (level !== OwnershipLevel.INHERIT) return level;

  // 4. Walk folder chain upward.
  if (!getFolder) return OwnershipLevel.NONE;

  let currentFolderId = docFolderId ?? null;
  const visited = new Set<string>();

  while (currentFolderId !== null) {
    // Guard against cycles in folder hierarchy.
    if (visited.has(currentFolderId)) break;
    visited.add(currentFolderId);

    const folder = getFolder(currentFolderId);
    if (!folder) break;

    level = baseGetUserLevel(folder.ownership, userId);
    if (level !== OwnershipLevel.INHERIT) return level;

    currentFolderId = folder.parentId ?? null;
  }

  // 5. Reached root with INHERIT → NONE.
  return OwnershipLevel.NONE;
}

/**
 * Test whether a user's effective ownership level meets a minimum.
 * REQ-DOC-030.
 */
export function testOwnership(
  ownership: Ownership,
  userId: string | null | undefined,
  role: UserRole,
  min: OwnershipLevel,
): boolean {
  return resolveOwnership(ownership, userId, role) >= min;
}

/**
 * Build the default ownership for a document created by a non-GM user.
 * REQ-DOC-029: default=NONE, creatorId=OWNER.
 */
export function ownershipForCreator(creatorId: string | null, role: UserRole): Ownership {
  const base = defaultOwnership(); // { default: NONE }
  if (!creatorId || role === UserRole.GAMEMASTER) {
    // GM creates: no personal owner entry needed (GM always gets OWNER via role).
    return base;
  }
  // Non-GM creator gets OWNER on their own document.
  return { ...base, [creatorId]: OwnershipLevel.OWNER };
}

export { OwnershipLevel, defaultOwnership };
export type { Ownership };
