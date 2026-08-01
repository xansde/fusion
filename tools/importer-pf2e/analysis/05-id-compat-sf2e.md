# 05 — Compatibilidade de \_ids SF2E ↔ Fusion

> Gerado em: 2026-07-05
> Script: `src/extract.mjs --system sf2e`
> Formato Fusion esperado: `^[A-Za-z0-9]{16}$` (16 caracteres alfanuméricos case-sensitive)

---

## 1. Resultado global — packs alvo

| Pack                    | Total docs | \_ids válidos | \_ids inválidos | % válidos |
| ----------------------- | ---------- | ------------- | --------------- | --------- |
| **equipment**           | 538        | 538           | 0               | 100.0%    |
| **spells**              | 159        | 159           | 0               | 100.0%    |
| **conditions**          | 3          | 3             | 0               | 100.0%    |
| **alien-core-bestiary** | 247        | 247           | 0               | 100.0%    |
| **rulebook-bestiaries** | 46         | 46            | 0               | 100.0%    |

**Subtotal packs alvo:**

- Total documentos: **993**
- \_ids válidos (Fusion): **993** (100.00%)
- \_ids inválidos: **0**

---

## 2. Resultado global — TODOS os packs sf2e

| Métrica                                    | Valor               |
| ------------------------------------------ | ------------------- |
| Total documentos escaneados                | **4076**            |
| \_ids válidos (Fusion `^[A-Za-z0-9]{16}$`) | **4076** (100.00%)  |
| \_ids inválidos                            | **0**               |
| Comprimentos de \_id encontrados           | 16 chars: 4076 docs |

---

## 3. Análise de formato dos \_ids PF2E

Os \_ids do repositório pf2e são gerados pelo Foundry VTT como strings de
**16 caracteres Base62** (`[A-Za-z0-9]`), idênticas ao padrão `^[A-Za-z0-9]{16}$`
definido no Fusion para document IDs.

### Características observadas

- Comprimento: sempre exatamente 16 caracteres
- Charset: A-Z, a-z, 0-9 (Base62 Foundry)
- Unicidade: garantida dentro de cada pack (Foundry impede colisão)
- Colisão cross-pack: **possível** — packs diferentes podem ter o mesmo \_id
  (ex: `equipment` e `spells` podem ambos ter um documento com \_id `ABCdef012345GHij`)

---

## 4. Veredito de compatibilidade

> **COMPATÍVEL — 100% dos \_ids pf2e já satisfazem o formato Fusion.**

Todos os **4076** documentos escaneados em todos os packs
possuem `_id` de exatamente 16 caracteres alfanuméricos, satisfazendo
diretamente o padrão `^[A-Za-z0-9]{16}$` do Fusion. Nenhum remapeamento
de formato é necessário.

---

## 5. Política de remapeamento recomendada

Embora o **formato** seja compatível, o \_id PF2E **não deve ser reutilizado
diretamente** como UUID Fusion. Motivos:

1. **Colisão cross-pack**: o mesmo \_id `XYZ...` pode existir em `equipment`
   E em `spells`. O Fusion usa um namespace global de UUIDs.

2. **Estabilidade e idempotência**: o importer deve produzir o mesmo UUID
   Fusion para o mesmo documento pf2e em todas as runs. O UUID derivado
   deve sobreviver a re-importações e upgrades do repositório pf2e.

3. **Rastreabilidade**: manter a referência ao \_id original facilita
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

### equipment

| Tipo       | Quantidade |
| ---------- | ---------- |
| equipment  | 274        |
| weapon     | 144        |
| consumable | 65         |
| armor      | 28         |
| ammo       | 13         |
| shield     | 8          |
| backpack   | 6          |

### spells

| Tipo  | Quantidade |
| ----- | ---------- |
| spell | 159        |

### conditions

| Tipo   | Quantidade |
| ------ | ---------- |
| effect | 3          |

### alien-core-bestiary

| Tipo   | Quantidade |
| ------ | ---------- |
| npc    | 243        |
| hazard | 4          |

### rulebook-bestiaries

| Tipo    | Quantidade |
| ------- | ---------- |
| hazard  | 34         |
| vehicle | 12         |
