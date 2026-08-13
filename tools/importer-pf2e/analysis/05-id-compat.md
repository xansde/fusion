# 05 — Compatibilidade de _ids PF2E ↔ Fusion

> Gerado em: 2026-08-11
> Script: `src/extract.mjs --system pf2e`
> Formato Fusion esperado: `^[A-Za-z0-9]{16}$` (16 caracteres alfanuméricos case-sensitive)

---

## 1. Resultado global — packs alvo

| Pack | Total docs | _ids válidos | _ids inválidos | % válidos |
|---|---|---|---|---|
| **abomination-vaults-bestiary** | 112 | 112 | 0 | 100.0% |
| **action-macros** | 71 | 71 | 0 | 100.0% |
| **actions** | 559 | 559 | 0 | 100.0% |
| **adventure-specific-actions** | 181 | 181 | 0 | 100.0% |
| **age-of-ashes-bestiary** | 130 | 130 | 0 | 100.0% |
| **agents-of-edgewatch-bestiary** | 185 | 185 | 0 | 100.0% |
| **ancestries** | 50 | 50 | 0 | 100.0% |
| **ancestry-features** | 55 | 55 | 0 | 100.0% |
| **backgrounds** | 495 | 495 | 0 | 100.0% |
| **battlecry-bestiary** | 55 | 55 | 0 | 100.0% |
| **bestiary-ability-glossary-srd** | 55 | 55 | 0 | 100.0% |
| **bestiary-effects** | 649 | 649 | 0 | 100.0% |
| **bestiary-family-ability-glossary** | 468 | 468 | 0 | 100.0% |
| **blog-bestiary** | 32 | 32 | 0 | 100.0% |
| **blood-lords-bestiary** | 191 | 191 | 0 | 100.0% |
| **book-of-the-dead-bestiary** | 106 | 106 | 0 | 100.0% |
| **boons-and-curses** | 247 | 247 | 0 | 100.0% |
| **campaign-effects** | 74 | 74 | 0 | 100.0% |
| **class-features** | 841 | 841 | 0 | 100.0% |
| **classes** | 27 | 27 | 0 | 100.0% |
| **claws-of-the-tyrant-bestiary** | 42 | 42 | 0 | 100.0% |
| **conditions** | 43 | 43 | 0 | 100.0% |
| **criticaldeck** | 106 | 106 | 0 | 100.0% |
| **crown-of-the-kobold-king-bestiary** | 42 | 42 | 0 | 100.0% |
| **curtain-call-bestiary** | 74 | 74 | 0 | 100.0% |
| **deities** | 479 | 479 | 0 | 100.0% |
| **equipment** | 5645 | 5645 | 0 | 100.0% |
| **equipment-effects** | 689 | 689 | 0 | 100.0% |
| **extinction-curse-bestiary** | 167 | 167 | 0 | 100.0% |
| **fall-of-plaguestone** | 24 | 24 | 0 | 100.0% |
| **familiar-abilities** | 111 | 111 | 0 | 100.0% |
| **feat-effects** | 825 | 825 | 0 | 100.0% |
| **feats** | 5987 | 5987 | 0 | 100.0% |
| **fists-of-the-ruby-phoenix-bestiary** | 138 | 138 | 0 | 100.0% |
| **gatewalkers-bestiary** | 89 | 89 | 0 | 100.0% |
| **hazards** | 53 | 53 | 0 | 100.0% |
| **hellbreakers-bestiary** | 78 | 78 | 0 | 100.0% |
| **hells-destiny-bestiary** | 110 | 110 | 0 | 100.0% |
| **heritages** | 322 | 322 | 0 | 100.0% |
| **howl-of-the-wild-bestiary** | 76 | 76 | 0 | 100.0% |
| **iconics** | 84 | 84 | 0 | 100.0% |
| **journals** | 7 | 7 | 0 | 100.0% |
| **kingmaker-bestiary** | 262 | 262 | 0 | 100.0% |
| **kingmaker-features** | 132 | 132 | 0 | 100.0% |
| **lost-omens-bestiary** | 385 | 385 | 0 | 100.0% |
| **macros** | 10 | 10 | 0 | 100.0% |
| **malevolence-bestiary** | 20 | 20 | 0 | 100.0% |
| **menace-under-otari-bestiary** | 92 | 92 | 0 | 100.0% |
| **myth-speaker-bestiary** | 82 | 82 | 0 | 100.0% |
| **night-of-the-gray-death-bestiary** | 17 | 17 | 0 | 100.0% |
| **npc-gallery** | 6 | 6 | 0 | 100.0% |
| **one-shot-bestiary** | 33 | 33 | 0 | 100.0% |
| **other-effects** | 53 | 53 | 0 | 100.0% |
| **outlaws-of-alkenstar-bestiary** | 98 | 98 | 0 | 100.0% |
| **paizo-pregens** | 57 | 57 | 0 | 100.0% |
| **pathfinder-bestiary** | 167 | 167 | 0 | 100.0% |
| **pathfinder-bestiary-2** | 161 | 161 | 0 | 100.0% |
| **pathfinder-bestiary-3** | 168 | 168 | 0 | 100.0% |
| **pathfinder-dark-archive** | 31 | 31 | 0 | 100.0% |
| **pathfinder-monster-core** | 492 | 492 | 0 | 100.0% |
| **pathfinder-monster-core-2** | 446 | 446 | 0 | 100.0% |
| **pathfinder-npc-core** | 271 | 271 | 0 | 100.0% |
| **pathfinder-society-boons** | 157 | 157 | 0 | 100.0% |
| **pfs-introductions-bestiary** | 13 | 13 | 0 | 100.0% |
| **pfs-season-1-bestiary** | 331 | 331 | 0 | 100.0% |
| **pfs-season-2-bestiary** | 254 | 254 | 0 | 100.0% |
| **pfs-season-3-bestiary** | 278 | 278 | 0 | 100.0% |
| **pfs-season-4-bestiary** | 220 | 220 | 0 | 100.0% |
| **pfs-season-5-bestiary** | 231 | 231 | 0 | 100.0% |
| **pfs-season-6-bestiary** | 339 | 339 | 0 | 100.0% |
| **pfs-season-7-bestiary** | 87 | 87 | 0 | 100.0% |
| **prey-for-death-bestiary** | 40 | 40 | 0 | 100.0% |
| **quest-for-the-frozen-flame-bestiary** | 87 | 87 | 0 | 100.0% |
| **rage-of-elements-bestiary** | 81 | 81 | 0 | 100.0% |
| **revenge-of-the-runelords-bestiary** | 100 | 100 | 0 | 100.0% |
| **rollable-tables** | 69 | 69 | 0 | 100.0% |
| **rusthenge-bestiary** | 25 | 25 | 0 | 100.0% |
| **season-of-ghosts-bestiary** | 96 | 96 | 0 | 100.0% |
| **seven-dooms-for-sandpoint-bestiary** | 69 | 69 | 0 | 100.0% |
| **shades-of-blood-bestiary** | 97 | 97 | 0 | 100.0% |
| **shadows-at-sundown-bestiary** | 18 | 18 | 0 | 100.0% |
| **sky-kings-tomb-bestiary** | 107 | 107 | 0 | 100.0% |
| **spell-effects** | 509 | 509 | 0 | 100.0% |
| **spells** | 1796 | 1796 | 0 | 100.0% |
| **spore-war-bestiary** | 78 | 78 | 0 | 100.0% |
| **standalone-adventures** | 8 | 8 | 0 | 100.0% |
| **stolen-fate-bestiary** | 98 | 98 | 0 | 100.0% |
| **strength-of-thousands-bestiary** | 159 | 159 | 0 | 100.0% |
| **the-enmity-cycle-bestiary** | 17 | 17 | 0 | 100.0% |
| **the-slithering-bestiary** | 13 | 13 | 0 | 100.0% |
| **triumph-of-the-tusk-bestiary** | 89 | 89 | 0 | 100.0% |
| **troubles-in-grayce-bestiary** | 53 | 53 | 0 | 100.0% |
| **troubles-in-otari-bestiary** | 18 | 18 | 0 | 100.0% |
| **vehicles** | 98 | 98 | 0 | 100.0% |
| **war-of-immortals-bestiary** | 16 | 16 | 0 | 100.0% |
| **wardens-of-wildwood-bestiary** | 90 | 90 | 0 | 100.0% |

