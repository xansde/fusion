# 47 — Fabricação e Alquimia

- **Título:** Fabricação e Alquimia — recurso de classe, preparação diária, livro de fórmulas e item infundido
- **Status:** draft v0.1 (2026-09-17)
- **Nível:** Recorte (ver DEC-FAB-01)
- **Baseada em:**
  - `15-api-de-sistemas.md` — a superfície pela qual o sistema declara o que sabe fazer: hooks de turno aguardados e mecânica de ator (REQ-SYS-138..142), plano de consumo de item e hook pós-consumo (REQ-SYS-143, REQ-SYS-144), e os pontos novos que esta spec obriga (REQ-SYS-145..148).
  - `17-sistema-pf2e.md` — a regra do PF2e remaster: derivação sem persistir (DEC-PF2-03), efeito como cópia embutida com expiração ancorada (DEC-PF2-11, REQ-PF2-217..223), plano de consumo e strike de item alquímico (DEC-PF2-12, REQ-PF2-224..228), DCs por nível e raridade (REQ-PF2-042), proficiência de categoria de ataque (REQ-PF2-207).
  - `10-combate-e-iniciativa.md` — os eventos de turno e de fim de combate que ancoram a expiração do que é fabricado (REQ-CBT-056).
  - `09-chat-e-mensagens.md` — o card que relata o que foi preparado, fabricado ou gasto (REQ-CHT-053).
  - `11-ui-framework-e-fichas.md` — a ficha por abas e o binding que a aba de Fabricação usa (REQ-UIF-020).
  - `16-compendiums-e-importacao.md` — o pack de onde a fórmula copia o documento (REQ-CMP-010a).
  - `05-usuarios-e-permissoes.md` e `21-seguranca.md` — posse do ator, papel privilegiado e redação por plateia (REQ-USR-013, REQ-SEC-020).

> **Spec de recorte.** Esta spec é dona do ciclo **recurso → preparação → fórmula → item
> fabricado**: o que é um recurso de classe, como corre a preparação diária, o que é um livro
> de fórmulas e o que distingue um item infundido de um item comprado. Ela atravessa `15`,
> `17`, `10`, `09`, `11`, `16`, `05` e `21`, e **não redefine requisito nenhum dessas áreas:
> cita**. As decisões que ela NÃO PODE contrariar, e não contraria: DEC-PF2-03 (dado derivado
> nunca é persistido), DEC-PF2-11 (efeito aplicado é cópia embutida), DEC-PF2-12 (strike de
> consumível sem equipar), DEC-SYS-12 (aplicar dano e condição é op do core) e REQ-PF2-223
> (fora de combate não corre relógio). Os pontos de extensão novos que ela exige da `15` estão
> em §12 — nenhuma spec fica contrariada em silêncio.

---

## 1. Objetivo

Dar dona ao que o Alquimista precisa para existir e que hoje não tem lugar: um **recurso de
classe** que não seja um campo novo no schema do ator por classe, uma **preparação diária**
que não seja um botão que escreve meia dúzia de campos, uma **fabricação** que não seja uma op
nova por ação, e um **item infundido** que saiba quem o fez e por quanto tempo vale.

O teste de corte do `CONVENCOES.md` §1 é o que junta os quatro numa spec só: decidir como um
recurso de classe é declarado obriga a decidir quem o recarrega (a preparação); decidir a
preparação obriga a decidir o que ela fabrica (a Alquimia Avançada); decidir a fabricação
obriga a decidir o que o item fabricado carrega (infusão, prazo e DC). São decisões que se
restringem mutuamente — não cabem em quatro specs, e nenhuma delas cabe dentro de uma área
existente sem virar dona de um conceito que não é dela.

O que esta spec **não** é: ela não inventa mecânica nova. A regra é a do PF2e remaster, a
superfície é a da `15`, e a conta de dano, efeito e strike continua sendo da `17`.

## 2. Escopo

### 2.1 O que inclui

- **Recurso de classe** como dado: o descritor `special-resource`, o avaliador de fórmula, o
  estado persistido, o derivado, a recarga e o contador na ficha.
- **Frequência** de item ou talento (1/dia e afins) como caso do mesmo contrato.
- **Preparação diária** como pipeline de etapas registráveis, transacional, com escolha.
- **Livro de fórmulas**: o que o ator conhece, como se adiciona, como se conta.
- **Fabricação** como uma op parametrizada por _ability_ (Alquimia Avançada, Alquimia Rápida),
  com hook de rascunho para quem quiser alterar o item antes de ele existir.
- **Item infundido**: o carimbo do criador, a DC pela Class DC, o prazo e o lote diário.
- **Frasco versátil** como recurso que vira strike e se refaz em exploração.
- **Atividade Craft** no servidor e o **custo** emitido por porta, sem tocar em moeda.

### 2.2 O que NÃO inclui

- **Carteira e economia.** Nenhum requisito desta spec debita, credita ou valida moeda. O
  custo é **emitido** (DEC-FAB-05) e quem o descontar será outra spec (Q-FAB-01).
- **Relógio de mundo e downtime.** Não há passagem de tempo automática; a única saída fora de
  combate é a preparação diária ou a remoção manual (REQ-PF2-223). Dias de Craft são registro,
  não simulação (Q-FAB-02).
- **Aflição, veneno e mutágeno** — são da spec `48` (reservada), que consome o item infundido e
  o resolvedor de DC desta spec.
- **Aditivo, custo de ação e reação** — são da spec `49` (reservada). Esta spec só abre o ponto
  de extensão (REQ-FAB-028).
- **Motor de rule elements** (DEC-SYS-04 e a evolução registrada em REQ-SYS-149): o descritor
  de recurso é um `kind` que entra por lá, não um motor paralelo.
- **O conteúdo dos packs** (quais itens alquímicos existem, texto pt-BR, curadoria) — é da `16`
  e da `17`.
- **A conta de respingo, dano persistente e IWR** — é da `17` (REQ-PF2-060, REQ-PF2-061).

## 3. Conceitos e terminologia

