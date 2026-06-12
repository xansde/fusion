/**
 * SVG sanitization — server-side, no DOM required.
 *
 * REQ-AST-016 / REQ-SEC-035: SVG uploads must have <script>, event handlers
 * (on*=), external references and <foreignObject> stripped before storage.
 *
 * Strategy (MVP): regex-based allowlist approach documented in spec 20
 * (REQ-AST-016) as acceptable for MVP.  We use `sanitize-html` configured in
 * SVG-safe mode.  If a tag or attribute is not on the allowlist it is stripped.
 *
 * Rejected patterns (per spec 20 / spec 21 REQ-SEC-035):
 *   - <script> elements
 *   - on* event handler attributes (onclick, onload, onerror, …)
 *   - <foreignObject> (embeds arbitrary HTML/XML)
 *   - href/xlink:href pointing to non-relative URLs
 *   - javascript: and data: URIs
 */

import sanitizeHtml from "sanitize-html";

// ---------------------------------------------------------------------------
// Tag allowlist
// ---------------------------------------------------------------------------

/**
 * SVG elements we permit.  Anything not in this list is stripped (tag +
 * contents removed for dangerous elements, tag only removed for unknown inline
 * elements — `sanitize-html` default is to keep text content of unknown tags).
 *
 * Covers the common structural/presentation SVG vocabulary; does NOT include
 * <script>, <foreignObject>, <animate>-with-href, or any HTML embedding.
 */
const ALLOWED_SVG_TAGS = [
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "use",
  "symbol",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feFlood",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "feSpecularLighting",
  "feTile",
  "feTurbulence",
  "fePointLight",
  "feSpotLight",
  "feDistantLight",
  "feFuncR",
  "feFuncG",
  "feFuncB",
  "feFuncA",
  "marker",
  "animate",
  "animateTransform",
  "animateMotion",
  "mpath",
  "set",
  "view",
  "switch",
  "a",
];

// ---------------------------------------------------------------------------
// Attribute allowlist
// ---------------------------------------------------------------------------

/**
 * Attributes that are always blocked regardless of tag (event handlers and
 * dangerous URL-bearing attrs).  `sanitize-html` does not have a global
 * block-list by default, so we use allowTagsFor to keep only safe attrs.
 */

/** Presentational / structural SVG attributes shared by many elements. */
const COMMON_SVG_ATTRS = [
  "id",
  "class",
  "style",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "visibility",
  "display",
  "overflow",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "color",
  "color-interpolation",
  "color-rendering",
  "shape-rendering",
  "text-rendering",
  "image-rendering",
  "pointer-events",
  "cursor",
  "vector-effect",
  "paint-order",
  "marker-start",
  "marker-mid",
  "marker-end",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "direction",
  "writing-mode",
];

/** href / xlink:href validated to relative paths only by URL transform. */
const HREF_ATTRS = ["href", "xlink:href"];

/** Build the per-tag allowedAttributes map. */
function buildAllowedAttributes(): Record<string, sanitizeHtml.AllowedAttribute[]> {
  const attrs: Record<string, sanitizeHtml.AllowedAttribute[]> = {};

  // Generic attrs for all tags
  for (const tag of ALLOWED_SVG_TAGS) {
    attrs[tag] = [...COMMON_SVG_ATTRS];
  }

  // <svg> root extras
  attrs["svg"] = [
    ...COMMON_SVG_ATTRS,
    "xmlns",
    "xmlns:xlink",
    "viewBox",
    "width",
    "height",
    "preserveAspectRatio",
    "version",
    "x",
    "y",
  ];

  // Shape-specific attrs
  const pathAttrs = ["d", "pathLength"];
  const coordAttrs = ["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry"];
  const pointsAttrs = ["points"];
  const dimAttrs = ["width", "height"];

  for (const tag of ["path"]) {
    attrs[tag] = [...(attrs[tag] ?? []), ...pathAttrs];
  }
  for (const tag of ["rect", "circle", "ellipse", "line", "polyline", "polygon"]) {
    attrs[tag] = [...(attrs[tag] ?? []), ...coordAttrs, ...dimAttrs, ...pointsAttrs, "pathLength"];
  }
  for (const tag of ["text", "tspan"]) {
    attrs[tag] = [
      ...(attrs[tag] ?? []),
      ...coordAttrs,
      "dx",
      "dy",
      "rotate",
      "lengthAdjust",
      "textLength",
    ];
  }
  for (const tag of ["image", "use", "pattern", "feImage"]) {
    attrs[tag] = [
      ...(attrs[tag] ?? []),
      ...coordAttrs,
      ...dimAttrs,
      ...HREF_ATTRS,
      "preserveAspectRatio",
    ];
  }
  for (const tag of ["linearGradient", "radialGradient"]) {
    attrs[tag] = [
      ...(attrs[tag] ?? []),
      "gradientUnits",
      "gradientTransform",
      "spreadMethod",
      "x1",
      "y1",
      "x2",
      "y2",
      "cx",
      "cy",
      "r",
      "fx",
      "fy",
      ...HREF_ATTRS,
    ];
  }
  for (const tag of ["stop"]) {
    attrs[tag] = [...(attrs[tag] ?? []), "offset", "stop-color", "stop-opacity"];
  }
  for (const tag of ["filter", "clipPath", "mask"]) {
    attrs[tag] = [
      ...(attrs[tag] ?? []),
      ...coordAttrs,
      ...dimAttrs,
      "filterUnits",
      "primitiveUnits",
      "maskUnits",
      "maskContentUnits",
      "clipPathUnits",
    ];
  }
  for (const tag of ["symbol"]) {
    attrs[tag] = [...(attrs[tag] ?? []), "viewBox", "preserveAspectRatio", ...dimAttrs];
  }
  attrs["defs"] = [...COMMON_SVG_ATTRS];
  attrs["g"] = [...COMMON_SVG_ATTRS];
  attrs["a"] = [...(attrs["a"] ?? []), ...HREF_ATTRS, "target"];
  attrs["marker"] = [
    ...(attrs["marker"] ?? []),
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "markerUnits",
    "viewBox",
  ];

  return attrs;
}

