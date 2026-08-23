/**
 * Migration 010 — DEC-MC-01: o Elfo Ancião deixa de conceder dedicação de
 * multiclasse.
 *
 * A decisão (docs/design/decisao-elfo-anciao-dedicacao.md) desligou a regra
 * `GrantItem` da herança Ancient Elf no pack. Só que a herança é COPIADA para
 * dentro do ator quando entra numa ficha — mundos criados antes desta versão
 * carregam a cópia antiga, com a concessão ainda ativa, e um pack novo não
 * alcança essas cópias. Daí esta migration: ela faz nas cópias embutidas o
 * mesmo que a curadoria do importer faz na fonte.
 *
 * Desativar é MOVER, não apagar: a regra sai de `system.rules[]` e passa a
 * `flags.fusion.disabledRules[]` junto com a decisão que a desligou — mesmo
 * formato que `tools/importer-pf2e/src/curation/disabled-rules.mjs` grava, para
 * que um documento migrado e um documento recém-importado sejam indistinguíveis.
 *
 * O alvo é identificado por `flags.fusion.sourceId` (identidade de documento no
 * Fusion; nome é homônimo em potencial no PF2e) MAIS o uuid do placeholder — os
 * dois têm de bater, senão a regra não é tocada.
 */

import type { FusionMigration } from "../migrations.js";

/** `flags.fusion.sourceId` da herança Ancient Elf no vendor pf2e. */
const ANCIENT_ELF_SOURCE_ID = "Nd9hdX8rdYyRozw8";

/** O uuid do `GrantItem` desligado — placeholder do ChoiceSet que nunca foi convertido. */
const GRANT_UUID = "{item|flags.system.rulesSelections.ancientElf}";

const DISABLED_BY = {
  decision: "DEC-MC-01",
  decidedOn: "2026-08-23",
  reason:
    "A dedicação de multiclasse concedida pela herança fica fora do app até a multiclasse ser refeita (docs/design/decisao-elfo-anciao-dedicacao.md).",
} as const;

interface EmbeddedLike {
  system?: { rules?: unknown[] };
  flags?: { fusion?: { sourceId?: string; disabledRules?: unknown[] } };
}

/**
 * Desativa a concessão em UM documento, se ele for o Elfo Ancião e a regra
 * ainda estiver ativa. Devolve `true` quando mexeu — o chamador só reescreve
 * a linha do banco nesse caso.
 */
function disableAncientElfGrant(doc: EmbeddedLike): boolean {
  const fusion = doc.flags?.fusion;
  if (fusion?.sourceId !== ANCIENT_ELF_SOURCE_ID) return false;

  const rules = doc.system?.rules;
  if (!Array.isArray(rules)) return false;

  const index = rules.findIndex(
    (r) => (r as { uuid?: string } | null)?.uuid === GRANT_UUID,
  );
  if (index === -1) return false; // já migrado, ou nunca teve a concessão

  const [rule] = rules.splice(index, 1);
  fusion.disabledRules = [...(fusion.disabledRules ?? []), { ...DISABLED_BY, rule }];
  return true;
}

export const migration010: FusionMigration = {
  version: 10,
  description: "DEC-MC-01: disable the Ancient Elf multiclass-dedication grant in stored documents",

  up(db) {
    // `actors.data` guarda o ator inteiro, com os itens embutidos dentro;
    // `items` guarda documentos soltos. A herança pode estar nos dois.
    const updateActor = db.prepare("UPDATE actors SET data = ? WHERE id = ?");
    let touchedActors = 0;

    for (const row of db.prepare("SELECT id, data FROM actors").all() as {
      id: string;
      data: string;
    }[]) {
      const actor = JSON.parse(row.data) as { items?: EmbeddedLike[] };
      const items = Array.isArray(actor.items) ? actor.items : [];
      let changed = false;
      for (const item of items) {
        if (disableAncientElfGrant(item)) changed = true;
      }
      if (!changed) continue;
      updateActor.run(JSON.stringify(actor), row.id);
      touchedActors++;
    }

    const updateItem = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of db.prepare("SELECT id, data FROM items").all() as {
      id: string;
      data: string;
    }[]) {
      const item = JSON.parse(row.data) as EmbeddedLike;
      if (!disableAncientElfGrant(item)) continue;
      updateItem.run(JSON.stringify(item), row.id);
    }

    if (touchedActors > 0) {
      // Sem logger aqui (migrations rodam antes do boot do server); o número
      // aparece no schema_migrations pela descrição, e no console de quem roda.
      console.log(
        `[migration010] DEC-MC-01 aplicada a ${String(touchedActors)} ator(es) com a herança Ancient Elf`,
      );
    }
  },
};
