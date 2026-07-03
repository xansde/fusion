/**
 * oradorSheetVM.ts — Pure view-model for the Etmos Orador Sheet.
 *
 * Mirrors the PF2e `CharacterSheetVM` pattern (packages/client/src/lib/sheets/pf2e/characterSheetVM.ts):
 * 100% testable TypeScript, no PIXI/Svelte/browser APIs. The Svelte component
 * (OradorSheet.svelte) imports this and stays thin — all logic lives here.
 *
 * Derived values (limiteFerimentos/limiteEstresse/complexidadeMaxima/
 * estadoFadiga) are NEVER recomputed here — they are read from
 * `system.<field>` as already written by the server's DeriveSteps
 * (systems/etmos/src/derivations/orador.ts, REQ-ETM-007..010). The VM only
 * IMPORTS the pure functions from `@fusion/system-etmos` for display-time
 * helpers that are genuinely presentational (e.g. `complexidadeLabel`) — it
 * never duplicates a formula that already runs server-side.
 *
 * Clean-room. Etmos RPG is a Editora Balde Galáctico / Rafa Reis property —
 * no proprietary prose here, only mechanical identifiers (already committed
 * in packs-src/*.json and the schemas under systems/etmos/src/schemas).
 *
 * REQ-ETM-006..014, REQ-ETM-042/043, REQ-ETM-051 (i18n).
 * Spec: 19-sistema-etmos.md. Design doc: docs/design/m5-etmos-compositor.md §4.1/§4.3.
 */

import type { Complexidade, EstadoFadiga } from "@fusion/system-etmos";
import { todasTrilhasCompletas, opcoesProgressao } from "@fusion/system-etmos";
import type { OpcaoProgressao } from "@fusion/system-etmos";

// ---------------------------------------------------------------------------
// Op payloads sent to server (mirrors characterSheetVM.ts's DocUpdatePayload)
// ---------------------------------------------------------------------------

export interface DocUpdatePayload {
  type: "doc:update";
  documentType: string;
  id: string;
  diff: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Marcos de Crescimento / Tabela E level-up op (REQ-ETM-038, CA-11) — mirrors
// the server's EtmosProgressaoConfirmarPayload shape 1:1 (progressao-handler.ts).
// ---------------------------------------------------------------------------

export type BonusEscolhido =
  | { tipo: "atributo"; atributo: TrilhaAtributo }
  | { tipo: "items"; itemIds: string[] };

export interface EtmosProgressaoConfirmarOp {
  type: "etmos:progressao:confirmar";
  actorId: string;
  fisica: BonusEscolhido;
  mental: BonusEscolhido;
  emocional: BonusEscolhido;
}

// ---------------------------------------------------------------------------
// Document accessor helpers
// ---------------------------------------------------------------------------

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"];
  return typeof sys === "object" && sys !== null ? (sys as Record<string, unknown>) : {};
}

