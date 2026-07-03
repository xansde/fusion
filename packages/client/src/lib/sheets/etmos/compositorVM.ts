/**
 * compositorVM.ts — View-model for the Compositor de Magias (Etmos).
 *
 * All the guided-composition logic (design doc m5-etmos-compositor.md §3.2)
 * lives here — the Svelte component (Compositor.svelte) only renders and
 * forwards user events. Mirrors the CharacterSheetVM pattern (pf2e): a cheap,
 * stateless-per-construction class recreated whenever the underlying Actor
 * document changes; the VM's OWN slot selection state lives in the Svelte
 * component as $state (the VM is reconstructed with that state each render,
 * same "controlled component" split used by other Fusion VMs).
 *
 * Steps (design doc §3.2, REQ-ETM-027):
 *   (a) Função        — 1, single-select, from the Orador's Grimório
 *   (b) Objeto(s)      — >=1, multi-select
 *   (c) Características — 0+, multi-select ORDERED (order feeds montarFrase)
 *   (d) Complementos   — Criadores (Ada-/No-/Mut-/Ag) require a target
 *                        selection; Modificadores are simple toggles
 *   (e) Intenção       — free text
 *   (f) preview ao vivo — frase_completa via montarFrase(), validarFrase()
 *       for immediate feedback, cost-per-Complexidade estimate marking tiers
 *       above complexidadeMaxima(mente).
 *
 * IMPORTANT: validarFrase()/montarFrase() run here ONLY for client feedback.
 * The server re-validates authoritatively when the frase is proposed
 * (packages/server/src/etmos/conjuracao-handlers.ts, buildConjuracaoProporHandler)
 * — this VM's validation NEVER gates the "Propor ao Narrador" button beyond a
 * simple UX nicety (disabled-while-invalid), and the server is free to reject
 * a frase this VM considered válida (e.g. a stale/re-imported Grimório).
 *
 * Design doc m5-etmos-compositor.md §3.2/§3.5. Spec 19-sistema-etmos.md
 * REQ-ETM-027/028. Golden fixtures §5 (G1-G10, CA-8).
 */

import {
  montarFrase,
  validarFrase,
  custoEstresse,
  complexidadeMaxima,
  PARTICULAS_SYNTAX,
  getComplementoSyntax,
  PREFIX_OBJETO_SLUG,
  CONNECTOR_SLUG,
  PREFIX_CARACTERISTICA_SLUGS,
} from "@fusion/system-etmos";
import type {
  FraseMagicaSystem,
  CriadorAplicado,
  Complexidade,
  GrimorioView,
} from "@fusion/system-etmos";
import type { GrimorioParticulaRow } from "./oradorSheetVM.js";

// ---------------------------------------------------------------------------
// Grimório entry — a resolved Partícula from the Orador's embedded Items.
// Re-uses OradorSheetVM's row shape (oradorSheetVM.ts's GrimorioParticulaRow)
// as the single source of truth for "what a Grimório entry looks like" so D1
// (fichas) and D2 (compositor) never drift on field names.
// ---------------------------------------------------------------------------

export type GrimorioParticula = GrimorioParticulaRow & {
  readonly palavra: string;
};

/** Reads the Orador's Grimório (embedded `particula` Items) from the raw Actor doc. */
export function readGrimorio(doc: Record<string, unknown>): GrimorioParticula[] {
  const items = doc["items"];
  if (!Array.isArray(items)) return [];
  const out: GrimorioParticula[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item["type"] !== "particula") continue;
    const sys = (item["system"] as Record<string, unknown> | undefined) ?? {};
    const slug = typeof sys["slug"] === "string" ? sys["slug"] : "";
    if (slug.length === 0) continue;
    const categoria = sys["categoria"];
    if (
      categoria !== "funcao" &&
      categoria !== "objeto" &&
      categoria !== "caracteristica" &&
      categoria !== "complemento"
    ) {
      continue;
    }
    const subtipo = sys["subtipo_complemento"];
    const palavra = typeof sys["palavra_etmos"] === "string" ? sys["palavra_etmos"] : slug;
    out.push({
      itemId: typeof item["_id"] === "string" ? item["_id"] : "",
      slug,
      palavraEtmos: palavra,
      palavra,
      categoria,
      significado: typeof sys["significado"] === "string" ? sys["significado"] : "",
      subtipoComplemento: subtipo === "modificador" || subtipo === "criador" ? subtipo : null,
      nivelGrimorio: typeof sys["nivel_grimorio"] === "number" ? sys["nivel_grimorio"] : null,
      iconeRunico: typeof sys["icone_runico"] === "string" ? sys["icone_runico"] : null,
    });
  }
  return out;
}

