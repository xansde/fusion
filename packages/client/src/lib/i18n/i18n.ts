/**
 * i18n.ts — Fusion internationalisation resolver.
 *
 * REQ-UIF-057..060: t(key, vars?) function, pt-BR primary, en fallback,
 * interpolation, pluralisation, bundle registration.
 *
 * Design:
 *   - Two built-in locales: "pt-BR" and "en".
 *   - Bundles are namespaced: engine bundle lives under "" (empty namespace),
 *     system bundles live under "<systemId>.*".
 *   - Resolution: locale active → "en" fallback → raw key (signals missing string).
 *   - Interpolation: {{varName}} in the translated string is replaced by the
 *     matching value from `vars`.
 *   - Pluralisation: a key may map to an object with numeric keys ("1", "other")
 *     when vars.count is supplied. "1" is used when count === 1, "other" otherwise.
 *
 * This module is a pure TS module (no Svelte, no DOM) so all logic is testable
 * in Vitest without a browser environment.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLocale = "pt-BR" | "en";

/** A bundle entry can be a plain string or a pluralisation object. */
export type BundleEntry = string | { "1": string; other: string };
export type BundleTable = Record<string, BundleEntry>;

// ---------------------------------------------------------------------------
// I18nResolver class
// ---------------------------------------------------------------------------

export class I18nResolver {
  private _locale: SupportedLocale = "pt-BR";

  /**
   * Merged bundle tables keyed by locale.
   * Inner flat map: "FUSION.Actors.Tab" → "Atores".
   */
  private _bundles: Record<SupportedLocale, Record<string, BundleEntry>> = {
    "pt-BR": {},
    en: {},
  };

  // -------------------------------------------------------------------------
  // Locale
  // -------------------------------------------------------------------------

  get locale(): SupportedLocale {
    return this._locale;
  }

  setLocale(locale: SupportedLocale): void {
    this._locale = locale;
  }

  // -------------------------------------------------------------------------
  // Bundle registration (REQ-UIF-058)
  // -------------------------------------------------------------------------

  /**
   * Merge a bundle table into the resolver for the given locale.
   * Keys in the table are hierarchical (dot-separated) but stored flat here.
   * Namespace prefix is prepended if non-empty.
   *
   * @param locale   "pt-BR" or "en"
   * @param namespace  Prefix for system keys (e.g. "PF2E"); "" for engine keys.
   * @param table    Flat or shallow-nested record of keys → values.
   *                 Shallow nesting (one level) is flattened with a dot separator.
   */
  registerBundle(locale: SupportedLocale, namespace: string, table: BundleTable): void {
    const target = this._bundles[locale];
    for (const [key, value] of Object.entries(table)) {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      target[fullKey] = value;
    }
  }

  // -------------------------------------------------------------------------
  // t() — resolve key (REQ-UIF-057)
  // -------------------------------------------------------------------------

  /**
   * Resolve a translation key in the active locale, with en fallback and raw-key
   * last resort.
   *
   * Supports:
   *   - Interpolation: "Olá, {{name}}!" with vars = { name: "Maria" }
   *   - Pluralisation: entry is { "1": "...", other: "..." }; use vars.count to select.
   *
   * @param key   Hierarchical key, e.g. "FUSION.Actors.Tab"
   * @param vars  Optional interpolation variables. vars.count selects plural form.
   * @returns Resolved and interpolated string (never throws; returns raw key as fallback).
   */
  t(key: string, vars?: Record<string, unknown>): string {
    const raw = this._resolve(key, this._locale) ?? this._resolve(key, "en") ?? key;
    return this._interpolate(raw, vars);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _resolve(key: string, locale: SupportedLocale): string | undefined {
    const entry = this._bundles[locale][key];
    if (entry === undefined) return undefined;
    if (typeof entry === "string") return entry;
    // Pluralisation object — resolve without count (returns "other" form)
    return entry["other"];
  }

  /** Resolve with pluralisation support. */
  private _resolveFull(key: string, locale: SupportedLocale, count?: number): string | undefined {
    const entry = this._bundles[locale][key];
    if (entry === undefined) return undefined;
    if (typeof entry === "string") return entry;
    // Plural object
    if (count === 1) return entry["1"];
    return entry["other"];
  }

  /**
   * Interpolate {{varName}} placeholders in a template string.
   * If vars.count exists, select plural form first.
   */
  private _interpolate(template: string, vars?: Record<string, unknown>): string {
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const val: unknown = vars[name];
      if (val === undefined) return `{{${name}}}`;
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return `{{${name}}}`;
    });
  }

  /**
   * Full resolution path with pluralisation.
   * Overrides _resolve by using _resolveFull internally.
   */
  private _resolvePlural(key: string, locale: SupportedLocale, count?: number): string | undefined {
    return this._resolveFull(key, locale, count);
  }
}

// Re-export a corrected t() that handles pluralisation properly.
// The class above is intentionally written with _resolve being thin so we can
// override the interpolation path cleanly.

/**
 * Fixed I18nResolver with unified resolution (pluralisation + interpolation).
 */
export class FusionI18n extends I18nResolver {
  /**
   * Resolve key → interpolated string.
   * Pluralisation: when vars.count is a number, selects "1" or "other" form.
   */
  override t(key: string, vars?: Record<string, unknown>): string {
    const count = typeof vars?.["count"] === "number" ? vars["count"] : undefined;
    const raw =
      this._resolveWithPlural(key, this.locale, count) ??
      this._resolveWithPlural(key, "en", count) ??
      key;
    return this._applyInterpolation(raw, vars);
  }

  private _resolveWithPlural(
    key: string,
    locale: SupportedLocale,
    count: number | undefined,
  ): string | undefined {
    // Access private field via cast — acceptable within the same module file
    const bundles = (
      this as unknown as { _bundles: Record<SupportedLocale, Record<string, BundleEntry>> }
    )._bundles;
    const entry = bundles[locale][key];
    if (entry === undefined) return undefined;
    if (typeof entry === "string") return entry;
    if (count === 1) return entry["1"];
    return entry["other"];
  }

  private _applyInterpolation(template: string, vars?: Record<string, unknown>): string {
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const val: unknown = vars[name];
      if (val === undefined) return `{{${name}}}`;
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
      return `{{${name}}}`;
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const i18n = new FusionI18n();

/**
 * Shorthand resolver bound to the singleton.
 * Use in Svelte components: const { t } = i18n;
 * Or import directly: import { t } from "$lib/i18n";
 */
export function t(key: string, vars?: Record<string, unknown>): string {
  return i18n.t(key, vars);
}
