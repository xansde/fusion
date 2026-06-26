/**
 * richtext.test.ts — Unit tests for the Fusion rich-text parser/serialiser.
 *
 * REQ-UIF-047..051: @doc-links, secrets, inline rolls, sanitisation.
 */

import { describe, it, expect } from "vitest";
import {
  sanitiseHtml,
  parseDocLinks,
  parseInlineRolls,
  parseSecretBlocks,
  serialiseDocLink,
  serialiseInlineRoll,
  serialiseSecretBlock,
  enrichHtml,
} from "../richtext.js";

// ---------------------------------------------------------------------------
// sanitiseHtml
// ---------------------------------------------------------------------------

describe("sanitiseHtml()", () => {
  it("passes through safe paragraphs unchanged", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(sanitiseHtml(html)).toBe(html);
  });

  it("removes <script> tags and their content", () => {
    const html = '<p>ok</p><script>alert("xss")</script>';
    const result = sanitiseHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("<p>ok</p>");
  });

  it("removes <style> tags and their content", () => {
    const html = "<p>text</p><style>body{color:red}</style>";
    const result = sanitiseHtml(html);
    expect(result).not.toContain("<style");
    expect(result).not.toContain("color:red");
    expect(result).toContain("<p>text</p>");
  });

  it("removes unknown tags but keeps inner text", () => {
    const html = "<custom-el>content</custom-el>";
    const result = sanitiseHtml(html);
    expect(result).not.toContain("<custom-el");
    expect(result).toContain("content");
  });

  it("removes onclick and other on* event handlers", () => {
    const html = '<p onclick="alert(1)">text</p>';
    const result = sanitiseHtml(html);
    expect(result).not.toContain("onclick");
    expect(result).toContain("<p");
    expect(result).toContain("text");
  });

  it("removes javascript: hrefs", () => {
    const html = '<a href="javascript:void(0)">click</a>';
    const result = sanitiseHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("preserves data-fusion-link on span", () => {
    const html = '<span data-fusion-link="abc123" data-label="Actor">Actor</span>';
    const result = sanitiseHtml(html);
    expect(result).toContain('data-fusion-link="abc123"');
    expect(result).toContain('data-label="Actor"');
  });

  it("preserves data-fusion-secret on section", () => {
    const html = '<section data-fusion-secret="1"><p>secret</p></section>';
    const result = sanitiseHtml(html);
    expect(result).toContain('data-fusion-secret="1"');
    expect(result).toContain("secret");
  });

  it("preserves allowed heading tags", () => {
    const html = "<h1>Title</h1><h2>Sub</h2>";
    const result = sanitiseHtml(html);
    expect(result).toContain("<h1>Title</h1>");
    expect(result).toContain("<h2>Sub</h2>");
  });

  it("removes disallowed attributes but keeps the tag", () => {
    const html = '<p data-evil="x" style="color:red">text</p>';
    const result = sanitiseHtml(html);
    expect(result).not.toContain("data-evil");
    expect(result).not.toContain("style");
    expect(result).toContain("<p");
    expect(result).toContain("text");
  });
});

// ---------------------------------------------------------------------------
// parseDocLinks
// ---------------------------------------------------------------------------

describe("parseDocLinks()", () => {
  it("parses a span-formatted doc-link", () => {
    const html = serialiseDocLink({ uuid: "AbCdEfGhIjKlMnOp", label: "My Actor" });
    const links = parseDocLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]!.uuid).toBe("AbCdEfGhIjKlMnOp");
    expect(links[0]!.label).toBe("My Actor");
  });

  it("parses multiple doc-links in a document", () => {
    const html =
      serialiseDocLink({ uuid: "Aaaa0000000000a1", label: "Actor A" }) +
      "<p>some text</p>" +
      serialiseDocLink({ uuid: "Bbbb0000000000b2", label: "Actor B" });
    const links = parseDocLinks(html);
    expect(links).toHaveLength(2);
    expect(links[0]!.uuid).toBe("Aaaa0000000000a1");
    expect(links[1]!.uuid).toBe("Bbbb0000000000b2");
  });

  it("returns empty array when no doc-links present", () => {
    const html = "<p>Plain text</p>";
    expect(parseDocLinks(html)).toHaveLength(0);
  });

  it("parses raw text format @UUID[...]{...}", () => {
    const html = "@UUID[AbCdEfGhIjKlMnOp]{My Actor}";
    const links = parseDocLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]!.uuid).toBe("AbCdEfGhIjKlMnOp");
    expect(links[0]!.label).toBe("My Actor");
  });
});

