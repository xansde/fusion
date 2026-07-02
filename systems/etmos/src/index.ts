/**
 * @fusion/system-etmos — Etmos RPG game system.
 *
 * Registers the Actor subtypes `orador`/`antagonista` and the Item subtypes
 * `particula`/`habilidade`/`origem`/`totem`/`item_encantado`/`frase_magica`,
 * plus the M5-A extension surfaces this system NEEDS (unlike PF2e/SF2e which
 * don't use them): `rollData` (E1), `degreeOfSuccess` (E2), and
 * `effectsMaterializer` (E4 — returns an empty list so Etmos actors NEVER
 * fall back to the derive-runner's 2e-family `collectEffects`, per M5-B
 * batch instructions).
 *
 * Etmos does NOT depend on `@fusion/engine-2e`: its degree-of-success is a
 * binary conjunto próprio (D6), not the 4-degree PF2e/SF2e helper — see
 * `compositor/degree.ts`.
 *
 * THIS BATCH (M5-B / B1) scope: schemas + defineSystem + pack build only.
 * NO sheets, NO UI, NO server wiring (M5-C/D). Initiative formula
 * registration (REQ-ETM-022, `compare`) is also OUT of scope for B1 — it
 * belongs to M5-E per the design doc's batch plan; this module does not call
 * `registerInitiativeFormula` yet.
 *
 * Clean-room implementation. Etmos RPG is a Editora Balde Galáctico / Rafa
 * Reis property — no proprietary prose or art is included; only mechanical
 * identifiers (Etmos words/slugs already committed in packs-src/*.json).
 *
 * Spec: 19-sistema-etmos.md. Design doc: docs/design/m5-etmos-compositor.md.
 * REQ-ETM-001..003, REQ-ETM-015 (E1), D6 (E2), M5-A E4.
 */

import { defineSystem } from "@fusion/system-api";

// Schemas — actors
import { OradorSystemSchema } from "./schemas/actor-orador.js";
import { AntagonistaSystemSchema } from "./schemas/actor-antagonista.js";

// Schemas — items
import { ParticulaSystemSchema } from "./schemas/item-particula.js";
import { HabilidadeSystemSchema } from "./schemas/item-habilidade.js";
import { OrigemSystemSchema } from "./schemas/item-origem.js";
import { TotemSystemSchema } from "./schemas/item-totem.js";
import { ItemEncantadoSystemSchema } from "./schemas/item-encantado.js";
import { FraseMagicaSystemSchema } from "./schemas/item-frase-magica.js";

// Compositor pure functions (degree-of-success binário próprio — D6). The
// pre-shaped `DegreeOfSuccessDefinition` adapter is registered as-is — a
// single source of truth, so the registered compute() and the one exported
// from degree.ts never diverge (they used to: this module previously
// re-implemented compute() inline, dropping `classeDificuldade` from meta).
import { etmosDegreeOfSuccessDefinition } from "./compositor/degree.js";

// Derivation steps (Orador: limites, complexidade máxima, fadiga)
import { registerDerivations } from "./derivations/index.js";

// ---------------------------------------------------------------------------
// defineSystem
// ---------------------------------------------------------------------------