**Subtotal packs alvo:**
- Total documentos: **28498**
- _ids válidos (Fusion): **28498** (100.00%)
- _ids inválidos: **0**

---

## 2. Resultado global — TODOS os packs pf2e

| Métrica | Valor |
|---|---|
| Total documentos escaneados | **28498** |
| _ids válidos (Fusion `^[A-Za-z0-9]{16}$`) | **28498** (100.00%) |
| _ids inválidos | **0** |
| Comprimentos de _id encontrados | 16 chars: 28498 docs |

---

## 3. Análise de formato dos _ids PF2E

Os _ids do repositório pf2e são gerados pelo Foundry VTT como strings de
**16 caracteres Base62** (`[A-Za-z0-9]`), idênticas ao padrão `^[A-Za-z0-9]{16}$`
definido no Fusion para document IDs.

### Características observadas

- Comprimento: sempre exatamente 16 caracteres
- Charset: A-Z, a-z, 0-9 (Base62 Foundry)
- Unicidade: garantida dentro de cada pack (Foundry impede colisão)
- Colisão cross-pack: **possível** — packs diferentes podem ter o mesmo _id
  (ex: `equipment` e `spells` podem ambos ter um documento com _id `ABCdef012345GHij`)

---

## 4. Veredito de compatibilidade

