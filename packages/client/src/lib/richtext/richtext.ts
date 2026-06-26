/**
 * richtext.ts — TipTap rich-text configuration for Fusion.
 *
 * REQ-UIF-047..051: TipTap editor with extensions for @links, secrets,
 * inline rolls, sanitisation, serialisation.
 *
 * This module is a pure TS module (no DOM/Svelte/browser APIs) so that the
 * parser/serialiser logic can be tested in Vitest without a browser.
 *
 * The Svelte component (RichText.svelte) imports this module and creates the
 * TipTap editor instance on mount. The extension objects defined here are
 * also valid TipTap extensions (they extend Mark/Node accordingly), but the
 * *rendering* into DOM is handled by TipTap in the browser context.
 *
 * Sanitisation (REQ-UIF-051): HTML is sanitised by stripping all tags and
 * attributes not in the allowlist, preventing XSS. We implement a lightweight
 * allowlist sanitiser here (no external lib dependency) suitable for server-side
 * pre-sanitisation and unit testing.
 */

// ---------------------------------------------------------------------------
// Document link representation (@UUID[...]{label})
// ---------------------------------------------------------------------------

/**
 * Parsed @link of a Document embedded in rich text.
 * Format in HTML: <span data-fusion-link="<uuid>" data-label="<label>">@UUID[<uuid>]{<label>}</span>
 */
export interface DocLink {
  uuid: string;
  label: string;
}

/**
 * Parsed inline roll embedded in rich text.
 * Format in HTML: <span data-fusion-roll="<formula>">[[<formula>]]</span>
 */
export interface InlineRoll {
  formula: string;
}

/**
 * Parsed secret block.
 * Format in HTML: <section data-fusion-secret="1">...</section>
 */
export interface SecretBlock {
  content: string;
}

// ---------------------------------------------------------------------------
// HTML allowlist sanitiser (REQ-UIF-051, REQ-UIF-NF-007)
// ---------------------------------------------------------------------------

/** Tags that are allowed in enriched rich-text output. */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "blockquote",
  "pre",
  "code",
  "details",
  "summary",
  "hr",
  "span",
  "section",
  "div",
]);

/** Attributes allowed per tag (tag → set of allowed attribute names). */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  span: new Set(["data-fusion-link", "data-label", "data-fusion-roll", "class"]),
  section: new Set(["data-fusion-secret", "class"]),
  div: new Set(["class"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  "*": new Set(["class"]),
};

/**
 * Sanitise an HTML string to remove potentially dangerous markup.
 *
 * Uses a simple regex-based approach suitable for Vitest (no DOM).
 * In the browser, TipTap itself controls the schema so only valid marks/nodes
 * are ever serialised; this function provides a second layer of defence for
 * the EnrichedContent component when rendering stored HTML.
 *
 * Rules:
 *   - Tags not in ALLOWED_TAGS are stripped (inner content preserved for block tags).
 *   - Attributes not in ALLOWED_ATTRS (for the tag or in "*") are removed.
 *   - `javascript:` and `data:` hrefs are replaced with "#".
 *   - `on*` event handler attributes are always removed.
 *   - `<script>` and `<style>` tags are removed along with their content.
 *
 * Note: This is a best-effort sanitiser for the Fusion content model (rich text
 * produced by TipTap with a controlled schema). It is NOT a general-purpose
 * sanitiser like DOMPurify. For production use, DOMPurify (browser-only) should
 * be applied on top of EnrichedContent in the DOM.
 */
export function sanitiseHtml(html: string): string {
  // Remove <script> and <style> tags with their content
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // Strip tags not in the allowlist (but keep inner text for inline tags)
  out = out.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (match, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        return ""; // strip tag entirely; content flows through
      }
      // Closing tag — always safe to keep if the tag is allowed
      if (match.trim().startsWith("</")) {
        return `</${tag}>`;
      }
      // Sanitise attributes
      const cleaned = sanitiseAttrs(tag, attrs);
      const selfClose = match.trimEnd().endsWith("/>") ? " /" : "";
      return `<${tag}${cleaned}${selfClose}>`;
    },
  );

  return out;
}