| Termo                     | Significado nesta spec                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Recurso de classe**     | Contador nomeado do ator, com valor e máximo derivado, declarado por um item que o ator tem (característica de classe, talento).     |
| **Descritor**             | A regra `kind: "special-resource"` dentro do `system.rules` desse item. É o único jeito de declarar um recurso.                      |
| **Frequência**            | Recurso de uso limitado de um item ou talento (1/dia), com slug `freq:<itemSlug>`. É um recurso de classe, não um mecanismo à parte. |
| **Preparação diária**     | A operação que o Descansar dispara: recupera PV, slots, foco, recarrega recursos, expira o que venceu e fabrica o lote do dia.       |
| **Etapa**                 | Unidade registrável da preparação, com id, ordem, aplicabilidade e escolha opcional.                                                 |
| **Fórmula**               | A referência, no ator, a um documento de item de um pack que ele sabe fabricar. Identidade é `flags.fusion.sourceId`, nunca o nome.  |
| **Livro de fórmulas**     | O conjunto de fórmulas conhecidas do ator.                                                                                           |
| **Ability de fabricação** | A regra que diz **como** um ator fabrica: o que custa, qual o teto de nível, quantos itens e com que prazo o item nasce.             |
| **Item infundido**        | Item fabricado com a trait `infused`, que carrega o criador e a Class DC dele, e tem prazo de validade.                              |
| **Lote diário**           | Quantos itens de Alquimia Avançada o ator já fez na preparação de hoje, e o teto.                                                    |
| **Porta de custo**        | A interface pela qual a fabricação anuncia quanto custou, sem saber quem paga.                                                       |

## 4. Decisões

### DEC-FAB-01 — Recurso de classe é dado declarado no item, e esta spec é um recorte

**Decisão:** Um recurso de classe é declarado por um **descritor** dentro do `system.rules` do
item que o concede (`kind: "special-resource"`), com `max` e `level` como **fórmulas em texto**
avaliadas por um avaliador próprio. A engine não tem campo por classe, e nenhuma classe tem
código próprio de recurso. O nível desta spec é **Recorte**: ela atravessa `15`, `17`, `10`,
`09`, `11` e `16` e não é dona de nenhuma delas.

**Racional:** O caminho alternativo — um campo no schema do ator por classe (`vials`, `focus`,
`versatilVials`) — obriga a mexer no schema e na ficha a cada classe nova, e faz a ficha
conhecer o Alquimista. Descritor é dado: o importer converte, o pack carrega, e a ficha só sabe
desenhar um contador. O nível de recorte segue do teste de corte do `CONVENCOES.md` §1: recurso,
preparação, fabricação e item infundido se restringem mutuamente, e nenhum deles é dono de uma
área existente.

**Alternativa rejeitada:** avaliar `max` com `eval`/`Function`. Fórmula vem de pack importado —
é entrada não confiável (REQ-SEC-020), e um avaliador de gramática fechada custa menos que a
auditoria de um `eval` que nunca fica segura.

### DEC-FAB-02 — Preparação diária é um pipeline transacional de etapas registráveis

**Decisão:** O Descansar deixa de ser um punhado de escritas do cliente e passa a ser a op de
servidor `actor:dailyPrep`. O sistema **registra etapas** (`registerDailyPrepStep`), cada uma
com id, ordem e aplicabilidade; o core as executa em ordem, **numa transação só**, e publica um
card de resumo. Etapa que lança aborta tudo: não existe preparação pela metade.

**Racional:** A preparação é o único ponto do jogo em que quatro subsistemas escrevem o mesmo
ator ao mesmo tempo (PV, slots, foco, recursos, expiração, lote do dia). Sem ordem declarada, a
ordem vira a ordem em que alguém chamou; sem transação, uma falha no meio deixa o ator com os
frascos cheios e os PV do dia anterior. É o oposto do isolamento de erro dos hooks de turno
(REQ-SYS-139) — e de propósito: lá o combate não pode parar por causa de um sistema; aqui a
preparação inteira é a unidade de sentido.

**Alternativa rejeitada:** cada sistema chamando suas próprias ops no Descansar. Espalha a
atomicidade por N ops e torna impossível dizer o que aconteceu num card só.

### DEC-FAB-03 — Uma op de fabricação, várias abilities parametrizadas

**Decisão:** Fabricar é sempre `crafting:create`, com um `abilitySlug`. Quem responde pelas
diferenças é a `CraftingAbilityDefinition` registrada pelo sistema: `maxItemLevel`, `cost`,
`capacity`/`maxPerUse` e `expiry`. Alquimia Avançada, Alquimia Rápida e o que vier depois são
**parâmetros**, não ops novas. A atividade Craft (`crafting:craft`) é separada porque rola um
teste e cria item permanente — não é o mesmo ato.

**Racional:** As ações de fabricação diferem em quatro números e um prazo; o resto (validar
fórmula, copiar o documento do pack, carimbar, debitar, gravar, publicar) é idêntico. Uma op por
ação multiplicaria a superfície de permissão e de atomicidade — os dois lugares onde erro custa
caro — para não compartilhar nada.

**Alternativa rejeitada:** uma op por ação (`crafting:quickAlchemy`, `crafting:advancedAlchemy`).

### DEC-FAB-04 — O item fabricado carrega criador, Class DC e prazo; o prazo é RAW, sem relógio novo

**Decisão:** O item que nasce de `crafting:create` recebe a trait `infused`,
`system.fusion.infused = { actorId, classDc }` e `system.fusion.expiry` — os três no **próprio
item**, decididos pelo **servidor** a partir da ability. Os prazos seguem a regra escrita, sem
relógio novo (decisão D-06 do plano do Alquimista): em combate, item de Alquimia Rápida vale até
o **início do próximo turno** do fabricante, o Quick Vial até o **fim do turno atual**, e efeito
que esse item aplique é truncado em **10 minutos**; fora de combate, o prazo é a **próxima
preparação diária** ou a remoção manual.

**Racional:** Carimbar o item resolve três perguntas futuras sem consulta: quem é o criador
(para a DC, REQ-FAB-037), o que é infundido (para regra e preço) e quando sai (para
`resolveExpirations`, REQ-PF2-220). O prazo vem do servidor porque o cliente não tem como saber
se há combate ativo — e, se tivesse, seria o cliente decidindo quanto tempo o item dele dura.
A ancoragem reusa inteiro o mecanismo de expiração da `17` (REQ-PF2-222): nenhum segundo relógio
nasce aqui, e fora de combate nada corre sozinho (REQ-PF2-223).

**Alternativa rejeitada:** relógio de mundo com minutos correndo. Foi descartado pelo Alexandre
(decisão D-05 do plano) antes desta spec, e adotá-lo aqui contrariaria REQ-PF2-223.

### DEC-FAB-05 — Custo de fabricação sai por uma porta, sem descontar moeda