export const etmosSystem = defineSystem(
  {
    id: "etmos",
    title: "Etmos RPG",
    version: "0.1.0",
    engineCompat: ">=0.1.0",
    authors: [{ name: "Fusion Engine Team" }],
    documentTypes: {
      Actor: ["orador", "antagonista"],
      Item: ["particula", "habilidade", "origem", "totem", "item_encantado", "frase_magica"],
    },
    languages: [{ lang: "pt-BR", name: "Português (Brasil)", path: "lang/pt-BR.json" }],
  },

  (registrar) => {
    // -----------------------------------------------------------------------
    // Actor schemas — REQ-ETM-001, REQ-ETM-002
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Actor",
      subtype: "orador",
      schema: OradorSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "antagonista",
      schema: AntagonistaSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Item schemas — REQ-ETM-003, REQ-ETM-046
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Item",
      subtype: "particula",
      schema: ParticulaSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "habilidade",
      schema: HabilidadeSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "origem",
      schema: OrigemSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "totem",
      schema: TotemSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "item_encantado",
      schema: ItemEncantadoSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "frase_magica",
      schema: FraseMagicaSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Roll data (M5-A E1, REQ-ETM-015) — exposes atributos.corpo/alma/mente
    // for `@atributos.corpo.value` etc. formula substitution (spec 19
    // §Dependências: "@atributos.corpo.value" namespace, NOT "@abilities.corpo").
    //
    // Orador's `atributos.<attr>` is `{ value, max }` (AtributoSchema,
    // schemas/actor-orador.ts), so it round-trips as-is: `@atributos.corpo.value`.
    // Antagonista's `atributos.<attr>` is a bare integer (AtributoAntagonistaSchema,
    // schemas/actor-antagonista.ts — antagonistas may be 0, no `.value`/`.max`
    // wrapper) — REQ-ETM-050 "2d6 + atributo" formulas for antagonistas resolve
    // `@atributos.corpo` directly, NOT `@atributos.corpo.value`. Both subtypes
    // are covered here since both roll 2d6+Atributo tests (REQ-ETM-015/016/049/050).
    //
    // Habilidade bônus (also named in REQ-ETM-015, "bônus de Habilidade") is NOT
    // covered here: it requires aggregating embedded Item `habilidade` documents
    // on the Actor (cross-document lookup), which is a server/embedded-items
    // concern out of scope for this batch's pure per-document rollData builder —
    // left as an explicit pending item for M5-C (ficha/server wiring).
    // -----------------------------------------------------------------------

    registrar.rollData({
      documentType: "Actor",
      subtypes: ["orador", "antagonista"],
      build(doc) {
        const system = doc["system"] as Record<string, unknown> | undefined;
        const atributos = system?.["atributos"];
        return { atributos: atributos ?? {} };
      },
    });

    // -----------------------------------------------------------------------
    // Degree of success (M5-A E2, D6) — Etmos's OWN binary success/failure
    // set + margem, registered independently of PF2e/SF2e's 4-degree helper.
    // -----------------------------------------------------------------------

    registrar.degreeOfSuccess(etmosDegreeOfSuccessDefinition);

    // -----------------------------------------------------------------------
    // Effects materializer (M5-A E4) — Etmos has no effects engine yet;
    // returning an EMPTY list (not omitting registration) ensures actors of
    // this system NEVER fall back to the derive-runner's 2e-family
    // `collectEffects` fallback (see M5-A E4 docstring in registries.ts).
    // -----------------------------------------------------------------------

    registrar.effectsMaterializer({
      documentType: "Actor",
      subtypes: ["orador", "antagonista"],
      build() {
        return [];
      },
    });

    // -----------------------------------------------------------------------
    // Derivation steps — Orador (REQ-ETM-007..010, REQ-SYS-020).
    // Limite de Ferimentos/Estresse, Complexidade Máxima, Estado de Fadiga.
    // -----------------------------------------------------------------------

    registerDerivations(registrar);
  },
);

// ---------------------------------------------------------------------------
// Public API re-exports
// ---------------------------------------------------------------------------

// Types / enums
export * from "./types.js";

// Particulas syntax table
export * from "./particulas-syntax.js";

// Actor schemas
export {
  OradorSystemSchema,
  parseOradorSystem,
  OradorAtributosSchema,
  OradorFadigaSchema,
  OradorDadosEmpenhoSchema,
  OradorTotemFlagSchema,
  OradorMarcosCrescimentoSchema,
  OradorConceitoSchema,
} from "./schemas/actor-orador.js";
export type { OradorSystem } from "./schemas/actor-orador.js";

export {
  AntagonistaSystemSchema,
  parseAntagonistaSystem,
  FichaBaseSchema,
  AntagonistaAtaqueSchema,
  AntagonistaAptidaoSchema,
  AntagonistaAtributosSchema,
  DefesaAtaqueSchema,
} from "./schemas/actor-antagonista.js";
export type {
  AntagonistaSystem,
  FichaBase,
  AntagonistaAtaque,
  AntagonistaAptidao,
} from "./schemas/actor-antagonista.js";

// Item schemas
export { ParticulaSystemSchema, parseParticulaSystem } from "./schemas/item-particula.js";
export type { ParticulaSystem } from "./schemas/item-particula.js";

export {
  HabilidadeSystemSchema,
  parseHabilidadeSystem,
  HabilidadeCategoriaSchema,
} from "./schemas/item-habilidade.js";
export type { HabilidadeSystem, HabilidadeCategoria } from "./schemas/item-habilidade.js";

export {
  OrigemSystemSchema,
  parseOrigemSystem,
  OrigemMundoAssociadoSchema,
} from "./schemas/item-origem.js";
export type { OrigemSystem, OrigemMundoAssociado } from "./schemas/item-origem.js";

export { TotemSystemSchema, parseTotemSystem } from "./schemas/item-totem.js";
export type { TotemSystem } from "./schemas/item-totem.js";

export {
  ItemEncantadoSystemSchema,
  parseItemEncantadoSystem,
  GrauSofisticacaoSchema,
  VeiculoEncantamentoSchema,
} from "./schemas/item-encantado.js";
export type {
  ItemEncantadoSystem,
  GrauSofisticacao,
  VeiculoEncantamento,
} from "./schemas/item-encantado.js";

export {
  FraseMagicaSystemSchema,
  parseFraseMagicaSystem,
  CriadorAplicadoSchema,
} from "./schemas/item-frase-magica.js";
export type { FraseMagicaSystem, CriadorAplicado } from "./schemas/item-frase-magica.js";

export {
  ConjuracaoCardSchema,
  parseConjuracaoCard,
  ControleFadigaSchema,
} from "./schemas/conjuracao-card.js";
export type { ConjuracaoCard, ControleFadiga } from "./schemas/conjuracao-card.js";

// Compositor pure functions
export * from "./compositor/degree.js";
export * from "./compositor/custo.js";
export * from "./compositor/validar-frase.js";
export * from "./compositor/montar-frase.js";

// Derivation steps (Orador)
export * from "./derivations/index.js";