function sanitiseAttrs(tag: string, attrsStr: string): string {
  const tagAllowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const globalAllowed = ALLOWED_ATTRS["*"] ?? new Set<string>();

  const result: string[] = [];

  // Match attribute key="value" or key='value' or key=value or standalone key
  const attrRe = /([a-zA-Z][a-zA-Z0-9\-:]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;

  while ((m = attrRe.exec(attrsStr)) !== null) {
    const attrName = (m[1] ?? "").toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";

    // Always strip event handlers
    if (attrName.startsWith("on")) continue;

    // Check allowlist
    if (!tagAllowed.has(attrName) && !globalAllowed.has(attrName)) continue;

    // Sanitise href/src values
    if (attrName === "href" || attrName === "src") {
      const v = value.trim().toLowerCase();
      if (v.startsWith("javascript:") || v.startsWith("data:")) continue;
    }

    result.push(`${attrName}="${value.replace(/"/g, "&quot;")}"`);
  }

  return result.length > 0 ? ` ${result.join(" ")}` : "";
}

// ---------------------------------------------------------------------------
// @link parsing and serialisation
// ---------------------------------------------------------------------------

/**
 * Regular expression to match a @link span in HTML.
 * Format: <span data-fusion-link="<uuid>" data-label="<label>">...</span>
 */
const DOC_LINK_RE =
  /<span[^>]*data-fusion-link="([^"]+)"[^>]*data-label="([^"]*)"[^>]*>.*?<\/span>/gs;

/**
 * Regular expression to match the raw text format for @links.
 * Format: @UUID[<uuid>]{<label>}
 */
const DOC_LINK_TEXT_RE = /@UUID\[([A-Za-z0-9]+)\]\{([^}]*)\}/g;

/**
 * Regular expression to match an inline roll span.
 * Format: <span data-fusion-roll="<formula>">...</span>
 */
const INLINE_ROLL_RE = /<span[^>]*data-fusion-roll="([^"]+)"[^>]*>.*?<\/span>/gs;

/**
 * Regular expression to match a secret block.
 * Format: <section data-fusion-secret="1">...</section>
 */
const SECRET_BLOCK_RE = /<section[^>]*data-fusion-secret="1"[^>]*>([\s\S]*?)<\/section>/g;

// ---------------------------------------------------------------------------
// Parser — extracts structured data from HTML
// ---------------------------------------------------------------------------

/**
 * Parse all @doc-links from HTML content.
 */
export function parseDocLinks(html: string): DocLink[] {
  const links: DocLink[] = [];
  let m: RegExpExecArray | null;

  // HTML span format
  DOC_LINK_RE.lastIndex = 0;
  while ((m = DOC_LINK_RE.exec(html)) !== null) {
    links.push({ uuid: m[1] ?? "", label: m[2] ?? "" });
  }

  // Raw text format fallback (for content not yet serialised to HTML)
  if (links.length === 0) {
    DOC_LINK_TEXT_RE.lastIndex = 0;
    while ((m = DOC_LINK_TEXT_RE.exec(html)) !== null) {
      links.push({ uuid: m[1] ?? "", label: m[2] ?? "" });
    }
  }

  return links;
}

/**
 * Parse all inline rolls from HTML content.
 */
export function parseInlineRolls(html: string): InlineRoll[] {
  const rolls: InlineRoll[] = [];
  let m: RegExpExecArray | null;

  INLINE_ROLL_RE.lastIndex = 0;
  while ((m = INLINE_ROLL_RE.exec(html)) !== null) {
    rolls.push({ formula: m[1] ?? "" });
  }

  return rolls;
}

/**
 * Parse all secret blocks from HTML content.
 */
export function parseSecretBlocks(html: string): SecretBlock[] {
  const secrets: SecretBlock[] = [];
  let m: RegExpExecArray | null;

  SECRET_BLOCK_RE.lastIndex = 0;
  while ((m = SECRET_BLOCK_RE.exec(html)) !== null) {
    secrets.push({ content: m[1] ?? "" });
  }

  return secrets;
}

// ---------------------------------------------------------------------------
// Serialiser — convert structures to HTML
// ---------------------------------------------------------------------------

/**
 * Serialise a DocLink to HTML span markup.
 * This is what TipTap outputs when a @link node is serialised.
 */
