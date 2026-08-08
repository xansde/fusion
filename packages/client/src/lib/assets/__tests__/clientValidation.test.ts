/**
 * clientValidation.test.ts — unit tests for client-side asset validation.
 *
 * Pure module — no DOM, no Svelte, no network. Safe for Vitest.
 */

import { describe, it, expect } from "vitest";
import {
  validateFileForUpload,
  validateFilesForUpload,
  getExtension,
  formatBytes,
  isImageExtension,
  MAX_UPLOAD_BYTES,
  MAX_BYTES_BY_KIND,
  ALLOWED_EXTENSIONS,
  acceptAttrFor,
  formatsLabelFor,
  maxBytesFor,
  assetKindFromMime,
  filterAssetsByKinds,
} from "../clientValidation.js";

// ---------------------------------------------------------------------------
// Helper: create a fake File with configurable name and size
// ---------------------------------------------------------------------------

function makeFile(name: string, sizeBytes: number = 1024, type = "image/png"): File {
  // File constructor: (fileBits, fileName, options?)
  // In Vitest (Node environment), File is available globally.
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

// ---------------------------------------------------------------------------
// getExtension
// ---------------------------------------------------------------------------

describe("getExtension", () => {
  it("returns lowercase extension", () => {
    expect(getExtension("photo.PNG")).toBe("png");
    expect(getExtension("map.WebP")).toBe("webp");
  });

  it("returns empty string when no extension", () => {
    expect(getExtension("Makefile")).toBe("");
  });

  it("returns empty string when dot is last character", () => {
    expect(getExtension("file.")).toBe("");
  });

  it("handles dotfiles correctly", () => {
    // .gitignore has no extension per our logic (dot is first char)
    expect(getExtension(".gitignore")).toBe("gitignore");
  });

  it("handles multiple dots — returns last segment", () => {
    expect(getExtension("my.backup.tar.gz")).toBe("gz");
  });
});

// ---------------------------------------------------------------------------
// isImageExtension
// ---------------------------------------------------------------------------

describe("isImageExtension", () => {
  it("returns true for png, jpg, jpeg, webp, svg", () => {
    expect(isImageExtension("token.png")).toBe(true);
    expect(isImageExtension("map.jpg")).toBe(true);
    expect(isImageExtension("map.jpeg")).toBe(true);
    expect(isImageExtension("tile.webp")).toBe(true);
    expect(isImageExtension("icon.svg")).toBe(true);
  });

  it("returns false for audio/video extensions", () => {
    expect(isImageExtension("track.mp3")).toBe(false);
    expect(isImageExtension("scene.webm")).toBe(false);
  });

  it("returns false for no extension", () => {
    expect(isImageExtension("Makefile")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("formats bytes below 1 KB as B", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats 1 KB as 1.0 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats 1.5 KB correctly", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats MB range", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(3145728)).toBe("3.0 MB");
  });

  it("formats 20 MB (max upload limit)", () => {
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("20.0 MB");
  });
});

// ---------------------------------------------------------------------------
// validateFileForUpload
// ---------------------------------------------------------------------------

describe("validateFileForUpload", () => {
  it("accepts a valid PNG file", () => {
    const file = makeFile("goblin.png", 1024);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid JPEG file (.jpg)", () => {
    const file = makeFile("dungeon.jpg", 2048);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid JPEG file (.jpeg)", () => {
    const file = makeFile("dungeon.jpeg", 2048);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid WebP file", () => {
    const file = makeFile("map.webp", 4096);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid SVG file", () => {
    const file = makeFile("icon.svg", 512);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("rejects an .exe file with reason=extension", () => {
    const file = makeFile("malware.exe", 1024);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("extension");
      expect(result.message).toMatch(/not supported/i);
    }
  });

  it("rejects a .pdf file with reason=extension", () => {
    const file = makeFile("document.pdf", 1024);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("extension");
    }
  });

  it("rejects a file with no extension with reason=extension", () => {
    const file = makeFile("Makefile", 100);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("extension");
    }
  });

  it("rejects a file exactly at MAX_UPLOAD_BYTES + 1 with reason=size", () => {
    const file = makeFile("big.png", MAX_UPLOAD_BYTES + 1);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("size");
      expect(result.message).toMatch(/too large/i);
    }
  });

  it("accepts a file at exactly MAX_UPLOAD_BYTES", () => {
    const file = makeFile("limit.png", MAX_UPLOAD_BYTES);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(true);
  });

  it("extension check takes priority over size check", () => {
    const file = makeFile("huge.exe", MAX_UPLOAD_BYTES + 1);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Extension is checked first
      expect(result.reason).toBe("extension");
    }
  });

  it("error message for extension includes allowed formats", () => {
    const file = makeFile("video.mp4", 1024);
    const result = validateFileForUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should list at least PNG and WebP
      expect(result.message).toMatch(/PNG|WebP/);
    }
  });
});

// ---------------------------------------------------------------------------
// validateFilesForUpload
// ---------------------------------------------------------------------------

