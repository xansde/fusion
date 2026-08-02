# Plano de resolução das 66 issues abertas — batches

Revisão feita em 2026-08-02 sobre as 66 issues abertas do repo (60 da varredura r22
sob a issue-mãe #61, mais #62–#65 do teste ao vivo e #66 da r23).

O agrupamento **não** segue a gravidade do label. Segue três critérios, nessa ordem:

1. **Precedência real** — o que torna o resto verificável ou possível vem antes.
2. **Superfície de código compartilhada** — issues que reescrevem o mesmo arquivo
   entram no mesmo batch e rodam em sequência; nunca em paralelo.
3. **Fonte compartilhada** — issues que exigem o mesmo re-import de pack entram
   juntas, para pagar o ciclo de import uma vez só.

## O gargalo que dita o plano

`packages/client/src/lib/sheets/pf2e/planVM.ts` tem **4.589 linhas** e é citado por
issues de quatro famílias diferentes (derivação, pré-requisitos, foco, multiclasse).
`characterSheetVM.ts` tem 2.868. Três batches mexem neles de forma incompatível —
B4, B7 e B9 formam uma **lane serial**. As outras duas lanes (packs/conteúdo e
motor de regras) correm em paralelo a ela.

---

## B0 — Gates e instrumentação (6 issues)

**Issues:** #2, #48, #27, #35, #68, #69
**Tamanho:** M · **Depende de:** nada · **Lane:** livre

**#68 e #69 entraram durante a execução do batch**, e no lugar certo: são gates
quebrados, exatamente o tema daqui. Rodar os gates do B0 revelou que `Format check` e
`Lint` já reprovavam na `build/app` antes de qualquer branch de batch existir — ou seja,
**nenhum PR da esteira fecharia verde**, inclusive o próprio B0.

- **#68** — o `.prettierignore` ignora `tools/importer-pf2e/out/**` mas esqueceu o irmão
  `tools/translate-packs/out/**`, e nunca cobriu `systems/pf2e/packs/**`. Dos 163
  arquivos reprovados, ~157 são artefato gerado; só 6 são código de verdade.
- **#69** — um `no-unnecessary-condition` em `planVM.ts:2548`. Não é conserto mecânico:
  ou o `?.` e o `?? false` são ruído, ou o tipo de retorno de `getItemBuildFlag` está
  mentindo e o lint está mascarando um `TypeError`. Decidir antes de silenciar.

Por que primeiro: nenhum batch posterior é verificável sem isto. #48 é a lição-mestra
da r22 — o teste das 12 classes confere a derivação contra a tabela do próprio pack,
então 80 testes verdes conviveram com 60 defeitos. Trocar a fonte de verdade para as
fichas pregen da Paizo (já vendorizadas em `tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics/`)
é o que impede a próxima leva de passar por baixo. #27 é o mesmo buraco no QA de
tradução; #35 transforma 43 falhas silenciosas de grant por build em sinal — sem ele,
B1/B2/B5 consertam no escuro. #2 vem junto porque a sessão cair a cada F5 atrapalha
todo teste manual daqui em diante.

Ordem: #2 → #48 → #27 → #35.

---

## B1 — Identidade e resolução de documento (7 issues)

**Issues:** #41, #14, #44, #47, #15, #57, #58
**Tamanho:** M · **Depende de:** B0 · **Lane:** livre

Uma família só: **parar de resolver documento por nome**. #41 publica
`flags.fusion.sourceId` nos indexFields — hoje a resolução por sourceId é código morto,
e ela é a chave de todo o resto. Com ela no ar, #14 (class feature pelo uuid de
`featuresByLevel`) e #44 (PlanDetailsDialog, grafo, knownPossessedNames) deixam de ser
remendos. #47 conserta o mapa vendor→pack; #57 publica `maxTakable`; #15 impede que
`findAdoptableItem` engula item que já ocupa slot pago; #58 resolve a feature certa no
painel de detalhes.

