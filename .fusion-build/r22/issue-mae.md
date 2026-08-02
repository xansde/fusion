## O que é isto

Varredura de jogabilidade das **12 classes PF2e**, feita em 2026-08-02 depois da
importação de Cleric, Bard, Sorcerer, Champion e Monk. A pergunta não era
"importou?", e sim **"dá pra jogar?"**.

Doze agentes varreram, em paralelo, oito dimensões: caminhos de pré-requisito,
concessão de talentos e ações, concessão de magias e pools de foco, tradução na
ficha, números derivados, mecânica não convertida, integridade dos packs,
progressão de nível — e o aplicativo real, no navegador.

**Resultado: 60 issues** (34 alta, 20 média, 6 baixa), de 74 achados brutos —
26 fundidos por descreverem o mesmo defeito por caminhos diferentes, 1 descartado
por ser suspeita não confirmada.

## O veredito

**Dá para criar personagem nas 12 classes. Não dá para jogar nenhuma ainda.**

Três bloqueios duros:

1. **Não há ancestralidade jogável** — o pack tem 2 opções (Fleshwarp e Ratfolk) e
   nenhuma core. Sem ancestralidade, o personagem fica com Velocidade 0 e sem PV
   de ancestralidade.
2. **Nenhuma magia chega à ficha por automação** — 137 regras de concessão nos
   packs e **zero** apontando para o pack de magias. O pool de foco nasce 0/0 nas
   12 classes, o que tira do Bardo e do Campeão a ação que define a classe.
3. **A sessão cai a cada F5** — o pedido de renovação de sessão vai sem corpo e o
   servidor rejeita antes do handler.

## A descoberta que explica todas as outras

**#48 — a varredura das 12 classes é circular.** Ela confere a proficiência
derivada contra a tabela declarada no próprio pack: tabela incompleta passa no
teste. Os 80 testes verdes foram usados como prova de que as classes estavam
jogáveis — eram prova de que o pipeline é coerente consigo mesmo. Toda esta lista
passou por baixo deles.

A saída está descrita na issue: testar contra as **fichas pregen oficiais da
Paizo**, que já estão vendorizadas no repo. O método já foi usado nesta varredura
e confirmou o HP em 11 das 12 classes.

## O que foi confirmado CERTO

Registrado com o mesmo cuidado dos defeitos, para ninguém reabrir à toa:

- **HP bate com as fichas pregen oficiais** em 11 das 12 classes (níveis 1, 3 e 5).
  Magus não tem pregen para comparar.
- CA, bônus de proficiência, atributo-chave e perícias iniciais: corretos.
- **Zero vazamento de arte da Paizo** nos 14 packs — regra inegociável de
  clean-room, verificada com dado e não só com leitura de código.
- **Zero duplicatas** (três estratégias de busca; os 3 grupos suspeitos foram
  checados à mão e são legítimos).
- **Overlay pt-BR 100% íntegro** nos 3.787 documentos: nenhum órfão, nenhum
  defasado.
- Zero pré-requisito com nível incoerente; cadeia de concessão aninhada funciona.


## Gravidade Alta (34)

**Construtor de personagem**

- [ ] #4 — Escrever system.resources.focusPoints.max ao aplicar a classe: o pool nasce 0/0 e nenhuma magia de foco é lançável
- [ ] #5 — Reconhecer pool de foco concedido por talento ou eixo: Cleric, Monk, Wizard e Ranger não ganham pool nenhum
- [ ] #12 — Restringir a Dádiva de Classe ao keyAbility da classe: Bárbaro aceita Carisma como atributo-chave sem aviso
- [ ] #13 — Progredir a proficiência das entries de conjuração: fica travada em treinado até o nível 20
- [ ] #17 — Corrigir o falso positivo "classe errada" em talentos com mais de um trait de classe (73 talentos entre 5 classes)
- [ ] #18 — Marcar pré-requisito que aponta para nome de talento/feature ausente: 458 entradas medidas, 0 marcações
- [ ] #19 — Adicionar cause, muse, bloodline e doctrine à tabela de eixos do avaliador de pré-requisitos (63 pré-requisitos silenciosos)
- [ ] #20 — Marcar pré-requisito não satisfeito também na lista do seletor, não só no chip depois de escolher
- [ ] #21 — Corrigir falso positivo permanente: "Elemental Apotheosis" é marcada como pré-requisito não satisfeito para TODO Kineticist
- [ ] #22 — Oferecer escolha em Gate's Threshold: o Kineticist de gate único fica travado em 1 elemento do nível 5 ao 20 e perde 89 dos 133 talentos
- [ ] #23 — Marcar impulso de elemento fora do gate: o filtro só existe no picker e só quando já há gate escolhido
- [ ] #49 — Aplicar o teto de nível no aumento de perícia: Mestre exige nível 7 e Lendário exige 15

