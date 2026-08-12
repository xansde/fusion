import { describe, expect, it } from "vitest";
import { EMPTY_DOC_JSON, docToPlainText, isEmptyDoc, parseDoc, serialiseDoc } from "../richText.js";

describe("richText", () => {
  describe("isEmptyDoc", () => {
    it("is true for an empty string", () => {
      expect(isEmptyDoc("")).toBe(true);
    });

    it("is true for the canonical empty document", () => {
      expect(isEmptyDoc(EMPTY_DOC_JSON)).toBe(true);
    });

    it("is true for a document made only of paragraphs without text", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph" }, { type: "paragraph", content: [] }],
      };
      expect(isEmptyDoc(serialiseDoc(doc))).toBe(true);
    });

    it("is false once a paragraph carries text", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Investigate the ruins." }] },
        ],
      };
      expect(isEmptyDoc(serialiseDoc(doc))).toBe(false);
    });

    it("is true for corrupted JSON — never throws", () => {
      expect(isEmptyDoc("{not json")).toBe(true);
    });
  });

  describe("parseDoc", () => {
    it("returns the empty document for an empty string", () => {
      expect(parseDoc("")).toEqual(JSON.parse(EMPTY_DOC_JSON));
    });

    it("returns the empty document for invalid JSON instead of throwing", () => {
      expect(() => parseDoc("{not json")).not.toThrow();
      expect(parseDoc("{not json")).toEqual(JSON.parse(EMPTY_DOC_JSON));
    });

    it("returns the empty document when the JSON is valid but not an object", () => {
      expect(parseDoc("42")).toEqual(JSON.parse(EMPTY_DOC_JSON));
      expect(parseDoc('"just a string"')).toEqual(JSON.parse(EMPTY_DOC_JSON));
      expect(parseDoc("null")).toEqual(JSON.parse(EMPTY_DOC_JSON));
    });

    it("parses a well-formed document as-is", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      };
      expect(parseDoc(JSON.stringify(doc))).toEqual(doc);
    });
  });

  describe("serialiseDoc / parseDoc round-trip", () => {
    it("round-trips the empty document", () => {
      const doc = parseDoc(EMPTY_DOC_JSON);
      expect(parseDoc(serialiseDoc(doc))).toEqual(doc);
    });

    it("round-trips an arbitrary document", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Step 1" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Talk to the ", marks: [] },
              { type: "text", text: "innkeeper", marks: [{ type: "bold" }] },
            ],
          },
        ],
      };
      const json = serialiseDoc(doc);
      expect(parseDoc(json)).toEqual(doc);
      expect(serialiseDoc(parseDoc(json))).toBe(json);
    });
  });

  describe("docToPlainText", () => {
    it("is empty for an empty document", () => {
      expect(docToPlainText(EMPTY_DOC_JSON)).toBe("");
    });

    it("flattens a single paragraph", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Investigate the ruins." }] },
        ],
      };
      expect(docToPlainText(serialiseDoc(doc))).toBe("Investigate the ruins.");
    });

    it("does not insert a space between adjacent marked text runs", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "un" },
              { type: "text", text: "believable", marks: [{ type: "italic" }] },
            ],
          },
        ],
      };
      expect(docToPlainText(serialiseDoc(doc))).toBe("unbelievable");
    });

    it("separates block-level nodes with a single space, including a list nested in a list", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Loot:" }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "a rusty key" }] }],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "orderedList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          { type: "paragraph", content: [{ type: "text", text: "a map fragment" }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(docToPlainText(serialiseDoc(doc))).toBe("Loot: a rusty key a map fragment");
    });

    it("returns empty text for corrupted JSON instead of throwing", () => {
      expect(() => docToPlainText("not json at all")).not.toThrow();
      expect(docToPlainText("not json at all")).toBe("");
    });
  });
});