function getObj(
  obj: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj?.[key];
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

function getNumber(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const v = obj?.[key];
  return typeof v === "number" ? v : fallback;
}

function getBool(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const v = obj?.[key];
  return typeof v === "boolean" ? v : fallback;
}

function getString(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Display labels (presentational only — i18n keys resolved by the component)
// ---------------------------------------------------------------------------

/** i18n key suffix for a Complexidade value — component composes "etmos.complexidade.<key>". */
export function complexidadeI18nKey(c: Complexidade): string {
  return c;
}

/** i18n key suffix for an EstadoFadiga value — component composes "etmos.fadiga.<key>". */
export function fadigaI18nKey(estado: EstadoFadiga): string {
  return estado;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type TrilhaAtributo = "corpo" | "alma" | "mente";

export interface AtributoRow {
  slug: TrilhaAtributo;
  value: number;
  max: number;
}

export interface RecursoRow {
  atual: number;
  limite: number;
}

export interface GrimorioParticulaRow {
  /** Embedded Item _id — needed for remove/edit ops. */
  itemId: string;
  slug: string;
  palavraEtmos: string;
  categoria: "funcao" | "objeto" | "caracteristica" | "complemento";
  significado: string;
  nivelGrimorio: number | null;
  subtipoComplemento: "modificador" | "criador" | null;
  iconeRunico: string | null;
}

export interface GrimorioGrouped {
  funcao: GrimorioParticulaRow[];
  objeto: GrimorioParticulaRow[];
  caracteristica: GrimorioParticulaRow[];
  complemento: GrimorioParticulaRow[];
}

// ---------------------------------------------------------------------------
// OradorSheetVM
// ---------------------------------------------------------------------------

/**
 * View-model for the Etmos Orador Sheet.
 *
 * Constructed with the live document + caller context (ownership, userId).
 * The Svelte component creates a new VM whenever the document changes
 * (`$derived`), exactly like CharacterSheetVM.
 */
export class OradorSheetVM {
  private readonly _doc: Record<string, unknown>;
  private readonly _actorId: string;
  private readonly _ownership: number;
  private readonly _userId: string;
  private readonly _isGm: boolean;

  constructor(opts: {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
  }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this._ownership = opts.ownership;
    this._userId = opts.userId;
    this._isGm = opts.isGm;
  }

  // -------------------------------------------------------------------------
  // Permission
  // -------------------------------------------------------------------------

  /** True if this user can edit the sheet (OWNER or GM). OwnershipLevel.OWNER = 3. */
  get editable(): boolean {
    return this._isGm || this._ownership >= 3;
  }

  // -------------------------------------------------------------------------
  // Document accessors
  // -------------------------------------------------------------------------

  get name(): string {
    const raw = this._doc["name"];
    return typeof raw === "string" ? raw : "Orador";
  }

  get img(): string | null {
    const raw = this._doc["img"];
    return typeof raw === "string" ? raw : null;
  }

  private get _system(): Record<string, unknown> {
    return getSystem(this._doc);
  }

  // -------------------------------------------------------------------------
  // Basic info
  // -------------------------------------------------------------------------

  get nivel(): number {
    return getNumber(this._system, "nivel", 1);
  }

  get especie(): string {
    return getString(this._system, "especie", "");
  }

  get mundoOrigem(): "mundano" | "fantastico" {
    const v = this._system["mundo_origem"];
    return v === "fantastico" ? "fantastico" : "mundano";
  }

  get playerName(): string {
    return getString(this._system, "player_name", "");
  }

  get anoEscolar(): string {
    return getString(this._system, "ano_escolar", "");
  }

  get idade(): number {
    return getNumber(this._system, "idade", 0);
  }

  // -------------------------------------------------------------------------
  // Atributos — 3 trilhas 1..6 (Corpo/Alma/Mente)
  // -------------------------------------------------------------------------

  get atributos(): AtributoRow[] {
    const atributos = getObj(this._system, "atributos");
    return (["corpo", "alma", "mente"] as const).map((slug) => {
      const raw = getObj(atributos, slug);
      return {
        slug,
        value: getNumber(raw, "value", 1),
        max: getNumber(raw, "max", 6),
      };
    });
  }

  atributo(slug: TrilhaAtributo): AtributoRow {
    return this.atributos.find((a) => a.slug === slug) ?? { slug, value: 1, max: 6 };
  }

  // -------------------------------------------------------------------------
  // Derivados READ-ONLY — written server-side by DeriveSteps (REQ-ETM-007..010).
  // Never recomputed here.
  // -------------------------------------------------------------------------

  get ferimentos(): RecursoRow {
    const r = getObj(this._system, "ferimentos");
    return { atual: getNumber(r, "atual", 0), limite: getNumber(r, "limite", 4) };
  }

  get estresse(): RecursoRow {
    const r = getObj(this._system, "estresse");
    return { atual: getNumber(r, "atual", 0), limite: getNumber(r, "limite", 5) };
  }

  get complexidadeMaxima(): Complexidade {
    const v = this._system["complexidade_maxima"];
    return (typeof v === "string" ? v : "regular") as Complexidade;
  }

  get estadoFadiga(): EstadoFadiga {
    const fadiga = getObj(this._system, "fadiga");
    const v = fadiga?.["estado"];
    return (typeof v === "string" ? v : "normal") as EstadoFadiga;
  }

  // -------------------------------------------------------------------------
  // Dados de Empenho (REQ-ETM: contador + "novo dia" reset — R7 manual button)
  // -------------------------------------------------------------------------

  get dadosEmpenho(): number {
    const d = getObj(this._system, "dados_empenho");
    return getNumber(d, "atual", 0);
  }

  // -------------------------------------------------------------------------
  // Totem — REQ-ETM-042/043
  // -------------------------------------------------------------------------

  get temTotem(): boolean {
    const t = getObj(this._system, "totem");
    return getBool(t, "possui", false);
  }

  get rankTotem(): number {
    const t = getObj(this._system, "totem");
    return getNumber(t, "rank", 0);
  }

  // -------------------------------------------------------------------------
  // Conceito — narrative-only, no mechanical effect (Q4)
  // -------------------------------------------------------------------------

  get conceitoBasico(): string {
    const c = getObj(this._system, "conceito");
    return getString(c, "basico", "");
  }

  get conceitoAparencia(): string {
    const c = getObj(this._system, "conceito");
    return getString(c, "aparencia", "");
  }

  get conceitoPontosImportancia(): string {
    const c = getObj(this._system, "conceito");
    return getString(c, "pontos_importancia", "");
  }

  get conceitoFuturo(): string {
    const c = getObj(this._system, "conceito");
    return getString(c, "futuro", "");
  }

  // -------------------------------------------------------------------------
  // Marcos de Crescimento — trilhas 5x3 + Tabela E level-up (REQ-ETM-035..039,
  // CA-11). The pure decision logic (todasTrilhasCompletas/opcoesProgressao)
  // lives in @fusion/system-etmos — this VM only reads document state and
  // exposes it; the actual level-up write is server-authoritative
  // (etmos:progressao:confirmar, packages/server/src/etmos/progressao-handler.ts).
  // -------------------------------------------------------------------------

  get marcos(): {
    fisicos: { value: number; max: number };
    mentais: { value: number; max: number };
    emocionais: { value: number; max: number };
  } {
    const m = getObj(this._system, "marcos_crescimento");
    const track = (key: string): { value: number; max: number } => {
      const t = getObj(m, key);
      return { value: getNumber(t, "value", 0), max: getNumber(t, "max", 5) };
    };
    return {
      fisicos: track("fisicos"),
      mentais: track("mentais"),
      emocionais: track("emocionais"),
    };
  }

  /** True when the 3 Marcos trilhas are all completas (5/5/5) — REQ-ETM-037. */
  get podeSubirDeNivel(): boolean {
    return todasTrilhasCompletas(this.marcos);
  }

  /** The Tabela E row for the current nivel's transition, or null at nivel 6 (max). */
  get opcaoProgressao(): OpcaoProgressao | null {
    return opcoesProgressao(this.nivel);
  }

  // -------------------------------------------------------------------------
  // Grimório — embedded Item `particula` grouped by categoria
  // -------------------------------------------------------------------------

  get grimorio(): GrimorioGrouped {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const grouped: GrimorioGrouped = {
      funcao: [],
      objeto: [],
      caracteristica: [],
      complemento: [],
    };
    if (!items) return grouped;

    for (const item of items) {
      if (item["type"] !== "particula") continue;
      const sys = getSystem(item);
      const categoria = sys["categoria"];
      if (
        categoria !== "funcao" &&
        categoria !== "objeto" &&
        categoria !== "caracteristica" &&
        categoria !== "complemento"
      ) {
        continue;
      }
      const rawId = item["_id"];
      const row: GrimorioParticulaRow = {
        itemId: typeof rawId === "string" ? rawId : "",
        slug: getString(sys, "slug", ""),
        palavraEtmos: getString(sys, "palavra_etmos", ""),
        categoria,
        significado: getString(sys, "significado", ""),
        nivelGrimorio: typeof sys["nivel_grimorio"] === "number" ? sys["nivel_grimorio"] : null,
        subtipoComplemento:
          sys["subtipo_complemento"] === "modificador" || sys["subtipo_complemento"] === "criador"
            ? sys["subtipo_complemento"]
            : null,
        iconeRunico: typeof sys["icone_runico"] === "string" ? sys["icone_runico"] : null,
      };
      grouped[categoria].push(row);
    }
    return grouped;
  }

  /** Set<slug> of every Partícula in the Grimório — used by the Compositor (D2) to validate locally. */
  get grimorioSlugs(): Set<string> {
    const g = this.grimorio;
    const all = [...g.funcao, ...g.objeto, ...g.caracteristica, ...g.complemento];
    return new Set(all.map((p) => p.slug));
  }

  get hasParticulas(): boolean {
    const g = this.grimorio;
    return g.funcao.length + g.objeto.length + g.caracteristica.length + g.complemento.length > 0;
  }

  // -------------------------------------------------------------------------
  // Op builders — called by Svelte component to build sendOp payloads
  // -------------------------------------------------------------------------

  /**
   * Build a doc:update op to set a field value (autosave binding).
   * @param path  Dot-path relative to the document root (e.g. "system.atributos.corpo.value").
   */
  fieldUpdate(path: string, value: unknown): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: { [path]: value },
    };
  }

  /** Apply a delta to Ferimentos, clamped to [0, limite]. */
  applyFerimentosDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const r = this.ferimentos;
    const next = Math.max(0, Math.min(r.atual + delta, r.limite));
    return this.fieldUpdate("system.ferimentos.atual", next);
  }

  /** Apply a delta to Estresse. Not clamped to `limite` — Estresse can exceed it (Fadiga, REQ-ETM-010/012). */
  applyEstresseDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const r = this.estresse;
    const next = Math.max(0, r.atual + delta);
    return this.fieldUpdate("system.estresse.atual", next);
  }

  /** "Novo dia" — resets Dados de Empenho to 0 (R7: manual button, no fictional clock). */
  resetDadosEmpenho(): DocUpdatePayload | null {
    if (!this.editable) return null;
    return this.fieldUpdate("system.dados_empenho.atual", 0);
  }

  /** Increment/decrement Dados de Empenho (spend/gain during play). */
  applyDadosEmpenhoDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const next = Math.max(0, this.dadosEmpenho + delta);
    return this.fieldUpdate("system.dados_empenho.atual", next);
  }

  /** Toggle Totem possession flag. */
  setTemTotem(value: boolean): DocUpdatePayload | null {
    return this.fieldUpdate("system.totem.possui", value);
  }

  /** Set Totem rank (0..5). */
  setRankTotem(value: number): DocUpdatePayload | null {
    const clamped = Math.max(0, Math.min(5, Math.round(value)));
    return this.fieldUpdate("system.totem.rank", clamped);
  }

  /** Set an Atributo trilha (Corpo/Alma/Mente), clamped 1..6 (D2: Orador min 1). */
  setAtributo(slug: TrilhaAtributo, value: number): DocUpdatePayload | null {
    const clamped = Math.max(1, Math.min(6, Math.round(value)));
    return this.fieldUpdate(`system.atributos.${slug}.value`, clamped);
  }

  /** Toggle a Marco checkbox at `index` (0-based) within a trilha, clamping to a click-to-set-value UX (like HP pips). */
  setMarcoValue(
    categoria: "fisicos" | "mentais" | "emocionais",
    value: number,
  ): DocUpdatePayload | null {
    const max = this.marcos[categoria].max;
    const clamped = Math.max(0, Math.min(max, Math.round(value)));
    return this.fieldUpdate(`system.marcos_crescimento.${categoria}.value`, clamped);
  }

  /**
   * Build the etmos:progressao:confirmar op for a level-up (REQ-ETM-038,
   * CA-11). Returns null when `podeSubirDeNivel` is false or the Actor is
   * already at nivel 6 (opcaoProgressao is null) — callers should gate the
   * "Subir de Nível" button on those getters directly, but this guard makes
   * the op-builder itself safe against a stale click.
   */
  buildProgressaoConfirmarOp(
    fisica: BonusEscolhido,
    mental: BonusEscolhido,
    emocional: BonusEscolhido,
  ): EtmosProgressaoConfirmarOp | null {
    if (!this.podeSubirDeNivel || this.opcaoProgressao === null) return null;
    return {
      type: "etmos:progressao:confirmar",
      actorId: this._actorId,
      fisica,
      mental,
      emocional,
    };
  }

  /**
   * Singleton key for the Compositor window tied to this Orador — used with
   * windowManager.open({ singletonKey }) so only one Compositor per actor is
   * open at a time (design doc §3.1).
   */
  get compositorSingletonKey(): string {
    return `compositor:${this._actorId}`;
  }

  get userId(): string {
    return this._userId;
  }
}