**Concessão de itens**

- [ ] #3 — Conceder magias pelos packs: 137 regras GrantItem e nenhuma aponta para spells-core
- [ ] #14 — Resolver class feature pelo uuid de featuresByLevel em vez do nome: 7 features não resolvem e o Ladino nível 9 perde a ação Debilitating Strike
- [ ] #15 — Impedir que findAdoptableItem adote um item que já ocupa um slot de build: trocar a musa do Bardo apaga o talento pago e deixa slot fantasma

**Tradução**

- [ ] #9 — Traduzir as 679 descrições que os packs entregam como string vazia (5 classes novas + Kineticist)
- [ ] #10 — Parar de descartar item.i18n ao montar o doc do painel de detalhes (buildEmbeddedDetailsDoc / buildEmbeddedSpellDoc / localizeEmbeddedDoc)

**Conteúdo dos compêndios**

- [ ] #1 — Importar as ancestralidades e antecedentes core: o pack tem 2 de cada e nenhuma jogável
- [ ] #6 — Dar trait `focus` às composições-truque do Bardo (ou incluí-las no filtro): Hino Corajoso é inalcançável no app
- [ ] #16 — Criar (ou remapear) os 12 alvos de grant inexistentes: Bloodrager, Avenger, Vindicator, Runelord, Gate Junction e Masterful Hunter não concedem nada
- [ ] #24 — Importar os talentos de perícia e gerais de nível ≥ 9: Steal Spell (Rogue 16) exige "Legendary Thief", que não existe em pack nenhum
- [ ] #25 — Importar as opções de Blessing of the Devoted do Champion: a escolha de nível 3 não existe e trava 6 talentos com pré-requisito impossível
- [ ] #26 — Reconciliar os nomes de pré-requisito do Monk: Inner Upheaval, Stunning fist e Wholeness of Body não existem em pack nenhum
- [ ] #50 — Aplicar as proficiências de doutrina do Cleric: Fortitude e conjuração ficam em Treinado do nível 1 ao 20
- [ ] #51 — 971 regras de mecânica ficam declaradas e inertes: unconvertedRules não tem consumidor nenhum
- [ ] #52 — Bárbaro: os 7 instintos são inertes — Animal Instinct tem 33 ataques que não chegam à ficha
- [ ] #53 — Sorcerer: as 19 linhagens não propagam tipo de dano nem tradição para as magias de sangue
- [ ] #54 — Champion: deidade e causa não aplicam mecânica (ChoiceSet, ActorTraits e AdjustStrike inertes)

**Servidor**

- [ ] #2 — Corrigir o POST sem corpo em /api/auth/refresh: recarregar a página derruba a sessão (400 FST_ERR_CTP_EMPTY_JSON_BODY)

**Ficha**

- [ ] #7 — Filtrar o seletor de magias de foco por classe e por nível: um Bardo nível 1 pode pegar Imposição de Mãos e Fatal Aria
- [ ] #8 — Dar destino à magia de domínio do Clérigo: sem pool de foco ela entra no grimório preparado
- [ ] #11 — Renderizar o bloco de atributos na ficha: a lista "Ability Scores" fica vazia mesmo com as dádivas escolhidas

**Ferramental e QA**

- [ ] #27 — Fazer o QA de tradução falhar quando o doc tem descrição EN e a tradução vem vazia
- [ ] #48 — A varredura das 12 classes é circular: valida coerência interna, não correção


## Gravidade Média (20)

**Construtor de personagem**

- [ ] #29 — Tratar os pré-requisitos de EFEITO do Ranger ("an animal companion", "warden spells"): as duas maiores subárvores da classe ficam sem verificação
- [ ] #31 — Corrigir o split de pré-requisito na vírgula de Oxford: o candidato sai como "or Twin Riposte" e a aresta se perde
- [ ] #34 — Oferecer a escolha do Divine Font do Cleric: 16 talentos ficam com pré-requisito irresolvível e a ficha não tem Heal/Harm por dia
- [ ] #38 — Persistir as proficiências concedidas pela classe: Fortitude/Reflexos/Vontade/Percepção ficam gravadas como "U"
- [ ] #59 — Sub-escolha dentro do eixo de classe não é oferecida: 58 pendências em ao menos 7 classes

**Concessão de itens**