> **COMPATÍVEL — 100% dos _ids pf2e já satisfazem o formato Fusion.**

Todos os **28498** documentos escaneados em todos os packs
possuem `_id` de exatamente 16 caracteres alfanuméricos, satisfazendo
diretamente o padrão `^[A-Za-z0-9]{16}$` do Fusion. Nenhum remapeamento
de formato é necessário.

---

## 5. Política de remapeamento recomendada

Embora o **formato** seja compatível, o _id PF2E **não deve ser reutilizado
diretamente** como UUID Fusion. Motivos:

1. **Colisão cross-pack**: o mesmo _id `XYZ...` pode existir em `equipment`
   E em `spells`. O Fusion usa um namespace global de UUIDs.

2. **Estabilidade e idempotência**: o importer deve produzir o mesmo UUID
   Fusion para o mesmo documento pf2e em todas as runs. O UUID derivado
   deve sobreviver a re-importações e upgrades do repositório pf2e.

3. **Rastreabilidade**: manter a referência ao _id original facilita
   debugging e diff entre versões.

### Política recomendada: UUID derivado por hash

```
fusionId = base62_16(sha1(packName + ":" + pf2eId))
```

- **Determinístico**: mesma entrada → mesmo UUID sempre
- **Sem colisão cross-pack**: `equipment:LJdbVTOZog39EEbi` ≠ `spells:LJdbVTOZog39EEbi`
- **Tamanho preservado**: output continua 16 chars Base62
- **Auditável**: `pf2eSourceId` é mantido no documento intermediário

O mapeamento `pf2eId → fusionId` é persistido em `out/fusion-uuid-map.json`
para uso nos estágios transform (M3-D) e pack (M3-E).

**Nota**: o presente estágio EXTRACT/NORMALIZE preserva o `_id` original
no campo `_id` do formato intermediário. A derivação do UUID Fusion final
ocorre no estágio TRANSFORM (M3-D), que também constrói o mapa de UUIDs.

