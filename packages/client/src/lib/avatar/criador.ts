/**
 * The avatar creator's brain — pure, no DOM, no canvas.
 *
 * Everything the creation popup needs to decide WHAT to offer and WHAT the
 * player picked lives here, so it can be tested against the real acervo without
 * a browser: the tab/slot tree, the colour options of a piece, the selection
 * edits, and the round-trip to the document flag.
 *
 * Two labelling rules the acervo hands us and we must not undo:
 *   - every piece has `nome_ptbr` (627 of 627 in the pinned acervo) and the
 *     catalog carries pt-BR maps for slots and colour names. The UI shows those;
 *     the English `nome` is only a fallback.
 *   - a piece's `grupo` is already a pt-BR top-level label ("Cabelo", "Torso").
 *     It is the tab, and its order comes from the `grupos` priority tree rather
 *     than from insertion order, so two clients render the same tabs.
 */

import type { Catalogo, Escolha, Item, Selecao } from "waybuilder-avatar";
import type { AvatarFlag } from "@fusion/shared";
import { AVATAR_FORMAT_VERSION } from "@fusion/shared";
import { coresDoCanal, type PaletasCarregadas } from "./paletas.js";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function rotuloDoItem(item: Item): string {
  return item.nome_ptbr ?? item.nome;
}

export function rotuloDoSlot(catalogo: Catalogo, slot: string): string {
  return catalogo.slots?.[slot] ?? slot;
}

/** pt-BR name of a raw colour name (atlas band or palette ramp). */
export function rotuloDaCor(catalogo: Catalogo, nome: string): string {
  return catalogo.cores?.[nome] ?? nome;
}

export function rotuloDoCorpo(catalogo: Catalogo, corpo: string): string {
  return catalogo.cores?.[corpo] ?? CORPOS_PT[corpo] ?? corpo;
}

/**
 * Body-variant labels.
 *
 * The catalog does not carry these (its `cores` map is about colours), and the
 * raw values are English enum values the player should never see.
 */
const CORPOS_PT: Record<string, string> = {
  male: "Masculino",
  female: "Feminino",
  teen: "Adolescente",
  child: "Criança",
  muscular: "Musculoso",
  pregnant: "Grávida",
};

/**
 * Colour-channel labels in pt-BR.
 *
 * Keyed by channel name AND by the acervo's own `rotulo`, which comes from the
 * upstream generator and is therefore in English — the nine distinct ones in the
 * pinned acervo are all here. An unknown label falls through to the acervo's
 * text rather than to a raw key, so a future channel degrades to English instead
 * of to `hat_accessory_secondary`.
 */
const CANAIS_PT: Record<string, string> = {
  cor: "Cor",
  color_1: "Cor principal",
  "Eye Color": "Cor dos olhos",
  "Hair Band": "Faixa de cabelo",
  "Hair Tie": "Fita de cabelo",
  Handle: "Cabo",
  "Helmet Strands": "Tiras do elmo",
  "Inner Ear": "Orelha interna",
  "Kettle Inner": "Interior do chapéu",
  "Leather Armor Belt": "Cinto da armadura",
  "Legion Pattern": "Padrão da legião",
};

export function rotuloDoCanal(canal: { nome: string; rotulo?: string }): string {
  if (canal.rotulo !== undefined) return CANAIS_PT[canal.rotulo] ?? canal.rotulo;
  return CANAIS_PT[canal.nome] ?? canal.nome;
}

/** Animation labels for the preview picker. */
const ANIMACOES_PT: Record<string, string> = {
  idle: "Parado",
  combat_idle: "Em guarda",
  walk: "Andando",
  run: "Correndo",
  sit: "Sentado",
};

export function rotuloDaAnimacao(animacao: string): string {
  return ANIMACOES_PT[animacao] ?? animacao;
}

// ---------------------------------------------------------------------------
// Tab / slot tree
// ---------------------------------------------------------------------------

export interface SlotDoCriador {
  slot: string;
  rotulo: string;
  itens: Item[];
}

