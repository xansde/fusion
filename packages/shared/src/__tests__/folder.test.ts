/**
 * folder.test.ts — the `Folder` document as the whole app now sees it.
 *
 * The shape used to live only in the server's private registry; spec 42
 * (REQ-NPC-020) gave the client a real folder tree, so it moved to
 * `@fusion/shared`. These tests pin the two properties that make the tree
 * possible: nesting is `parentId` (nullable, so a root folder is expressible),
 * and `folder:delete` takes a folder id — never a list of documents.
 */

import { describe, expect, it } from "vitest";

import { defaultStats } from "../document.js";
import {
  ACTOR_FOLDER_TYPE,
  FOLDER_CONTENT_TYPES,
  FolderCreateInputSchema,
  FolderDeletePayloadSchema,
  FolderDocumentSchema,
} from "../folder.js";

function baseFolder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "aaaaaaaaaaaaaaaa",
    _stats: defaultStats(),
    name: "Bosque",
    type: "Actor",
    parentId: null,
    ...overrides,
  };
}

describe("REQ-NPC-020: a Folder nests by parentId", () => {
  it("REQ-NPC-020: a root folder has parentId null, and a nested one carries the id", () => {
    const root = FolderDocumentSchema.parse(baseFolder());
    const nested = FolderDocumentSchema.parse(baseFolder({ parentId: "bbbbbbbbbbbbbbbb" }));

    expect(root.parentId).toBeNull();
    expect(nested.parentId).toBe("bbbbbbbbbbbbbbbb");
    expect(root.sort).toBe(0);
  });

  it("REQ-NPC-020: a folder without a name is refused — an unnamed folder is undrawable", () => {
    expect(FolderDocumentSchema.safeParse(baseFolder({ name: "" })).success).toBe(false);
  });

  it("REQ-NPC-020: the tab's tree is the Actor one, and it is one of the known types", () => {
    expect(ACTOR_FOLDER_TYPE).toBe("Actor");
    expect(FOLDER_CONTENT_TYPES).toContain("Actor");
  });

  it("REQ-NPC-021: a create payload needs a name and a type, and defaults to the root", () => {
    const parsed = FolderCreateInputSchema.parse({ name: "Aldeia", type: "Actor" });

    expect(parsed.parentId).toBeNull();
    expect(parsed.sort).toBe(0);
    expect(FolderCreateInputSchema.safeParse({ name: "", type: "Actor" }).success).toBe(false);
  });
});

describe("REQ-NPC-022: folder:delete takes a folder, not a list of documents", () => {
  it("REQ-NPC-022: one folder id is the whole payload", () => {
    expect(FolderDeletePayloadSchema.parse({ folderId: "aaaaaaaaaaaaaaaa" })).toEqual({
      folderId: "aaaaaaaaaaaaaaaa",
    });
    expect(FolderDeletePayloadSchema.safeParse({ folderId: "" }).success).toBe(false);
    // A caller cannot smuggle a list of actors into the operation.
    const parsed = FolderDeletePayloadSchema.parse({
      folderId: "aaaaaaaaaaaaaaaa",
      ids: ["act-1"],
    });
    expect(Object.keys(parsed)).toEqual(["folderId"]);
  });
});