describe("validateFilesForUpload", () => {
  it("returns ok:true for empty array", () => {
    const result = validateFilesForUpload([]);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for all valid files", () => {
    const files = [makeFile("a.png", 100), makeFile("b.webp", 200)];
    const result = validateFilesForUpload(files);
    expect(result.ok).toBe(true);
  });

  it("returns first error when a file is invalid", () => {
    const files = [makeFile("a.png", 100), makeFile("b.exe", 100)];
    const result = validateFilesForUpload(files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.file.name).toBe("b.exe");
      expect(result.reason).toBe("extension");
    }
  });

  it("identifies the offending file when first file is invalid", () => {
    const files = [makeFile("bad.pdf", 100), makeFile("good.png", 100)];
    const result = validateFilesForUpload(files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.file.name).toBe("bad.pdf");
    }
  });
});

// ---------------------------------------------------------------------------
// ALLOWED_EXTENSIONS constant
// ---------------------------------------------------------------------------

describe("ALLOWED_EXTENSIONS", () => {
  it("includes png, jpg, jpeg, webp, svg", () => {
    expect(ALLOWED_EXTENSIONS).toHaveProperty("png");
    expect(ALLOWED_EXTENSIONS).toHaveProperty("jpg");
    expect(ALLOWED_EXTENSIONS).toHaveProperty("jpeg");
    expect(ALLOWED_EXTENSIONS).toHaveProperty("webp");
    expect(ALLOWED_EXTENSIONS).toHaveProperty("svg");
  });

  it("includes mp3 and ogg", () => {
    expect(ALLOWED_EXTENSIONS).toHaveProperty("mp3");
    expect(ALLOWED_EXTENSIONS).toHaveProperty("ogg");
  });

  it("does NOT include exe, pdf, mp4, wav", () => {
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("exe");
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("pdf");
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("mp4");
    // WAV is out of scope by decision (RIFF is ambiguous with WebP server-side).
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("wav");
  });

  it("tags every extension with the kind the server caps it by", () => {
    expect(ALLOWED_EXTENSIONS["png"]?.kind).toBe("image");
    expect(ALLOWED_EXTENSIONS["svg"]?.kind).toBe("image");
    expect(ALLOWED_EXTENSIONS["mp3"]?.kind).toBe("audio");
    expect(ALLOWED_EXTENSIONS["ogg"]?.kind).toBe("audio");
  });
});

// ---------------------------------------------------------------------------
// Audio uploads and the per-kind size cap (wi-mapa-som-01)
// ---------------------------------------------------------------------------

