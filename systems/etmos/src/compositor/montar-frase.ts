/**
 * @fusion/system-etmos — montarFrase() (montagem determinística da frase falada).
 *
 * Pure function (REQ-ETM-NFR-001). Given the resolved slots (with each
 * Partícula's `palavra_etmos` looked up), produces the display string
 * `frase_completa` exactly as the SRD's canonical `exemplo_uso` strings show
 * it (design doc §2.3, golden fixtures §5).
 *
 * Algorithm (design doc §2.3):
 *   1. Núcleo: funcao.palavra + primeiro objeto.palavra, lowercasing the
 *      SECOND term and concatenating (no space) — "Et" + "Imu" → "Etimu".
 *      Fusion happens ONLY here (Função + first Objeto); nothing else fuses
 *      beyond the núcleo (R4, design doc).
 *   2. Objetos extras: appended as separate words after the núcleo, in order.
 *   3. Características: each becomes a separate word, in
 *      caracteristica_slugs order, EXCEPT indices claimed by a Criador:
 *        - prefix targeting a Característica (ada/no): lowercase the
 *          Criador's word (minus trailing "-") + the target's word AS-IS
 *          (capitalized) — "ada" + "Quan" → "adaQuan"; "no" + "Tum" → "noTum".
 *        - prefix targeting an Objeto-as-Característica (mut): capitalize
 *          the Criador's word (minus trailing "-") + the target's word
 *          LOWERCASED — "Mut" + "exa" → "Mutexa" (opposite casing pattern
 *          from ada/no — the target is an Objeto, not a Característica, so
 *          IT gets lowercased while the Criador keeps its capital).
 *        - connector (ag) fuses the two target words with the Criador's word
 *          UNCHANGED (both targets stay capitalized) between them —
 *          "Quan" + "Ag" + "Aer" → "QuanAgAer".
 *   4. Modificadores (suffix): appended last, each a separate word, in the
 *      order chosen — "… Mor", "… Min", "… Itam".
 *
 * Design doc m5-etmos-compositor.md §2.3. Golden fixtures §5 (G1..G8).
 */
import type { FraseMagicaSystem, CriadorAplicado } from "../schemas/item-frase-magica.js";
import { getComplementoSyntax } from "../particulas-syntax.js";

/** Resolver: given a Partícula slug, returns its Etmos word (palavra_etmos). */
export type PalavraResolver = (slug: string) => string;

/** Strips a trailing "-" from a Criador's word (e.g. "Ada-" → "Ada", "Mut-" → "Mut"). */
function stripHyphen(palavra: string): string {
  return palavra.endsWith("-") ? palavra.slice(0, -1) : palavra;
}

function lowerFirst(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toLowerCase() + word.slice(1);
}

/**
 * Assembles the `frase_completa` display string from resolved slots.
 *
 * `resolvePalavra` is injected (rather than hardcoding a pack lookup) so
 * this stays pure and testable without loading the real compiled pack —
 * callers (VM, server) resolve from the caster's Grimório or the compendium.
 */
export function montarFrase(
  slots: Pick<
    FraseMagicaSystem,
    "funcao_slug" | "objeto_slugs" | "caracteristica_slugs" | "criadores" | "modificador_slugs"
  >,
  resolvePalavra: PalavraResolver,
): string {
  const words: string[] = [];

  // --- 1. Núcleo: Função + primeiro Objeto, fundidos ---
  const funcaoPalavra = slots.funcao_slug.length > 0 ? resolvePalavra(slots.funcao_slug) : "";
  const primeiroObjeto = slots.objeto_slugs[0];
  let nucleo = funcaoPalavra;
  if (primeiroObjeto !== undefined) {
    nucleo = funcaoPalavra + lowerFirst(resolvePalavra(primeiroObjeto));
  }
  if (nucleo.length > 0) {
    words.push(nucleo);
  }

  // --- 2. Objetos extras (2ª em diante), palavras separadas ---
  for (let i = 1; i < slots.objeto_slugs.length; i++) {
    const slug = slots.objeto_slugs[i];
    if (slug !== undefined) words.push(resolvePalavra(slug));
  }

  // --- 3. Características, exceto as tomadas por um Criador ---
  // Index Criadores by the Característica-slot index(es) they claim.
  const prefixByIndex = new Map<number, CriadorAplicado>();
  const connectorPairs: Array<{ a: number; b: number; criador: CriadorAplicado }> = [];
  const consumedIndices = new Set<number>();

  for (const criador of slots.criadores) {
    const syntax = getComplementoSyntax(criador.slug);
    if (!syntax) continue;

    if (syntax.ligacao === "prefix" && typeof criador.alvo === "number") {
      prefixByIndex.set(criador.alvo, criador);
      consumedIndices.add(criador.alvo);
    } else if (syntax.ligacao === "connector" && Array.isArray(criador.alvo)) {
      const [a, b] = criador.alvo;
      connectorPairs.push({ a, b, criador });
      consumedIndices.add(a);
      consumedIndices.add(b);
    }
  }

  const emittedConnectorAt = new Set<number>();

  for (let i = 0; i < slots.caracteristica_slugs.length; i++) {
    const slug = slots.caracteristica_slugs[i];
    if (slug === undefined) continue;
    const targetPalavra = resolvePalavra(slug);

    // Connector (Ag): emit the fused word once, at the FIRST index of the pair.
    const connectorPair = connectorPairs.find((p) => p.a === i || p.b === i);
    if (connectorPair) {
      if (emittedConnectorAt.has(connectorPair.a)) continue; // already emitted
      emittedConnectorAt.add(connectorPair.a);
      const otherIndex = connectorPair.a === i ? connectorPair.b : connectorPair.a;
      const otherSlug = slots.caracteristica_slugs[otherIndex];
      const otherPalavra = otherSlug !== undefined ? resolvePalavra(otherSlug) : "";
      const connectorPalavra = resolvePalavra(connectorPair.criador.slug);
      // "Quan" + "Ag" + "Aer" — no lowercasing, straight concatenation.
      words.push(targetPalavra + connectorPalavra + otherPalavra);
      continue;
    }

    // Prefix (Ada-/No-/Mut-) targeting this index.
    const prefixCriador = prefixByIndex.get(i);
    if (prefixCriador) {
      const criadorPalavra = stripHyphen(resolvePalavra(prefixCriador.slug));
      if (prefixCriador.slug === "mut") {
        // Mut-: prefix stays capitalized, the Objeto-as-Característica target lowercases.
        words.push(criadorPalavra + lowerFirst(targetPalavra));
      } else {
        // Ada-/No-: prefix lowercases, the Característica target stays capitalized.
        words.push(lowerFirst(criadorPalavra) + targetPalavra);
      }
      continue;
    }

    // Plain Característica — not claimed by any Criador.
    if (!consumedIndices.has(i)) {
      words.push(targetPalavra);
    }
  }

  // --- 4. Modificadores (suffix), última posição, ordem escolhida ---
  for (const slug of slots.modificador_slugs) {
    words.push(resolvePalavra(slug));
  }

  return words.join(" ");
}
