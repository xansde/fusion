/**
 * WorldSection.test.ts — G102 (Fase 9 — Aba Configurações), Seção Mundo
 * (spec 37 §5.4, REQ-CFG-030/073, REQ-CFG-082).
 *
 * Server-rendered snapshots via `svelte/server`'s `render()` — same
 * constraint as `PermissionsSection`'s and `PreferencesSection`'s tests: no
 * client runtime is attached, so no change event fires here. What this file
 * proves is markup shape across all three control kinds (REQ-CFG-030 —
 * `SettingsTab.test.ts` only exercised the boolean branch) and that a
 * refusal recorded in `WorldSectionState` renders its reason under the row
 * (REQ-CFG-073's "exibir o motivo"). The confirm/impact-query orchestration
 * itself is `resolveBooleanWrite`'s own pure-logic tests
 * (`worldSettingsSection.test.ts`) — this file never simulates a click.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render } from "svelte/server";

import WorldSection from "../WorldSection.svelte";
import {
  resetWorldSettingsRegistry,
  seedWorldSettingsRegistry,
} from "../../../lib/settings/worldSettingsRegistry.svelte.js";
import { WorldSectionState } from "../../../lib/settings/worldSectionState.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

beforeEach(() => {
  resetWorldSettingsRegistry();
});

function renderSection(state?: WorldSectionState): string {
  const { body } = render(WorldSection, {
    props: { socket: {} as never, ...(state ? { state } : {}) },
  });
  return body;
}

describe("WorldSection — REQ-CFG-030: enum row draws a <select> with the current option chosen", () => {
  it("renders a <select> offering every declared option, with the row's value selected", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-enum-1",
          key: "fake-system:verbosityLevel",
          kind: "enum",
          options: ["quiet", "loud"],
          label: "Verbosidade",
          value: "loud",
        },
      ],
    });

    const html = renderSection();

    expect(html).toContain("<select");
    expect(html).toContain('<option value="quiet">quiet</option>');
    expect(html).toContain('<option value="loud" selected="">loud</option>');
  });
});

describe("WorldSection — REQ-CFG-030: number row draws a numeric <input>", () => {
  it("renders a numeric input with the row's value", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-number-1",
          key: "fake-system:maxRetries",
          kind: "number",
          label: "Máximo de tentativas",
          value: 5,
        },
      ],
    });

    const html = renderSection();

    expect(html).toMatch(/<input[^>]*type="number"[^>]*value="5"/);
  });
});

describe("WorldSection — REQ-CFG-030: boolean row draws a checked/unchecked checkbox", () => {
  it("renders an unchecked checkbox for a false value", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: null,
          key: "fake-system:neverSeenBeforeToggle",
          kind: "boolean",
          label: "Nunca visto antes",
          value: false,
        },
      ],
    });

    const html = renderSection();

    expect(html).toContain('type="checkbox"');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });
});

describe("WorldSection — REQ-CFG-073: a refusal shows its reason under the row", () => {
  it("a row with an error recorded in state renders the WriteFailed message", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-fa-1",
          key: "pf2e:freeArchetype",
          kind: "boolean",
          label: "Arquétipo Livre",
          value: true,
        },
      ],
    });
    const state = new WorldSectionState();
    state.setError("pf2e:freeArchetype", "papel insuficiente");

    const html = renderSection(state);

    expect(html).toContain(
      t("FUSION.Settings.World.WriteFailed", { message: "papel insuficiente" }),
    );
  });

  it("a row with no recorded error shows no failure message at all", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-fa-1",
          key: "pf2e:freeArchetype",
          kind: "boolean",
          label: "Arquétipo Livre",
          value: true,
        },
      ],
    });

    const html = renderSection(new WorldSectionState());

    expect(html).not.toContain("world-section__error");
  });

  it("REQ-CFG-042/073: the control still reflects the row's own value while the error shows — refusal never assumes success", () => {
    seedWorldSettingsRegistry({
      systemId: "fake-system",
      settings: [
        {
          id: "setting-fa-1",
          key: "pf2e:freeArchetype",
          kind: "boolean",
          label: "Arquétipo Livre",
          value: true,
        },
      ],
    });
    const state = new WorldSectionState();
    state.setError("pf2e:freeArchetype", "papel insuficiente");

    const html = renderSection(state);

    // The row's value in the registry was never touched by the refused
    // write, so the markup still renders it checked.
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });
});