export function serialiseDocLink(link: DocLink): string {
  const escaped = link.label.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<span data-fusion-link="${link.uuid}" data-label="${escaped}" class="doc-link">@UUID[${link.uuid}]{${link.label}}</span>`;
}

/**
 * Serialise an InlineRoll to HTML span markup.
 */
export function serialiseInlineRoll(roll: InlineRoll): string {
  const escaped = roll.formula.replace(/"/g, "&quot;");
  return `<span data-fusion-roll="${escaped}" class="inline-roll">[[${roll.formula}]]</span>`;
}

/**
 * Serialise a SecretBlock to HTML section markup.
 */
export function serialiseSecretBlock(content: string): string {
  return `<section data-fusion-secret="1" class="secret-block">${content}</section>`;
}

// ---------------------------------------------------------------------------
// Enriched content renderer (server/client-side logic only)
// ---------------------------------------------------------------------------

/**
 * Options for enriching HTML content before rendering.
 */
export interface EnrichOptions {
  /** Whether the current user is the GM. Non-GMs cannot see secret blocks. */
  isGm: boolean;
  /**
   * Resolver for @doc-links: receives a UUID and returns the document name
   * (or null if the document is not accessible). Runs synchronously (from cache).
   */
  resolveDocLink?: (uuid: string) => { name: string; type: string } | null;
}

/**
 * Enrich HTML content:
 *   1. Remove secret blocks for non-GMs (REQ-UIF-049).
 *   2. Resolve @doc-links to chip markup.
 *   3. Sanitise the result (REQ-UIF-051).
 *
 * Returns sanitised HTML ready to be set as `innerHTML` by the browser component.
 * The actual DOM manipulation (DOMPurify, custom elements) happens in
 * EnrichedContent.svelte; this function produces the HTML string logic.
 */
export function enrichHtml(html: string, opts: EnrichOptions): string {
  let out = html;

  // Step 1: remove secret blocks for non-GMs
  if (!opts.isGm) {
    out = out.replace(SECRET_BLOCK_RE, "");
  }

  // Step 2: resolve @doc-links if a resolver is provided
  if (opts.resolveDocLink) {
    const resolver = opts.resolveDocLink;
    DOC_LINK_RE.lastIndex = 0;
    out = out.replace(DOC_LINK_RE, (_match, uuid: string, label: string) => {
      const doc = resolver(uuid);
      if (!doc) {
        // Document not accessible — render as plain text
        return `<span class="doc-link doc-link--missing" title="Document not found">${label}</span>`;
      }
      return `<span class="doc-link" data-fusion-link="${uuid}" data-label="${label}" data-doc-type="${doc.type}">${doc.name}</span>`;
    });
  }

  // Step 3: sanitise
  return sanitiseHtml(out);
}

// ---------------------------------------------------------------------------
// TipTap extension descriptors (metadata only — no TipTap imports)
// ---------------------------------------------------------------------------

/**
 * Descriptor for a Fusion TipTap extension.
 * The Svelte component creates the actual TipTap extension objects from these.
 * Keeping descriptors in this .ts file makes the configuration testable without
 * a browser environment.
 */
export interface ExtensionDescriptor {
  name: string;
  type: "mark" | "node";
  attrs?: Record<string, { default: unknown }>;
  /** Tag that represents this extension in HTML. */
  tag: string;
  /** Attribute used to identify this element in HTML. */
  identifierAttr?: string;
}

/** Extension descriptor for @doc-links. */
export const DOC_LINK_EXTENSION: ExtensionDescriptor = {
  name: "fusionDocLink",
  type: "mark",
  attrs: {
    uuid: { default: "" },
    label: { default: "" },
  },
  tag: "span",
  identifierAttr: "data-fusion-link",
};

/** Extension descriptor for secret blocks. */
export const SECRET_BLOCK_EXTENSION: ExtensionDescriptor = {
  name: "fusionSecret",
  type: "node",
  attrs: {
    secret: { default: "1" },
  },
  tag: "section",
  identifierAttr: "data-fusion-secret",
};

/** Extension descriptor for inline rolls. */
export const INLINE_ROLL_EXTENSION: ExtensionDescriptor = {
  name: "fusionInlineRoll",
  type: "mark",
  attrs: {
    formula: { default: "" },
  },
  tag: "span",
  identifierAttr: "data-fusion-roll",
};

/**
 * All Fusion-specific extensions, in the order they should be registered.
 */
export const FUSION_EXTENSIONS: ExtensionDescriptor[] = [
  DOC_LINK_EXTENSION,
  SECRET_BLOCK_EXTENSION,
  INLINE_ROLL_EXTENSION,
];
