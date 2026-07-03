/**
 * antagonistaSheetVM.ts — Pure view-model for the Etmos Antagonista Sheet.
 *
 * Mirrors oradorSheetVM.ts / the PF2e CharacterSheetVM pattern: 100% testable
 * TypeScript, no PIXI/Svelte/browser APIs.
 *
 * Delta vs. Orador (design doc §4.2):
 *   - Atributos may be 0 (no AtributoSchema min(1) — bare integers, no `.value`/`.max`).
 *   - Ferimentos/Estresse/Complexidade/Movimentação are EDITABLE fixed statblock
 *     values (NOT derived formulas) — Ficha Base (`simples`/`intermediaria`/
 *     `avancada`) only pre-fills sensible defaults; the GM can freely edit.
 *   - Aptidões: free list `{ nome, descricao }`.
 *   - Ataques: free list `{ nome, ferimentos, defesa, alcance, descricao }` with
 *     EXACT damage (REQ-ETM-050 SRD exception) applicable to a target actor's
 *     Ferimentos tracker.
 *   - No Compositor — antagonistas do not compose frases in the MVP.
 *
 * REQ-ETM-002, REQ-ETM-049, REQ-ETM-050.
 * Spec: 19-sistema-etmos.md. Design doc: docs/design/m5-etmos-compositor.md §4.2.
 */

// ---------------------------------------------------------------------------
// Op payloads sent to server
// ---------------------------------------------------------------------------

export interface DocUpdatePayload {
  type: "doc:update";
  documentType: string;
  id: string;
  diff: Record<string, unknown>;
}

export type TargetHpApplyPayload = DocUpdatePayload;

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