**Decisão:** A fabricação **calcula** o custo e o **emite** por `CurrencyPort.requestCost`
(evento `crafting:costRequested`). A implementação registrada hoje é um **no-op** que só anota o
valor no card ("custo: X po — não descontado"). Nenhum requisito desta spec lê ou escreve moeda
(decisão D-07 do plano).

**Racional:** A economia do Fusion ainda não tem dona, e fabricar sem custo nenhum é regra
errada tanto quanto fabricar debitando um campo que ninguém mantém. A porta deixa a regra do
custo escrita e testável agora, e permite que a carteira futura pluge sem tocar em fabricação.

**Alternativa rejeitada:** debitar `system.currency` direto. Cria dona informal para a economia
dentro de uma spec de fabricação e quebra toda mesa que controla dinheiro fora do sistema.

### DEC-FAB-06 — O que o servidor sabe com certeza, bloqueia; o que é da mesa, avisa

**Decisão:** A fabricação **recusa** quando o estado que o servidor conhece diz não: fórmula
fora do livro, nível acima do teto, recurso insuficiente, proficiência insuficiente, ausência de
posse. Ela **avisa e deixa fazer** quando a condição é de mesa e o dado é notoriamente incompleto
— o caso decidido é o **Alchemist's Toolkit** na Alquimia Rápida (decisão D-08 do plano), que
avisa e prossegue.

**Racional:** Bloquear pelo que o servidor sabe é o que impede trapaça e estado inconsistente.
Bloquear pelo que ele _acha_ transforma toda lacuna de importação em mesa travada — o inventário
do personagem nem sempre reflete o que está na mão do jogador, e a mesa não vai parar por causa
de um kit que ninguém marcou. A mesma postura já vale para munição na `17` (REQ-PF2-228).

**Alternativa rejeitada:** bloquear sem kit. Vira o primeiro item que o Mestre desliga.

## 5. Requisitos funcionais

### 5.1 Recurso de classe

- **REQ-FAB-001** [MVP] O ator DEVE guardar o estado de um recurso de classe em
  `system.resources.special[<slug>].value` (persistido) e expor o resultado em
  `system.derived.resources[<slug>]` com `slug`, `label`, `value`, `max`, `level?` e
  `recharge` — derivado a cada `prepareData`, **nunca persistido** (DEC-PF2-03). Ator sem
  nenhum descritor DEVE derivar um mapa **vazio**, não um mapa com zeros.
  **Critério verificável:** um Guerreiro sem nenhum descritor não tem chave alguma em
  `system.derived.resources`; um Alquimista tem `versatile-vials` com `max` calculado, e
  nenhuma das duas fichas grava `max` no `_source`.
- **REQ-FAB-002** [MVP] O **único** meio de declarar um recurso DEVE ser um descritor
  `kind: "special-resource"` no `system.rules` de um item que o ator tem (característica de
  classe, talento, item), com `slug`, `max` e, opcionalmente, `level`, `recharge`, `mode` e
  `label`. Dois descritores do **mesmo slug** DEVEM compor assim: `mode: "set"` (default) fixa o
  máximo, e só `mode: "add"` soma ao máximo já fixado. O importer DEVE converter o rule element
  equivalente do material de origem para este descritor (`ver 16-compendiums-e-importacao.md`),
  sem que nenhuma classe ganhe código próprio.
  **Critério verificável:** a característica Frascos Versáteis sozinha dá máximo `2 + Int`; com
  o talento que amplia (`mode: "add"`, valor 2) o máximo sobe 2; um segundo descritor `set` do
  mesmo slug substitui o máximo em vez de somar, e a escolha aparece no relatório do importer.
- **REQ-FAB-003** [MVP] As fórmulas de `max` e `level` DEVEM ser avaliadas por um avaliador
  próprio, de gramática fechada: números, `+ - * /`, parênteses, comparações, operador ternário e
  referências de leitura ao ator (`@actor.<caminho>`). O avaliador NÃO DEVE usar `eval`,
  `Function` nem qualquer acesso a global, e expressão fora da gramática DEVE falhar com **erro
  de parse nomeando o descritor** — o recurso NÃO DEVE entrar derivado como zero silencioso.
  **Critério verificável:** `"2 + @actor.system.abilities.int.mod"` com Int +4 derive 6;
  `"process.exit()"` derive erro de parse e nenhum recurso; a derivação do resto do ator continua.
- **REQ-FAB-004** [MVP] `value` DEVE ser mantido no intervalo `[0, max]` tanto na derivação
  quanto na escrita: valor acima do máximo DEVE ser exibido e gravado como o máximo, valor
  negativo como zero, e `max` calculado abaixo de zero DEVE virar zero. O clamp NÃO DEVE
  reescrever o `_source` durante a derivação (DEC-PF2-03).
  **Critério verificável:** ator com `value: 9` e máximo 6 aparece 6/6; mandar `-1` pela ficha
  grava 0; baixar o Int (máximo 6 → 4) com `value: 6` mostra 4/4 sem nenhuma escrita.
- **REQ-FAB-005** [MVP] A ficha DEVE mostrar **todo** recurso derivado como um contador com
  rótulo em pt-BR, `valor/máximo` e incremento/decremento, sem conhecer classe nenhuma; recurso
  sem descritor NÃO DEVE aparecer. O dono do ator DEVE poder ajustar o valor pela ficha
  (`ver 02-modelo-de-dados.md`, REQ-DOC-023), e o Mestre DEVE ver o mesmo número.
  **Critério verificável:** ficha de Alquimista nível 1 com Int +4 mostra "Frascos versáteis
  6/6"; clicar em − mostra 5/6 na tela do jogador e na do Mestre; a ficha de um Guerreiro não
  mostra contador nenhum.
- **REQ-FAB-006** [MVP] A recarga DEVE seguir o `recharge` do descritor: `"daily-prep"` repõe ao
  máximo na preparação diária (REQ-FAB-013); `"none"` nunca repõe sozinho;
  `{ every: "10-minutes", amount }` DEVE repor **apenas** quando uma ação explícita de exploração
  for executada (REQ-FAB-018) — nenhum recurso DEVE se recarregar pela passagem de tempo
  (REQ-PF2-223).
  **Critério verificável:** recurso `daily-prep` em 2/6 vai a 6/6 no Descansar; o mesmo recurso
  não muda depois de qualquer número de rolagens, trocas de cena e turnos.
