# r29 — As 12 classes restantes: contrato do levantamento

> Rodada de **conteúdo**, sob `specs/31-base-canonica-de-conteudo.md`. Fecha a
> fila aberta pela r21 (5 classes), continuada pela r22 (12) e pelo piloto A6 da
> r28 (Druid). O piloto provou o custo real de uma classe nova: **1 arquivo de
> curadoria + 4 linhas no `planVM` + 6 entradas no `choiceSetInventory`**, zero
> mudança em `transform.mjs`/`build-mvp-subset.mjs`.

## 1. Escopo desta fase: LEVANTAMENTO, não geração

Esta fase produz **estudo**, não pack. Ninguém roda o importer, ninguém gera
`documents.json`, ninguém traduz. A geração dos packs acontece **uma vez, no
fim, pela integração central**, depois que os 12 levantamentos estiverem
revisados. Essa é a regra R1 da r21 (redundância zero por construção) e é o que
permite 6 agentes trabalharem em paralelo sem conflito.

**As 12 classes** (nenhuma tem curadoria hoje):

| Classe | HP/Atrib | Features `items{}` | Class feats candidatos | Eixos (`otherTags`) | Conjura |
| --- | --- | --- | --- | --- | --- |
| witch | 6 / int | 15 | 53 | patron(16), elementalist-patron(7), lesson(19) | sim |
| oracle | 8 / cha | 21 | 56 | mystery(11) | sim |
| summoner | 10 / cha | 24 | 60 | eidolon(13) | sim |
| animist | 8 / wis | 15 | 39 | apparition(13) | sim |
| exemplar | 10 / dex-str | 20 | 49 | ikon(21), worn/weapon/body-ikon, 3 epithets | não |
| thaumaturge | 8 / cha | 24 | 42 | implement(10) | não |
| alchemist | 8 / int | 19 | 67 | research-field(4) | não |
| swashbuckler | 10 / dex | 24 | 73 | style(6) | não |
| guardian | 12 / str | 18 | 65 | — | não |
| investigator | 8 / int | 21 | 56 | methodology(5) | não |
| commander | 8 / int | 18 | 43 | — | não |
| inventor | 8 / int | 26 | 54 | innovation(4) | não |

Os números acima são **medição preliminar do orquestrador**. Confira-os; se o
seu script divergir, o certo é o seu número — reporte a divergência no
relatório em vez de calar.

## 2. Ambiente

- Trabalhe **somente** nesta worktree (`build/app` + branch
  `feat/classes-restantes-estudo`). O repo principal em
  `C:\Users\xansd\pessoal\fusion` está noutra branch e **não pode ser tocado**.
- `tools/importer-pf2e/vendor/` é uma **junction somente-leitura** para o clone
  do `foundryvtt/pf2e`. Leia à vontade; **nunca escreva nada lá**.
- **Não rode** `pnpm install`, `pnpm build`, `pnpm test`, o importer, nem
  nenhum comando `git` que altere estado (commit/add/checkout/restore/push).
  `git log`/`git show` para leitura são permitidos.
- **Não edite arquivo compartilhado**: `transform.mjs`, `build-mvp-subset.mjs`,
  `curation/index.mjs`, `planVM.ts`, schemas, testes. Se você acha que um deles
  precisa mudar, isso é um **achado do relatório**, não uma edição.
- Nada de `git add -A` (lição de 2026-08-10: levou um data-dir inteiro pro
  remoto). Você não commita — quem commita é o orquestrador.

## 3. Entregáveis — exatamente dois arquivos

1. `tools/importer-pf2e/src/curation/classes/<slug>.json` — a configuração.
2. `.fusion-build/r29-classes/<slug>-relatorio.md` — a evidência.

Nenhum outro arquivo. Scripts de medição descartáveis podem ser escritos no
diretório de scratchpad da sua sessão, **fora** da worktree.

## 4. As regras duras (herdadas da r21 §2, todas já custaram caro)

- **R1 — Redundância zero.** Feature compartilhada entre N classes (Shield
  Block está em 7) entra **uma vez**: o pipeline faz a união dos nomes. Seu
  trabalho é **declarar** o que é compartilhado, não recriar.
- **R2 — Prioridade ao que já existe.** Antes de propor qualquer inclusão,
  cruze com os packs atuais (`systems/pf2e/packs/*/documents.json`) por
  **`flags.fusion.sourceId`** (= `_id` do arquivo do vendor). O que já existe é
  **reusado**; listar o conjunto reusado é o que prova que a regra foi obedecida.
- **R3 — Nada de hardcode por classe.** Os eixos de sub-escolha são **dado**:
  `system.traits.otherTags` dos arquivos de `class-features/`, no formato
  `<classe>-<eixo>`. Não invente eixo que a tag não sustente.
- **Nome canônico = segmento final da uuid**, NUNCA `entry.name`. No
  `magus.json` a entrada exibida como "Lightning Reflexes" aponta para
  `...classfeatures.Item.Reflex Expertise`; casar por `name` cria documento
  fantasma.
- **Identidade é `sourceId`, nunca o nome.** Homônimo é padrão no PF2e.
- **Medir, não estimar.** Todo número do relatório vem de script rodado agora,
  com o comando reconstruível a partir do texto. "Cerca de", "aproximadamente"
  e "provavelmente" são defeitos de entrega.
- **O nível genérico do arquivo mente.** `armor-expertise.json` diz 7; o Fighter
  concede no 11. A fonte de verdade é o **nível do `items{}` da classe**. Toda
  divergência encontrada vai para `dedupe.collisionsDetected`.
