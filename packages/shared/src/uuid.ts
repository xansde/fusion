/**
 * Hierarchical UUID system for Fusion documents.
 *
 * REQ-DOC-003: World documents:     <RootType>.<rootId>(.<EmbeddedType>.<embeddedId>)*
 * REQ-DOC-003: Compendium documents: Compendium.<packId>.<DocType>.<docId>(.<EmbeddedType>.<embeddedId>)*
 * REQ-DOC-004: parseUuid must decompose and reject malformed UUIDs.
 */

/** Branded type for hierarchical UUIDs. */
export type Uuid = string & { readonly __brand: "Uuid" };

/** Scope of a parsed UUID. */
export type UuidScope = "world" | "compendium";

/** A single step in an embedded path. */
export interface EmbeddedStep {
  type: string;
  id: string;
}

/** Result of parsing a UUID. */
export interface ParsedUuid {
  scope: UuidScope;
  /** Only present for compendium scope. */
  packId?: string;
  rootType: string;
  rootId: string;
  embedded: EmbeddedStep[];
  /** The original UUID string. */
  raw: string;
}

/**
 * Build a world-scoped UUID from root type/id and optional embedded path.
 *
 * Example: buildWorldUuid("Actor", "abc123...", [{ type: "Item", id: "xyz789..." }])
 *   => "Actor.abc123....Item.xyz789..."
 */
export function buildWorldUuid(
  rootType: string,
  rootId: string,
  embedded: EmbeddedStep[] = [],
): Uuid {
  const parts = [rootType, rootId];
  for (const step of embedded) {
    parts.push(step.type, step.id);
  }
  return parts.join(".") as Uuid;
}

/**
 * Build a compendium-scoped UUID.
 *
 * Example: buildCompendiumUuid("pf2e.bestiary", "Actor", "def456...", [])
 *   => "Compendium.pf2e.bestiary.Actor.def456..."
 */
export function buildCompendiumUuid(
  packId: string,
  docType: string,
  docId: string,
  embedded: EmbeddedStep[] = [],
): Uuid {
  const parts = ["Compendium", packId, docType, docId];
  for (const step of embedded) {
    parts.push(step.type, step.id);
  }
  return parts.join(".") as Uuid;
}

/**
 * Parse a UUID string into its structural components.
 * Throws for malformed UUIDs.
 *
 * REQ-DOC-004
 */
export function parseUuid(uuid: string): ParsedUuid {
  if (!uuid || typeof uuid !== "string") {
    throw new Error(`Invalid UUID: must be a non-empty string, got: ${uuid}`);
  }

  const segments = uuid.split(".");

  if (segments[0] === "Compendium") {
    // Compendium.<packId>.<DocType>.<docId>[.<EmbType>.<embId>]*
    //
    // packId is a logical field that may contain dots (e.g. "pf2e.bestiary",
    // "mypack", "ns.sub.pack"). DocType is the first segment after the packId
    // that starts with an uppercase letter AND has at least one segment after
    // it (the docId). We scan forward from index 1 to find that boundary.
    //
    // Minimum meaningful structure: Compendium + ≥1 packId segment + DocType + docId
    // = at least 4 segments total.
    if (segments.length < 4) {
      throw new Error(
        `Invalid compendium UUID "${uuid}": too few segments (need at least "Compendium.<packId>.<Type>.<id>")`,
      );
    }

    // Find the index of the DocType segment: first segment (starting at index 1)
    // that begins with an uppercase letter and is not the last segment (needs docId after it).
    let docTypeIndex = -1;
    for (let i = 1; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (seg && /^[A-Z]/.test(seg)) {
        docTypeIndex = i;
        break;
      }
    }

    if (docTypeIndex === -1) {
      throw new Error(
        `Invalid compendium UUID "${uuid}": could not find a DocType segment (must start with uppercase letter) followed by a docId`,
      );
    }

    // packId = segments[1..docTypeIndex-1] joined by "."
    const packIdParts = segments.slice(1, docTypeIndex);
    if (packIdParts.length === 0) {
      throw new Error(`Invalid compendium UUID "${uuid}": packId is empty`);
    }
    const packId = packIdParts.join(".");

    const rootType = segments[docTypeIndex] as string;
    const rootId = segments[docTypeIndex + 1];
    if (!rootId) {
      throw new Error(`Invalid compendium UUID "${uuid}": missing docId after DocType`);
    }

    const rest = segments.slice(docTypeIndex + 2);
    const embedded = parseEmbeddedPath(rest, uuid);

    return {
      scope: "compendium",
      packId,
      rootType,
      rootId,
      embedded,
      raw: uuid,
    };
  }

  // World scope: <RootType>.<rootId>[.<EmbType>.<embId>]*
  // Minimum: 2 segments
  if (segments.length < 2) {
    throw new Error(`Invalid world UUID "${uuid}": must have at least 2 segments "<Type>.<id>"`);
  }

  // segments.length >= 2 is guaranteed by the check above; destructure to
  // satisfy noUncheckedIndexedAccess without non-null assertions.
  const [rootType, rootId, ...rest] = segments;
  if (!rootType || !rootId) {
    throw new Error(`Invalid world UUID "${uuid}": missing rootType or rootId`);
  }

  // Root type must start with uppercase letter (document type convention)
  if (!/^[A-Z]/.test(rootType)) {
    throw new Error(
      `Invalid world UUID "${uuid}": rootType "${rootType}" must start with an uppercase letter`,
    );
  }
  const embedded = parseEmbeddedPath(rest, uuid);

  return {
    scope: "world",
    rootType,
    rootId,
    embedded,
    raw: uuid,
  };
}

function parseEmbeddedPath(parts: string[], rawUuid: string): EmbeddedStep[] {
  if (parts.length === 0) return [];

  if (parts.length % 2 !== 0) {
    throw new Error(
      `Invalid UUID "${rawUuid}": embedded path must have an even number of segments (type/id pairs)`,
    );
  }

  const steps: EmbeddedStep[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const type = parts[i];
    const id = parts[i + 1];
    if (!type || !id) {
      throw new Error(`Invalid UUID "${rawUuid}": empty segment in embedded path`);
    }
    steps.push({ type, id });
  }

  return steps;
}

/**
 * Check whether a string looks like a valid Fusion UUID (permissive check).
 */
export function isValidUuid(value: string): value is Uuid {
  try {
    parseUuid(value);
    return true;
  } catch {
    return false;
  }
}