export interface AbaDoCriador {
  /** pt-BR group label — also the tab's identity. */
  grupo: string;
  slots: SlotDoCriador[];
  /** Total pieces under the tab, for the tab's counter. */
  total: number;
}

/** Priority of a piece's top-level path in the catalog's group tree. */
function prioridadeDoCaminho(catalogo: Catalogo, item: Item): number {
  const topo = item.caminho[0];
  if (topo === undefined) return Number.MAX_SAFE_INTEGER;
  return catalogo.grupos[topo]?.prioridade ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The creator's two-level navigation: tab per group, section per slot.
 *
 * Slots inside a tab are ordered by how much they offer (descending), then by
 * label: that puts `hair` (90 pieces) above `hairtie` (1) and `clothes` above
 * `jacket_pockets`, which is the order a player scans in. Ties break on the
 * label so the order is stable, never insertion-dependent.
 */
export function abasDoCatalogo(catalogo: Catalogo): AbaDoCriador[] {
  const porGrupo = new Map<string, { prioridade: number; slots: Map<string, Item[]> }>();

  for (const item of catalogo.itens) {
    let aba = porGrupo.get(item.grupo);
    if (aba === undefined) {
      aba = { prioridade: prioridadeDoCaminho(catalogo, item), slots: new Map() };
      porGrupo.set(item.grupo, aba);
    }
    aba.prioridade = Math.min(aba.prioridade, prioridadeDoCaminho(catalogo, item));
    const lista = aba.slots.get(item.slot);
    if (lista === undefined) aba.slots.set(item.slot, [item]);
    else lista.push(item);
  }

  const ordenadas = [...porGrupo.entries()].map(([grupo, dados]) => {
    const slots = [...dados.slots.entries()]
      .map(([slot, itens]) => ({
        slot,
        rotulo: rotuloDoSlot(catalogo, slot),
        itens: [...itens].sort((a, b) => rotuloDoItem(a).localeCompare(rotuloDoItem(b), "pt-BR")),
      }))
      .sort((a, b) => b.itens.length - a.itens.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
    return {
      grupo,
      slots,
      total: slots.reduce((soma, s) => soma + s.itens.length, 0),
      prioridade: dados.prioridade,
    };
  });

  ordenadas.sort((a, b) => a.prioridade - b.prioridade || a.grupo.localeCompare(b.grupo, "pt-BR"));
  return ordenadas.map(({ grupo, slots, total }) => ({ grupo, slots, total }));
}

/** Index pieces by id — the creator looks pieces up constantly. */
export function indexarItens(catalogo: Catalogo): Map<string, Item> {
  return new Map(catalogo.itens.map((i) => [i.id, i]));
}

/** True when this piece has no art for this body variant. */
export function semArteNoCorpo(item: Item, corpo: string): boolean {
  return (item.sem_arte ?? []).includes(corpo);
}

// ---------------------------------------------------------------------------
// Colour channels
// ---------------------------------------------------------------------------

export type TipoDeCor = "faixa" | "paleta";

export interface OpcaoDeCor {
  /** Value stored in the selection. Band name, or `<paleta>:<rampa>`. */
  valor: string;
  rotulo: string;
  /** Hex swatch for the button, or null when the acervo gives none. */
  amostra: string | null;
  tipo: TipoDeCor;
}

export interface CanalDoCriador {
  /** Channel key inside `escolha.cores`. */
  nome: string;
  rotulo: string;
  opcoes: OpcaoDeCor[];
  /**
   * Value used when the player picked nothing.
   *
   * For bands it is the first band — the acervo's renderer falls back to exactly
   * that. For palettes there is no default: the base art is already a colour, so
   * "nothing picked" is a real state and the picker must be able to show it.
   */
  padrao: string | null;
}

/** First layer of the piece that has art for this body. */
function varianteDoCorpo(item: Item, corpo: string) {
  for (const camada of item.camadas) {
    const variante = camada.corpos[corpo];
    if (variante !== undefined) return variante;
  }
  return undefined;
}

/**
 * The colour axes a piece offers on a given body.
 *
 * Two mechanisms coexist in the acervo and both land in `escolha.cores`:
 *
 *   bands    the atlas holds the piece pre-painted in N colours stacked on Y;
 *            picking one moves the source rectangle. Only the principal axis
 *            (`cor`) indexes the atlas.
 *   palettes `canais_de_cor`, recoloured at draw time — this is what gives skin
 *            and hair their colour (383 of 609 pieces).
 *
 * A channel whose material is `body` on a piece that follows the body's tone is
 * omitted: the renderer FORCES the inherited value, so offering a picker there
 * would be a control that does nothing.
 */
export function canaisDaPeca(
  catalogo: Catalogo,
  item: Item,
  corpo: string,
  paletas: PaletasCarregadas,
): CanalDoCriador[] {
  const canais: CanalDoCriador[] = [];
  const variante = varianteDoCorpo(item, corpo);
  const faixas = Object.keys(variante?.cores ?? {});

  const opcoesDeFaixa: OpcaoDeCor[] =
    faixas.length > 1
      ? faixas.map((nome) => ({
          valor: nome,
          rotulo: rotuloDaCor(catalogo, nome),
          amostra: variante?.amostras?.[nome] ?? null,
          tipo: "faixa" as const,
        }))
      : [];

  for (const canal of item.canais_de_cor ?? []) {
    // The body is the SOURCE of the skin tone, so its own picker stays even
    // though it is also flagged as following the body — the flag is what makes
    // face, ears and torso agree, and the body is the one that decides.
    if (item.slot !== "body" && item.segue_cor_do_corpo === true && canal.material === "body") continue;
    const opcoes = coresDoCanal(canal, paletas).map((cor) => ({
      valor: cor.valor,
      rotulo: rotuloDaCor(catalogo, cor.nome),
      amostra: cor.amostra,
      tipo: "paleta" as const,
    }));
    // The principal axis carries the atlas bands too, when the piece has both.
    const juntas = canal.nome === "cor" ? [...opcoesDeFaixa, ...opcoes] : opcoes;
    if (juntas.length === 0) continue;
    canais.push({
      nome: canal.nome,
      rotulo: rotuloDoCanal(canal),
      opcoes: juntas,
      padrao: canal.nome === "cor" ? (faixas[0] ?? null) : null,
    });
  }

  // Band-only piece: no channel declared, but the bands are still a colour axis.
  const temPrincipal = canais.some((c) => c.nome === "cor");
  if (!temPrincipal && opcoesDeFaixa.length > 0) {
    canais.unshift({
      nome: "cor",
      rotulo: rotuloDoCanal({ nome: "cor" }),
      opcoes: opcoesDeFaixa,
      padrao: faixas[0] ?? null,
    });
  }

  return canais;
}

/** Which value a channel's picker should show as selected. */
export function corSelecionada(
  selecao: Selecao,
  slot: string,
  canal: CanalDoCriador,
): string | null {
  return selecao[slot]?.cores?.[canal.nome] ?? canal.padrao;
}

// ---------------------------------------------------------------------------
// Selection edits — every one returns a NEW selection
// ---------------------------------------------------------------------------

/**
 * Equip a piece in its slot, or unequip when `id` is null.
 *
 * Colours are dropped on a swap, deliberately: they are keyed by CHANNEL, and
 * two pieces in the same slot rarely share channels — carrying `hat_secondary`
 * over to a piece that has no such axis leaves dead data in the document (the
 * bug the acervo's own `estado.cores` keyed-by-id had).
 */
export function trocarPeca(selecao: Selecao, slot: string, id: string | null): Selecao {
  const nova: Selecao = { ...selecao };
  if (id === null) delete nova[slot];
  else nova[slot] = { id };
  return nova;
}

/** Set one colour channel of the piece equipped in `slot`. */
export function definirCor(selecao: Selecao, slot: string, canal: string, valor: string): Selecao {
  const atual = selecao[slot];
  if (atual === undefined) return selecao;
  const escolha: Escolha = { ...atual, cores: { ...atual.cores, [canal]: valor } };
  return { ...selecao, [slot]: escolha };
}

/** Clear every equipped piece. */
export function limparSelecao(): Selecao {
  return {};
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Human head that fits this body variant, preferring the same-named one. */
function cabecaPadrao(catalogo: Catalogo, corpo: string): Item | undefined {
  const humanas = catalogo.itens.filter(
    (i) => i.slot === "head" && i.caminho.at(-1) === "human" && !semArteNoCorpo(i, corpo),
  );
  return humanas.find((i) => i.id === `head/human-${corpo}`) ?? humanas[0];
}

/**
 * A starting avatar that is visible and neutral.
 *
 * Body plus a human head plus the shadow: without a body the sprite is empty,
 * and without the head the face is missing (they are separate slots). The
 * shadow grounds the figure, which matters for the corner overlay where there
 * is no floor behind it.
 */
export function selecaoInicial(catalogo: Catalogo, corpo: string): Selecao {
  const selecao: Selecao = {};
  const sombra = catalogo.itens.find((i) => i.slot === "shadow" && !semArteNoCorpo(i, corpo));
  if (sombra !== undefined) selecao["shadow"] = { id: sombra.id };
  const corpoBase =
    catalogo.itens.find((i) => i.id === "body/body-color" && !semArteNoCorpo(i, corpo)) ??
    catalogo.itens.find((i) => i.slot === "body" && !semArteNoCorpo(i, corpo));
  if (corpoBase !== undefined) selecao["body"] = { id: corpoBase.id };
  const cabeca = cabecaPadrao(catalogo, corpo);
  if (cabeca !== undefined) selecao["head"] = { id: cabeca.id };
  return selecao;
}

/** Body variant to start from, when the flag has none or an unknown one. */
export function corpoPadrao(catalogo: Catalogo): string {
  return catalogo.recorte.corpos[0] ?? "male";
}

// ---------------------------------------------------------------------------
// Document flag round-trip
// ---------------------------------------------------------------------------

export interface SelecaoNormalizada {
  corpo: string;
  selecao: Selecao;
  /** Piece ids the catalog no longer has — the UI says so instead of hiding it. */
  descartados: string[];
}

/**
 * Bring a stored flag into the creator, dropping what the acervo cannot draw.
 *
 * An acervo bump can retire a piece id. The renderer already reports those as
 * orphan warnings at draw time, but the CREATOR has to go further and remove
 * them: otherwise the next save writes the dead id back and the avatar never
 * heals. Every drop is reported, never silent.
 */
export function normalizarSelecao(
  catalogo: Catalogo,
  flag: Pick<AvatarFlag, "corpo" | "selecao"> | null,
): SelecaoNormalizada {
  const porId = indexarItens(catalogo);
  const corpo =
    flag !== null && catalogo.recorte.corpos.includes(flag.corpo) ? flag.corpo : corpoPadrao(catalogo);

  if (flag === null) return { corpo, selecao: selecaoInicial(catalogo, corpo), descartados: [] };

  const selecao: Selecao = {};
  const descartados: string[] = [];
  for (const [slot, escolha] of Object.entries(flag.selecao)) {
    const item = porId.get(escolha.id);
    if (item === undefined) {
      descartados.push(escolha.id);
      continue;
    }
    // Trust the CATALOG's slot, not the stored key: a piece that moved slots
    // between acervo versions would otherwise be drawn in the old one and
    // silently stop being mutually exclusive with its real slot-mates.
    selecao[item.slot] = escolha.cores === undefined ? { id: item.id } : { id: item.id, cores: { ...escolha.cores } };
    if (item.slot !== slot) descartados.push(`${escolha.id} (slot ${slot} → ${item.slot})`);
  }
  return { corpo, selecao, descartados };
}

/** The flag to write on the Actor. */
export function paraFlag(catalogo: Catalogo, corpo: string, selecao: Selecao): AvatarFlag {
  return {
    versao: AVATAR_FORMAT_VERSION,
    corpo,
    selecao: Object.fromEntries(
      Object.entries(selecao).map(([slot, escolha]) => [
        slot,
        escolha.cores === undefined || Object.keys(escolha.cores).length === 0
          ? { id: escolha.id }
          : { id: escolha.id, cores: { ...escolha.cores } },
      ]),
    ),
    pin: catalogo.pin,
  };
}