- **REQ-FAB-007** [MVP] Uso limitado de item ou talento (1/dia e afins) DEVE usar **o mesmo
  contrato**, com slug `freq:<itemSlug>` e `recharge: "daily-prep"`. NÃO DEVE existir um segundo
  mecanismo de frequência no sistema, e o contador DEVE aparecer na ficha como qualquer outro
  recurso (REQ-FAB-005).
  **Critério verificável:** um talento 1/dia declara `freq:<slug>` com máximo 1; usá-lo zera o
  contador, um segundo uso é recusado, e o Descansar devolve 1/1.
- **REQ-FAB-008** [MVP] Gastar recurso por uma ação DEVE passar pelo op `item:consume` no modo
  `resource` (`ver 15-api-de-sistemas.md`, REQ-SYS-143; regra em REQ-PF2-224), que valida posse,
  `expectedVersion` e saldo: saldo insuficiente DEVE responder `VALIDATION_FAILED` **sem escrever
  nada**. O cliente NÃO DEVE gastar recurso escrevendo o valor direto — o ajuste manual de
  REQ-FAB-005 é edição de ficha, não gasto de ação.
  **Critério verificável:** dois clientes com o mesmo último frasco: o primeiro consome, o
  segundo recebe `CONFLICT` ou `VALIDATION_FAILED` e o saldo final é 0, nunca −1.
- **REQ-FAB-009** [MVP] Quando o descritor declara `level`, o valor derivado DEVE ser o **nível
  do que o recurso produz** (nível do frasco, da bomba improvisada), avaliado pelo mesmo
  avaliador de REQ-FAB-003, e DEVE ser a única fonte desse nível para quem consome o recurso —
  cliente NÃO DEVE ter tabela de nível embutida. Sem `level`, o recurso não tem nível.
  **Critério verificável:** a fórmula ternária de nível do frasco versátil derive 1, 4, 12 e 18
  nos níveis de personagem 3, 4, 12 e 18, e o strike do frasco (REQ-FAB-016) mostre exatamente
  esse número.

### 5.2 Preparação diária

- **REQ-FAB-010** [MVP] O Descansar DEVE ser a op de servidor `actor:dailyPrep`
  (`{ actorId, choices?, expectedVersion }`), exigindo ownership **OWNER** do ator ou papel
  privilegiado (REQ-USR-013): outro usuário DEVE receber `PERMISSION_DENIED`, ator inexistente
  `NOT_FOUND`, e versão divergente `CONFLICT` sem escrever nada. A ficha NÃO DEVE continuar
  escrevendo os campos de descanso direto.
  **Critério verificável:** um jogador dispara o Descansar do próprio personagem e ele acontece;
  o mesmo jogador disparando no personagem de outro recebe `PERMISSION_DENIED`, e nada muda no
  ator alvo.
- **REQ-FAB-011** [MVP] A preparação DEVE executar **etapas registradas** pelo sistema
  (`registerDailyPrepStep`, `ver 15-api-de-sistemas.md`, REQ-SYS-145), ordenadas por `order`
  crescente e desempatadas por `id`, executando só as que respondem verdadeiro a `appliesTo`. A
  ordem canônica no PF2e DEVE ser: PV `100`, slots de magia `200`, foco `300`, recarga de
  recursos `400`, expiração `500`, Alquimia Avançada `600`. Registrar duas etapas com o mesmo id
  DEVE lançar erro na definição do sistema, nomeando o id.
  **Critério verificável:** com as seis etapas registradas fora de ordem, a execução acontece na
  ordem dos números acima; um ator sem magias pula a etapa de slots sem erro.
- **REQ-FAB-012** [MVP] A preparação DEVE ser **atômica**: as escritas de todas as etapas são
  aplicadas numa transação só, e etapa que lançar DEVE abortar a operação inteira, sem escrita
  parcial e sem card. Esta é a diferença deliberada em relação ao isolamento de erro dos hooks de
  turno (REQ-SYS-139): lá o combate segue; aqui a preparação é a unidade.
  **Critério verificável:** com uma etapa que lança no meio, o ator termina com PV, recursos,
  efeitos e inventário **idênticos** aos de antes, e o erro aparece nomeando a etapa.
- **REQ-FAB-013** [MVP] O sistema PF2e DEVE registrar as etapas nativas: (a) **PV**, recuperando
  `mod de Constituição × nível`, com mínimo de `1 × nível`, sem passar do máximo; (b) **slots de
  magia**, repostos ao máximo; (c) **pontos de foco**, repostos ao máximo; (d) **recursos** com
  `recharge: "daily-prep"` (REQ-FAB-006); (e) **expiração**, chamando `resolveExpirations` com o
  evento `daily-prep` (REQ-PF2-220) e removendo tudo que ele apontar, efeito e item físico
  temporário (REQ-PF2-222, REQ-PF2-223).
  **Critério verificável:** ator ferido com Con +2 no nível 4 recupera 8 PV; recurso 2/6 vai a
  6/6; a bomba "até a preparação" some do inventário; o efeito de 1 hora sai.
- **REQ-FAB-014** [MVP] A preparação DEVE publicar **um** card de resumo, montado a partir do
  `summary` que cada etapa devolve, dizendo o que mudou (PV recuperados, recursos repostos, o que
  expirou, o que foi fabricado). Etapa que não se aplicou NÃO DEVE gerar linha. O card DEVE
  seguir a plateia de `09-chat-e-mensagens.md` (REQ-CHT-053): o dono do ator e o Mestre.
  **Critério verificável:** um Descansar que recupera PV, repõe frascos e apaga uma bomba
  temporária produz um card com três linhas, e não três cards.
- **REQ-FAB-015** [MVP] Etapa que precise de decisão do jogador DEVE declará-la por
  `needsChoice(actor)`, e a op DEVE receber a resposta em `choices[<stepId>]`. Etapa com escolha
  pendente e sem resposta DEVE recusar a op com `VALIDATION_FAILED`, sem escrever; preparação sem
  nenhuma escolha pendente DEVE rodar direto, sem diálogo.
  **Critério verificável:** o Descansar de um Alquimista com Alquimia Avançada abre a escolha e
  não escreve nada até a confirmação; o Descansar de um Guerreiro acontece num clique só.

### 5.3 Frasco versátil

- **REQ-FAB-016** [MVP] Enquanto o recurso de frascos versáteis tiver valor maior que zero, o
  ator DEVE ter um **strike derivado do recurso** — sem item no inventário e sem equipar
  (DEC-PF2-12) — cujo `source` é `{ kind: "resource", resourceSlug, level }` e cujos campos são
  os de REQ-PF2-227. Valor zero DEVE fazer o strike **sumir** da lista.
  **Critério verificável:** com 3 frascos, a lista de ataques mostra "Frasco versátil (nível N)";
  com 0, não mostra; nenhum item novo aparece no inventário em nenhum dos dois casos.
