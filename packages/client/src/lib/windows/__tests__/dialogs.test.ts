/**
 * dialogs.test.ts — Unit tests for the dialog bridge (dialogs.svelte.ts).
 *
 * Tests that confirm() / prompt() correctly push pending dialogs to the queue
 * and that resolving them cleans up the queue.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { confirm, prompt, pendingDialogs, removePendingDialog, Dialog } from "../dialogs.svelte.js";

// ---------------------------------------------------------------------------
// Helpers to drain the pendingDialogs array between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  pendingDialogs.splice(0, pendingDialogs.length);
});

// ---------------------------------------------------------------------------
// confirm()
// ---------------------------------------------------------------------------

describe("confirm()", () => {
  it("pushes a PendingConfirm with kind='confirm'", () => {
    const p = confirm("Are you sure?");
    expect(pendingDialogs).toHaveLength(1);
    expect(pendingDialogs[0]!.kind).toBe("confirm");
    // Resolve to avoid unhandled promise
    (pendingDialogs[0]! as { resolve: (v: boolean) => void }).resolve(false);
    return p;
  });

  it("resolves to true when the pending resolve is called with true", async () => {
    const p = confirm("Confirm?");
    const pending = pendingDialogs[0]! as { resolve: (v: boolean) => void };
    pending.resolve(true);
    const result = await p;
    expect(result).toBe(true);
  });

  it("resolves to false when the pending resolve is called with false", async () => {
    const p = confirm("Confirm?");
    const pending = pendingDialogs[0]! as { resolve: (v: boolean) => void };
    pending.resolve(false);
    const result = await p;
    expect(result).toBe(false);
  });

  it("uses default labels when none provided", () => {
    confirm("Message?").catch(() => {});
    const d = pendingDialogs[0]! as {
      confirmLabel: string;
      cancelLabel: string;
      resolve: (v: boolean) => void;
    };
    expect(d.confirmLabel).toBe("Confirmar");
    expect(d.cancelLabel).toBe("Cancelar");
    d.resolve(false);
  });

  it("accepts custom labels", () => {
    confirm("Delete?", { confirmLabel: "Excluir", cancelLabel: "Manter" }).catch(() => {});
    const d = pendingDialogs[0]! as {
      confirmLabel: string;
      cancelLabel: string;
      resolve: (v: boolean) => void;
    };
    expect(d.confirmLabel).toBe("Excluir");
    expect(d.cancelLabel).toBe("Manter");
    d.resolve(false);
  });

  it("carries the message string", () => {
    confirm("Are you really sure?").catch(() => {});
    expect((pendingDialogs[0]! as { message: string; resolve: (v: boolean) => void }).message).toBe(
      "Are you really sure?",
    );
    (pendingDialogs[0]! as { resolve: (v: boolean) => void }).resolve(false);
  });
});

// ---------------------------------------------------------------------------
// prompt()
// ---------------------------------------------------------------------------

describe("prompt()", () => {
  it("pushes a PendingPrompt with kind='prompt'", () => {
    const p = prompt("Enter name:");
    expect(pendingDialogs).toHaveLength(1);
    expect(pendingDialogs[0]!.kind).toBe("prompt");
    (pendingDialogs[0]! as { resolve: (v: string | null) => void }).resolve(null);
    return p;
  });

  it("resolves with the entered string", async () => {
    const p = prompt("Enter name:");
    (pendingDialogs[0]! as { resolve: (v: string | null) => void }).resolve("Thorin");
    const result = await p;
    expect(result).toBe("Thorin");
  });

  it("resolves to null on cancel", async () => {
    const p = prompt("Enter name:");
    (pendingDialogs[0]! as { resolve: (v: string | null) => void }).resolve(null);
    const result = await p;
    expect(result).toBeNull();
  });

  it("carries the defaultValue", () => {
    prompt("Enter:", "default text").catch(() => {});
    expect(
      (pendingDialogs[0]! as { defaultValue: string; resolve: (v: string | null) => void })
        .defaultValue,
    ).toBe("default text");
    (pendingDialogs[0]! as { resolve: (v: string | null) => void }).resolve(null);
  });

  it("empty defaultValue when not provided", () => {
    prompt("Enter:").catch(() => {});
    expect(
      (pendingDialogs[0]! as { defaultValue: string; resolve: (v: string | null) => void })
        .defaultValue,
    ).toBe("");
    (pendingDialogs[0]! as { resolve: (v: string | null) => void }).resolve(null);
  });
});

// ---------------------------------------------------------------------------
// removePendingDialog
// ---------------------------------------------------------------------------

describe("removePendingDialog()", () => {
  it("removes the dialog from the queue", () => {
    confirm("Test?").catch(() => {});
    const d = pendingDialogs[0]!;
    removePendingDialog(d);
    expect(pendingDialogs).toHaveLength(0);
  });

  it("does not throw when removing a dialog not in the queue", () => {
    confirm("Test?").catch(() => {});
    const d = pendingDialogs[0]!;
    removePendingDialog(d);
    // Second remove should be a no-op
    expect(() => removePendingDialog(d)).not.toThrow();
  });

  it("only removes the target dialog, leaving others", () => {
    confirm("Q1?").catch(() => {});
    confirm("Q2?").catch(() => {});
    expect(pendingDialogs).toHaveLength(2);
    const first = pendingDialogs[0]!;
    removePendingDialog(first);
    expect(pendingDialogs).toHaveLength(1);
    expect(pendingDialogs[0]!.kind).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------
// Dialog namespace export
// ---------------------------------------------------------------------------

describe("Dialog namespace", () => {
  it("Dialog.confirm is the same function as confirm", () => {
    expect(Dialog.confirm).toBe(confirm);
  });

  it("Dialog.prompt is the same function as prompt", () => {
    expect(Dialog.prompt).toBe(prompt);
  });
});

// ---------------------------------------------------------------------------
// Multiple concurrent dialogs
// ---------------------------------------------------------------------------

describe("Multiple concurrent dialogs", () => {
  it("queues multiple dialogs independently", async () => {
    const p1 = confirm("First?");
    const p2 = prompt("Second?");
    const p3 = confirm("Third?");

    expect(pendingDialogs).toHaveLength(3);
    expect(pendingDialogs[0]!.kind).toBe("confirm");
    expect(pendingDialogs[1]!.kind).toBe("prompt");
    expect(pendingDialogs[2]!.kind).toBe("confirm");

    // Resolve in order
    (pendingDialogs[0]! as { resolve: (v: boolean) => void }).resolve(true);
    (pendingDialogs[1]! as { resolve: (v: string | null) => void }).resolve("hello");
    (pendingDialogs[2]! as { resolve: (v: boolean) => void }).resolve(false);

    expect(await p1).toBe(true);
    expect(await p2).toBe("hello");
    expect(await p3).toBe(false);
  });
});