Vem cedo porque toda concessão e todo pré-requisito dos batches seguintes depende de
casar com o documento certo — homônimo é padrão no PF2e.

Ordem: #41 primeiro (habilita os demais) → #47 → #14 → #44 → #15 → #57 → #58.

---

## B2 — Conteúdo faltante dos packs (9 issues)

**Issues:** #1, #24, #16, #25, #26, #28, #30, #45, #46
**Tamanho:** G · **Depende de:** B1(#41, #47) · **Lane:** packs

Todas mexem em `tools/importer-pf2e/src/curation/*`, `build-mvp-subset.mjs` e
`packs/*/documents.json`, e todas exigem re-import. Juntas, o ciclo de import se paga
uma vez.

#1 é o bloqueio duro nº 1 da varredura — 2 ancestralidades e nenhuma jogável significa
Velocidade 0 e sem PV de ancestralidade em qualquer ficha. #24 (talentos de perícia e
gerais nível ≥ 9) resolve de graça parte de #16, porque `Scare to Death` é um dos alvos
de grant ausentes. #25/#26/#28/#30/#45/#46 são reconciliações de nome e opções faltantes
em Champion, Monk e Barbarian.

Ordem: #1 → #24 → #16 → #25/#26/#28/#30 (independentes entre si) → #45/#46.

---

## B3 — i18n de ponta a ponta (8 issues)

**Issues:** #10, #43, #9, #32, #42, #40, #64, #65
**Tamanho:** G · **Depende de:** B2 (traduzir depois de importar) · **Lane:** livre