- **REQ-FAB-017** [MVP] Rolar esse strike DEVE gastar **um** frasco **na mesma operação** da
  rolagem, por `item:consume` no modo `resource` (REQ-FAB-008, REQ-PF2-226): gastar sem rolar, ou
  rolar sem gastar, NÃO DEVE ser possível pelo cliente.
  **Critério verificável:** um arremesso com 3 frascos deixa 2 e produz um card de ataque; uma
  tentativa com 0 é recusada sem rolar dado nenhum.
- **REQ-FAB-018** [MVP] A ação de exploração de refazer frascos DEVE repor `amount` frascos (2
  no caso base; 3 quando o ator tem a característica de classe que amplia), **até o máximo**, e
  só quando executada explicitamente pelo dono ou pelo Mestre — nunca pela passagem de tempo
  (REQ-PF2-223, REQ-FAB-006).
  **Critério verificável:** 5/6 vai a 6/6 (e não a 7); 1/6 vai a 3/6, ou a 4/6 com a
  característica que amplia; nada acontece sem o clique.
- **REQ-FAB-019** [MVP] O nível, o bônus de item e os dados de dano do frasco DEVEM sair do
  `level` derivado (REQ-FAB-009) e da regra da `17` (REQ-PF2-032, REQ-PF2-033, REQ-PF2-207),
  nunca de tabela embutida no cliente nem de total pronto lido do pack.
  **Critério verificável:** o mesmo personagem em dois níveis diferentes mostra dois níveis de
  frasco, e o número exibido pelo cliente é igual ao que o servidor usa na rolagem.

### 5.4 Livro de fórmulas

- **REQ-FAB-020** [MVP] O ator DEVE guardar as fórmulas conhecidas em `system.crafting.formulas`,
  cada uma com `sourceId`, `packId` e `addedAt`. A identidade da fórmula DEVE ser o
  `flags.fusion.sourceId` do documento, **nunca o nome** — homônimo é padrão no PF2e. A fórmula
  NÃO DEVE copiar o documento: ela referencia o pack, e o item só é copiado quando fabricado
  (REQ-FAB-026).
  **Critério verificável:** dois itens homônimos de packs diferentes viram duas fórmulas
  distintas; renomear o documento no pack não perde a fórmula do ator.
- **REQ-FAB-021** [MVP] Adicionar duas vezes o mesmo `sourceId` DEVE resultar em **um** registro
  (a operação é idempotente), sem erro para o jogador.
  **Critério verificável:** adicionar "Fogo de Alquimista (Menor)" duas vezes deixa o livro com
  um registro e a contagem inalterada na segunda vez.
- **REQ-FAB-022** [MVP] Adicionar fórmula de item com nível **maior** que o nível do personagem
  DEVE ser recusado com `VALIDATION_FAILED`, e o picker NÃO DEVE oferecê-la.
  **Critério verificável:** personagem de nível 3 não vê item de nível 5 no picker, e a tentativa
  por op direta é recusada sem escrever.
- **REQ-FAB-023** [MVP] A ficha DEVE mostrar **conhecidas × esperadas**, com o esperado derivado
  da regra da classe (no Alquimista, `2 + 2 × nível`). O sistema NÃO DEVE conceder as fórmulas
  iniciais sozinho: a contagem é informativa e a escolha é do jogador.
  **Critério verificável:** personagem de nível 3 com 3 fórmulas mostra "3/8", e nenhuma fórmula
  aparece no livro sem ter sido escolhida.
- **REQ-FAB-024** [MVP] A ficha DEVE ter uma aba de Fabricação (`ver 11-ui-framework-e-fichas.md`,
  REQ-UIF-020) com o livro, o picker filtrado pelo pack de itens alquímicos e pelo nível do
  personagem, e o lote do dia (REQ-FAB-033). O picker DEVE respeitar a plateia do pack
  (REQ-CMP-010a).
  **Critério verificável:** o jogador abre a aba, filtra por traço, adiciona um item de nível ≤ 3
  e ele aparece no livro sem recarregar a ficha.

### 5.5 Fabricação: a op e o item infundido

- **REQ-FAB-025** [MVP] Fabricar DEVE ser a op `crafting:create`
  (`{ actorId, abilitySlug, formulaSourceIds[], additives?, expectedVersion }`), atendida pelo
  core sobre a `CraftingAbilityDefinition` que o sistema registrou
  (`ver 15-api-de-sistemas.md`, REQ-SYS-146). Ela DEVE recusar, **sem escrever nada**:
  `abilitySlug` desconhecido ou não aplicável ao ator, fórmula fora do livro, item de nível acima
  de `maxItemLevel(actor)`, quantidade acima de `maxPerUse`/`capacity`, recurso insuficiente para
  `cost`, ausência de posse (`PERMISSION_DENIED`) e `expectedVersion` divergente (`CONFLICT`). A
  recusa por **livro de fórmulas** é julgada pelo sistema — que é quem conhece
  `system.crafting.formulas` — e chega ao jogador como `VALIDATION_FAILED` pelo caminho de
  REQ-SYS-146; posse e versão são do core.
  **Critério verificável:** cada uma dessas recusas devolve o erro nomeado e deixa o ator igual
  ao que era — em particular, uma Alquimia Rápida com 0 frascos não cria item nem debita, e uma
  fórmula que não está no livro não cria item mesmo estando dentro do teto de nível.
- **REQ-FAB-026** [MVP] O item criado DEVE ser **cópia do documento do pack** (mesma disciplina
  de DEC-PF2-11) com: `traits` acrescido de `infused`; o carimbo `system.fusion.infused` com o
  `actorId` e a `classDc` do fabricante no momento; e `system.fusion.expiry` devolvido por
  `ability.expiry(actor, ctx)`. O **cliente NÃO DEVE enviar `expiry`**, e o servidor DEVE ignorar
  o campo se ele vier. Regerar o pack depois NÃO DEVE alterar item já fabricado.
  **Critério verificável:** um payload que traga `expiry` produz o mesmo item que um payload sem
  ele; o item fabricado tem `infused` nas traits e o `classDc` do fabricante gravado.
- **REQ-FAB-027** [MVP] O custo em recurso (`ability.cost`) DEVE ser debitado **na mesma
  transação** que cria o item, e a op inteira DEVE ser atômica: item, débito, card e efeitos ou
  entram juntos, ou não entra nada.
  **Critério verificável:** com 1 frasco, fabricar 2 itens é recusado e o frasco continua lá;
  fabricar 1 deixa 0 frascos e exatamente 1 item novo.