---

## 6. Tipos de documento por pack (packs alvo)

### abomination-vaults-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 97 |
| hazard | 15 |

### action-macros

| Tipo | Quantidade |
|---|---|
| script | 71 |

### actions

| Tipo | Quantidade |
|---|---|
| action | 559 |

### adventure-specific-actions

| Tipo | Quantidade |
|---|---|
| action | 165 |
| feat | 16 |

### age-of-ashes-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 103 |
| hazard | 27 |

### agents-of-edgewatch-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 148 |
| hazard | 37 |

### ancestries

| Tipo | Quantidade |
|---|---|
| ancestry | 50 |

### ancestry-features

| Tipo | Quantidade |
|---|---|
| feat | 55 |

### backgrounds

| Tipo | Quantidade |
|---|---|
| background | 495 |

### battlecry-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 55 |

### bestiary-ability-glossary-srd

| Tipo | Quantidade |
|---|---|
| action | 55 |

### bestiary-effects

| Tipo | Quantidade |
|---|---|
| effect | 649 |

### bestiary-family-ability-glossary

| Tipo | Quantidade |
|---|---|
| action | 468 |

### blog-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 32 |

### blood-lords-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 135 |
| hazard | 56 |

### book-of-the-dead-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 81 |
| hazard | 25 |

### boons-and-curses

| Tipo | Quantidade |
|---|---|
| feat | 240 |
| effect | 7 |

### campaign-effects

| Tipo | Quantidade |
|---|---|
| effect | 66 |
| feat | 7 |
| condition | 1 |

### class-features

| Tipo | Quantidade |
|---|---|
| feat | 841 |

### classes

| Tipo | Quantidade |
|---|---|
| class | 27 |

### claws-of-the-tyrant-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 27 |
| hazard | 15 |

### conditions

| Tipo | Quantidade |
|---|---|
| condition | 43 |

### criticaldeck

| Tipo | Quantidade |
|---|---|
| (sem tipo) | 106 |

### crown-of-the-kobold-king-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 27 |
| hazard | 15 |

### curtain-call-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 61 |
| hazard | 13 |

### deities

| Tipo | Quantidade |
|---|---|
| deity | 479 |

### equipment

| Tipo | Quantidade |
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

### equipment-effects

| Tipo | Quantidade |
|---|---|
| effect | 689 |

### extinction-curse-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 139 |
| hazard | 28 |

### fall-of-plaguestone

| Tipo | Quantidade |
|---|---|
| npc | 21 |
| hazard | 3 |

### familiar-abilities

| Tipo | Quantidade |
|---|---|
| action | 111 |

### feat-effects

| Tipo | Quantidade |
|---|---|
| effect | 825 |

### feats

| Tipo | Quantidade |
|---|---|
| feat | 5987 |

### fists-of-the-ruby-phoenix-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 127 |
| hazard | 11 |

### gatewalkers-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 64 |
| hazard | 25 |

### hazards

| Tipo | Quantidade |
|---|---|
| hazard | 53 |

### hellbreakers-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 58 |
| hazard | 20 |

### hells-destiny-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 82 |
| hazard | 28 |

### heritages

| Tipo | Quantidade |
|---|---|
| heritage | 322 |

### howl-of-the-wild-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 76 |

### iconics

| Tipo | Quantidade |
|---|---|
| character | 81 |
| familiar | 3 |

### journals

| Tipo | Quantidade |
|---|---|
| (sem tipo) | 7 |

### kingmaker-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 182 |
| hazard | 44 |
| army | 22 |
| character | 14 |

### kingmaker-features

| Tipo | Quantidade |
|---|---|
| campaignFeature | 115 |
| effect | 17 |

### lost-omens-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 377 |
| hazard | 8 |

### macros

| Tipo | Quantidade |
|---|---|
| script | 10 |

### malevolence-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 12 |
| hazard | 8 |