/**
 * The caster's overall Grimório level — the HIGHEST nivel_grimorio among the
 * Complemento Partículas actually present in the Grimório (level-1
 * Complementos are available by default per design doc §2.2 note 4, so an
 * empty/absent set of higher-level Complementos still yields level >= 1).
 */
export function grimorioLevel(particulas: readonly GrimorioParticula[]): number {
  let max = 1;
  for (const p of particulas) {
    if (p.categoria === "complemento" && p.nivelGrimorio !== null && p.nivelGrimorio > max) {
      max = p.nivelGrimorio;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Slot selection state — owned by the Svelte component ($state), passed in
// on every VM construction (same split as CharacterSheetVM's props).
// ---------------------------------------------------------------------------

export interface CompositorSlots {
  /** 0, 1 (valid) or >=2 (multiplasFuncoes) — transient multi-select before collapse. */
  funcaoSlugsSelecionados: string[];
  objetoSlugs: string[];
  caracteristicaSlugs: string[];
  criadores: CriadorAplicado[];
  modificadorSlugs: string[];
  intencao: string;
}

export function emptySlots(): CompositorSlots {
  return {
    funcaoSlugsSelecionados: [],
    objetoSlugs: [],
    caracteristicaSlugs: [],
    criadores: [],
    modificadorSlugs: [],
    intencao: "",
  };
}

// ---------------------------------------------------------------------------
// UI-facing rows
// ---------------------------------------------------------------------------

export interface ParticulaOption {
  readonly slug: string;
  readonly palavra: string;
  readonly significado: string;
  readonly selected: boolean;
  /** false when the caster's Grimório level is below the Complemento's requirement. */
  readonly disponivel: boolean;
}

export interface ComplementoOption extends ParticulaOption {
  readonly subtipo: "modificador" | "criador";
  readonly ligacao: "prefix" | "connector" | "suffix";
  readonly nivelGrimorio: number;
}

/** A target option for a Criador being configured (dropdown, design doc §3.2/R5). */
export interface AlvoOption {
  readonly index: number;
  readonly label: string;
}

export interface CustoPreview {
  readonly complexidade: Complexidade;
  readonly custo: number;
  readonly excedeMaxima: boolean;
}

export interface FrasePreviewToken {
  readonly text: string;
  readonly categoria: "funcao" | "objeto" | "caracteristica" | "complemento";
}

const COMPLEXIDADES_ORDEM: readonly Complexidade[] = [
  "trivial",
  "regular",
  "dificil",
  "complexa",
  "milagre",
];

// ---------------------------------------------------------------------------
// Op payload sent to server — mirrors CharacterSheetVM's typed payload pattern.
// ---------------------------------------------------------------------------

export interface EtmosConjuracaoProporOp {
  type: "etmos:conjuracao:propor";
  conjuradorActorId: string;
  frase: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CompositorVM
// ---------------------------------------------------------------------------

export class CompositorVM {
  private readonly _doc: Record<string, unknown>;
  private readonly _actorId: string;
  private readonly _rankTotem: number;
  private readonly _mente: number;
  readonly slots: CompositorSlots;
  readonly grimorio: readonly GrimorioParticula[];

  constructor(opts: { doc: Record<string, unknown>; actorId: string; slots: CompositorSlots }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this.slots = opts.slots;
    this.grimorio = readGrimorio(opts.doc);

    const sys = (opts.doc["system"] as Record<string, unknown> | undefined) ?? {};
    const totem = sys["totem"] as Record<string, unknown> | undefined;
    this._rankTotem = typeof totem?.["rank"] === "number" ? totem["rank"] : 0;
    const atributos = sys["atributos"] as Record<string, unknown> | undefined;
    const mente = atributos?.["mente"] as Record<string, unknown> | undefined;
    this._mente = typeof mente?.["value"] === "number" ? mente["value"] : 1;
  }

  // -------------------------------------------------------------------------
  // Grimório views by category
  // -------------------------------------------------------------------------

  private _byCategoria(categoria: GrimorioParticula["categoria"]): GrimorioParticula[] {
    return this.grimorio.filter((p) => p.categoria === categoria);
  }

  get grimorioLevel(): number {
    return grimorioLevel(this.grimorio);
  }

  /** Step (a) — Função options, single-select. */
  get funcaoOptions(): ParticulaOption[] {
    return this._byCategoria("funcao").map((p) => ({
      slug: p.slug,
      palavra: p.palavra,
      significado: p.significado,
      selected: this.slots.funcaoSlugsSelecionados.includes(p.slug),
      disponivel: true,
    }));
  }

  /** Step (b) — Objeto options, multi-select. */
  get objetoOptions(): ParticulaOption[] {
    return this._byCategoria("objeto").map((p) => ({
      slug: p.slug,
      palavra: p.palavra,
      significado: p.significado,
      selected: this.slots.objetoSlugs.includes(p.slug),
      disponivel: true,
    }));
  }

  /** Step (c) — Característica options, multi-select ordered. */
  get caracteristicaOptions(): ParticulaOption[] {
    return this._byCategoria("caracteristica").map((p) => ({
      slug: p.slug,
      palavra: p.palavra,
      significado: p.significado,
      selected: this.slots.caracteristicaSlugs.includes(p.slug),
      disponivel: true,
    }));
  }

  /** Step (d) — Complemento options (both Criadores and Modificadores), gated by Grimório level. */
  get complementoOptions(): ComplementoOption[] {
    const level = this.grimorioLevel;
    return this._byCategoria("complemento").map((p) => {
      const syntax = getComplementoSyntax(p.slug);
      const nivel = syntax?.nivelGrimorio ?? p.nivelGrimorio ?? 1;
      const isCriador = syntax?.subtipo === "criador";
      const selected = isCriador
        ? this.slots.criadores.some((c) => c.slug === p.slug)
        : this.slots.modificadorSlugs.includes(p.slug);
      return {
        slug: p.slug,
        palavra: p.palavra,
        significado: p.significado,
        subtipo: syntax?.subtipo ?? p.subtipoComplemento ?? "modificador",
        ligacao: syntax?.ligacao ?? "suffix",
        nivelGrimorio: nivel,
        selected,
        disponivel: level >= nivel,
      };
    });
  }

  /** Criador Complementos currently applied, for rendering their target selector. */
  get criadoresAplicados(): readonly CriadorAplicado[] {
    return this.slots.criadores;
  }

  /**
   * Valid target options for a `prefix` Criador (Ada-/No-): every currently
   * selected Característica index. `Mut-` is prefix too but targets an
   * Objeto-as-Característica — see mutAlvoOptions.
   */
  prefixAlvoOptions(): AlvoOption[] {
    return this.slots.caracteristicaSlugs.map((slug, index) => ({
      index,
      label: this._palavra(slug),
    }));
  }

  /**
   * `Mut-` targets an Objeto used as a Característica. In the slot model
   * (item-frase-magica.ts docstring) that Objeto is represented as an entry
   * appended to caracteristica_slugs carrying the Objeto's slug — so the UI
   * offers the Objeto options directly; picking one both appends it to
   * caracteristica_slugs (via applyCriador) AND records the criador.
   */
  get objetoOptionsForMut(): ParticulaOption[] {
    return this.objetoOptions;
  }

  /** Valid target PAIRS for the `connector` Criador (Ag) — distinct index pairs. */
  connectorAlvoOptions(): Array<{ a: number; b: number; label: string }> {
    const out: Array<{ a: number; b: number; label: string }> = [];
    const slugs = this.slots.caracteristicaSlugs;
    for (let a = 0; a < slugs.length; a++) {
      for (let b = a + 1; b < slugs.length; b++) {
        const slugA = slugs[a] ?? "";
        const slugB = slugs[b] ?? "";
        out.push({ a, b, label: `${this._palavra(slugA)} + ${this._palavra(slugB)}` });
      }
    }
    return out;
  }

  private _palavra(slug: string): string {
    const p = this.grimorio.find((g) => g.slug === slug);
    return p?.palavra ?? slug;
  }

  // -------------------------------------------------------------------------
  // Preview ao vivo — frase_completa + validation + cost estimate
  // -------------------------------------------------------------------------

  /** The single Função slug once exactly 1 is selected, else "". */
  private get _funcaoSlug(): string {
    return this.slots.funcaoSlugsSelecionados.length === 1
      ? (this.slots.funcaoSlugsSelecionados[0] ?? "")
      : "";
  }

  private get _fraseSlotsForCompute(): Pick<
    FraseMagicaSystem,
    "funcao_slug" | "objeto_slugs" | "caracteristica_slugs" | "criadores" | "modificador_slugs"
  > {
    return {
      funcao_slug: this._funcaoSlug,
      objeto_slugs: this.slots.objetoSlugs,
      caracteristica_slugs: this.slots.caracteristicaSlugs,
      criadores: this.slots.criadores,
      modificador_slugs: this.slots.modificadorSlugs,
    };
  }

  private _resolvePalavra = (slug: string): string => this._palavra(slug);

  /** frase_completa preview — CA-8: Et + Imu -> "Etimu". */
  get fraseCompleta(): string {
    if (this._funcaoSlug.length === 0 || this.slots.objetoSlugs.length === 0) {
      // montarFrase tolerates empty funcao/objeto — still expose a partial
      // preview so the UI shows progress even before both are chosen.
      return montarFrase(this._fraseSlotsForCompute, this._resolvePalavra);
    }
    return montarFrase(this._fraseSlotsForCompute, this._resolvePalavra);
  }

  /** Colored tokens for FrasePreview.svelte (placeholder tipográfico, D7). */
  get fraseTokens(): FrasePreviewToken[] {
    const words = this.fraseCompleta.split(" ").filter((w) => w.length > 0);
    // Best-effort categoria tagging: núcleo (Função+Objeto fused) is "funcao",
    // remaining objeto words are "objeto", the rest characteristics/complementos
    // are inferred by matching against known modificador/criador palavras.
    return words.map((word, idx) => ({
      text: word,
      categoria: this._inferTokenCategoria(word, idx),
    }));
  }

  private _inferTokenCategoria(word: string, idx: number): FrasePreviewToken["categoria"] {
    if (idx === 0) return "funcao";
    const lower = word.toLowerCase();
    for (const entry of PARTICULAS_SYNTAX) {
      const bare = entry.palavra.replace(/-$/, "").toLowerCase();
      if (lower === bare.toLowerCase() || lower.endsWith(bare.toLowerCase())) {
        return "complemento";
      }
    }
    // Extra Objeto words come right after the núcleo, before Características —
    // approximate: if it matches a known objeto slug's palavra, tag "objeto".
    const isObjetoWord = this._byCategoria("objeto").some((p) => p.palavra.toLowerCase() === lower);
    if (isObjetoWord) return "objeto";
    return "caracteristica";
  }

  /** Live syntax validation (client-side feedback ONLY — see module docstring). */
  get validacao(): { valido: boolean; erros: string[]; avisos: string[] } {
    const grimorioView: GrimorioView = {
      hasSlug: (slug: string) => this.grimorio.some((p) => p.slug === slug),
      grimorioLevel: this.grimorioLevel,
    };

    // Rule 1 needs the transient multi-select BEFORE it collapses to a single
    // slot — surface "multiplasFuncoes"/"semFuncao" precisely (G9/G10).
    if (this.slots.funcaoSlugsSelecionados.length !== 1) {
      const erros: string[] = [];
      if (this.slots.funcaoSlugsSelecionados.length === 0) {
        erros.push("etmos.compositor.erro.semFuncao");
      } else {
        erros.push("etmos.compositor.erro.multiplasFuncoes");
      }
      if (this.slots.objetoSlugs.length === 0) {
        erros.push("etmos.compositor.erro.semObjeto");
      }
      return { valido: false, erros, avisos: [] };
    }

    return validarFrase(this._fraseSlotsForCompute, grimorioView);
  }

  get intencaoValida(): boolean {
    return this.slots.intencao.trim().length > 0;
  }

  /** True when the frase can be proposed (syntax valid AND Intenção declared). */
  get podePropor(): boolean {
    return this.validacao.valido && this.intencaoValida;
  }

  /** Cost estimate per Complexidade tier, marking those above complexidadeMaxima(mente). */
  get custoPreview(): CustoPreview[] {
    const maxima = complexidadeMaxima(this._mente);
    const maximaIdx = COMPLEXIDADES_ORDEM.indexOf(maxima);
    return COMPLEXIDADES_ORDEM.map((c, idx) => ({
      complexidade: c,
      custo: custoEstresse(c, this._rankTotem),
      excedeMaxima: idx > maximaIdx,
    }));
  }

  get complexidadeMaxima(): Complexidade {
    return complexidadeMaxima(this._mente);
  }

  // -------------------------------------------------------------------------
  // Slot mutation helpers — return a NEW CompositorSlots (immutable, mirrors
  // aplicar()'s "never mutate" convention). The Svelte component assigns the
  // result to its $state slots.
  // -------------------------------------------------------------------------

  toggleFuncao(slug: string): CompositorSlots {
    const has = this.slots.funcaoSlugsSelecionados.includes(slug);
    return {
      ...this.slots,
      funcaoSlugsSelecionados: has
        ? this.slots.funcaoSlugsSelecionados.filter((s) => s !== slug)
        : [...this.slots.funcaoSlugsSelecionados, slug],
    };
  }

  /** Single-select convenience — replaces the whole Função selection with `slug`. */
  selectFuncao(slug: string): CompositorSlots {
    return { ...this.slots, funcaoSlugsSelecionados: [slug] };
  }

  toggleObjeto(slug: string): CompositorSlots {
    const has = this.slots.objetoSlugs.includes(slug);
    return {
      ...this.slots,
      objetoSlugs: has
        ? this.slots.objetoSlugs.filter((s) => s !== slug)
        : [...this.slots.objetoSlugs, slug],
    };
  }

  toggleCaracteristica(slug: string): CompositorSlots {
    const has = this.slots.caracteristicaSlugs.includes(slug);
    if (has) {
      const removedIndex = this.slots.caracteristicaSlugs.indexOf(slug);
      return {
        ...this.slots,
        caracteristicaSlugs: this.slots.caracteristicaSlugs.filter((s) => s !== slug),
        // Drop any Criador that targeted the removed index; re-index the rest.
        criadores: reindexCriadoresAfterRemoval(this.slots.criadores, removedIndex),
      };
    }
    return {
      ...this.slots,
      caracteristicaSlugs: [...this.slots.caracteristicaSlugs, slug],
    };
  }

  /** Reorder a Característica (drag or up/down buttons — design doc §3.2 step c). */
  moveCaracteristica(fromIndex: number, toIndex: number): CompositorSlots {
    const list = [...this.slots.caracteristicaSlugs];
    if (
      fromIndex < 0 ||
      fromIndex >= list.length ||
      toIndex < 0 ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return this.slots;
    }
    const [item] = list.splice(fromIndex, 1);
    if (item === undefined) return this.slots; // unreachable given the range guard above
    list.splice(toIndex, 0, item);
    return {
      ...this.slots,
      caracteristicaSlugs: list,
      // Criador targets are index-based — remap old->new position.
      criadores: remapCriadoresAfterMove(this.slots.criadores, fromIndex, toIndex),
    };
  }

  toggleModificador(slug: string): CompositorSlots {
    const has = this.slots.modificadorSlugs.includes(slug);
    return {
      ...this.slots,
      modificadorSlugs: has
        ? this.slots.modificadorSlugs.filter((s) => s !== slug)
        : [...this.slots.modificadorSlugs, slug],
    };
  }

  /**
   * Apply (or replace) a `prefix` Criador (Ada-/No-) targeting a
   * Característica index (design doc §3.2/R5 — UI-guided target selection).
   */
  applyPrefixCriador(slug: string, alvoIndex: number): CompositorSlots {
    const withoutSameCriador = this.slots.criadores.filter((c) => c.slug !== slug);
    return {
      ...this.slots,
      criadores: [...withoutSameCriador, { slug, alvo: alvoIndex }],
    };
  }

  /**
   * Apply `Mut-` targeting an Objeto: appends the Objeto slug to
   * caracteristica_slugs (per the slot model — item-frase-magica.ts
   * docstring) and records the Criador targeting that new index.
   */
  applyMutCriador(objetoSlug: string): CompositorSlots {
    const newIndex = this.slots.caracteristicaSlugs.length;
    const withoutMut = this.slots.criadores.filter((c) => c.slug !== PREFIX_OBJETO_SLUG);
    return {
      ...this.slots,
      caracteristicaSlugs: [...this.slots.caracteristicaSlugs, objetoSlug],
      criadores: [...withoutMut, { slug: PREFIX_OBJETO_SLUG, alvo: newIndex }],
    };
  }

  /** Apply the `connector` Criador (Ag) linking two DISTINCT Característica indices. */
  applyConnectorCriador(a: number, b: number): CompositorSlots {
    const withoutAg = this.slots.criadores.filter((c) => c.slug !== CONNECTOR_SLUG);
    return {
      ...this.slots,
      criadores: [...withoutAg, { slug: CONNECTOR_SLUG, alvo: [a, b] }],
    };
  }

  removeCriador(slug: string): CompositorSlots {
    return {
      ...this.slots,
      criadores: this.slots.criadores.filter((c) => c.slug !== slug),
    };
  }

  setIntencao(text: string): CompositorSlots {
    return { ...this.slots, intencao: text };
  }

  reset(): CompositorSlots {
    return emptySlots();
  }

  // -------------------------------------------------------------------------
  // Emit — build the etmos:conjuracao:propor op (REQ-ETM-027, design doc §3.3)
  // -------------------------------------------------------------------------

  buildProporOp(): EtmosConjuracaoProporOp {
    const frase: FraseMagicaSystem = {
      funcao_slug: this._funcaoSlug,
      objeto_slugs: this.slots.objetoSlugs,
      caracteristica_slugs: this.slots.caracteristicaSlugs,
      criadores: this.slots.criadores,
      modificador_slugs: this.slots.modificadorSlugs,
      intencao: this.slots.intencao,
      frase_completa: this.fraseCompleta,
      complexidade: null,
      estresse_gerado: 0,
      favorita: false,
    };
    return {
      type: "etmos:conjuracao:propor",
      conjuradorActorId: this._actorId,
      frase,
    };
  }
}

// ---------------------------------------------------------------------------
// Criador index bookkeeping — pure helpers used by the mutation methods above
// ---------------------------------------------------------------------------

function reindexCriadoresAfterRemoval(
  criadores: readonly CriadorAplicado[],
  removedIndex: number,
): CriadorAplicado[] {
  const out: CriadorAplicado[] = [];
  for (const c of criadores) {
    if (typeof c.alvo === "number") {
      if (c.alvo === removedIndex) continue; // dropped — its target vanished
      out.push({ slug: c.slug, alvo: c.alvo > removedIndex ? c.alvo - 1 : c.alvo });
    } else {
      const [a, b] = c.alvo;
      if (a === removedIndex || b === removedIndex) continue;
      out.push({
        slug: c.slug,
        alvo: [a > removedIndex ? a - 1 : a, b > removedIndex ? b - 1 : b],
      });
    }
  }
  return out;
}

function remapIndex(index: number, fromIndex: number, toIndex: number): number {
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex) {
    // item moved down/right: indices strictly between shift left by 1
    if (index > fromIndex && index <= toIndex) return index - 1;
    return index;
  }
  // fromIndex > toIndex: item moved up/left: indices in [toIndex, fromIndex) shift right by 1
  if (index >= toIndex && index < fromIndex) return index + 1;
  return index;
}

function remapCriadoresAfterMove(
  criadores: readonly CriadorAplicado[],
  fromIndex: number,
  toIndex: number,
): CriadorAplicado[] {
  return criadores.map((c) => {
    if (typeof c.alvo === "number") {
      return { slug: c.slug, alvo: remapIndex(c.alvo, fromIndex, toIndex) };
    }
    const [a, b] = c.alvo;
    return {
      slug: c.slug,
      alvo: [remapIndex(a, fromIndex, toIndex), remapIndex(b, fromIndex, toIndex)] as [
        number,
        number,
      ],
    };
  });
}

// Re-exported for the Svelte component's target-selector UI (design doc R5).
export { PREFIX_OBJETO_SLUG, CONNECTOR_SLUG, PREFIX_CARACTERISTICA_SLUGS };
