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
  ALLOWED_EXTENSIONS,
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

  it("does NOT include exe, pdf, mp4, mp3", () => {
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("exe");
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("pdf");
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("mp4");
    expect(ALLOWED_EXTENSIONS).not.toHaveProperty("mp3");
  });
});