Superfície própria (`compendium/service.ts`, `documentDetails.ts`, `i18n/pt-BR.json`,
`packs/*/i18n.pt-BR.json`), com o gate já instalado em B0(#27).

A ordem interna importa: primeiro **parar de perder** a tradução (#10 descarta `item.i18n`
no painel de detalhes; #43 apaga o overlay de forma permanente ao importar do compêndio
para o mundo), depois **produzir** (#9: 679 descrições vazias; #32: 1.459 pré-requisitos,
0 traduzidos), depois **migrar** o que já foi gravado vazio (#42), e por último os rótulos
residuais de UI (#40, #64, #65).

Inverter isso desperdiça a tradução: traduzir antes de #43 é encher um balde furado.

Ordem: #10 → #43 → #9 → #32 → #42 → #40 → #64 → #65.

---

## B4 — Régua do sistema: números derivados (8 issues)

**Issues:** #49, #50, #38, #13, #12, #39, #11, #63
**Tamanho:** M · **Depende de:** B0(#48) · **Lane:** planVM (serial)

Este é exatamente o batch que o teste-pregen de #48 valida — por isso ele vem logo
depois do gate, e não antes. São as regras do sistema que ou não existem, ou não
persistem: teto de perícia (Mestre ≥ 7, Lendário ≥ 15 — violado em 12/12 classes),
proficiências de doutrina do Cleric, proficiências de classe gravadas como "U",
progressão de conjuração travada em treinado até o nível 20, Dádiva de Classe aceitando
atributo fora do keyAbility, HP 0/0 até o jogador clicar em outra coisa, bloco de
atributos vazio na ficha e a aba Perícias exibindo "Untrained" em tudo.

#49 primeiro: é a regra mais violada e o conserto mais localizado.

Ordem: #49 → #50 → #38 → #13 → #12 → #39 → #11 → #63.

---

## B5 — Foco e magias (10 issues)

**Issues:** #4, #55(decisão), #3, #5, #6, #7, #8, #36, #34, #37
**Tamanho:** G · **Depende de:** B1, B2 · **Lane:** livre

Bloqueio duro nº 2 da varredura: nenhuma magia chega à ficha por automação e o pool de
foco nasce 0/0 nas 12 classes — o que tira do Bardo e do Campeão a ação que define a
classe.

#4 é a fundação (escrever `system.resources.focusPoints.max` ao aplicar a classe); sem
ela, #5/#7/#8/#36/#34 não têm onde escrever. **#55 é decisão de produto e precisa ser
resolvida antes de #3**, porque muda o escopo: 78 documentos concedem magia só na prosa,
e o vendor não tem o dado — ou se escreve a concessão à mão, ou se aceita que o jogador
adiciona manualmente.

Ordem: decidir #55 → #4 → #3 → #5 → #6 → #7 → #8 → #36 → #34 → #37.

---

## B6 — Ataques na ficha e motor de rule elements (7 issues)

**Issues:** #62, #51, #52, #53, #54, #33, #56(decisão)
**Tamanho:** GG (o maior do plano) · **Depende de:** B1 · **Lane:** mechanics

971 regras de mecânica declaradas e inertes, em 413 documentos: `unconvertedRules` não
tem consumidor nenhum. De 660 regras classificáveis, **exatamente 1 é cosmética** — o
resto é mecânica real que o jogador supõe que funciona.

#62 abre o batch por ser o caso mais simples da mesma família (o Monge não tem ataque
desarmado porque o coletor de equipamento não conta o punho — independente do motor) e
valida a superfície de ataques antes dos 61 `Strike` de #51.

Dentro de #51, a ordem do próprio levantamento: `ItemAlteration` (288 casos, destrava
sozinho boa parte de Bárbaro/Sorcerer/Champion) → `ChoiceSet` (99, é o seletor que
alimenta os demais e o que B8 precisa) → `AdjustModifier` (80) → `Strike` (61) → o resto.
Feito o motor, #52/#53/#54 são os consumidores: instintos do Bárbaro (~9 documentos que
devolvem a subclasse inteira — melhor ganho/esforço da lista), linhagens do Sorcerer
(+#33, a tradição que só existe em prosa HTML) e deidade/causa do Champion.

**#56 é decisão:** manter `AdjustDegreeOfSuccess` em V2 deixa 60 documentos inertes.

Ordem: #62 → #51(ItemAlteration → ChoiceSet → AdjustModifier → Strike) → #52 → #53 → #33 → #54; decidir #56 no início.

---

## B7 — Pré-requisitos e grafo de talentos (7 issues)

**Issues:** #17, #19, #21, #18, #20, #31, #29
**Tamanho:** M · **Depende de:** B1(#44), B2 · **Lane:** planVM (serial)

Todas reescrevem `planVM.ts` e `curation/grafo-de-feats.mjs` — daí serem um batch
sequencial e não um fan-out.

Consertar os falsos positivos antes de acrescentar marcação nova: #17 (73 talentos
marcados como "classe errada" por terem mais de um trait de classe), #19 (cause, muse,
bloodline e doctrine fora da tabela de eixos — 63 pré-requisitos silenciosos), #21
("Elemental Apotheosis" reprovada para todo Kineticist). Só então #18 (marcar
pré-requisito com alvo ausente: 458 entradas medidas, 0 marcações) e #20 (marcar também
na lista do seletor, não só no chip). #31 (vírgula de Oxford) e #29 (pré-requisitos de
efeito do Ranger) fecham.

**#18 depende de B2 estar pronto** — antes disso ele marcaria como ausente o que apenas
falta importar, e produziria ruído em massa.

Ordem: #17 → #19 → #21 → #18 → #20 → #31 → #29.

---

## B8 — Sub-escolhas e Kineticist (4 issues)