// ---------------------------------------------------------------------------
// parseInlineRolls
// ---------------------------------------------------------------------------

describe("parseInlineRolls()", () => {
  it("parses a single inline roll", () => {
    const html = serialiseInlineRoll({ formula: "1d20+5" });
    const rolls = parseInlineRolls(html);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]!.formula).toBe("1d20+5");
  });

  it("parses multiple inline rolls", () => {
    const html =
      serialiseInlineRoll({ formula: "1d6" }) +
      "<p> </p>" +
      serialiseInlineRoll({ formula: "2d8+4" });
    const rolls = parseInlineRolls(html);
    expect(rolls).toHaveLength(2);
    expect(rolls.map((r) => r.formula)).toEqual(["1d6", "2d8+4"]);
  });

  it("returns empty array when no rolls present", () => {
    expect(parseInlineRolls("<p>no rolls</p>")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseSecretBlocks
// ---------------------------------------------------------------------------

describe("parseSecretBlocks()", () => {
  it("parses a secret block", () => {
    const html = serialiseSecretBlock("<p>Segredo</p>");
    const secrets = parseSecretBlocks(html);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]!.content).toContain("Segredo");
  });

  it("parses multiple secret blocks", () => {
    const html =
      serialiseSecretBlock("<p>S1</p>") + "<p>public</p>" + serialiseSecretBlock("<p>S2</p>");
    const secrets = parseSecretBlocks(html);
    expect(secrets).toHaveLength(2);
  });

  it("returns empty array when no secret blocks", () => {
    expect(parseSecretBlocks("<p>public</p>")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serialiseDocLink (round-trip)
// ---------------------------------------------------------------------------

describe("serialiseDocLink()", () => {
  it("round-trips: serialise → parse yields the same uuid and label", () => {
    const link = { uuid: "Zzzz9999000011Aa", label: "Test Actor" };
    const html = serialiseDocLink(link);
    const parsed = parseDocLinks(html);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(link);
  });

  it("escapes double-quotes in the label", () => {
    const html = serialiseDocLink({ uuid: "Aaaa0000000000a1", label: 'Actor "Quote"' });
    expect(html).not.toContain('"Actor "Quote"');
  });
});

// ---------------------------------------------------------------------------
// enrichHtml
// ---------------------------------------------------------------------------

describe("enrichHtml()", () => {
  it("removes secret blocks for non-GMs", () => {
    const html = "<p>public</p>" + serialiseSecretBlock("<p>secret</p>");
    const result = enrichHtml(html, { isGm: false });
    expect(result).toContain("public");
    expect(result).not.toContain("secret");
  });

  it("preserves secret blocks for GMs", () => {
    const html = "<p>public</p>" + serialiseSecretBlock("<p>secret</p>");
    const result = enrichHtml(html, { isGm: true });
    expect(result).toContain("public");
    expect(result).toContain("secret");
  });

  it("resolves doc-links when resolver is provided", () => {
    const html = serialiseDocLink({ uuid: "Aaaa0000000000a1", label: "Old Name" });
    const result = enrichHtml(html, {
      isGm: true,
      resolveDocLink: (uuid) =>
        uuid === "Aaaa0000000000a1" ? { name: "Real Actor Name", type: "Actor" } : null,
    });
    expect(result).toContain("Real Actor Name");
  });

  it("renders missing doc-links as missing chip", () => {
    const html = serialiseDocLink({ uuid: "Missing00000000a1", label: "Unknown" });
    const result = enrichHtml(html, {
      isGm: true,
      resolveDocLink: () => null,
    });
    expect(result).toContain("doc-link--missing");
  });

  it("sanitises the final output to remove dangerous HTML", () => {
    const html = "<p>ok</p><script>evil()</script>";
    const result = enrichHtml(html, { isGm: true });
    expect(result).not.toContain("<script");
    expect(result).not.toContain("evil()");
  });
});
