/**
 * i18n barrel — Fusion internationalisation public API.
 *
 * Usage:
 *   import { t, i18n } from "$lib/i18n";
 *   import ptBR from "$lib/i18n/pt-BR.json";
 *
 * The singleton i18n instance is pre-loaded with the pt-BR and en bundles
 * at import time so that t() works out of the box without explicit setup.
 */

export { i18n, t, FusionI18n, I18nResolver } from "./i18n.js";
export type { SupportedLocale, BundleEntry, BundleTable } from "./i18n.js";

// Pre-load bundles — import is synchronous (JSON via Vite/Node ESM)
import { i18n } from "./i18n.js";
import ptBR from "./pt-BR.json" assert { type: "json" };
import en from "./en.json" assert { type: "json" };

i18n.registerBundle("pt-BR", "", ptBR);
i18n.registerBundle("en", "", en);