- **Nada de teste circular** (lição #48): conferir a derivação contra a tabela
  do próprio pack não prova nada. Conferência vale contra fonte **independente**
  (journal do vendor, fichas pregen dos `iconics/`, Pathbuilder).
- **Dívida declarada > invenção.** O que não dá para mecanizar agora (companheiro
  animal, eidolon como criatura, formulário de alquimista) vira nota explícita
  no relatório e `notes[]` no JSON. Predicado inventado é pior que lacuna
  registrada (REQ-BC-034).

## 5. Schema do JSON (fechado — chave desconhecida é REJEITADA pelo loader)

Chaves aceitas no topo: `class`, `displayName`, `vendorClassFile`,
`keyAbilityOptions`, `hp`, `choiceAxes`, `classFeats`, `classFeatures`,
`spellcasting`, `focusSpells`, `prerequisites`, `prerequisiteFixes`, `dedupe`,
`notes`, `proficiencyUpgradeExtras`, `proficiencyMirrors`, `levelBasis`.
Obrigatórias: `class`, `displayName`, `vendorClassFile`, `classFeats`,
`classFeatures`.

Leia o contrato real em `tools/importer-pf2e/src/curation/index.mjs`
(`validateClassCuration`) e use **`druid.json` como modelo mais recente**
(conjuradora completa, com tabela e fonte citada); `fighter.json` como modelo de
classe marcial sem eixo.

`levelBasis: "class"` é obrigatório em toda classe nova (spec 31 §4.3): declara
que os níveis emitidos são níveis **de classe**, não de personagem.

### Validação obrigatória antes de entregar

Rode, da raiz da worktree, trocando `SLUG`:

```
node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='SLUG.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
```

Se isso lançar, sua entrega está quebrada. Cole a saída no relatório.

## 6. Roteiro de medição (mínimo — o relatório do Fighter é o padrão-ouro)

Fontes, todas em `tools/importer-pf2e/vendor/pf2e/packs/pf2e/`:

| O quê | Onde |
| --- | --- |
| Doc da classe | `classes/<slug>.json` → `system.{hp,keyAbility,perception,savingThrows,attacks,defenses,items,ancestryFeatLevels,classFeatLevels,generalFeatLevels,skillFeatLevels,skillIncreaseLevels,trainedSkills,spellcasting}` |
| Features | `class-features/**.json` (pasta grande; varredura **recursiva**) |
| Feats exclusivos | `feats/class/<slug>/level-*/*.json` |
| Feats compartilhados | `feats/class/shared-class-feats/level-*/*.json` filtrados pelo trait da classe (pasta é **subdividida por nível**: `readdirSync` raso devolve 0) |
| Eixos | `otherTags` com prefixo `<slug>-` em `class-features/**` |
| Focus spells | `spells/**` filtrando o trait da classe |
| Tabela de conjuração | `journals/classes.json` (HTML das tabelas oficiais) |
| Conferência independente | `iconics/<nome>/` — fichas pregen por nível |
| Packs atuais do Fusion | `systems/pf2e/packs/{feats-core,class-features-core,spells-core,classes-core}/documents.json` |

## 7. Estrutura do relatório (siga `.fusion-build/r21/fighter-relatorio.md`)

1. Método — os comandos rodados, reconstruíveis.
2. Doc da classe medido (tabela de campos) + `items{}` com nível e divergência
   contra o nível genérico do arquivo.
3. Features compartilhadas com outras classes (varredura das 27 classes).
4. O que já existe nos packs — **reusar** (com `sourceId`).
5. Eixo(s) de sub-escolha — tag, opções, nível, e como o `featureNameInItemsMap`
   casa com o `items{}`.
6. Class feats — total, quebra por nível, exclusivos vs compartilhados, quantos
   já estão em `feats-core` por `sourceId`.
7. Pré-requisitos — quantos têm; quantos resolvem **dentro** do conjunto da
   classe; quais apontam **para fora**; quais não são mecanizáveis (texto de
   perícia/proficiência preservado, sem predicado inventado). Cadeias internas
   vão para `prerequisites.internalChains`.
8. Preparação para multiclasse (r21 §4): gate
   `{"class_level":{"<slug>":{">=":N}}}`; feats com trait de **mais de uma**
   classe são ambiguidade a reportar.
9. Conjuração e focus spells (ver §8 abaixo).
10. Riscos, dívidas e perguntas em aberto para a integração central.

## 8. Conjuradoras — a exigência extra

A tabela de slots por nível **não existe estruturada** no vendor. A do Magus foi
transcrita do journal na r10-B e **errou na primeira tentativa**; o Druid só
passou porque foi conferido contra as fichas da Lini. Portanto:

- Transcreva do `journals/classes.json` **parseando o HTML**, célula a célula —
  nunca "a olho".
- **Confira contra uma segunda fonte independente**: as fichas pregen em
  `iconics/<personagem>/<personagem>-level-{1,3,5}.json` (a entrada de
  spellcasting traz `system.slots`). Cite a fonte no campo
  `spellcasting.source`, como o `druid.json` faz.
- Armadilhas conhecidas: cantrips e slots sobem **em pares**; slot de rank
  descartado **não persiste** no level-up; slot extra de currículo/mistério é
  **por rank** e não se soma aos normais.
- Se as duas fontes divergirem, **pare e reporte** — não escolha a mais bonita.

## 9. O que NÃO entra nesta fase

Tradução pt-BR, geração de pack, wiring do `planVM`/`choiceSetInventory`,
importação de magias novas de tradição incompleta (divine/occult/primal têm
buracos grandes hoje — é dívida a **declarar**, não a fechar aqui), arquétipos
de multiclasse e companheiro animal/eidolon como criatura.