- [ ] #35 — Registrar (log/telemetria) todo grant que não resolve: hoje 43 falhas por build de classe são silenciosas

**Tradução**

- [ ] #32 — Traduzir system.prerequisites: a ficha em pt-BR mostra os pré-requisitos em inglês (0 de 1459 entradas traduzidas)
- [ ] #40 — Traduzir os traits e rótulos residuais da UI: aba Ações, bloco de Ataques, inventário e modo Edit em inglês
- [ ] #42 — Decidir a migração dos itens já gravados com i18n.ptBR.description vazia: eles continuarão em inglês mesmo depois de traduzir os packs
- [ ] #43 — Item importado do compêndio para o mundo perde o overlay pt-BR de forma permanente (delete worldDoc.i18n)

**Conteúdo dos compêndios**

- [ ] #28 — Corrigir os nomes legados de causa do Champion (paladin/redeemer/liberator) e o "Fiendsbane Oath" ausente: 5 talentos inalcançáveis
- [ ] #30 — Modelar Master of Many Styles como alternativa (OR) e resolver o "(Monk)" que nenhum documento carrega: 3 talentos de Monk ficam órfãos
- [ ] #33 — Derivar a tradição de cada linhagem do Sorcerer: hoje ela só existe em prosa HTML e 6 talentos gated por tradição são inavaliáveis
- [ ] #41 — Expor flags.fusion.sourceId nos indexFields dos packs: a resolução por sourceId é código morto hoje
- [ ] #55 — 78 documentos concedem magia só por prosa: o vendor não automatiza e o Bardo é o mais atingido (23)
- [ ] #56 — Reavaliar AdjustDegreeOfSuccess no MVP: 60 documentos ficam inertes enquanto estiver em V2
- [ ] #57 — Publicar system.maxTakable nos indexFields de feats-core: talento esgotado só é recusado depois do clique

**Ficha**

- [ ] #36 — Não gastar ponto de foco ao lançar composição-truque: castFocusSpell decrementa sempre
- [ ] #37 — Trocar a UI de magias do Bardo de preparado para espontâneo: a aba mostra "Grimório" e "Preparar do grimório…"
- [ ] #39 — Recalcular HP ao escolher a classe: fica 0/0 até o jogador fazer outra escolha qualquer


## Gravidade Baixa (6)

**Construtor de personagem**

- [ ] #44 — Parar de resolver documento por NOME nos caminhos que restaram (PlanDetailsDialog, grafo, knownPossessedNames): risco latente de casar com o doc errado
- [ ] #60 — Verificar se refazer escolha de eixo em nível baixo deixa lixo nos níveis acima

**Concessão de itens**

- [ ] #47 — Corrigir mapVendorToFusionPack: equipment-srd aponta para weapons-core ignorando equipment-core, e conditionitems não tem mapeamento

**Conteúdo dos compêndios**

- [ ] #45 — Cobrir o pré-requisito "animal instinct or untamed order" do Barbarian: 3 talentos escapam da marca que os irmãos recebem
- [ ] #46 — Revisar dois textos de pré-requisito atípicos do vendor ("bloodline the grants occult spells" e "Embodiment of Balance or Cleric")

**Ficha**

- [ ] #58 — Painel de detalhes mostra o nível genérico de class-features compartilhadas (35 divergências em 11 classes)


## Ordem sugerida de ataque

O que dá mais jogabilidade por esforço:

1. **Ancestralidades core** (#1) — sem isso nenhuma ficha fecha.
2. **Sessão que cai no F5** (#2) — atrapalha qualquer teste posterior.
3. **Descrições em inglês** (#9, #10, #43) — atinge toda ficha, o tempo todo. Foi o
   primeiro problema que o dono viu.
4. **Teto de perícia** (#49) — regra do sistema violada em 12/12 classes, conserto
   pequeno e localizado.
5. **`ItemAlteration`** (#51) — o tipo de regra mais frequente (288 casos);
   destrava de uma vez boa parte do Bárbaro, do Sorcerer e do Campeão.
6. **Instintos do Bárbaro** (#52) — ~9 documentos devolvem a subclasse inteira.
7. **Testar contra as pregens** (#48) — não conserta bug nenhum, mas impede a
   próxima leva de passar despercebida.

## Rastro

- Registro completo, com evidência e reprodução: `.fusion-build/r22/varredura-jogabilidade.md`
- Dados brutos das issues: `.fusion-build/r22/issues.json`
- Inventário de escolhas pendentes (anterior, ainda válido): `.fusion-build/r21/escolhas-pendentes.md`
