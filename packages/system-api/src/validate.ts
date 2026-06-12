/**
 * validateSystemModule — contract test harness.
 *
 * REQ-SYS-110: The engine must provide a validateSystemModule(module) harness.
 * REQ-SYS-111: Every system in the monorepo must pass this as a CI gate.
 * REQ-SYS-011: Every subtype declared in manifest.documentTypes must have a model.
 *              Every model must have a corresponding declared subtype.
 */
import type { SystemModule } from "./system-module.js";

export interface ContractViolation {
  rule: string;
  message: string;
}

export interface ContractReport {
  ok: boolean;
  violations: ContractViolation[];
}

/**
 * Validate a SystemModule against the system API contract.
 *
 * Returns a ContractReport. If `ok` is false, `violations` contains all failing rules.
 */
export function validateSystemModule(module: SystemModule): ContractReport {
  const violations: ContractViolation[] = [];

  const { manifest, models } = module;

  // ─── REQ-SYS-003: manifest field presence ───────────────────────────────
  if (!manifest.id) {
    violations.push({ rule: "REQ-SYS-003", message: "manifest.id is required" });
  }
  if (!manifest.title) {
    violations.push({ rule: "REQ-SYS-003", message: "manifest.title is required" });
  }
  if (!manifest.version) {
    violations.push({ rule: "REQ-SYS-003", message: "manifest.version is required" });
  }
  if (!manifest.engineCompat) {
    violations.push({ rule: "REQ-SYS-003", message: "manifest.engineCompat is required" });
  }
  if (manifest.authors.length === 0) {
    violations.push({
      rule: "REQ-SYS-003",
      message: "manifest.authors must have at least one entry",
    });
  }

  // ─── REQ-SYS-011: every declared subtype must have a registered model ───
  const declaredSubtypes = new Set<string>();
  for (const [docType, subtypes] of Object.entries(manifest.documentTypes)) {
    for (const subtype of subtypes) {
      const key = `${docType}:${subtype}`;
      declaredSubtypes.add(key);
      if (!models.has(key)) {
        violations.push({
          rule: "REQ-SYS-011",
          message: `Subtype "${subtype}" declared for "${docType}" in manifest but no SystemDataModel registered`,
        });
      }
    }
  }

  // ─── REQ-SYS-011: every registered model must be declared in manifest ───
  for (const key of models.keys()) {
    if (!declaredSubtypes.has(key)) {
      violations.push({
        rule: "REQ-SYS-011",
        message: `Model registered for "${key}" but not declared in manifest.documentTypes`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
