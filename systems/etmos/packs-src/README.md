# ETMOS — Compendium Packs Source Data

> **AVISO LEGAL — LEIA ANTES DE USAR**
>
> Todo o conteúdo desta pasta é derivado do material oficial do **ETMOS RPG**:
> © Editora Balde Galáctico — Autor: Rafa Reis.
>
> Este material destina-se exclusivamente ao **uso privado do grupo de jogo** no
> contexto do projeto FUSION VTT. **NÃO distribuir, publicar, compartilhar ou
> redistribuir** sem autorização expressa da Editora Balde Galáctico.
>
> Fonte: `SRD-ETMOS-1.1.pdf` (System Reference Document v1.1) e materiais
> suplementares do Quickstart. Ver specs/26 para detalhes de licenciamento.

---

## Arquivos nesta pasta

| Arquivo             | Conteúdo                                         | Entradas                                                            | Ambiguidades                                          |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------- |
| `particulas.json`   | 81 Partículas canônicas do Grimório              | 18 Funções + 19 Objetos + 34 Características + 10 Complementos = 81 | 3 (`verify: true`)                                    |
| `origens.json`      | Catálogo de Origens do SRD + Quickstart          | 5 canônicas (SRD) + 5 do Quickstart                                 | 5 (Quickstart, não confirmadas no SRD)                |
| `habilidades.json`  | Catálogo de Habilidades do SRD + Quickstart      | 5 Práticas + 3 Teóricas (SRD) + 15 do Quickstart                    | 15 (Quickstart)                                       |
| `antagonistas.json` | Fichas base, Aptidões e exemplos de antagonistas | 11 Aptidões canônicas + 2 fichas de exemplo                         | 1 ficha + aptidões do Curupira sem mecânica explícita |
| `tabelas.json`      | Tabelas mecânicas estruturadas                   | 9 tabelas                                                           | 1 (Habilidade Artesão não detalhada no SRD)           |

---

## Formato dos dados

### Estrutura comum a todos os arquivos

```json
{
  "_meta": {
    "sistema": "ETMOS RPG",
    "versao_srd": "1.1",
    "editora": "Balde Galáctico",
    "autor": "Rafa Reis",
    "fonte_primaria": "SRD-ETMOS-1.1.pdf",
    "aviso_legal": "..."
  }
}
```

### Campos especiais

- **`verify: true`** — entrada com ambiguidade ou dado não confirmado pela fonte
  primária. Requer verificação editorial antes de usar em produção.
- **`fonte`** — referência à fonte específica de onde o dado foi extraído.
- **`exemplo_uso`** — frases de exemplo canônicas retiradas do SRD.

---

## Particulas — Contagens e Verificação

| Categoria       | Contagem                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| Funções         | **18** (17 no SRD + 1 excluída: "Mat" não canônica)                              |
| Objetos         | **19**                                                                           |
| Características | **34**                                                                           |
| Complementos    | **10** (5 Modificadores nível 1 + 4 Criadores nível 2–3 + 1 Modificador nível 4) |
| **TOTAL**       | **81**                                                                           |

> Nota: "Mat" (Matar) aparece apenas na ficha do Quickstart de Marcela e não
> consta na Lista Completa do SRD nem na ficha oficial. Está incluída em
> `particulas.json` como entrada com `verify: true` e descrição explicando
> sua exclusão do canônico.

---

## Ambiguidades marcadas (`verify: true`)

1. **`Bhas-` (Emoção)** — o hífen sugere uso como prefixo/criador, mas o SRD
   lista como Característica regular. Tratar como Característica padrão até
   confirmação editorial.

2. **`Hin` (Idioma)** — o OCR de `particulas-v3.pdf` capturou "HEIN". O SRD
   lista "Hin". Canônico = "Hin".

3. **`Cysg` (Sono)** — o OCR de `particulas-v3.pdf` capturou "CYTYSG". O SRD
   lista "Cysg". Canônico = "Cysg".

4. **`Mat` (Matar)** — não canônica. Ver nota acima.

5. **Origens do Quickstart** (5 entradas) — não confirmadas na seção de Origens
   do SRD. Canônicas apenas por uso nos personagens pré-gerados.

6. **Habilidades do Quickstart** (15 entradas) — mesma situação.

7. **Habilidade `Artesão`** mencionada no sistema de encantamento mas não
   detalhada como Habilidade na seção Habilidades do SRD.

8. **Aptidões sem mecânica explícita do Curupira** — "Escalador", "Pés Virados",
   "Imunidade Ígnea", "Fogo Intenso", "Constringir" listadas na ficha mas sem
   descrição mecânica no SRD.

---

## Mapa de consumo no M5

No Milestone 5 (construção dos compendium packs do Foundry VTT), estes arquivos
serão consumidos da seguinte forma:

| Arquivo fonte       | Pack Foundry VTT     | Tipo de documento                                        |
| ------------------- | -------------------- | -------------------------------------------------------- |
| `particulas.json`   | `etmos.particulas`   | `Item` (type: `particula`)                               |
| `origens.json`      | `etmos.origens`      | `Item` (type: `origem`)                                  |
| `habilidades.json`  | `etmos.habilidades`  | `Item` (type: `habilidade`)                              |
| `antagonistas.json` | `etmos.antagonistas` | `Actor` (type: `antagonista`) + `Item` (type: `aptidao`) |
| `tabelas.json`      | `etmos.tabelas`      | `JournalEntry` com seções estruturadas                   |

O script de build (`scripts/build-packs.mjs`, a criar no M5) lê estes JSONs e
gera os arquivos `.db` (LevelDB) para os compendium packs.

---

## Fontes primárias utilizadas

- `SRD-ETMOS-1.1.pdf` — System Reference Document oficial v1.1 (fonte de
  autoridade máxima)
- `particulas-v3.pdf` / `ocr_particulas.txt` — ilustrações e glifos rúnicos das
  Partículas
- `Ficha-final.pdf` / `ocr_ficha.txt` — ficha oficial de personagem
- `etmos sistema.pdf` / `etmos_full.txt` — Quickstart "Grimório de Introdução à
  Linguagem Mágica"
- `12b-etmos-fontes-locais.md` — documento de pesquisa e integração das fontes
