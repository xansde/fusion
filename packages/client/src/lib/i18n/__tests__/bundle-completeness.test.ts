/**
 * bundle-completeness.test.ts — i18n bundle completeness checks.
 *
 * Verifies:
 *   1. Every key in pt-BR also exists in en (no pt-BR orphan keys).
 *   2. Every key in en also exists in pt-BR (no en orphan keys).
 *   3. No value in pt-BR is the empty string (untranslated placeholder guard).
 *   4. No value in pt-BR still equals the English value for spot-checked keys
 *      where we know the translation must differ (smoke test for copy-paste errors).
 *   5. The t() singleton resolves all bundle keys without returning the raw key
 *      (i.e. no resolution misses for the registered bundles).
 *   6. Interpolation placeholders {{...}} in pt-BR and en match each other
 *      for the same key (prevents broken templates on locale switch).
 *
 * REQ-UIF-057..060: key resolution, interpolation, fallback, bundle registration.
 */

import { describe, it, expect } from "vitest";
import ptBR from "../pt-BR.json" assert { type: "json" };
import en from "../en.json" assert { type: "json" };
import { FusionI18n } from "../i18n.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BundleValue = string | { "1": string; other: string };
type Bundle = Record<string, BundleValue>;

function extractPlaceholders(value: string): Set<string> {
  const matches = value.match(/\{\{(\w+)\}\}/g) ?? [];
  return new Set(matches);
}

function bundleEntryToString(entry: BundleValue): string {
  if (typeof entry === "string") return entry;
  // Pluralisation: check both forms
  return `${entry["1"]} ${entry["other"]}`;
}

const ptBRBundle = ptBR as Bundle;
const enBundle = en as Bundle;

// ---------------------------------------------------------------------------
// 1 — Key parity: every pt-BR key exists in en
// ---------------------------------------------------------------------------