describe("validateFileForUpload — audio", () => {
  it("accepts an .mp3", () => {
    expect(validateFileForUpload(makeFile("tavern.mp3", 1024, "audio/mpeg")).ok).toBe(true);
  });

  it("accepts an .ogg", () => {
    expect(validateFileForUpload(makeFile("rain.ogg", 1024, "audio/ogg")).ok).toBe(true);
  });

  it("rejects a .wav on extension", () => {
    const result = validateFileForUpload(makeFile("ambient.wav", 1024, "audio/wav"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("extension");
  });

  it("lists the audio formats in the extension error", () => {
    const result = validateFileForUpload(makeFile("clip.mp4", 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/MP3/);
  });
});

describe("MAX_BYTES_BY_KIND — same size, different verdict", () => {
  it("mirrors the server numbers", () => {
    expect(MAX_BYTES_BY_KIND.image).toBe(20 * 1024 * 1024);
    expect(MAX_BYTES_BY_KIND.audio).toBe(100 * 1024 * 1024);
  });

  it("keeps MAX_UPLOAD_BYTES as the image cap (the historical meaning)", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_BYTES_BY_KIND.image);
  });

  it("rejects a 30 MB image but accepts a 30 MB track", () => {
    const thirtyMb = 30 * 1024 * 1024;

    const image = validateFileForUpload(makeFile("huge.png", thirtyMb));
    expect(image.ok).toBe(false);
    if (!image.ok) {
      expect(image.reason).toBe("size");
      expect(image.message).toMatch(/image/i);
    }

    expect(validateFileForUpload(makeFile("long.mp3", thirtyMb, "audio/mpeg")).ok).toBe(true);
  });

  it("rejects a track above the audio cap, naming the kind", () => {
    const result = validateFileForUpload(
      makeFile("epic.ogg", MAX_BYTES_BY_KIND.audio + 1, "audio/ogg"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("size");
      expect(result.message).toMatch(/audio/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Picker helpers — what the FilePicker renders is derived, never hand-written
// ---------------------------------------------------------------------------

describe("acceptAttrFor", () => {
  it("offers only image extensions to an image picker", () => {
    expect(acceptAttrFor(["image"])).toBe(".png,.jpg,.jpeg,.webp,.svg");
  });

  it("offers only audio extensions to an audio picker", () => {
    expect(acceptAttrFor(["audio"])).toBe(".mp3,.ogg");
  });

  it("offers both when both kinds are asked for", () => {
    expect(acceptAttrFor(["image", "audio"])).toBe(".png,.jpg,.jpeg,.webp,.svg,.mp3,.ogg");
  });
});

describe("formatsLabelFor", () => {
  it("dedupes JPEG and reads like a human wrote it", () => {
    expect(formatsLabelFor(["image"])).toBe("PNG, JPEG, WebP, SVG");
    expect(formatsLabelFor(["audio"])).toBe("MP3, OGG");
  });
});

describe("maxBytesFor", () => {
  it("is the cap of the single kind", () => {
    expect(maxBytesFor(["image"])).toBe(MAX_BYTES_BY_KIND.image);
    expect(maxBytesFor(["audio"])).toBe(MAX_BYTES_BY_KIND.audio);
  });

  it("is the largest cap when several kinds are accepted", () => {
    expect(maxBytesFor(["image", "audio"])).toBe(MAX_BYTES_BY_KIND.audio);
  });
});

// ---------------------------------------------------------------------------
// validateFileForUpload — kinds param (drop/file-input honoring the picker's
// scope, not just the browse dialog's `accept`; wi-mapa-som-01 review §3)
// ---------------------------------------------------------------------------

describe("validateFileForUpload — kinds param", () => {
  it("accepts a file whose kind is in the given kinds", () => {
    const result = validateFileForUpload(makeFile("goblin.png", 1024), ["image"]);
    expect(result.ok).toBe(true);
  });

  it("rejects a file whose kind is outside the given kinds, naming the file and the scope", () => {
    const result = validateFileForUpload(makeFile("track.mp3", 1024, "audio/mpeg"), ["image"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("extension");
      expect(result.message).toBe("track.mp3: not allowed in this picker (image only).");
    }
  });

  it("rejects the inverse: an image dropped on an audio-only picker", () => {
    const result = validateFileForUpload(makeFile("map.webp", 1024), ["audio"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("map.webp: not allowed in this picker (audio only).");
    }
  });

  it("accepts either kind when both are offered", () => {
    expect(validateFileForUpload(makeFile("map.webp", 1024), ["image", "audio"]).ok).toBe(true);
    expect(
      validateFileForUpload(makeFile("track.mp3", 1024, "audio/mpeg"), ["image", "audio"]).ok,
    ).toBe(true);
  });

  it("still runs the size check after a kind match", () => {
    const result = validateFileForUpload(
      makeFile("huge.png", MAX_BYTES_BY_KIND.image + 1),
      ["image"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("size");
  });

  it("still rejects on extension before ever checking kinds", () => {
    const result = validateFileForUpload(makeFile("malware.exe", 1024), ["image"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("extension");
    // Not the kinds-scoped message
    if (!result.ok) expect(result.message).not.toMatch(/not allowed in this picker/);
  });

  it("omitting kinds keeps the pre-kinds behavior (no extra restriction)", () => {
    expect(validateFileForUpload(makeFile("track.mp3", 1024, "audio/mpeg")).ok).toBe(true);
    expect(validateFileForUpload(makeFile("goblin.png", 1024)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assetKindFromMime
// ---------------------------------------------------------------------------

describe("assetKindFromMime", () => {
  it("classifies image/* as image", () => {
    expect(assetKindFromMime("image/png")).toBe("image");
    expect(assetKindFromMime("image/webp")).toBe("image");
  });

  it("classifies audio/* as audio", () => {
    expect(assetKindFromMime("audio/mpeg")).toBe("audio");
    expect(assetKindFromMime("audio/ogg")).toBe("audio");
  });

  it("returns undefined for an unrecognized mime type", () => {
    expect(assetKindFromMime("application/pdf")).toBeUndefined();
    expect(assetKindFromMime("video/webm")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// filterAssetsByKinds — what the FilePicker grid renders, so an image picker
// never shows an audio card and vice versa (wi-mapa-som-01 review §3)
// ---------------------------------------------------------------------------

describe("filterAssetsByKinds", () => {
  const png = { name: "goblin.png", size: 100, mime_type: "image/png" };
  const mp3 = { name: "tavern.mp3", size: 200, mime_type: "audio/mpeg" };
  const pdf = { name: "manual.pdf", size: 300, mime_type: "application/pdf" };

  it("keeps only image assets for an image-only picker", () => {
    expect(filterAssetsByKinds([png, mp3, pdf], ["image"])).toEqual([png]);
  });

  it("keeps only audio assets for an audio-only picker", () => {
    expect(filterAssetsByKinds([png, mp3, pdf], ["audio"])).toEqual([mp3]);
  });

  it("excludes an asset with an unrecognized mime type regardless of kinds", () => {
    expect(filterAssetsByKinds([pdf], ["image", "audio"])).toEqual([]);
  });

  it("keeps both kinds when both are requested", () => {
    expect(filterAssetsByKinds([png, mp3, pdf], ["image", "audio"])).toEqual([png, mp3]);
  });

  it("returns an empty array for an empty asset list", () => {
    expect(filterAssetsByKinds([], ["image"])).toEqual([]);
  });
});
