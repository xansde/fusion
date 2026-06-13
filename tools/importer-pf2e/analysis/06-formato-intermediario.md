# 06 — Formato Intermediário Fusion (estágio EXTRACT/NORMALIZE)

> Gerado em: 2026-06-13
> Script: `src/normalize.mjs`
> Estágio: M2-P (EXTRACT/NORMALIZE)
> Próximo estágio: TRANSFORM (M3-D) → schema Fusion final

---

## 1. Visão geral

O **Formato Intermediário** é a representação de documentos pf2e após o estágio
NORMALIZE e antes do estágio TRANSFORM. Sua finalidade é:

- Preservar todos os dados mecânicos necessários para o M3-D
- Eliminar arte proprietária Paizo
- Remover metadados Foundry VTT sem valor no Fusion
- Manter rastreabilidade ao documento pf2e original

O formato intermediário é **transitório** — persiste em `out/<pack>/normalized.json`
e `samples/<pack>/sample-{1,2,3}.json` mas não é o schema de runtime do Fusion.

---

## 2. Schema do documento intermediário

```typescript
interface FusionIntermediateDocument {
  // === Identificação ===
  _id: string; // _id original do pf2e (16 chars Base62)
  pf2eSourceId: string; // cópia explícita de _id para rastreabilidade
  type: string; // tipo pf2e original (weapon, spell, npc, condition, ...)
  name: string; // nome canônico ORC/OGL

  // === Arte (substituída) ===
  img: string; // placeholder por tipo: "icons/placeholder/<type>.svg"
  originalImgRef: string | null; // apenas nome do arquivo original (ex: "blinded.webp")
  // sem path completo — somente para auditoria

  // === Dados mecânicos (preservados integralmente) ===
  system: Record<string, unknown>; // system.* do pf2e — TODOS os campos preservados

  // === Items embutidos (actors: npc, character, hazard) ===
  items?: FusionIntermediateEmbeddedItem[];

  // === Metadados de normalização ===
  _fusion: {
    normalizedAt: string; // ISO 8601
    removedFields: string[]; // campos presentes no original e removidos (ex: ["flags", "sort"])
  };
}

interface FusionIntermediateEmbeddedItem {
  _id: string;
  type: string;
  name: string;
  img: string; // placeholder por tipo
  originalImgRef: string | null;
  system: Record<string, unknown>;
  // Nota: _stats, flags, sort NÃO são incluídos
}
```

---

## 3. Campos preservados

| Campo            | Origem              | Motivo                                                                |
| ---------------- | ------------------- | --------------------------------------------------------------------- |
| `_id`            | `doc._id`           | Rastreabilidade; base para derivação do fusionId no M3-D              |
| `pf2eSourceId`   | `doc._id` (cópia)   | Explicitidade — campo nomeado para o M3-D                             |
| `type`           | `doc.type`          | Tipo de documento — classificação fundamental                         |
| `name`           | `doc.name`          | Nome canônico ORC/OGL — ok para reutilização                          |
| `img`            | Placeholder         | Arte proprietária substituída                                         |
| `originalImgRef` | `basename(doc.img)` | Apenas nome do arquivo para auditoria                                 |
| `system.*`       | `doc.system`        | Todos os campos mecânicos: damage, traits, rules[], description, etc. |
| `items[]`        | `doc.items`         | Items embutidos em actors (NPC weapons, spells, etc.) — normalizados  |
| `_fusion`        | Gerado              | Metadados de proveniência desta normalização                          |

---

## 4. Campos removidos

| Campo       | Motivo                                                                       | Categoria       |
| ----------- | ---------------------------------------------------------------------------- | --------------- |
| `flags`     | Flags de módulos pf2e — específicas do Foundry VTT (ex: `pf2e.linkedWeapon`) | Foundry interno |
| `_stats`    | Metadados de sincronização de compendium (ex: `compendiumSource`)            | Foundry interno |
| `sort`      | Ordem de exibição na UI do Foundry                                           | UI Foundry      |
| `folder`    | ID de pasta no Foundry — estrutura não transportável                         | UI Foundry      |
| `ownership` | Permissões por usuário do Foundry                                            | Foundry interno |
| `_key`      | Chave de pacote interna do Foundry                                           | Foundry interno |

### Substituição de img

Todos os valores de `img` são substituídos por placeholder. A política é **conservadora**:
substituir independentemente de origem (Paizo ou Foundry core icons), por dois motivos:

1. Arte Paizo (`systems/pf2e/...`): explicitamente proibida por specs/26
2. Arte Foundry core (`icons/...`): licença incerta; substituição garante conformidade

