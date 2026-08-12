/**
 * richText.ts — pure TipTap document helpers for the generic RichText editor.
 *
 * Kept free of DOM/TipTap imports so it runs under the client's node-environment
 * Vitest runner (see vitest.config.ts) without a browser. RichText.svelte owns
 * the TipTap Editor instance and calls into this module to parse/serialise the
 * JSON document it hands to consumers as a plain string.
 *
 * The document shape here is TipTap's own JSON schema (ProseMirror JSON): a
 * recursive `{ type, text?, content? }` tree. This module walks that tree
 * structurally (never importing `JSONContent` from `@tiptap/core`) so it stays
 * a plain, dependency-free module the quest board and journal can both import
 * without pulling TipTap's browser-only code into non-editor code paths.
 */

/** The document TipTap produces for a brand-new, untouched editor. */
export const EMPTY_DOC_JSON: string = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph" }],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A fresh (unshared) empty-document object, so callers never mutate a cached instance. */
function freshEmptyDoc(): unknown {
  const parsed: unknown = JSON.parse(EMPTY_DOC_JSON);
  return parsed;
}

/**
 * Parse a serialised TipTap document.
 *
 * Never throws: an empty string, invalid JSON, or JSON that parses to
 * something other than an object all fall back to the empty document rather
 * than bringing down whatever panel is rendering it — a quest step's
 * description field is one bad write away from this path in production.
 */
export function parseDoc(value: string): unknown {
  if (value === "") return freshEmptyDoc();
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : freshEmptyDoc();
  } catch {
    return freshEmptyDoc();
  }
}

/** Serialise a document back to the string form `parseDoc` accepts. */
export function serialiseDoc(doc: unknown): string {
  return JSON.stringify(doc);
}

/**
 * Collect every text run in document order.
 *
 * Text nodes are concatenated directly — TipTap keeps whitespace inside the
 * text node it belongs to, so two marks that split one word (e.g. italic
 * starting mid-word) must NOT get a separator forced between them. A single
 * space is appended once each node's own `content` array has been walked
 * instead, which is enough to keep separate blocks (paragraphs, list items,
 * headings) from running into each other; the repeated whitespace this
 * produces at nested boundaries is collapsed by the caller.
 */
function collectText(node: unknown, parts: string[]): void {
  if (!isRecord(node)) return;
  const text = node["text"];
  if (typeof text === "string") {
    parts.push(text);
    return;
  }
  const content = node["content"];
  if (Array.isArray(content)) {
    for (const child of content) collectText(child, parts);
    parts.push(" ");
  }
}

/** Flatten a document to the plain text a one-line preview or search index needs. */
export function docToPlainText(value: string): string {
  const parts: string[] = [];
  collectText(parseDoc(value), parts);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * True for the empty string, the canonical empty document, and any document
 * that only has structure (paragraphs, empty list items…) and no actual text.
 *
 * REQ-HUB-032b: the quest board uses this to decide whether a step's
 * description gets an expand affordance at all — a step nobody wrote a
 * description for renders as a plain row, not an empty expander.
 */
export function isEmptyDoc(value: string): boolean {
  return docToPlainText(value) === "";
}
