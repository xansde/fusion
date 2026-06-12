# @fusion/importer-pf2e — Pipeline de Importação

Este pacote implementa o pipeline **extract → transform → pack** que converte os
dados de compendium do repositório `foundryvtt/pf2e` (Apache-2.0) em packs Fusion
versionados, importáveis de forma idempotente.

Referências de spec:
- `specs/16-compendiums-e-importacao.md` — spec do pipeline
- `specs/17-sistema-pf2e.md` — schema de dados PF2E no Fusion
- `specs/26-licencas-e-legal.md` — licença ORC/OGL; arte Paizo proibida

---

## Pipeline em 3 fases

```
vendor/pf2e/packs/
       │
       ▼ [Phase 1: Extract]
   src/extract/
       │  Lee JSONs da sparse-checkout do repo pf2e
       │  Resolve folders aninhadas (_folders.json)
       │  Filtra packs pelo manifest de packs essenciais
       │
       ▼ [Phase 2: Transform]
   src/transform/
       │  mapeia campos pf2e → schema Fusion (ver analysis/02-schema-actor-item.md)
       │  substitui img proprietária por placeholder
       │  processa system.rules[] (ver analysis/03-rules-elements.md):
       │    - REs suportados: mantidos como-está
       │    - REs não suportados: marcados com _unsupported:true
       │  reconstrói UUIDs: pf2e UUID → Fusion UUID
       │  valida com Zod schema (fase posterior)
       │
       ▼ [Phase 3: Pack]
   output/packs/
       Formato: NDJSON (um documento por linha) por pack
       Arquivo de metadados: output/packs/<pack-name>/pack.json
       Mapa de UUIDs: output/fusion-uuid-map.json
       Relatório: output/import-report.json
```

---

## Estrutura de arquivos planejada

```
src/
├── cli.mjs                  # Entrypoint CLI (commander)
├── config.mjs               # Configuração: packs essenciais, paths, flags
│
├── extract/
│   ├── index.mjs            # Orquestrador da fase Extract
│   ├── collectFiles.mjs     # Varre diretório recursivamente, exclui _folders.json
│   ├── resolveFolders.mjs   # Mapeia folder IDs para nomes de categoria
│   └── packManifest.mjs     # Lista de packs a importar por tier (T1/T2/T3)
│
├── transform/
│   ├── index.mjs            # Orquestrador da fase Transform
│   ├── transformDocument.mjs # Dispatch por tipo de documento
│   ├── transformWeapon.mjs  # Mapeamento de campos weapon/armor/equipment
│   ├── transformSpell.mjs   # Mapeamento de campos spell
│   ├── transformNpc.mjs     # Mapeamento de campos npc (actor)
│   ├── transformFeat.mjs    # Mapeamento de campos feat/feature
│   ├── transformEffect.mjs  # Mapeamento de campos effect
│   ├── rules/
│   │   ├── index.mjs        # Processa array system.rules[]
│   │   ├── supported.mjs    # Set de chaves suportadas pelo motor Fusion
│   │   └── patchUuids.mjs   # Traduz UUIDs pf2e → Fusion
│   ├── art/
│   │   └── replaceArt.mjs   # Substitui img proprietária por placeholder por tipo
│   └── schema/
│       └── fusionDocument.zod.mjs  # Zod schema para validação (fase posterior)
│
├── pack/
│   ├── index.mjs            # Orquestrador da fase Pack
│   ├── writeNdjson.mjs      # Serializa documentos em NDJSON
│   ├── writePackMeta.mjs    # Gera pack.json com metadados e versão
│   └── uuidMap.mjs          # Constrói e persiste fusion-uuid-map.json
│
└── report/
    └── importReport.mjs     # Gera import-report.json com estatísticas e erros
```

---

## Formato de saída — Pack Fusion

Cada pack é um diretório com:

```
output/packs/<pack-name>/
├── pack.json          # Metadados: name, version, source, license, docCount
└── documents.ndjson   # Um documento JSON por linha
```

### Exemplo `pack.json`
```json
{
  "name": "equipment",
  "fusionVersion": "0.1.0",
  "sourceRepo": "foundryvtt/pf2e",
  "sourceCommit": "<sha>",
  "importedAt": "2026-06-12T00:00:00Z",
  "docCount": 5645,
  "licenses": ["ORC", "OGL"],
  "unsupportedRuleElements": 142,
  "artReplaced": 5645
}
```

---

## Convenções de placeholder de arte

| Tipo de documento | Placeholder |
|---|---|
| weapon | `/icons/placeholder/weapon.svg` |
| armor / shield | `/icons/placeholder/armor.svg` |
| spell | `/icons/placeholder/spell.svg` |
| consumable | `/icons/placeholder/consumable.svg` |
| equipment (genérico) | `/icons/placeholder/item.svg` |
| npc / character | `/icons/placeholder/npc.svg` |
| feat / action | `/icons/placeholder/feat.svg` |
| effect | `/icons/placeholder/effect.svg` |
| condition | `/icons/placeholder/condition.svg` |

Os arquivos SVG placeholder são fornecidos por `packages/shared/assets/icons/placeholder/`.

---

## Flags de CLI planejadas

```
fusion-importer-pf2e extract [--packs tier1,tier2] [--out ./output]
fusion-importer-pf2e transform [--strip-lore] [--src ./output] [--out ./fusion-packs]
fusion-importer-pf2e pack [--src ./fusion-packs] [--format ndjson|leveldb]
fusion-importer-pf2e all [--strip-lore] [--packs tier1]
```

- `--strip-lore` — substitui texto narrativo (publicNotes, lore descriptions) por
  placeholder `[lore removed — see source publication]`
- `--packs` — seleciona tiers ou packs individuais por nome

---

## Idempotência e versionamento

O importer é **idempotente**: rodar duas vezes com o mesmo source produz output
identico (mesmos UUIDs Fusion, mesmos documentos). Os UUIDs Fusion são derivados
de `sha1(pf2eSourceId + packName)` para estabilidade entre runs.

O `import-report.json` registra diff entre runs (documentos adicionados/removidos/
alterados) para facilitar updates de versão do repositório pf2e.