describe("Bundle parity: pt-BR ↔ en", () => {
  const ptBRKeys = Object.keys(ptBRBundle);
  const enKeys = new Set(Object.keys(enBundle));

  it("every pt-BR key exists in en", () => {
    const orphans = ptBRKeys.filter((k) => !enKeys.has(k));
    expect(orphans, `pt-BR has keys missing from en: ${orphans.join(", ")}`).toHaveLength(0);
  });

  it("every en key exists in pt-BR", () => {
    const ptBRSet = new Set(ptBRKeys);
    const orphans = Object.keys(enBundle).filter((k) => !ptBRSet.has(k));
    expect(orphans, `en has keys missing from pt-BR: ${orphans.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2 — No empty translations in pt-BR
// ---------------------------------------------------------------------------

describe("No empty translations in pt-BR", () => {
  it("every pt-BR value is non-empty", () => {
    const empty: string[] = [];
    for (const [key, value] of Object.entries(ptBRBundle)) {
      if (typeof value === "string" && value.trim() === "") {
        empty.push(key);
      } else if (typeof value === "object") {
        if (value["1"].trim() === "" || value["other"].trim() === "") {
          empty.push(key);
        }
      }
    }
    expect(empty, `pt-BR has empty translations: ${empty.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3 — Interpolation placeholders are consistent across locales
// ---------------------------------------------------------------------------

describe("Interpolation placeholder consistency", () => {
  it("pt-BR and en have identical {{placeholders}} for each key", () => {
    const mismatches: string[] = [];
    for (const key of Object.keys(ptBRBundle)) {
      const ptEntry: BundleValue | undefined = ptBRBundle[key];
      const enEntry: BundleValue | undefined = enBundle[key];
      if (!ptEntry || !enEntry) continue; // already caught by parity test

      const ptStr = bundleEntryToString(ptEntry);
      const enStr = bundleEntryToString(enEntry);
      const ptVars = extractPlaceholders(ptStr);
      const enVars = extractPlaceholders(enStr);

      const diff = [...ptVars]
        .filter((v) => !enVars.has(v))
        .concat([...enVars].filter((v) => !ptVars.has(v)));

      if (diff.length > 0) {
        mismatches.push(`${key}: placeholder diff [${diff.join(", ")}]`);
      }
    }
    expect(
      mismatches,
      `Placeholder mismatch between pt-BR and en:\n${mismatches.join("\n")}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4 — t() resolves all keys without returning the raw key (no missing entries)
// ---------------------------------------------------------------------------

describe("t() resolution — no missing keys", () => {
  it("singleton t() resolves all pt-BR keys to a non-key string", () => {
    const i18n = new FusionI18n();
    i18n.registerBundle("pt-BR", "", ptBRBundle);
    i18n.registerBundle("en", "", enBundle);
    i18n.setLocale("pt-BR");

    const unresolved: string[] = [];
    for (const key of Object.keys(ptBRBundle)) {
      const result = i18n.t(key);
      // If t() returns the raw key, the key is missing from the bundle
      if (result === key) {
        unresolved.push(key);
      }
    }
    expect(
      unresolved,
      `These keys were not resolved (t() returned the raw key): ${unresolved.join(", ")}`,
    ).toHaveLength(0);
  });

  it("singleton t() resolves all en keys to a non-key string", () => {
    const i18n = new FusionI18n();
    i18n.registerBundle("pt-BR", "", ptBRBundle);
    i18n.registerBundle("en", "", enBundle);
    i18n.setLocale("en");

    const unresolved: string[] = [];
    for (const key of Object.keys(enBundle)) {
      const result = i18n.t(key);
      if (result === key) {
        unresolved.push(key);
      }
    }
    expect(unresolved, `These en keys were not resolved: ${unresolved.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5 — Spot-check: known pt-BR translations differ from English
// ---------------------------------------------------------------------------

describe("Spot-check: pt-BR translations differ from English for key terms", () => {
  const spotCheck: Array<[string, string, string]> = [
    // [key, expected pt-BR, must NOT equal en value]
    ["FUSION.Sidebar.Tabs.Scenes", "Cenas", "Scenes"],
    ["FUSION.Sidebar.Tabs.Combat", "Combate", "Combat"],
    ["FUSION.Combat.Empty", "Nenhum combate ativo.", "No active combat."],
    ["FUSION.Join.JoinWorld", "Entrar no World", "Join World"],
    ["FUSION.NoScene.Title", "Nenhuma Cena Ativa", "No Active Scene"],
    ["FUSION.Connection.Connected", "Conectado", "Connected"],
    ["FUSION.Role.GM", "Mestre", "GM"],
    ["FUSION.Role.Player", "Jogador", "Player"],
    ["FUSION.Sheet.Labels.HP", "PV", "HP"],
    ["FUSION.Sheet.Labels.AC", "CA", "AC"],
    ["FUSION.Dialog.Cancel", "Cancelar", "Cancel"],
    ["FUSION.Header.Leave", "Sair", "Leave"],
    [
      "FUSION.Management.Title",
      "Servidor ativo — nenhum mundo aberto",
      "Server running — no world open",
    ],
    ["FUSION.Management.RetryButton", "Verificar novamente", "Check again"],
  ];

  for (const [key, expectedPtBR, _enValue] of spotCheck) {
    it(`"${key}" is "${expectedPtBR}" in pt-BR`, () => {
      expect(ptBRBundle[key]).toBe(expectedPtBR);
    });

    it(`"${key}" is different in pt-BR vs en`, () => {
      expect(ptBRBundle[key]).not.toBe(enBundle[key]);
    });
  }
});

// ---------------------------------------------------------------------------
// 6 — Combat section coverage
// ---------------------------------------------------------------------------

describe("Combat keys coverage", () => {
  const combatKeys = [
    "FUSION.Combat.Empty",
    "FUSION.Combat.Create",
    "FUSION.Combat.Round",
    "FUSION.Combat.Ended",
    "FUSION.Combat.NotStarted",
    "FUSION.Combat.Begin",
    "FUSION.Combat.End",
    "FUSION.Combat.RollAll",
    "FUSION.Combat.NoCombatants",
    "FUSION.Combat.NoCombatantsGm",
    "FUSION.Combat.Defeated",
    "FUSION.Combat.RemoveFromCombat",
    "FUSION.Combat.RollInitiative",
    "FUSION.Combat.RollMyInitiative",
    "FUSION.Combat.TargetToken",
    "FUSION.Combat.TurnOrder",
    "FUSION.Combat.ActiveTurn",
  ];

  it("all combat keys exist in pt-BR", () => {
    const missing = combatKeys.filter((k) => !(k in ptBRBundle));
    expect(missing, `Missing combat keys in pt-BR: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all combat keys exist in en", () => {
    const missing = combatKeys.filter((k) => !(k in enBundle));
    expect(missing, `Missing combat keys in en: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7 — Join screen keys coverage
// ---------------------------------------------------------------------------

describe("Join screen keys coverage", () => {
  const joinKeys = [
    "FUSION.Join.ChooseCharacter",
    "FUSION.Join.NoUsers",
    "FUSION.Join.PasswordFor",
    "FUSION.Join.PasswordPlaceholder",
    "FUSION.Join.Connecting",
    "FUSION.Join.LockedOut",
    "FUSION.Join.JoinWorld",
    "FUSION.Join.VersionMismatch",
    "FUSION.Join.ReloadPage",
  ];

  it("all join keys exist in pt-BR", () => {
    const missing = joinKeys.filter((k) => !(k in ptBRBundle));
    expect(missing, `Missing join keys in pt-BR: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all join keys exist in en", () => {
    const missing = joinKeys.filter((k) => !(k in enBundle));
    expect(missing, `Missing join keys in en: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8 — Management screen keys coverage (server up, no world open)
// ---------------------------------------------------------------------------

describe("Management screen keys coverage", () => {
  const managementKeys = [
    "FUSION.Management.Title",
    "FUSION.Management.Subtitle",
    "FUSION.Management.StepsTitle",
    "FUSION.Management.Step1Label",
    "FUSION.Management.Step2Label",
    "FUSION.Management.CopyCommand",
    "FUSION.Management.Copied",
    "FUSION.Management.SetupLink",
    "FUSION.Management.RetryButton",
  ];

  it("all management keys exist in pt-BR", () => {
    const missing = managementKeys.filter((k) => !(k in ptBRBundle));
    expect(missing, `Missing management keys in pt-BR: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all management keys exist in en", () => {
    const missing = managementKeys.filter((k) => !(k in enBundle));
    expect(missing, `Missing management keys in en: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9 — Connection and role keys coverage
// ---------------------------------------------------------------------------

describe("Connection and role keys coverage", () => {
  const statusKeys = [
    "FUSION.Connection.Connected",
    "FUSION.Connection.Connecting",
    "FUSION.Connection.Reconnecting",
    "FUSION.Connection.Disconnected",
    "FUSION.Connection.AuthFailed",
    "FUSION.Connection.ProtocolMismatch",
    "FUSION.Role.GM",
    "FUSION.Role.Assistant",
    "FUSION.Role.Trusted",
    "FUSION.Role.Player",
    "FUSION.Header.Leave",
    "FUSION.Header.Leaving",
    "FUSION.Header.CollapsePanel",
    "FUSION.Header.ExpandPanel",
  ];

  it("all connection/role keys exist in pt-BR", () => {
    const missing = statusKeys.filter((k) => !(k in ptBRBundle));
    expect(missing, `Missing status keys in pt-BR: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all connection/role keys exist in en", () => {
    const missing = statusKeys.filter((k) => !(k in enBundle));
    expect(missing, `Missing status keys in en: ${missing.join(", ")}`).toHaveLength(0);
  });
});
