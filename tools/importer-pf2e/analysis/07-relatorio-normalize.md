# 07 — Relatório de Normalização PF2E → Formato Intermediário Fusion

> Gerado em: 2026-07-05
> Script: `src/normalize.mjs --system pf2e`
> Estágio: EXTRACT/NORMALIZE (M2-P)

---

## 1. Sumário por pack

| Pack | Docs | img substituídas | img Paizo | img FoundryCore | Docs c/ rules | Entradas rules | Itens embutidos |
|---|---|---|---|---|---|---|---|
| **equipment** | 5645 | 5645 | 2769 | 2876 | 1313 | 2276 | 0 |
| **spells** | 1796 | 1796 | 755 | 1041 | 11 | 18 | 0 |
| **conditions** | 43 | 43 | 43 | 0 | 19 | 49 | 0 |
| **pathfinder-monster-core** | 492 | 6695 | 5523 | 1172 | 771 | 1251 | 6203 |
| **classes** | 27 | 27 | 27 | 0 | 5 | 11 | 0 |
| **class-features** | 841 | 841 | 199 | 642 | 584 | 2170 | 0 |
| **feats** | 5987 | 5987 | 11 | 5976 | 2411 | 5112 | 0 |
| **ancestries** | 50 | 50 | 50 | 0 | 13 | 33 | 0 |
| **heritages** | 322 | 322 | 95 | 227 | 282 | 535 | 0 |
| **backgrounds** | 495 | 495 | 495 | 0 | 135 | 315 | 0 |
| **TOTAL** | **15698** | **21901** | **9967** | **11934** | **5544** | **11770** | **6203** |

---

## 2. Campos removidos por categoria

| Categoria | Campo | Política | Motivo |
|---|---|---|---|
| Metadados Foundry | `_stats` | Removido | Dados de sincronização de compendium (compendiumSource) — sem valor no Fusion |
| Metadados Foundry | `flags` | Removido | Flags de módulos pf2e (ex: `linkedWeapon`) — específicas do Foundry VTT |
| UI Foundry | `sort` | Removido | Ordem de exibição na UI do Foundry — irrelevante no Fusion |
| UI Foundry | `folder` | Removido | ID de pasta no Foundry — estrutura não transportável |
| Arte Paizo | `img` (paths `systems/pf2e/`) | Substituído | Arte proprietária Paizo — proibida por specs/26 |
| Arte Foundry Core | `img` (paths `icons/`) | Substituído | Política conservadora — substituir todos os imgs por placeholder |

**Campos preservados:**

| Campo | Motivo |
|---|---|
| `_id` | _id original pf2e — rastreabilidade e derivação de fusionId no M3-D |
| `pf2eSourceId` | Cópia explícita do _id original para rastreabilidade |
| `type` | Tipo de documento — classificação fundamental |
| `name` | Nome canônico ORC/OGL |
| `system.*` | Todos os campos mecânicos — integralmente preservados |
| `system.rules[]` | Rule Elements — preservados intactos para conversão no M3-D |
| `items[]` | Itens embutidos em actors (NPC, character) — normalizados recursivamente |
| `originalImgRef` | Nome do arquivo img original (ex: `blinded.webp`) — apenas para auditoria |

---

## 3. Tamanhos estimados de output

| Pack | Docs | Tamanho estimado normalized.json |
|---|---|---|
| equipment | 5645 | ~9.61 MB |
| spells | 1796 | ~3.17 MB |
| conditions | 43 | ~0.05 MB |
| pathfinder-monster-core | 492 | ~6.99 MB |
| classes | 27 | ~0.13 MB |
| class-features | 841 | ~1.71 MB |
| feats | 5987 | ~7.47 MB |
| ancestries | 50 | ~0.08 MB |
| heritages | 322 | ~0.36 MB |
| backgrounds | 495 | ~0.84 MB |

---

## 4. Rule Elements — top 10 por frequência (packs alvo)

| Rule Key | Ocorrências |
|---|---|
| `FlatModifier` | 2094 |
| `ItemAlteration` | 1542 |
| `RollOption` | 1396 |
| `ActiveEffectLike` | 1391 |
| `GrantItem` | 1253 |
| `ChoiceSet` | 620 |
| `Note` | 614 |
| `DamageDice` | 388 |
| `Resistance` | 359 |
| `AdjustDegreeOfSuccess` | 248 |

---

## 5. Tipos de documento por pack

### equipment

| Tipo | Docs |
|---|---|
| equipment | 2281 |
| consumable | 1666 |
| weapon | 975 |
| ammo | 203 |
| armor | 201 |
| treasure | 153 |
| shield | 118 |
| backpack | 46 |
| kit | 2 |

### spells

| Tipo | Docs |
|---|---|
| spell | 1796 |

### conditions

| Tipo | Docs |
|---|---|
| condition | 43 |

### pathfinder-monster-core

| Tipo | Docs |
|---|---|
| npc | 492 |

### classes

| Tipo | Docs |
|---|---|
| class | 27 |

### class-features

| Tipo | Docs |
|---|---|
| feat | 841 |

### feats

| Tipo | Docs |
|---|---|
| feat | 5987 |

### ancestries

| Tipo | Docs |
|---|---|
| ancestry | 50 |

### heritages

| Tipo | Docs |
|---|---|
| heritage | 322 |

### backgrounds

| Tipo | Docs |
|---|---|
| background | 495 |

---

## 6. Pendências para o estágio TRANSFORM (M3-D)

As pendências abaixo NÃO são resolvidas neste estágio:

| # | Pendência | Responsável |
|---|---|---|
| 1 | **Derivação de UUID Fusion**: `fusionId = base62_16(sha1(packName + ":" + pf2eSourceId))` | M3-D transform |
| 2 | **Mapa de UUIDs**: construção e persistência de `out/fusion-uuid-map.json` | M3-D transform |
| 3 | **Reescrita de UUIDs em rules[]**: `Compendium.pf2e.*` → UUIDs Fusion | M3-D patchUuids |
| 4 | **Marcação de Rule Elements não suportados**: `_unsupported: true` nos REs sem suporte Fusion | M3-D rules/ |
| 5 | **Validação Zod**: schema completo de documento Fusion normalizado | M3-D schema/ |
| 6 | **Serialização NDJSON**: conversão de normalized.json → documents.ndjson por pack | M3-E pack |
| 7 | **pack.json**: geração de metadados de pack (docCount, licenses, sourceCommit) | M3-E pack |
| 8 | **Strip de lore**: flag `--strip-lore` para remover texto narrativo proprietário | M3-D transform |
| 9 | **system.description.value**: avaliar texto ORC vs. lore não reutilizável por documento | M3-D + revisão legal |
| 10 | **Itens embutidos (items[])**: fusionId dos itens embutidos em NPC actors | M3-D transform |

---

## 7. Notas sobre originalImgRef

O campo `originalImgRef` contém **apenas o nome do arquivo** (sem path completo),
por exemplo: `blinded.webp`, `longsword.webp`, `fireball.webp`.

Não contém o path original (`systems/pf2e/icons/...`) para evitar
qualquer referência acidental a arte proprietária no output. Serve
exclusivamente para auditoria manual ("qual era a arte original?")
e para correlação futura com arte licenciada compatível.