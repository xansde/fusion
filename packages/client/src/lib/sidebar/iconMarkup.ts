/**
 * iconMarkup.ts — the gate that makes a rail icon safe to inject.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.4: `registerSidebarTab({ icon, ... })`
 * (REQ-GAV-030) takes the icon as **inline SVG markup**, and REQ-NPC-094 (spec 42)
 * forbids emoji or symbol characters — so the rail necessarily injects that string
 * into the DOM (`SidebarRail.svelte`, `{@html tab.icon}`).
 *
 * That injection is only defensible if the string was *proven* to be a drawn icon
 * first. REQ-GAV-031 [V2] promises mods the very same registration call, so this
 * module is the door a mod's markup walks through, and a substring test (`includes
 * "<svg"`) is not a door: `<svg onload="...">` and `<svg></svg><img src=x onerror=...>`
 * both contain it.
 *
 * The check is therefore an **allowlist**, not a blocklist: only the shape elements
 * and the presentation attributes an icon actually needs are accepted, and everything
 * else — event handlers, `<script>`, `<foreignObject>`, `style`, any URL-bearing
 * attribute (`href`, `xlink:href`), comments, doctypes, text content, a second root —
 * is rejected because it was never on the list. A blocklist has to guess tomorrow's
 * vector; an allowlist does not.
 *
 * Pure string logic on purpose: no DOM, so it runs identically in the browser and in
 * the node environment the client's tests use.
 */

/** Shape and grouping elements an icon may use. Nothing that can fetch or script. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "rect",
]);

/**
 * Presentation attributes an icon may carry, compared lower-cased.
 *
 * Deliberately absent: every `on*` handler, `style` (CSS `url()`), and every
 * URL-bearing attribute (`href`, `xlink:href`, `src`, `filter`, `mask`, `clip-path`).
 * Absence is the rejection — no pattern needs to anticipate them.
 */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-hidden",
  "class",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "focusable",
  "height",
  "opacity",
  "points",
  "preserveaspectratio",
  "r",
  "role",
  "rx",
  "ry",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "transform",
  "vector-effect",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
]);

/** Emoji / pictograph guard: icons are drawn SVG, never a character (REQ-NPC-094). */
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/** Element or attribute name, including the `foo-bar` and `xlink:href` forms. */
const NAME = /^[A-Za-z][A-Za-z0-9]*(?:[:-][A-Za-z0-9]+)*/;

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

function skipWhitespace(src: string, from: number): number {
  let i = from;
  while (i < src.length && WHITESPACE.has(src[i] as string)) i += 1;
  return i;
}

interface TagScan {
  /** Index just past the tag's closing `>`. */
  readonly end: number;
  /** Lower-cased element name. */
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

/**
 * Scan one tag starting at `<`. Returns the violation string instead of the scan
 * when the markup is not an allowed tag.
 */
function scanTag(src: string, start: number): TagScan | string {
  if (src.startsWith("<!", start) || src.startsWith("<?", start)) {
    return "comments, doctypes and processing instructions are not allowed";
  }

  let i = start + 1;
  const closing = src[i] === "/";
  if (closing) i += 1;

  const nameMatch = NAME.exec(src.slice(i));
  if (nameMatch === null) return "malformed tag";
  const name = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;

  if (!ALLOWED_ELEMENTS.has(name)) return `<${name}> is not an allowed icon element`;

  for (;;) {
    i = skipWhitespace(src, i);
    if (i >= src.length) return "unterminated tag";

    if (src[i] === ">") return { end: i + 1, name, closing, selfClosing: false };
    if (src[i] === "/" && src[i + 1] === ">") {
      return { end: i + 2, name, closing, selfClosing: true };
    }
    if (closing) return `closing tag </${name}> must carry no attributes`;

    const attrMatch = NAME.exec(src.slice(i));
    if (attrMatch === null) return "malformed attribute";
    const attribute = attrMatch[0].toLowerCase();
    i += attrMatch[0].length;

    if (!ALLOWED_ATTRIBUTES.has(attribute)) {
      return `attribute "${attribute}" is not an allowed icon attribute`;
    }

    const afterName = skipWhitespace(src, i);
    if (src[afterName] !== "=") {
      // Valueless attribute (`<path d>`): nothing to inspect, keep scanning.
      i = afterName;
      continue;
    }

    i = skipWhitespace(src, afterName + 1);
    const quote = src[i];
    if (quote !== '"' && quote !== "'") return `attribute "${attribute}" must be quoted`;
    const close = src.indexOf(quote, i + 1);
    if (close === -1) return `attribute "${attribute}" is unterminated`;

    const value = src.slice(i + 1, close);
    if (value.includes("<")) return `attribute "${attribute}" must not contain markup`;
    i = close + 1;
  }
}

/**
 * The reason `icon` is not an acceptable drawn SVG icon, or `null` when it is one.
 *
 * Accepts exactly one `<svg>` root whose whole subtree is allow-listed shape
 * elements with allow-listed presentation attributes, and no text content.
 */
export function findIconMarkupViolation(icon: string): string | null {
  if (typeof icon !== "string") return "must be a string of inline SVG markup";

  const src = icon.trim();
  if (src.length === 0) return "must not be empty";
  if (PICTOGRAPH.test(src)) return "must not contain an emoji or pictograph";
  if (!/^<svg[\s/>]/i.test(src)) return "must start with a single <svg> root element";

  let i = 0;
  let depth = 0;
  let rootClosed = false;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const text = lt === -1 ? src.slice(i) : src.slice(i, lt);
    if (text.includes(">")) return 'stray ">" outside a tag';
    if (text.trim().length > 0) return "must contain no text content";
    if (lt === -1) break;
    if (rootClosed) return "must contain a single <svg> root element";

    const scan = scanTag(src, lt);
    if (typeof scan === "string") return scan;

    if (scan.closing) {
      depth -= 1;
      if (depth < 0) return "has an unbalanced closing tag";
      if (depth === 0) rootClosed = true;
    } else if (!scan.selfClosing) {
      depth += 1;
    } else if (depth === 0) {
      // A self-closing root (`<svg />`) opens and closes in one tag.
      rootClosed = true;
    }

    i = scan.end;
  }

  if (depth !== 0) return "has an unclosed tag";
  if (!rootClosed) return "must end with a closed <svg> root element";
  return null;
}

/** Whether `icon` is markup this drawer is willing to inject (REQ-GAV-030). */
export function isDrawnSvgIcon(icon: string): boolean {
  return findIconMarkupViolation(icon) === null;
}