// ---------------------------------------------------------------------------
// URL transform — reject external / dangerous hrefs
// ---------------------------------------------------------------------------

/**
 * Called by sanitize-html for href / src / xlink:href values.
 * Returns `false` to drop the attribute when the URL is:
 *   - javascript: or data: scheme
 *   - an absolute URL (http/https/ftp/etc.) — external reference
 * Returns the original value for relative paths (#id, ./foo.svg, etc.)
 */
function transformUrl(tagName: string, attribName: string, attribValue: string): string | false {
  const val = attribValue.trim();

  // Block dangerous schemes
  const lower = val.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }

  // Block absolute URLs (anything with ://) except fragment-only refs
  if (lower.includes("://")) {
    return false;
  }

  return attribValue;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ALLOWED_ATTRIBUTES = buildAllowedAttributes();

/**
 * Sanitize an SVG string server-side.
 *
 * - Strips <script>, <foreignObject>, event handler attrs, external hrefs.
 * - Preserves all structural/presentational SVG content.
 *
 * REQ-AST-016 / REQ-SEC-035: This is the MVP "documented regex/allowlist" approach.
 * The spec notes `sanitize-html` as the preferred server-side library (no DOM needed).
 *
 * @param svgString Raw SVG text as received from the upload.
 * @returns Sanitized SVG string safe for serving inline.
 */
export function sanitizeSvg(svgString: string): string {
  return sanitizeHtml(svgString, {
    allowedTags: ALLOWED_SVG_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https"],
    // Strip event handlers and dangerous attrs — sanitize-html strips unknown attrs by default.
    // We additionally apply a URL transform for href-bearing attrs.
    transformTags: {
      "*": (tagName, attribs) => {
        // Remove all on* event handler attributes from every tag.
        const cleanAttribs: Record<string, string> = {};
        for (const [key, value] of Object.entries(attribs)) {
          if (key.toLowerCase().startsWith("on")) continue;
          // Validate URL-bearing attributes
          if (key === "href" || key === "xlink:href" || key === "src") {
            const transformed = transformUrl(tagName, key, value);
            if (transformed === false) continue;
            cleanAttribs[key] = transformed;
          } else {
            cleanAttribs[key] = value;
          }
        }
        return { tagName, attribs: cleanAttribs };
      },
    },
    // Remove contents of <script> and <style>
    exclusiveFilter: (frame) => {
      return frame.tag === "script" || frame.tag === "style";
    },
  });
}

/**
 * Check whether an SVG string contains obvious XSS vectors.
 * Used as a pre-check before sanitization for fast rejection logging.
 *
 * This check is informational only — the canonical safety guarantee
 * comes from {@link sanitizeSvg}.
 */
export function svgHasXssVectors(svgString: string): boolean {
  const lower = svgString.toLowerCase();
  return (
    lower.includes("<script") ||
    /\bon\w+\s*=/.test(lower) ||
    lower.includes("javascript:") ||
    lower.includes("<foreignobject")
  );
}
