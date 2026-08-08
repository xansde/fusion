# B3 — medições que dimensionam o batch

Tudo aqui foi medido em 2026-08-02 na branch `fix/b2-conteudo-packs` (ou seja, **depois**
do B2 importar conteúdo novo). Os scripts de medição são one-off e não foram commitados;
o que importa é o número e como reproduzi-lo.

## 1. Lacuna de tradução dos packs (issue #9)

Regra de contagem: só entram docs cuja descrição EN tenha **texto de verdade** —
`stripHtmlToText(descriptionEn).trim().length > 0`, a mesma definição que o gate
`missing-description` (issue #27) usa em `tools/translate-packs/src/qa-checks.mjs`.
Markup vazio (`<p></p>`) não conta como prosa a traduzir.

| pack | docs | com prosa EN | sem entrada | descrição vazia | ok |
| --- | --- | --- | --- | --- | --- |
| feats-core | 1807 | 1807 | 348 | 561 | 898 |
| class-features-core | 262 | 262 | 8 | 103 | 151 |
| heritages-core | 53 | 53 | 45 | 0 | 8 |
| backgrounds-core | 42 | 42 | 40 | 0 | 2 |
| spells-core | 1262 | 1262 | 0 | 10 | 1252 |
| ancestries-core | 10 | 10 | 8 | 0 | 2 |
| classes-core | 12 | 12 | 0 | 5 | 7 |
| actions-core | 521 | 521 | 0 | 0 | 521 |
| familiar-abilities-core | 111 | 111 | 0 | 0 | 111 |
| ancestry-features-core | 55 | 55 | 0 | 0 | 55 |
| conditions | 43 | 43 | 0 | 0 | 43 |
| weapons-core | 30 | 30 | 0 | 0 | 30 |
| equipment-core | 18 | 17 | 0 | 0 | 17 |
| bestiary-core | 10 | 0 | 0 | 0 | 0 |
| **TOTAL** | **4236** | **4225** | **449** | **679** | **3097** |

**Lacuna = 1.128** (449 sem entrada + 679 com entrada e descrição vazia).

Os 679 são os que a issue #9 cita e continuam lá; os 449 são novos, trazidos pelo B2.
`bestiary-core` tem 10 docs e nenhum com prosa — não é lacuna.

### O extrator não enxerga os 679

`buildWorkUnitsForPack` (`tools/translate-packs/src/i18n-overlay.mjs:41-70`) pula todo doc
cujo `sourceHash` bata com a entrada existente. Uma entrada com `name` traduzido,
`sourceHash` correto e `description` ausente/vazia satisfaz isso — então `extract.mjs`
classifica os 679 como "já traduzidos" e nunca os emite. É a mesma cegueira que a #27
consertou do lado do QA. A válvula correta para "doc deliberadamente sem prosa traduzida"
é `noDescription: true`, nunca string vazia.

`mergeI18nOverlay` (mesmo arquivo, `:83-105`) monta a entrada como `{ name, sourceHash }`
+ `description` opcional e **descarta qualquer outro campo** — ou seja, perderia a própria
válvula `noDescription` no merge seguinte, e bloqueia guardar `prerequisites` (issue #32).

## 2. Pré-requisitos (issue #32)

```
docs com system.prerequisites não-vazio : 998   (todos em feats-core)
ocorrências                             : 1219
strings DISTINTAS                       : 626
traduzidas                              : 0
```

O `1459` do título da issue era a contagem de entradas do overlay de `feats-core`, não de
pré-requisitos — e esse pack agora tem 1.807 docs.

Classificando as 626 por quanto já existe traduzido em outro lugar:

| classe | distintas | ocorrências | fonte da tradução |
| --- | --- | --- | --- |
| `<rank> in <perícia>` simples | 86 | 349 | rank + `skillNames.ts` (ambos já traduzidos) |
| nome de documento que existe nos packs | 219 | 354 | overlay do próprio doc |
| resíduo | 321 | 516 | tradução à mão |

Do resíduo, **46 apontam para um documento que existe mas está sem tradução** — esses caem
sozinhos quando a #9 fechar. Quebrando os 321 restantes por forma:

| forma | distintas | ocorrências | como resolver |
| --- | --- | --- | --- |
| `<rank> in <assunto composto>` | 48 | 63 | mesmo template de rank; só **32 assuntos distintos** a curar ("Perception", "Fortitude saves", "a skill with the Recall Knowledge action", "unarmed attacks", listas com "or"/"and") |
| expressão de eixo | 144 | 268 | nome da opção já traduzido + ~10 palavras de sufixo (`muse`, `instinct`, `cause`, `bloodline`, `doctrine`, `order`, `thesis`, `racket`, `dedication`, ...) |
| prosa de verdade | 129 | 185 | tradução à mão — e **100 delas aparecem uma única vez** |

Ou seja, o vocabulário realmente curado à mão é da ordem de **32 assuntos de rank + ~10
sufixos de eixo + 129 strings de prosa ≈ 171 itens**, cobrindo as 1.219 ocorrências. As
mais frequentes da prosa são efeitos, não nomes: `focus pool` (6), `warden spells` (6),
`an animal companion` (5), `holy`/`unholy` (5 cada), `a familiar` (3), `divine spells` (3).

Conclusão de projeto: **#32 é majoritariamente composição, não tradução** — o conserto é um
renderizador que compõe a partir de peças já traduzidas, com um vocabulário pequeno de
exceções. E deve rodar **depois** da #9, para não traduzir à mão nome que a #9 vai traduzir
de qualquer jeito.

## 3. Itens vivos no mundo de teste (issues #10, #42, #43)

`~/.fusion/worlds/argiburgo/world.db`, 6 atores:

```
itens embutidos                             98
  com uuid de compêndio                      0   <-- não sobrevive ao embed
  com flags.fusion.sourceId                 79
  com i18n                                  60
    i18n.ptBR.description preenchida        57
    i18n.ptBR presente, description vazia    3
linhas na tabela items                       0   <-- a #43 não tem caso vivo
```

Três consequências:

1. O conserto barato da #10 (preservar o bag já persistido) acerta **57 dos 60** itens que
   hoje renderizam inglês tendo tradução válida gravada ao lado.
2. Como `uuid` não sobrevive ao embed, qualquer resolução em tempo de leitura tem de usar
   `flags.fusion.sourceId` — nunca uuid, nunca nome.
3. A #43 é achado de **código**, não observado em produção: não há nenhum item no mundo.
   Isso não a invalida, mas dimensiona a urgência.

## 3b. Acentuação perdida no overlay JÁ COMMITADO (achado fora do escopo do B3)

Varrendo os 7.573 campos `name`/`description` dos overlays commitados com um dicionário de
palavras que **só existem acentuadas** em pt-BR (a forma sem acento nunca é grafia válida):

```
campos com acento perdido: 621
palavras: voce, condicao, nao, bonus, resistencia, pericia, duracao, acao, ate,
          critico, nivel, acoes, dificil, sao, proximo, distancia, tambem ...
```

Duas armadilhas de medição que atravessei antes de chegar a esse número, registradas
porque a próxima pessoa vai cair nelas:

1. **Enricher aninha colchete.** `@Damage[2d4[persistent,bleed]|options:area-damage]` — um
   strip com `[^\]]*` para no `]` INTERNO e deixa `|options:area-damage]` no texto, que
   casa com `\barea\b`. Isso fabricou 28 ocorrências fantasma. O strip precisa aceitar um
   nível de aninhamento.
2. **Verbo homógrafo.** `pratica` ("você pratica") é grafia correta; `prática` é outro
   uso. O mesmo vale para `critica`. Palavras assim não podem entrar num dicionário de
   "só existe acentuada" — nem `sabedoria`, `carisma`, `destreza`, `ferocidade`, que
   nunca levam acento.

Atinge **nome** de documento, não só prosa — e nome é o que o jogador lê sem abrir nada:
`Nao Detectado` (condição, aparece em token), `Pericia Terreno`, `Multilingue`,
`Acuidade Tatica`, `Pulso de Forca`, `Visao de Calor`, `Pericia com Armas`.

O repo **já tem o corretor**: `tools/translate-packs/src/fix-missing-accents.mjs`, com
dicionário curado, regras de sufixo, proteção dos spans de enricher e idempotência
testada. Ele simplesmente não foi rodado neste conteúdo. Em `--dry-run`:

```
actions-core  112 docs,  465 substituições
conditions     35 docs,  321
feats-core      2 docs,    2
spells-core   418 docs, 3050
TOTAL         567 docs, 3838 substituições
```

Na mesma varredura, uma contaminação de **português europeu**: `spells-core/7gZgITMWR3iRHZA0`
tem o **nome** `"Forma de Demónio"` (pt-PT) em vez de "Demônio", mais uma ocorrência em
prosa. Só 2 casos em 7.573 campos — mas um deles é nome de magia, que o jogador lê no
seletor. (Duas outras ocorrências que a varredura acusou eram falso positivo meu: "equipa"
é o verbo *equipar*, grafia normal em pt-BR.) Entra no mesmo lote de limpeza dos acentos.

**Deliberadamente NÃO executado no B3.** Não está em issue nenhuma, não é o que a #9 pede
(a #9 é sobre descrição *vazia*, não sobre acento), e 3.838 substituições afogariam o
review do batch. Vira issue própria — é o candidato natural a abrir o próximo lote de
i18n, e o conserto é rodar uma ferramenta que já existe e já está testada.

O que **é** do B3: garantir que a tradução nova não engrosse o problema. A mesma varredura
roda sobre os 1.128 documentos novos antes do `apply.mjs`, e o número de 658 tem de ficar
igual depois — se subir, a tradução nova introduziu acento perdido.

## 3c. Colisão no glossário: `finesse` e `precision` viram a mesma palavra

Levantado por um dos tradutores e confirmado por varredura minha do
`glossary.pt-BR.json`. Cruzando todas as categorias, **16 formas pt-BR são reusadas por
termos EN diferentes** — e 14 delas são legítimas, porque o EN também usa a mesma palavra
nos dois lugares (`fire` é tipo de dano E trait; `Disarm` é ação E trait; idem
acid/cold/electricity/mental/poison/sonic/spirit/vitality/void/primal/shove/trip).

Uma é defeito de verdade:

```
damageTypes: precision -> "precisao"
traits:      finesse   -> "precisao"
```

São conceitos **distintos** no PF2e com nomes distintos em inglês: `finesse` é o trait que
deixa usar Destreza no ataque; `precision` é um tipo de dano que várias criaturas resistem.
Colapsando os dois em "precisão", o jogador não consegue distinguir na ficha — e a
distinção é mecânica, não cosmética. `finesse` é o lado a mudar ("acuidade" é a forma usual
em pt-BR); `precision` está correto.

A segunda, mais branda: `Strength` (atributo) e `force` (tipo de dano/trait) viram ambos
"forca". Em português "força" serve para os dois naturalmente, e o contexto separa — não
recomendo mexer.

**Nota importante para não interpretar errado:** os valores do glossário são gravados
**sem diacríticos de propósito** (`"precisao"`, `"agil"`, `"forca"`). Não é acento perdido —
é normalização para o casamento do gate `glossary-applied`, documentada em
`qa-checks.mjs`. Isso é diferente do defeito real da seção 3b, que está no overlay.

**Não corrigido no B3.** Mudar `finesse` no glossário depois de 15 agentes já terem
traduzido com a forma atual criaria divergência dentro do próprio batch. Vira issue.

## 4. Auditoria clean-room de arte (varredura de campos aninhados)

Script próprio, varrendo **todo** campo string de **todo** nó de **todo** documento (não só
`img` de primeiro nível): 4.236 documentos, 10 valores distintos de asset.

Excluí de propósito `flags.fusion.assetSubstitutions[].original` — é a trilha de auditoria
do que foi substituído (nome de arquivo do vendor, nunca um caminho que o app resolve), e
mantê-la é a evidência de que a substituição aconteceu.

Nove dos dez valores são placeholder (`icons/placeholder/*.svg` e `icons/placeholder.svg`),
inclusive nos campos aninhados `system.items.<id>.img` e `items[].img`. **Um não é:**

```
equipment-core / xHtscw4I2ztIg0r5 "Torch"
  flags.fusion.unconvertedRules[].value -> icons/sundries/lights/torch-brown-lit.webp
```

É um caminho de asset da Paizo preservado dentro de uma regra `unconvertedRules` marcada
`_conversionState: "unsupported"`. O asset em si **não** está no repo, e a regra está
inerte — mas a substituição de assets normaliza a chave `img` (no mesmo documento, um
`Strike` inerte já teve seu `img` trocado por `icons/placeholder/feat.svg`) e **não alcança
caminho carregado no `value` de uma regra**. Se a #51 (B6) ligar o consumidor de
`unconvertedRules`, esse caminho passa a ser resolvido de verdade.

Ocorrência única, inerte hoje, e **fora do escopo do B3** — pertence ao B6, junto com a
#51. Registrado aqui para não evaporar.
