/**
 * Document identity utilities.
 *
 * REQ-DOC-001: _id is a 16-character string from the alphabet [A-Za-z0-9].
 * REQ-DOC-002: Generated server-side; accepted from caller when provided.
 */
import { customAlphabet } from "nanoid";

/** The alphabet for document IDs: letters and digits (62 symbols). */
export const DOCUMENT_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Length of a document ID in characters. */
export const DOCUMENT_ID_LENGTH = 16;

/**
 * Branded string type for document IDs.
 * 16 characters, alphabet [A-Za-z0-9].
 */
export type DocumentId = string & { readonly __brand: "DocumentId" };

/** Pre-built nanoid generator for document IDs. */
const generateId = customAlphabet(DOCUMENT_ID_ALPHABET, DOCUMENT_ID_LENGTH);

/**
 * Generate a new unique document ID.
 * ~95 bits of entropy; collision probability is negligible at world scale.
 */
export function createDocumentId(): DocumentId {
  return generateId() as DocumentId;
}

const VALID_ID_REGEX = /^[A-Za-z0-9]{16}$/;

/**
 * Check whether a string is a valid document ID.
 */
export function isValidDocumentId(id: string): id is DocumentId {
  return VALID_ID_REGEX.test(id);
}

/**
 * Assert that a string is a valid document ID, throwing if not.
 */
export function assertDocumentId(id: string): DocumentId {
  if (!isValidDocumentId(id)) {
    throw new Error(`Invalid DocumentId: "${id}" — must be exactly 16 chars from [A-Za-z0-9]`);
  }
  return id;
}
