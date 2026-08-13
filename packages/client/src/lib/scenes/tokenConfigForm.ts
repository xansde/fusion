/**
 * tokenConfigForm.ts — what the token config dialog SENDS when the GM saves.
 *
 * Pure TS, no Svelte — which is the point. The dialog itself cannot be mounted
 * in this repo's test setup (there is no jsdom), so as long as the patch was
 * built inline in the component, "does Save actually carry this field" was a
 * question nothing could answer. It had already been answered wrong once: the
 * whole dialog saved to a wire shape the server rejects, so vision, light and
 * bars silently never persisted.
 *
 * Spec: `06-canvas-e-renderizacao.md` REQ-CNV-089/090 (bars) and REQ-CNV-093
 * (the actor-link control and its no-clearing rule), `07-visao-…`
 * REQ-VIS-060..062/040/041 (vision and light), `02-modelo-de-dados.md`
 * REQ-DOC-031 (`actorLink` — "does this token keep its own sheet").
 */

import type { TokenDisplayMode } from "@fusion/shared";
import type { TokenPatch } from "./tokenController.js";

/** The dialog's fields, as the user left them — strings included, as typed. */
export interface TokenConfigFormValues {
  readonly name: string;
  readonly texture: string | null;
  /** REQ-DOC-031: `true` shares the world Actor, `false` gives this token its own. */
  readonly actorLink: boolean;

  readonly visionEnabled: boolean;
  /** Raw text: blank means "unlimited", not zero. */
  readonly visionRange: string;
  readonly visionAngle: number;
  readonly visionMode: "basic" | "darkvision";

  readonly lightEnabled: boolean;
  readonly lightBright: string;
  readonly lightDim: string;
  readonly lightColor: string;
  readonly lightIntensity: number;

  /** Raw text: blank means "no bar", and must reach the server as `null`. */
  readonly bar1Attribute: string;
  readonly bar2Attribute: string;
  readonly displayBars: TokenDisplayMode;
}

/** Blank text is the absence of a value, not the empty string. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A number the user may not have typed. Blank → `null` (unlimited range). */
function optionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A number that must exist. Anything unparseable falls back to `fallback`. */
function requiredNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Build the patch for `tokenController.updateToken`.
 *
 * Plain token fields, never dot-paths: the server addresses an embedded Token
 * by `{ documentType: "Token", embedded: { type: "Token", id: sceneId } }` and
 * rejects a Scene update carrying `tokens.<id>.<field>` outright.
 *
 * `actorDelta` is deliberately absent from the patch even when re-linking. The
 * link is a reversible decision; clearing the delta on the way through would
 * silently discard this token's own hit points with no way to get them back.
 */
export function buildTokenConfigPatch(form: TokenConfigFormValues): TokenPatch {
  return {
    name: form.name,
    texture: form.texture,
    actorLink: form.actorLink,
    vision: {
      enabled: form.visionEnabled,
      range: optionalNumber(form.visionRange),
      angle: form.visionAngle,
      visionMode: form.visionMode,
    },
    light: {
      enabled: form.lightEnabled,
      bright: requiredNumber(form.lightBright, 0),
      dim: requiredNumber(form.lightDim, 0),
      color: form.lightColor,
      intensity: form.lightIntensity,
    },
    bar1: { attribute: blankToNull(form.bar1Attribute) },
    bar2: { attribute: blankToNull(form.bar2Attribute) },
    displayBars: form.displayBars,
  };
}
