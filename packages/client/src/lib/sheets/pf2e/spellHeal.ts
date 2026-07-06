/**
 * spellHeal.ts — load spells-core pack systems to heal embedded spell copies
 * (r16 verificação viva).
 *
 * PF2e actors copy spells into `items[]`, but the copies observed in Argiburgo
 * lost their scaling data (`heightening`/`damage`/`traits`/`defense`). The
 * sheet's automatic-heightening (r16-G3) reads `system.heightening`, so every
 * cantrip/spell showed at base — the "elevação não funciona" bug.
 *
 * This module fetches the matching pack spell `system` for the embedded spells
 * an actor actually has, and returns a {@link SpellHealResolver} the VM applies
 * at display time via `healSpellSystem`. It is DISPLAY-only: the actor doc is
 * never mutated (preferred over a write-back heal — no ownership/permission
 * concerns, no migration, and it self-corrects if the pack is fixed).
 *
 * Resolution mirrors buildSpellDetailsResolver: match by normalized name (EN or
 * pt-BR) and by `flags.fusion.sourceId` when present. The socket is resolved
 * lazily by the caller (never a frozen prop — r10 lesson).
 */

import type { Socket } from "socket.io-client";
import { normalizeSearchText } from "@fusion/shared";
import { listPacks, searchPack, getDocument } from "../../compendium/compendiumApi.js";
import type { SpellHealResolver } from "./characterSheetVM.js";

/** One embedded spell the actor carries, by its resolution keys. */
export interface EmbeddedSpellKey {
  name: string;
  sourceId: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build a {@link SpellHealResolver} that supplies each embedded spell's pack
 * `system`. Loads the spells-core pack index, resolves the given spell keys to
 * pack UUIDs (by normalized EN/pt-BR name or sourceId), fetches each matching
 * pack doc once, and indexes its `system` by both name keys and sourceId.
 *
 * Returns a resolver that is `null` for spells with no pack match (homebrew —
 * the VM then leaves the embedded system unchanged). On any load failure
 * (offline / no pack) returns an always-null resolver so the sheet degrades to
 * base heightening rather than breaking.
 */
export async function buildSpellHealResolver(
  getSocketFn: () => Socket | null | undefined,
  embedded: EmbeddedSpellKey[],
  systemId = "pf2e",
): Promise<SpellHealResolver> {
  const empty: SpellHealResolver = () => null;
  const sock = getSocketFn();
  if (!sock) return empty;

  try {
    const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
    const spellPack = packs.find((p) => p.id.endsWith(".spells-core")) ?? packs[0];
    if (!spellPack) return empty;

    const { entries } = await searchPack(sock, { packId: spellPack.id });

    // name/sourceId → uuid (first write wins, deterministic index order).
    const uuidByName = new Map<string, string>();
    const uuidBySourceId = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.uuid) continue;
      const enKey = normalizeSearchText(entry.name);
      if (enKey && !uuidByName.has(enKey)) uuidByName.set(enKey, entry.uuid);
      if (entry.namePt && entry.namePt.length > 0) {
        const ptKey = normalizeSearchText(entry.namePt);
        if (ptKey && !uuidByName.has(ptKey)) uuidByName.set(ptKey, entry.uuid);
      }
      const src = entry.index?.["flags.fusion.sourceId"];
      if (typeof src === "string" && src.length > 0 && !uuidBySourceId.has(src)) {
        uuidBySourceId.set(src, entry.uuid);
      }
    }

    // Resolve the uuids the actor actually needs (dedup) and fetch each once.
    const neededUuids = new Set<string>();
    const resolveUuid = (name: string, sourceId: string | null): string | null => {
      if (sourceId) {
        const bySrc = uuidBySourceId.get(sourceId);
        if (bySrc) return bySrc;
      }
      const byName = uuidByName.get(normalizeSearchText(name));
      return byName ?? null;
    };
    for (const key of embedded) {
      const uuid = resolveUuid(key.name, key.sourceId);
      if (uuid) neededUuids.add(uuid);
    }

    const systemByUuid = new Map<string, Record<string, unknown>>();
    await Promise.all(
      Array.from(neededUuids).map(async (uuid) => {
        try {
          const { document } = await getDocument(sock, uuid);
          const sys = isRecord(document) ? document["system"] : undefined;
          if (isRecord(sys)) systemByUuid.set(uuid, sys);
        } catch {
          // Skip a single failed fetch — the spell just won't be healed.
        }
      }),
    );

    return (rawName: string, sourceId?: string | null): Record<string, unknown> | null => {
      const uuid = resolveUuid(rawName, sourceId ?? null);
      if (!uuid) return null;
      return systemByUuid.get(uuid) ?? null;
    };
  } catch {
    return empty;
  }
}