**Issues:** #59, #22, #23, #60
**Tamanho:** M · **Depende de:** B6(#51, ChoiceSet) · **Lane:** livre

#59 é o mecanismo genérico: consumir o `ChoiceSet` do próprio vendor como sub-slot,
em vez de escrever mais um caminho à mão. São 58 escolhas pendentes de 76 mapeadas,
em ao menos 7 classes, já inventariadas em `.fusion-build/r21/escolhas-pendentes.md`.
Por isso vem depois do consumer de `ChoiceSet` em B6 — construir o mecanismo genérico
antes somaria mais casos manuais.

#22 e #23 são o Kineticist, que é o caso mais caro: sem escolha em Gate's Threshold o
personagem de gate único fica travado em 1 elemento do nível 5 ao 20 e perde 89 dos 133
talentos. #60 verifica se refazer escolha de eixo em nível baixo deixa lixo acima.

Ordem: #59 → #22 → #23 → #60.

---

## B9 — Multiclasse por níveis: UI (1 issue)

**Issue:** #66
**Tamanho:** G · **Depende de:** B7 (mesma superfície) · **Lane:** planVM (serial)

Épico próprio, e o único que não vem da varredura r22. A derivação está pronta e verde
no servidor (`classLevels`, `hpByLevel`, `proficiencyOrigin`, `spellcastingLevels` já
saem em `system.derived`) — nenhum cálculo novo é necessário, é apresentação: toggle,
divisão na identidade, slot de nível de classe no Plano, HP/proficiência auditáveis,
rank por entrada de conjuração, elegibilidade pelo par (nível de classe, nível de
personagem) e exclusão mútua classe ↔ dedicação.

Vem por último da lane `planVM` justamente pelo aviso da própria issue: é onde vive boa
parte das 60 issues da r22, e misturar defeito novo com defeito velho no mesmo arquivo
custa caro.

> **Em curso fora deste plano (2026-08-02).** Há trabalho da #66 sendo feito em paralelo
> direto na `build/app` — `planVM.ts`, `PlanColumn.svelte`, `CharacterSheet.svelte`,
> `SpellsTab.svelte`, os dois `i18n/*.json` e testes novos (`class-levels-plan.test.ts`,
> `class-levels-spellcasting.test.ts`). Se esse trabalho seguir, B9 deixa de ser um batch
> a executar e vira só o fechamento da issue — mas **B4 e B7 passam a conflitar com ele**,
> porque disputam o mesmo `planVM.ts`. Alinhar antes de abrir B4.

---

## B10 — Issue-mãe (1 issue)

**Issue:** #61
**Tamanho:** P · **Depende de:** B2..B8 · **Lane:** livre

Não é trabalho: é o fechamento da épica da varredura r22 quando os 60 achados estiverem
resolvidos. Fica registrada como batch próprio só para que a contagem feche — 68 issues
abertas, todas em algum batch.

---

## Ondas de execução

Três lanes: **planVM** (serial), **packs/conteúdo** e **mechanics/livre**.

| Onda | planVM (serial) | Lane B | Lane C | estado |
| --- | --- | --- | --- | --- |
| 1 | — | **B0** gates | — | PR #67 |
| 2 | — | **B1** identidade | — | próximo |
| 3 | **B4** derivações | **B2** packs | **B6** motor de regras | |
| 4 | **B7** pré-requisitos | **B3** i18n | **B5** foco e magias | |
| 5 | **B9** multiclasse UI | **B8** sub-escolhas | — | em curso fora do plano |
| 6 | — | **B10** fechar #61 | — | |

Um PR por batch, sempre contra `build/app` — nunca contra `main`. Um por vez também no
merge: é o que evita conflito, já que vários batches disputam os mesmos arquivos.

## Decisões de produto que travam trabalho

Três issues não são conserto, são escolha — e cada uma muda o escopo do batch que a
contém. Resolver antes de o batch começar:

- **#55** (abre B5) — 78 documentos concedem magia só na prosa e o vendor não tem o dado:
  escrever a concessão à mão ou aceitar entrada manual do jogador?
- **#56** (abre B6) — `AdjustDegreeOfSuccess` fica em V2? São 60 documentos inertes.
- **#42** (dentro de B3) — migrar os itens já gravados com `i18n.ptBR.description` vazia,
  ou deixá-los em inglês para sempre?

## Observação fora de escopo

`planVM.ts` (4.589 linhas) sendo lane serial única é o principal limitador de paralelismo
deste plano — três batches inteiros esperam fila por causa dele. Quebrá-lo não está em
nenhuma issue e não foi incluído aqui; se virar prioridade, o ponto natural é entre B4 e
B7, quando o arquivo já terá sido tocado uma vez e ainda não recebeu a multiclasse.