function getString(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FichaBase = "simples" | "intermediaria" | "avancada";
export type DefesaAtaque = "completa" | "parcial" | "ineficaz" | "contestada" | null;

export interface AntagonistaAtaqueRow {
  index: number;
  nome: string;
  ferimentos: number | null;
  defesa: DefesaAtaque;
  alcance: string;
  descricao: string;
}

export interface AntagonistaAptidaoRow {
  index: number;
  nome: string;
  descricao: string;
}

export interface RecursoRow {
  atual: number;
  limite: number;
}

export type TrilhaAtributo = "corpo" | "alma" | "mente";

// ---------------------------------------------------------------------------
// AntagonistaSheetVM
// ---------------------------------------------------------------------------

export class AntagonistaSheetVM {
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

  get editable(): boolean {
    return this._isGm || this._ownership >= 3; // OwnershipLevel.OWNER = 3
  }

  // -------------------------------------------------------------------------
  // Document accessors
  // -------------------------------------------------------------------------

  get name(): string {
    const raw = this._doc["name"];
    return typeof raw === "string" ? raw : "Antagonista";
  }

  get img(): string | null {
    const raw = this._doc["img"];
    return typeof raw === "string" ? raw : null;
  }

  private get _system(): Record<string, unknown> {
    return getSystem(this._doc);
  }

  get fichaBase(): FichaBase {
    const v = this._system["ficha_base"];
    return v === "intermediaria" || v === "avancada" ? v : "simples";
  }

  // -------------------------------------------------------------------------
  // Editable statblock values (NOT derived — REQ-ETM-049)
  // -------------------------------------------------------------------------

  get ferimentos(): RecursoRow {
    const r = getObj(this._system, "ferimentos");
    return { atual: getNumber(r, "atual", 0), limite: getNumber(r, "limite", 4) };
  }

  get estresse(): RecursoRow {
    const r = getObj(this._system, "estresse");
    return { atual: getNumber(r, "atual", 0), limite: getNumber(r, "limite", 4) };
  }

  get complexidadeMaxima(): string {
    const v = this._system["complexidade_maxima"];
    return typeof v === "string" ? v : "regular";
  }

  get movimentacao(): number {
    return getNumber(this._system, "movimentacao", 6);
  }

  get comunicacao(): boolean {
    return this._system["comunicacao"] === true;
  }

  /** Atributos podem ser 0 (bare integers, no {value,max} wrapper — schema delta vs Orador). */
  get atributos(): Record<TrilhaAtributo, number> {
    const atributos = getObj(this._system, "atributos");
    return {
      corpo: getNumber(atributos, "corpo", 0),
      alma: getNumber(atributos, "alma", 0),
      mente: getNumber(atributos, "mente", 0),
    };
  }

  // -------------------------------------------------------------------------
  // Aptidões — free list
  // -------------------------------------------------------------------------

  get aptidoes(): AntagonistaAptidaoRow[] {
    const raw = this._system["aptidoes"];
    if (!Array.isArray(raw)) return [];
    return raw.map((a, index) => {
      const obj = a as Record<string, unknown>;
      return {
        index,
        nome: getString(obj, "nome", ""),
        descricao: getString(obj, "descricao", ""),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Ataques — REQ-ETM-050 (exact damage exception)
  // -------------------------------------------------------------------------

  get ataques(): AntagonistaAtaqueRow[] {
    const raw = this._system["ataques"];
    if (!Array.isArray(raw)) return [];
    return raw.map((a, index) => {
      const obj = a as Record<string, unknown>;
      const defesaRaw = obj["defesa"];
      const defesa: DefesaAtaque =
        defesaRaw === "completa" ||
        defesaRaw === "parcial" ||
        defesaRaw === "ineficaz" ||
        defesaRaw === "contestada"
          ? defesaRaw
          : null;
      return {
        index,
        nome: getString(obj, "nome", ""),
        ferimentos: typeof obj["ferimentos"] === "number" ? obj["ferimentos"] : null,
        defesa,
        alcance: getString(obj, "alcance", ""),
        descricao: getString(obj, "descricao", ""),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Op builders
  // -------------------------------------------------------------------------

  fieldUpdate(path: string, value: unknown): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: { [path]: value },
    };
  }

  applyFerimentosDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const r = this.ferimentos;
    const next = Math.max(0, Math.min(r.atual + delta, r.limite));
    return this.fieldUpdate("system.ferimentos.atual", next);
  }

  applyEstresseDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const r = this.estresse;
    const next = Math.max(0, r.atual + delta);
    return this.fieldUpdate("system.estresse.atual", next);
  }

  setAtributo(slug: TrilhaAtributo, value: number): DocUpdatePayload | null {
    // Antagonistas may have Atributo 0 (D2 — no min(1) unlike Orador).
    const clamped = Math.max(0, Math.round(value));
    return this.fieldUpdate(`system.atributos.${slug}`, clamped);
  }

  setFichaBase(value: FichaBase): DocUpdatePayload | null {
    return this.fieldUpdate("system.ficha_base", value);
  }

  setMovimentacao(value: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.movimentacao", Math.max(0, value));
  }

  setComunicacao(value: boolean): DocUpdatePayload | null {
    return this.fieldUpdate("system.comunicacao", value);
  }

  setFerimentosLimite(value: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.ferimentos.limite", Math.max(0, Math.round(value)));
  }

  setEstresseLimite(value: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.estresse.limite", Math.max(0, Math.round(value)));
  }

  setComplexidadeMaxima(value: string): DocUpdatePayload | null {
    return this.fieldUpdate("system.complexidade_maxima", value);
  }

  // --- Aptidões CRUD (whole-array replace — simplest safe diff for a small free list) ---

  addAptidao(): DocUpdatePayload | null {
    if (!this.editable) return null;
    const next = [
      ...this.aptidoes.map(({ nome, descricao }) => ({ nome, descricao })),
      { nome: "", descricao: "" },
    ];
    return this.fieldUpdate("system.aptidoes", next);
  }

  updateAptidao(
    index: number,
    field: "nome" | "descricao",
    value: string,
  ): DocUpdatePayload | null {
    if (!this.editable) return null;
    const list = this.aptidoes.map(({ nome, descricao }) => ({ nome, descricao }));
    const current = list[index];
    if (index < 0 || index >= list.length || !current) return null;
    list[index] = {
      nome: field === "nome" ? value : current.nome,
      descricao: field === "descricao" ? value : current.descricao,
    };
    return this.fieldUpdate("system.aptidoes", list);
  }

  removeAptidao(index: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const list = this.aptidoes.map(({ nome, descricao }) => ({ nome, descricao }));
    if (index < 0 || index >= list.length) return null;
    list.splice(index, 1);
    return this.fieldUpdate("system.aptidoes", list);
  }

  // --- Ataques CRUD ---

  addAtaque(): DocUpdatePayload | null {
    if (!this.editable) return null;
    const next = [
      ...this.ataques.map(({ nome, ferimentos, defesa, alcance, descricao }) => ({
        nome,
        ferimentos,
        defesa,
        alcance,
        descricao,
      })),
      { nome: "", ferimentos: null, defesa: null, alcance: "", descricao: "" },
    ];
    return this.fieldUpdate("system.ataques", next);
  }

  updateAtaque(
    index: number,
    field: "nome" | "ferimentos" | "defesa" | "alcance" | "descricao",
    value: string | number | null,
  ): DocUpdatePayload | null {
    if (!this.editable) return null;
    const list = this.ataques.map(({ nome, ferimentos, defesa, alcance, descricao }) => ({
      nome,
      ferimentos,
      defesa,
      alcance,
      descricao,
    }));
    const current = list[index];
    if (index < 0 || index >= list.length || !current) return null;
    list[index] = {
      nome: field === "nome" ? (value as string) : current.nome,
      ferimentos: field === "ferimentos" ? (value as number | null) : current.ferimentos,
      defesa: field === "defesa" ? (value as DefesaAtaque) : current.defesa,
      alcance: field === "alcance" ? (value as string) : current.alcance,
      descricao: field === "descricao" ? (value as string) : current.descricao,
    };
    return this.fieldUpdate("system.ataques", list);
  }

  removeAtaque(index: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const list = this.ataques.map(({ nome, ferimentos, defesa, alcance, descricao }) => ({
      nome,
      ferimentos,
      defesa,
      alcance,
      descricao,
    }));
    if (index < 0 || index >= list.length) return null;
    list.splice(index, 1);
    return this.fieldUpdate("system.ataques", list);
  }

  /**
   * Build a doc:update op that applies an Ataque's exact `ferimentos` damage
   * to a TARGET actor's Ferimentos tracker (REQ-ETM-050 — antagonistas may
   * declare exact damage, applied via the existing combat tracker rather than
   * a roll). Caller supplies the target's current Ferimentos (read from the
   * target's own VM/doc) since this VM only knows the attacker's data.
   */
  static buildApplyDamageToTarget(
    targetActorId: string,
    targetFerimentosAtual: number,
    targetFerimentosLimite: number,
    ataque: AntagonistaAtaqueRow,
  ): TargetHpApplyPayload | null {
    if (ataque.ferimentos === null) return null;
    const next = Math.min(targetFerimentosAtual + ataque.ferimentos, targetFerimentosLimite);
    return {
      type: "doc:update",
      documentType: "Actor",
      id: targetActorId,
      diff: { "system.ferimentos.atual": next },
    };
  }

  get userId(): string {
    return this._userId;
  }
}