O `originalImgRef` retém apenas o **nome do arquivo** (ex: `blinded.webp`) sem
o path completo, para evitar qualquer referência residual a paths de arte proprietária.

---

## 5. Placeholders por tipo de documento

| Tipo                                                            | Placeholder                        |
| --------------------------------------------------------------- | ---------------------------------- |
| `weapon`                                                        | `icons/placeholder/weapon.svg`     |
| `armor`, `shield`                                               | `icons/placeholder/armor.svg`      |
| `spell`                                                         | `icons/placeholder/spell.svg`      |
| `consumable`                                                    | `icons/placeholder/consumable.svg` |
| `equipment`, `backpack`, `kit`, `treasure`, `ammo`              | `icons/placeholder/item.svg`       |
| `npc`, `character`, `familiar`, `hazard`                        | `icons/placeholder/npc.svg`        |
| `feat`, `action`, `background`, `heritage`, `ancestry`, `class` | `icons/placeholder/feat.svg`       |
| `effect`                                                        | `icons/placeholder/effect.svg`     |
| `condition`                                                     | `icons/placeholder/condition.svg`  |
| (outros)                                                        | `icons/placeholder.svg`            |

Os arquivos SVG são fornecidos por `packages/shared/assets/icons/placeholder/`.

---

## 6. Rules[] — política de preservação

O array `system.rules[]` é **preservado intacto** neste estágio. Cada entrada
de Rule Element (RE) mantém todos os seus campos originais, incluindo:

- `key` — tipo de RE (FlatModifier, RollOption, GrantItem, etc.)
- Campos específicos de cada RE (`selector`, `value`, `predicate`, etc.)

A conversão/filtragem de REs (marcar não suportados com `_unsupported: true`,
reescrever UUIDs internos) é responsabilidade do estágio **TRANSFORM (M3-D)**.

---

## 7. Exemplo — documento de condição (conditions/blinded)

```json
{
  "_id": "XgEqL1kFApUbl5Z2",
  "pf2eSourceId": "XgEqL1kFApUbl5Z2",
  "type": "condition",
  "name": "Blinded",
  "img": "icons/placeholder/condition.svg",
  "originalImgRef": "blinded.webp",
  "system": {
    "description": {
      "value": "<p>You can't see...</p>"
    },
    "duration": { "expiry": null, "unit": "unlimited", "value": 0 },
    "group": "senses",
    "overrides": ["dazzled"],
    "publication": { "license": "ORC", "remaster": true, "title": "Pathfinder Player Core" },
    "rules": [
      {
        "key": "FlatModifier",
        "selector": "perception",
        "slug": "blinded",
        "type": "status",
        "value": -4
      },
      { "key": "Immunity", "type": "visual" }
    ],
    "traits": { "value": [] },
    "value": { "isValued": false, "value": null }
  },
  "_fusion": {
    "normalizedAt": "2026-06-13T00:29:04.643Z",
    "removedFields": []
  }
}
```

## 8. Exemplo — arma (equipment/longsword)

```json
{
  "_id": "LJdbVTOZog39EEbi",
  "pf2eSourceId": "LJdbVTOZog39EEbi",
  "type": "weapon",
  "name": "Longsword",
  "img": "icons/placeholder/weapon.svg",
  "originalImgRef": "sword-guard-blue.webp",
  "system": {
    "damage": { "damageType": "slashing", "dice": 1, "die": "d8" },
    "category": "martial",
    "group": "sword",
    "traits": { "rarity": "common", "value": ["versatile-p"] },
    "publication": { "license": "ORC", "remaster": true },
    "rules": []
  },
  "_fusion": {
    "normalizedAt": "2026-06-13T00:29:04.000Z",
    "removedFields": []
  }
}
```

---

## 9. Responsabilidades do próximo estágio (TRANSFORM — M3-D)

O M3-D receberá os documentos neste formato intermediário e deverá:

1. **Derivar fusionId**: `base62_16(sha1(packName + ":" + pf2eSourceId))`
2. **Construir mapa de UUIDs**: `out/fusion-uuid-map.json`
3. **Reescrever UUIDs em rules[]**: `Compendium.pf2e.*` → fusionId Fusion
4. **Marcar REs não suportados**: `_unsupported: true` nos REs sem implementação
5. **Validar com Zod**: schema completo de documento Fusion
6. **Strip de lore** (flag): substituir `system.description.value` por placeholder
7. **Serializar NDJSON**: converter `normalized.json` → `documents.ndjson`