### menace-under-otari-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 82 |
| hazard | 10 |

### myth-speaker-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 68 |
| hazard | 13 |
| vehicle | 1 |

### night-of-the-gray-death-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 15 |
| hazard | 2 |

### npc-gallery

| Tipo | Quantidade |
|---|---|
| npc | 6 |

### one-shot-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 25 |
| hazard | 8 |

### other-effects

| Tipo | Quantidade |
|---|---|
| effect | 53 |

### outlaws-of-alkenstar-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 82 |
| hazard | 16 |

### paizo-pregens

| Tipo | Quantidade |
|---|---|
| character | 55 |
| familiar | 2 |

### pathfinder-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 167 |

### pathfinder-bestiary-2

| Tipo | Quantidade |
|---|---|
| npc | 161 |

### pathfinder-bestiary-3

| Tipo | Quantidade |
|---|---|
| npc | 168 |

### pathfinder-dark-archive

| Tipo | Quantidade |
|---|---|
| hazard | 20 |
| npc | 11 |

### pathfinder-monster-core

| Tipo | Quantidade |
|---|---|
| npc | 492 |

### pathfinder-monster-core-2

| Tipo | Quantidade |
|---|---|
| npc | 445 |
| hazard | 1 |

### pathfinder-npc-core

| Tipo | Quantidade |
|---|---|
| npc | 271 |

### pathfinder-society-boons

| Tipo | Quantidade |
|---|---|
| feat | 157 |

### pfs-introductions-bestiary

| Tipo | Quantidade |
|---|---|
| hazard | 9 |
| npc | 4 |

### pfs-season-1-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 259 |
| hazard | 72 |

### pfs-season-2-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 199 |
| hazard | 55 |

### pfs-season-3-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 198 |
| hazard | 80 |

### pfs-season-4-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 175 |
| hazard | 45 |

### pfs-season-5-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 184 |
| hazard | 47 |

### pfs-season-6-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 252 |
| hazard | 87 |

### pfs-season-7-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 55 |
| hazard | 32 |

### prey-for-death-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 36 |
| hazard | 4 |

### quest-for-the-frozen-flame-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 68 |
| hazard | 19 |

### rage-of-elements-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 81 |

### revenge-of-the-runelords-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 68 |
| hazard | 32 |

### rollable-tables

| Tipo | Quantidade |
|---|---|
| (sem tipo) | 69 |

### rusthenge-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 18 |
| hazard | 7 |

### season-of-ghosts-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 76 |
| hazard | 20 |

### seven-dooms-for-sandpoint-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 53 |
| hazard | 16 |

### shades-of-blood-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 73 |
| hazard | 24 |

### shadows-at-sundown-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 13 |
| hazard | 5 |

### sky-kings-tomb-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 86 |
| hazard | 21 |

### spell-effects

| Tipo | Quantidade |
|---|---|
| effect | 509 |

### spells

| Tipo | Quantidade |
|---|---|
| spell | 1796 |

### spore-war-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 61 |
| hazard | 17 |

### standalone-adventures

| Tipo | Quantidade |
|---|---|
| npc | 7 |
| hazard | 1 |

### stolen-fate-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 88 |
| hazard | 10 |

### strength-of-thousands-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 146 |
| hazard | 13 |

### the-enmity-cycle-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 12 |
| hazard | 5 |

### the-slithering-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 9 |
| hazard | 4 |

### triumph-of-the-tusk-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 70 |
| hazard | 19 |

### troubles-in-grayce-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 27 |
| hazard | 26 |

### troubles-in-otari-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 12 |
| hazard | 6 |

### vehicles

| Tipo | Quantidade |
|---|---|
| vehicle | 98 |

### war-of-immortals-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 11 |
| hazard | 5 |

### wardens-of-wildwood-bestiary

| Tipo | Quantidade |
|---|---|
| npc | 73 |
| hazard | 17 |