- **REQ-FAB-028** [MVP] Antes de gravar, o core DEVE passar o **rascunho** do item pelos hooks
  registrados em `registerCraftingDraftHook` (`ver 15-api-de-sistemas.md`, REQ-SYS-147), em ordem
  determinística de prioridade e id; cada hook devolve o rascunho (possivelmente alterado). Hook
  que lançar DEVE abortar a op (REQ-FAB-027), e no MVP **nenhum** hook é registrado — o ponto
  existe para os aditivos da spec `49`.
  **Critério verificável:** com nenhum hook registrado, o item gravado é idêntico à cópia do
  pack mais os carimbos de REQ-FAB-026; com um hook de teste que muda o nome, o item gravado sai
  com o nome do hook.
- **REQ-FAB-029** [MVP] Item infundido DEVE ser distinguível na ficha e no card: selo "infundido"
  e o prazo em linguagem de mesa, derivado do `expiry` ("até o início do seu próximo turno", "até
  a preparação diária"). Item comprado, sem infusão, NÃO DEVE mostrar selo nenhum.
  **Critério verificável:** o mesmo item aparece com selo e prazo quando fabricado, e sem selo
  quando comprado, lado a lado no mesmo inventário.

### 5.6 Alquimia Avançada e lote diário

- **REQ-FAB-030** [MVP] Com a característica de Alquimia Avançada, a preparação diária DEVE
  oferecer a etapa de escolha (REQ-FAB-015) para fabricar do livro até o teto da ability:
  `4 + mod de Inteligência` na classe, e `4` fixo pela dedicação de arquétipo,
  independentemente de Inteligência. Pedido acima do teto DEVE ser recusado sem escrever nada.
  **Critério verificável:** Int +4 permite 8 itens e recusa 9; o mesmo personagem com a dedicação
  em vez da classe permite 4 e recusa 5.
- **REQ-FAB-031** [MVP] Os itens dessa etapa DEVEM ser criados pela mesma op de REQ-FAB-025, com
  `expiry.on: "daily-prep"` — eles saem do inventário na **próxima** preparação (REQ-FAB-013).
  **Critério verificável:** os itens preparados hoje continuam no inventário depois de qualquer
  combate, e somem no Descansar seguinte.
- **REQ-FAB-032** [MVP] O ator DEVE rastrear o lote do dia em
  `system.crafting.dailyBatch = { prepId, made, max }`. Cada preparação gera um `prepId` novo e
  DEVE **zerar** `made`; `made` NÃO DEVE ser decrementado por item que expirou ou foi consumido —
  o teto é do dia, não do inventário.
  **Critério verificável:** preparar 3 de 8 deixa `made: 3`; consumir os 3 mantém `made: 3`; o
  Descansar seguinte devolve `made: 0` com `prepId` diferente.
- **REQ-FAB-033** [MVP] A aba de Fabricação DEVE mostrar "Lote de hoje `made`/`max`", com os
  mesmos números de REQ-FAB-032, e o teto DEVE vir da ability, nunca de constante no cliente.
  **Critério verificável:** a ficha mostra "3/8" logo após a preparação e "0/8" depois do
  Descansar seguinte, sem recarregar a página.

### 5.7 Alquimia Rápida

- **REQ-FAB-034** [MVP] A ação de Alquimia Rápida DEVE, num gesto só: escolher fórmula do livro,
  gastar o recurso declarado por `ability.cost` (um frasco por item) e criar o item pela op de
  REQ-FAB-025. Com a característica de dobrar a fabricação, a ação DEVE permitir **dois** itens,
  cada um com seu custo: recurso para um só DEVE produzir **um** item, não dois.
  **Critério verificável:** com 2 frascos, a fabricação dupla produz 2 itens e deixa 0 frascos;
  com 1 frasco, produz 1 item e deixa 0 — nunca 2 itens com 1 frasco.
- **REQ-FAB-035** [MVP] O prazo do que a Alquimia Rápida cria DEVE ser decidido **pelo servidor**
  (DEC-FAB-04), assim: com combate ativo, item potente expira em `turn-start` ancorado no
  fabricante e o frasco rápido em `turn-end` do turno atual; sem combate ativo, o prazo é
  `daily-prep`. Efeito que esse item aplicar DEVE ter a duração **truncada em 10 minutos**
  quando o documento declarar mais que isso. Nenhum relógio novo DEVE ser criado (REQ-PF2-223).
  **Critério verificável:** o mesmo item fabricado em combate sai com `turn-start` do fabricante
  e some no início do próximo turno dele; fabricado fora de combate, sai com `daily-prep` e
  atravessa a sessão; um efeito de 1 hora declarado pelo documento entra com 10 minutos.
- **REQ-FAB-036** [MVP] Sem o Alchemist's Toolkit no inventário, a Alquimia Rápida DEVE **avisar
  e deixar fazer** (DEC-FAB-06): a ação continua disponível, o resultado traz o aviso e o card
  registra que a ferramenta não foi encontrada. O aviso NÃO DEVE bloquear nem alterar o item.
  **Critério verificável:** o mesmo personagem com e sem o kit fabrica o mesmo item; só o card
  difere, por uma linha de aviso.

### 5.8 DC de item infundido

- **REQ-FAB-037** [MVP] O sistema DEVE ter **um** resolvedor, `resolveItemSaveDc(item, creator)`,
  que devolve: o **maior** entre a DC impressa do item e a Class DC do criador, quando o item tem
  `system.fusion.infused.actorId` e esse criador tem a característica que estende a Class DC aos
  itens infundidos; e a DC impressa em qualquer outro caso. O mesmo resolvedor DEVE servir ao card
  de consumo, ao strike de bomba e à exposição de aflição da spec `48` — NÃO DEVE existir segunda
  conta de DC de item.
  **Critério verificável:** item com DC impressa 17, criador com Class DC 19 e a característica →
  19; sem a característica → 17; infundido por outro ator → 17; Class DC 15 → 17 (é o maior).
- **REQ-FAB-038** [MVP] O card DEVE exibir a DC resolvida, e a **origem** dela ("classe") DEVE
  ser mostrada apenas a papel privilegiado (REQ-SEC-020, decisão D-17 do plano). A redação da DC
  em exposição de aflição — onde o alvo não deve saber o número — é da spec `48`, não desta.
  **Critério verificável:** o Mestre vê "CD 19 (classe)" e o jogador dono vê "CD 19" no mesmo
  card; o payload entregue ao jogador não traz a marca de origem.

### 5.9 Atividade Craft e custo

- **REQ-FAB-039** [MVP] A atividade Craft DEVE ser a op `crafting:craft`
  (`{ actorId, formulaSourceId, quantity, days }`), resolvida **no servidor**:
  1. exige a fórmula no livro (REQ-FAB-020) e proficiência em Crafting ao menos **treinado** —
     destreinado DEVE ser recusado com `VALIDATION_FAILED`;
  2. rola Crafting contra a **DC por nível** do item, com ajuste de raridade (REQ-PF2-042), e
     resolve o grau pelo caminho normal (REQ-PF2-040) — o cliente NÃO DEVE mandar o resultado;
  3. sucesso e sucesso crítico criam item **permanente**: sem `infused`, sem `expiry` e fora do
     lote diário (REQ-FAB-032);
  4. falha NÃO DEVE criar item; falha crítica NÃO DEVE criar item e DEVE registrar no card a
     perda de material que a regra prevê;
  5. o custo (metade do preço do item, pela regra) DEVE ser emitido **uma vez**, por
     `CurrencyPort.requestCost` (`ver 15-api-de-sistemas.md`, REQ-SYS-148), e NÃO DEVE tocar
     moeda, inventário ou qualquer campo de dinheiro (DEC-FAB-05);
  6. `days` DEVE ser **registrado** no card e usado só no cálculo do custo emitido: o sistema NÃO
     DEVE simular passagem de tempo (REQ-PF2-223).

  **Critério verificável:** item comum de nível 1 usa DC 15 e de nível 5 usa DC 20, incomum +2;
  destreinado é recusado; nat 20 cria o item permanente sem selo de infusão; nat 1 não cria nada
  e deixa a nota; a porta de custo recebe exatamente uma chamada com metade do preço e o
  inventário de moedas fica intocado.

- **REQ-FAB-040** [MVP] A aba de Fabricação DEVE oferecer "Fabricar…", com diálogo mostrando a
  **DC prevista** (calculada pela mesma função pura que o servidor usa, nunca por réplica da
  regra no cliente), o bônus de Crafting do ator e o custo **informativo**, com o aviso de que a
  carteira ainda não desconta. Sem proficiência, o botão DEVE ficar desabilitado com o motivo
  visível. Confirmar DEVE chamar `crafting:craft`, e o resultado DEVE aparecer no card e no
  inventário.
  **Critério verificável:** o número de DC mostrado no diálogo é igual ao usado na rolagem do
  servidor para o mesmo item; com Crafting destreinado o botão não clica e o motivo aparece.

## 6. Requisitos não-funcionais

- **RNF-FAB-01** O avaliador de fórmula DEVE ser **inerte**: sem acesso a `globalThis`,
  `process`, `require`, protótipos ou qualquer função do host; a única entrada externa é a
  leitura do ator por `@actor.<caminho>`. Uma fórmula maliciosa vinda de pack importado DEVE
  falhar no parse, nunca executar (REQ-SEC-020).
- **RNF-FAB-02** A preparação diária DEVE ser **idempotente por `prepId`**: repetir a mesma op
  com o mesmo `expectedVersion` não DEVE duplicar itens do lote nem recarregar recursos duas
  vezes — a segunda chamada cai em `CONFLICT` (REQ-FAB-010).
- **RNF-FAB-03** Recurso, livro de fórmulas e lote diário DEVEM ser **determinísticos**: a mesma
  `_source` derivada duas vezes produz os mesmos números (REQ-SYS-131), e nenhum deles DEVE
  depender de relógio de parede.

## 7. Modelo de dados

```ts
// Estado persistido no ator
interface ActorResourceState {
  value: number;
} // system.resources.special[slug]

// Derivado a cada prepareData (nunca persistido — DEC-PF2-03)
interface ActorResourceDerived {
  slug: string;
  label: string;
  value: number;
  max: number;
  level?: number;
  recharge: "daily-prep" | "none" | { every: "10-minutes"; amount: number };
}

// Descritor no system.rules do item que concede o recurso
interface SpecialResourceDescriptor {
  kind: "special-resource";
  slug: string;
  max: string; // fórmula avaliada por REQ-FAB-003
  level?: string; // fórmula avaliada por REQ-FAB-003
  recharge?: ActorResourceDerived["recharge"];
  mode?: "set" | "add"; // default "set"
  label?: string;
}
// frequência de item/talento: slug "freq:<itemSlug>", recharge "daily-prep" (REQ-FAB-007)

// Livro de fórmulas — system.crafting.formulas
interface FormulaEntry {
  sourceId: string;
  packId: string;
  addedAt: string;
}

// Lote do dia — system.crafting.dailyBatch
interface DailyBatch {
  prepId: string;
  made: number;
  max: number;
}

// Carimbo do item fabricado (no próprio item, REQ-FAB-026)
interface InfusedStamp {
  actorId: string;
  classDc: number;
} // system.fusion.infused
// system.fusion.expiry: FusionExpiry — shape em 17-sistema-pf2e.md (REQ-PF2-219)
// traits: [...traits, "infused"]

// Ops de servidor desta spec
// "actor:dailyPrep"  { actorId, choices?: Record<string, unknown>, expectedVersion }
// "crafting:create"  { actorId, abilitySlug, formulaSourceIds: string[], additives?, expectedVersion }
// "crafting:craft"   { actorId, formulaSourceId, quantity, days }
// erros: PERMISSION_DENIED | NOT_FOUND | VALIDATION_FAILED | CONFLICT
```

As definições registráveis (`DailyPrepStepDefinition`, `CraftingAbilityDefinition`,
`registerCraftingDraftHook`, `CurrencyPort`) são da `15` — ver REQ-SYS-145..148. Esta spec as
cita e não as redefine.

## 8. Dependências

| Spec | O que esta spec depende dela                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `15` | Os pontos de registro (REQ-SYS-145..148), o op de consumo (REQ-SYS-143) e o motor de effects por onde o descritor entra (REQ-SYS-082).                |
| `17` | A regra do PF2e: derivação sem persistir (DEC-PF2-03), efeito e expiração (REQ-PF2-217..223), consumo e strike (REQ-PF2-224..228), DCs (REQ-PF2-042). |
| `10` | Os eventos de turno e de fim de combate que ancoram os prazos do que é fabricado (REQ-CBT-056).                                                       |
| `09` | O card de preparação, de fabricação e de Craft, e a plateia dele (REQ-CHT-053).                                                                       |
| `11` | A ficha por abas onde vivem o contador, o livro e o diálogo de Craft (REQ-UIF-020).                                                                   |
| `16` | Os packs de onde a fórmula copia o documento e a plateia deles (REQ-CMP-010a).                                                                        |
| `05` | Posse do ator e papel privilegiado nas três ops (REQ-USR-013).                                                                                        |
| `21` | Redação por plateia da origem da DC e do resumo (REQ-SEC-020).                                                                                        |
| `02` | A escrita de ficha pelo dono do ator (REQ-DOC-023).                                                                                                   |
| `08` | A rolagem de Crafting no servidor (REQ-ROL-012).                                                                                                      |

## 9. Critérios de aceitação

- **CA-FAB-001** Um Alquimista nível 1 com Int +4 abre a ficha e vê "Frascos versáteis 6/6"; um
  Guerreiro na mesma mesa não vê contador nenhum, e nenhuma das duas fichas tem código de classe.
- **CA-FAB-002** Uma fórmula de `max` inválida num pack importado produz erro de parse nomeando o
  descritor, e o resto da ficha deriva normalmente.
- **CA-FAB-003** O Descansar de um Alquimista ferido, com 1 frasco e uma bomba temporária, devolve
  PV, repõe os frascos, apaga a bomba e publica **um** card com as três linhas.
- **CA-FAB-004** Uma etapa de preparação que lança deixa o ator exatamente como estava — PV,
  recursos, efeitos e inventário — e nenhum card é publicado.
- **CA-FAB-005** Com 3 frascos, o jogador arremessa o frasco versátil: sai o card de ataque e o
  contador vai a 2, numa operação só; com 0 frascos o strike não aparece na lista.
- **CA-FAB-006** "Refinar frascos" com 5/6 leva a 6/6, e nenhuma passagem de tempo, troca de cena
  ou rodada de combate muda o contador sozinha.
- **CA-FAB-007** Adicionar duas vezes a mesma fórmula deixa um registro; uma fórmula de nível 5
  não aparece no picker de um personagem de nível 3 nem é aceita por op direta.
- **CA-FAB-008** A Alquimia Avançada com Int +4 aceita 8 itens e recusa o nono; os 8 nascem
  infundidos, com prazo "até a preparação", e a aba mostra "Lote de hoje 8/8".
- **CA-FAB-009** Em combate, a Alquimia Rápida cria um item que expira no início do próximo turno
  do fabricante; o mesmo item fabricado fora de combate atravessa a sessão e sai no Descansar.
- **CA-FAB-010** Sem o Alchemist's Toolkit, a Alquimia Rápida acontece e o card traz o aviso; o
  item é idêntico ao fabricado com o kit.
- **CA-FAB-011** Um veneno infundido por um Alquimista com a característica que estende a Class DC
  mostra CD 19 no card do jogador e "CD 19 (classe)" no do Mestre; o mesmo veneno comprado mostra
  CD 17.
- **CA-FAB-012** Fabricar pelo Craft um item comum de nível 1 rola contra DC 15 no servidor, cria
  o item **sem** selo de infusão em caso de sucesso, e emite uma única chamada de custo — as
  moedas do personagem não mudam em nenhum dos graus.

## 10. Questões em aberto

- **Q-FAB-01** Quem descontará o custo emitido por `CurrencyPort`? _Posição atual: nenhuma spec é
  dona da economia; quando houver, ela implementa a porta e esta spec não muda (DEC-FAB-05)._
- **Q-FAB-02** Como a mesa marca os **dias** gastos numa atividade Craft sem relógio de mundo?
  _Posição atual: `days` é declarativo e vai no card; o Mestre narra. Se downtime virar trabalho,
  a dona é a spec de campanha (`33`), não esta._
- **Q-FAB-03** As fórmulas iniciais da classe devem ser concedidas automaticamente na criação do
  personagem? _Posição atual: não (REQ-FAB-023) — a contagem esperada é informativa, porque
  conceder exigiria escolher pelo jogador._
- **Q-FAB-04** Um item infundido **não consumido** deve poder ser vendido ou dado a outro
  personagem? _Posição atual: o mecanismo não impede; a regra da mesa resolve, e o selo de prazo
  (REQ-FAB-029) já diz que ele vence._

## 11. Referências

- Regra de jogo: **Pathfinder 2e remaster** — a classe Alquimista (recursos, Alquimia Avançada e
  Rápida, livro de fórmulas) e a atividade Craft com DC por nível e ajuste de raridade. Nenhum
  texto de regra é reproduzido: os requisitos descrevem comportamento verificável.
- **Clean-room** (`26-licencas-e-legal.md`): nada de código, asset ou texto proprietário do
  Foundry VTT. O repositório `foundryvtt/pf2e` (Apache-2.0) é consultado apenas como **referência
  de comportamento**, com atribuição, e nenhum trecho dele é copiado para o Fusion.
- Plano de tarefas que origina esta spec: `docs/design/alquimista/tasks.md` — decisões D-05, D-06,
  D-07, D-08 e D-17 do Alexandre e os contratos canônicos da §2.7.
- `specs/CONVENCOES.md` §1 (teste de corte) e §3 (declaração de nível).

## 12. Emendas que esta spec obriga

Registradas aqui para que nenhuma spec fique contrariada em silêncio (`CONVENCOES.md` §2).
Nenhum id é renumerado.

| Spec        | O que muda                                                                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` | A linha `REQ-FAB-` entra no registro de prefixos e a spec entra no índice. Sem isso o `spec-lint` reprova a definição de qualquer id desta spec.                                                                                                                                                          |
| `15`        | Quatro pontos de extensão novos: etapa de preparação diária, ability de fabricação, hook de rascunho e porta de custo (REQ-SYS-145..148), mais as linhas correspondentes na tabela de superfície pública. Nada é revogado: a atomicidade da preparação é declarada como exceção deliberada a REQ-SYS-139. |
| `17`        | REQ-PF2-103 é **reclassificado**: a atividade **Craft** sai da lista [V2] de exploration/downtime e passa a [MVP] sob esta spec (REQ-FAB-039); as demais atividades continuam [V2] com o mesmo id. A linha correspondente do mapa de cobertura de automação passa a apontar para as duas specs.           |
| `48`, `49`  | Consomem o item infundido, o resolvedor de DC (REQ-FAB-037) e o hook de rascunho (REQ-FAB-028) quando forem escritas. Nada nelas é decidido aqui.                                                                                                                                                         |
