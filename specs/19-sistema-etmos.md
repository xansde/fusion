# 19 — Sistema Etmos RPG

- **Título:** Sistema Etmos RPG
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/12b-etmos-fontes-locais.md` (fonte canônica: SRD-ETMOS 1.1, livro de Partículas, ficha oficial — leitura integral)
  - `docs/research/12-etmos-sistema.md` (pesquisa de sistema, identificação, ambientação, fontes públicas)

> **Aviso de fidelidade e clean-room.** Esta spec descreve a implementação do
> sistema Etmos RPG no Fusion como um pacote TypeScript/Svelte compilado junto ao
> app (`systems/etmos`). O Etmos RPG é obra da **Editora Balde Galáctico** (autor
> **Rafa Reis**) e **não possui licença aberta** (OGL/CC/ORC) conhecida — ver
> `ver 26-licencas-e-legal.md`. Toda regra aqui descrita vem do SRD 1.1 e ficha
> oficial pesquisados; nenhuma arte proprietária (ilustrações, glifos rúnicos
> originais) é redistribuída. A distribuição do pacote `systems/etmos` com os
> dados de regra depende de **autorização formal da editora** (questão em aberto).
> Onde o SRD é omisso, a spec adota a diretriz do usuário: **não automatizar — o
> Fusion oferece controles manuais de arbitragem do Narrador** em vez de inventar
> regra.

> **Nota normativa de escopo de fase:** O sistema Etmos é classificado como
> **[V2] no escopo global** do Fusion (REQ-ESC-011 em `00-visao-e-escopo.md`).
> Todo o pacote `systems/etmos` é desenvolvido após o MVP global (sessão de PF2e
> jogável) estar entregue. As tags **[MVP]** e **[V2]** ao longo desta spec
> referem-se ao **escopo interno do Etmos** — ou seja, ao que é necessário para
> "jogar uma sessão de Etmos funcional" versus o que pode ser adiado dentro do
> desenvolvimento do próprio sistema — e **não** ao MVP global do Fusion. Para
> evitar ambiguidade em ferramentas de rastreamento, interprete [MVP] nesta spec
> como **[ETM-CORE]** e [V2] como **[ETM-V2]**.

---

## Objetivo

Especificar o sistema de jogo **Etmos RPG** como pacote registrado pela API de
sistemas do Fusion (`ver 15-api-de-sistemas.md`): os schemas `system` dos Actors
(estudante/Orador e antagonista/criatura) e Items (Partícula, Habilidade,
Origem, Totem, Item Encantado, Frase Mágica), os derivados calculados
automaticamente, as fichas Svelte, as fórmulas de rolagem `2d6+Atributo` com
margens de sucesso, a iniciativa por Teste de Corpo, as trilhas clicáveis de
Marcos de Crescimento com Bônus de Progressão, e o **diferencial central do
sistema**: o **Compositor de Magias** — uma UI colaborativa GM↔jogador para
combinar Partículas do Grimório em frases mágicas, propô-las ao Narrador, que
arbitra Complexidade e custo, e resolver a rolagem no servidor.

Esta spec é o contrato funcional do pacote `systems/etmos`. Ela **consome** a
infraestrutura definida nas specs de fundação e **não redefine** mecanismos
genéricos (Documents, rolagens, chat, combate, sheets) — apenas os parametriza
para o Etmos.

## Escopo

### O que esta spec inclui

- **Schemas `system`** dos Documents do Etmos: Actor `orador`, Actor
  `antagonista`; Items `particula`, `habilidade`, `origem`, `totem`,
  `item_encantado`, `frase_magica`.
- **Derivados** calculados em `prepareData`: Limite de Ferimentos, Limite de
  Estresse, Complexidade Máxima conjurável, Estado de Fadiga, e validações de
  trilhas.
- **Catálogo de Partículas** (81 canônicas: 18 Funções, 19 Objetos, 34
  Características, 10 Complementos) como compendium do sistema (`ver
16-compendiums-e-importacao.md`).
- **Fórmulas de rolagem**: testes de Atributo, Habilidade, Conjuração e
  Contestado em `2d6+mod`; mapeamento da margem de sucesso aos parâmetros de
  dificuldade do SRD; iniciativa `2d6+Corpo` com desempate pró-jogador.
- **Fichas Svelte**: ficha do Orador (frente: atributos/derivados/fadiga/marcos;
  verso: Grimório), ficha do Antagonista, e janelas auxiliares.
- **Marcos de Crescimento**: trilhas clicáveis 5×3 (Físico/Mental/Emocional) com
  trigger de Bônus de Progressão e aplicação semiautomática da Tabela E.
- **Compositor de Magias**: estrutura de dados da Frase Mágica, validação
  sintática (1 Função + ≥1 Objeto + N Características + N Complementos), o
  protocolo de estados (proposta→arbitrada→rolada→resolvida) e o fluxo de chat /
  janela dedicada GM↔jogador.
- **Calculadoras assistidas** de Encantamento (Pontos de Preparo, 6+ fatores) e
  de Totens/Santuários (Rank, bloqueio de magia no Mundano), com **decisão final
  manual do Narrador**.
- **Estados e penalidades** automatizados de Estresse/Fadiga e Ferimentos
  (inconsciente, morte), Reação por rodada, Dados de Empenho, Descanso.

### O que esta spec NÃO inclui

- A **mecânica genérica de Documents/schema/ownership** → `ver
02-modelo-de-dados.md` (esta spec só define o conteúdo de `system`).
- A **superfície da system API** (como registrar models, sheets, fórmulas,
  hooks) → `ver 15-api-de-sistemas.md`.
- O **motor de parsing/execução de rolagens** e o RNG autoritativo → `ver
08-motor-de-rolagens.md` (esta spec só registra fórmulas e `DegreeOfSuccess`).
- O **framework de UI/janelas/sheets** Svelte → `ver 11-ui-framework-e-fichas.md`
  (esta spec só descreve as sheets concretas do Etmos).
- O **modelo `Combat`/`Combatant`** e o tracker → `ver
10-combate-e-iniciativa.md` (esta spec só fornece a fórmula de iniciativa e o
  desempate).
- O **chat e os chat cards** genéricos → `ver 09-chat-e-mensagens.md` (o
  Compositor de Magias usa ChatMessages, mas o transporte e o render base vivem
  lá).
- O **pipeline de importação/conversão** de compendiums → `ver
16-compendiums-e-importacao.md` (esta spec lista os packs do Etmos; eles são
  **criados à mão**, não convertidos do `foundryvtt/pf2e`).
- **Permissões de runtime** → `ver 05-usuarios-e-permissoes.md`.
- Os sistemas **PF2e** e **SF2e** → `ver 17-sistema-pf2e.md`, `18-sistema-sf2e.md`.

## Conceitos e terminologia

- **Orador:** personagem mago, jogável; aluno da escola Brasilis. Actor de
  subtype `orador`. Pode ser humano (do Mundano) ou ser Fantástico.
- **Narrador:** o GM no Etmos. Arbitra Complexidade, custos e lacunas de regra.
- **Atributos:** Corpo, Alma, Mente — valores inteiros **1–6** (mínimo 1).
- **Ferimentos:** dano físico/mental acumulado; comparado ao **Limite de
  Ferimentos** (`4 + floor(Corpo/2)`).
- **Estresse:** desgaste acumulado ao conjurar; comparado ao **Limite de
  Estresse** (`4 + Alma`).
- **Fadiga:** estado derivado de (Estresse − Limite): Normal → Cansado → Exausto
  → Esgotado.
- **Complexidade:** nível de potência de uma magia (Trivial, Regular, Difícil,
  Complexa, Milagre), limitado por Mente; cada nível tem custo fixo de Estresse.
- **Grimório:** coleção de Partículas que o Orador domina (Items `particula`
  embedded no Actor).
- **Partícula:** palavra da linguagem Etmos. 4 categorias: **Função** (o que a
  magia faz), **Objeto** (o que é afetado), **Característica** (qualidade), **Complemento**
  (Modificador ou Criador).
- **Frase Mágica:** combinação `[Função]+[Objeto(s)]+[Característica(s)]+[Complemento(s)]`
  falada em voz alta com uma **Intenção** declarada; sem efeito pré-definido.
- **Compositor de Magias:** a UI do Fusion para montar Frases Mágicas a partir do
  Grimório e negociá-las com o Narrador.
- **Marcos de Crescimento:** trilhas de progressão (Físico/Mental/Emocional), 5
  caixas cada; completar uma trilha gera um **Bônus de Progressão**.
- **Bônus de Progressão:** recompensa de subida de nível (Tabela E), 1 por
  categoria por nível.
- **Dado de Empenho:** recurso diário que permite re-rolar 1d6 de um teste já
  feito e escolher o melhor.
- **Totem / Santuário:** objeto/local encantado que habilita magia no Mundano.
- **Mundano / Fantástico:** os dois mundos sobrepostos; magia só ocorre no
  Mundano com Totem/Santuário.
- **Dado base:** `2d6 + modificador`; sucesso se resultado ≥ dificuldade.

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### D1 — Pacote compilado, fonte de regra em compendiums criados à mão

`systems/etmos` é um pacote TypeScript/Svelte compilado junto ao app (sem
carregamento dinâmico de plugins — isso é [V2]). As Partículas, Habilidades,
Origens e Fichas Base de antagonista canônicas vêm em **compendiums (`pack`)
criados à mão** (`ver 16-compendiums-e-importacao.md`), não convertidos de
nenhum repositório externo.

- **Rejeitado: converter de `foundryvtt/pf2e`.** Inexiste implementação de Etmos
  em qualquer VTT (pesquisa `12-...md` §9) — o Fusion seria o primeiro. Não há
  fonte para conversor.
- **Rejeitado: hardcode das 81 Partículas no código.** Compendiums são editáveis
  pelo GM, traduzíveis e versionáveis sem rebuild; alinha com a arquitetura geral
  de dados-como-Document.
- **Racional:** o catálogo de regra é dado, não código.

### D2 — Atributos com mínimo 1; Corpo 0 do pré-gerado normalizado para 1

O SRD especifica Atributos **1–6**. O Quickstart traz a personagem Marcela com
Corpo 0 (provável erro de impressão). O Fusion adota **mínimo 1** e o importador
do pré-gerado normaliza 0→1.

- **Rejeitado: permitir 0.** Contradiz o SRD e quebra fórmulas derivadas
  (`4 + floor(0/2)` ainda funciona, mas a regra textual proíbe 0).
- **Racional:** fidelidade ao SRD (fonte prioritária) sobre o Quickstart.

### D3 — Função "Mat" (Matar) excluída do catálogo canônico

A pesquisa confirma que "Mat" aparece apenas em uma ficha de Quickstart, **não**
consta no SRD nem na ficha oficial, e é provável erro/restrição não canônica.

- **Decisão:** o compendium padrão traz **18 Funções** sem "Mat" como Função
  default disponível; o GM pode adicioná-la manualmente como Partícula custom se
  quiser. (Nota: a contagem de 18 Funções da ficha oficial **já não inclui**
  "Mat"; ver Questão Q1.)
- **Racional:** SRD/ficha oficial são fonte prioritária.

### D4 — Estresse, Fadiga, Ferimentos e custo de Complexidade automatizados; Complexidade _arbitrada_ manualmente

O Fusion automatiza tudo que tem regra determinística no SRD: cálculo de limites,
transição de estados de Fadiga (faixas 1–5 / 6–8 / 9+), penalidades de Fadiga,
inconsciência (Ferimentos > Limite), morte (Limite+4), e o **custo de Estresse
por nível de Complexidade** (Tabela A). Mas a **definição do nível de
Complexidade de uma Frase** (os 9 parâmetros do SRD) **não é automatizada** — é
arbitrada pelo Narrador no Compositor.

- **Rejeitado: tentar inferir a Complexidade da Frase por heurística.** O SRD diz
  explicitamente que nenhuma Frase tem efeito pré-determinado e que a
  Complexidade depende de julgamento contextual (9 parâmetros, incluindo "quão
  próxima é a lógica da Frase ao efeito"). Automatizar produziria resultados
  errados.
- **Racional:** automatizar o determinístico, delegar o subjetivo ao GM — exatamente
  a diretriz do usuário para lacunas.

### D5 — Compositor de Magias como fluxo de estados sobre ChatMessage

A negociação da Frase Mágica é um workflow social GM↔jogador. Modelamo-lo como
uma máquina de estados (`proposta → arbitrada → rolada → resolvida`, com ramo
`recusada`/`cancelada`) cujo estado vive numa flag de uma `ChatMessage` dedicada
(o "card de conjuração"), com uma **janela dedicada** opcional para edição rica.

- **Rejeitado: resolver tudo numa única rolagem imediata.** Quebra a natureza
  negociada do sistema; o jogador propõe, o Narrador arbitra custo/Complexidade
  _antes_ de rolar.
- **Rejeitado: estado efêmero só em memória do cliente.** Perderia o histórico e
  não sincronizaria GM↔jogador de forma autoritativa. O servidor é autoritativo
  (`ver 04-rede-e-sincronizacao.md`).
- **Racional:** o card persistente no chat documenta a magia e sobrevive a
  reconexões; a rolagem executa no servidor (anti-cheat, `ver 08-...md`).

### D6 — Conjunto binário de graus (`success`/`failure`) próprio, com margens

O SRD usa faixas de dificuldade (Simples <6, Fácil 6, Mediano 7–10, Árduo 11–14,
Difícil 15+), mas a resolução é binária (≥ dificuldade = sucesso) com magnitude
narrativa. Como o contrato de `DegreeOfSuccess` da `packages/system-api` é **genérico**
(cada sistema define seu próprio conjunto de graus — REQ-ROL-039, `ver 08-motor-de-rolagens.md`),
o Etmos define um **conjunto binário próprio** `success`/`failure`, sem usar o helper de
4 graus da `systems/engine-2e` (esse helper é exclusivo de PF2e/SF2e). O sistema implementa
`computeDegreeOfSuccess(total, dc, context)` (REQ-ROL-038) retornando `"success"` ou
`"failure"` do seu conjunto, e expõe a **margem** (`total − dc`) como metadado. A **classe
de dificuldade** (Simples/Fácil/Mediano/Árduo/Difícil) é metadado de rótulo/cor separado,
calculado por `classeDificuldade(total)`, não um grau de sucesso.

- **Rejeitado: mapear ao conjunto de 4 graus de PF2e/SF2e (CriticalSuccess/Success/Failure/CriticalFailure).**
  O SRD do Etmos não tem crítico mecânico; reusar o conjunto de 4 graus carregaria semântica
  estranha e graus que nunca são emitidos. O contrato genérico da API torna o conjunto
  binário próprio a representação correta.
- **Racional:** o tipo `DegreeOfSuccess` da system-api é genérico (string), então cada
  sistema é livre para definir o conjunto que reflete suas regras. O conjunto binário com
  margem expressa fielmente o SRD sem inventar crítico e sem depender do helper de 4 graus
  da engine-2e.

### D7 — Símbolos rúnicos como placeholder tipográfico no MVP

Os glifos rúnicos das Partículas são arte vetorial proprietária da editora,
pendentes (Questão D12 da pesquisa). No MVP, cada Partícula é representada por um
**placeholder tipográfico** (a palavra Etmos em fonte estilizada + cor por
categoria). Slot de `icone_runico` (path de asset) fica reservado para quando os
vetoriais forem fornecidos sob licença.

- **Racional:** não bloquear o MVP em assets indisponíveis; não redistribuir arte
  proprietária (`ver 26-licencas-e-legal.md`).

### D8 — Lacunas de regra → controles manuais, nunca invenção

Diretriz transversal: campos sem regra determinística no SRD (ex.: Pontos de
Importância, efeito mecânico de Origens custom, Complexidade final, Grau de
Sofisticação de Encantamento) são **campos editáveis / modificadores livres**
com a decisão final do Narrador. O Fusion **calcula sugestões** (calculadoras
assistidas) mas nunca trava a decisão humana.

- **Racional:** decisão explícita do usuário; preserva a natureza
  narrativista/arbitrada do Etmos.

---

## Requisitos funcionais

> Tags: **[MVP]** = necessário para "jogar uma sessão de Etmos com ficha,
> rolagens, chat e combate"; **[V2]** = pós-MVP. A definição de MVP global é
> centrada em PF2e; para o Etmos, o MVP do _sistema_ cobre ficha funcional,
> rolagens 2d6, Compositor de Magias básico e trackers — pois é o diferencial que
> justifica o sistema. Ferramentas de Narrador complexas (Encantamento) são [V2].

### Actors e Items

- **REQ-ETM-001** [MVP] O sistema DEVE registrar o Actor subtype `orador` com o
  schema definido em _Modelo de dados_ §Actor Orador, validado por Zod via a
  system API (`ver 15-api-de-sistemas.md`).
- **REQ-ETM-002** [MVP] O sistema DEVE registrar o Actor subtype `antagonista`
  com Ficha Base (`simples`/`intermediaria`/`avancada`) e lista livre de Aptidões
  e Ataques.
- **REQ-ETM-003** [MVP] O sistema DEVE registrar os Items: `particula`,
  `habilidade`, `origem`, `totem`, `item_encantado` e `frase_magica`, cada um com
  seu schema `system`.
- **REQ-ETM-004** [MVP] O Grimório de um Orador DEVE ser composto pelos Items
  `particula` embedded no Actor; a ficha DEVE listá-los agrupados por categoria
  (Funções, Objetos, Características, Complementos).
- **REQ-ETM-005** [MVP] Na criação, o sistema DEVE oferecer um assistente que
  monte um Orador Nível 1 válido: 2 Origens, 6 Pontos de Atributo (nenhum > 4), 2
  Habilidades Práticas + 2 Teóricas, e Grimório inicial de 2 Funções + 3 Objetos
  - 4 Características (Complementos de nível 1 disponíveis por padrão). O assistente
    DEVE permitir desvio manual (campos editáveis) — não trava a composição.

### Atributos e derivados

- **REQ-ETM-006** [MVP] Os Atributos Corpo/Alma/Mente DEVEM aceitar inteiros 1–6;
  a UI DEVE renderizá-los como trilha de 6 caixas marcadas até o valor.
- **REQ-ETM-007** [MVP] O sistema DEVE calcular em `prepareData` o **Limite de
  Ferimentos = 4 + floor(Corpo/2)** (Tabela B) e exibi-lo como derivado
  read-only.
- **REQ-ETM-008** [MVP] O sistema DEVE calcular o **Limite de Estresse = 4 +
  Alma** (Tabela C) e exibi-lo como derivado read-only.
- **REQ-ETM-009** [MVP] O sistema DEVE derivar a **Complexidade Máxima
  conjurável** a partir de Mente: Trivial/Regular sempre; Difícil se Mente > 2;
  Complexa se Mente > 4; Milagre se Mente = 6.
- **REQ-ETM-010** [MVP] O sistema DEVE derivar o **Estado de Fadiga** de
  (Estresse atual − Limite de Estresse): Normal (≤0), Cansado (1–5), Exausto
  (6–8), Esgotado (9+), e exibi-lo na trilha linear da ficha.

### Vitalidade, Estresse e Fadiga

- **REQ-ETM-011** [MVP] A ficha DEVE oferecer um tracker de **Ferimentos atuais**
  com botões +/− e entrada direta; ao atingir Ferimentos > Limite, o sistema DEVE
  sinalizar **Inconsciente**; ao atingir Ferimentos = Limite + 4, DEVE sinalizar
  **Morte**. Esses estados são avisos/flags — a aplicação narrativa é do Narrador.
- **REQ-ETM-012** [MVP] A ficha DEVE oferecer um tracker de **Estresse
  acumulado**; mudanças DEVEM recomputar o Estado de Fadiga automaticamente.
- **REQ-ETM-013** [MVP] Ao acordar de Inconsciente (Ferimentos voltam ao Limite),
  o sistema DEVE oferecer aplicar **+3 Estresse** (ação confirmável, não
  silenciosa).
- **REQ-ETM-014** [MVP] As penalidades de Fadiga DEVEM ser exibidas como aviso
  contextual: Cansado (+1 Ferimento a todo Ferimento sofrido); Exausto/Esgotado
  (rolar 2d6 ao conjurar magia não Trivial — ver REQ-ETM-024).

### Rolagens (testes)

- **REQ-ETM-015** [MVP] O sistema DEVE registrar fórmulas de roll data que
  resolvam `@atributos.corpo.value`, `@atributos.alma.value`,
  `@atributos.mente.value` e bônus de Habilidade no motor de rolagens
  (`ver 08-motor-de-rolagens.md`).
- **REQ-ETM-016** [MVP] A ficha DEVE oferecer botões de **Teste de Atributo**
  (`2d6 + Atributo`) para Corpo, Alma e Mente, executados no servidor.
- **REQ-ETM-017** [MVP] Cada Item `habilidade` DEVE oferecer um botão de **Teste
  de Habilidade** (`2d6 + bonus`).
- **REQ-ETM-018** [MVP] O sistema DEVE oferecer **Teste de Conjuração** (`2d6 +
Alma`).
- **REQ-ETM-019** [MVP] Toda rolagem de teste DEVE aceitar uma **dificuldade-alvo
  opcional** e, quando informada, classificar o resultado em sucesso/falha (resultado
  ≥ dificuldade) via `computeDegreeOfSuccess(total, dc, context)` (REQ-ROL-038),
  retornando `"success"` ou `"failure"` do conjunto binário próprio do Etmos
  (REQ-ROL-039, D6). A faixa narrativa (Simples <6 / Fácil 6
  / Mediano 7–10 / Árduo 11–14 / Difícil 15+) DEVE ser calculada separadamente por
  `classeDificuldade(total)` e exibida como rótulo/cor no chat, sem alterar o grau
  de sucesso.
- **REQ-ETM-020** [MVP] O sistema DEVE oferecer um **Bônus Extraordinário**
  (modificador livre, default 0) aplicável a qualquer teste antes da rolagem,
  com rótulo explicando os fatores do SRD (situação, costume, objeto, ajuda,
  equilíbrio emocional).
- **REQ-ETM-021** [MVP] O sistema DEVE oferecer **Teste Contestado** entre dois
  participantes: duas rolagens `2d6+mod` (qualquer combinação Atributo /
  Habilidade / Conjuração), vencendo o maior; em empate, o lado que **provocou**
  o teste vence, e jogadores vencem empates contra personagens do Narrador.

### Iniciativa e combate

- **REQ-ETM-022** [MVP] O sistema DEVE fornecer à `system-api` a **fórmula de
  iniciativa `2d6 + Corpo`** via `registrar.initiativeFormula` (REQ-SYS-042,
  `ver 15-api-de-sistemas.md`). A regra de desempate — **jogadores vencem NPCs**;
  empate entre jogadores resolvido por Corpo mais alto — DEVE ser codificada no
  `compare(a, b)` da `InitiativeFormula` (`ver 10-combate-e-iniciativa.md`,
  DEC-CBT-04, REQ-CBT-013; `ver 15-...md` REQ-SYS-042), e NÃO como tiebreaker
  numérico embutido (que não expressa "jogadores sempre vencem NPCs" de forma
  monotônica). Ordem de `compare`: (1) maior `initiative` vence; (2) em empate,
  combatant com `hasPlayerOwner` vence o sem; (3) persistindo o empate, maior Corpo
  vence. O núcleo aplica esse comparador ao ordenar a fila.
- **REQ-ETM-023** [MVP] O sistema DEVE rastrear **1 Reação por rodada** por
  Combatant, resetada no início do próprio turno; a Habilidade "Agilidade Mental"
  DEVE elevar para 2 Reações (a 2ª acumula +3 Estresse). A aplicação do efeito de
  Reação (defesa) é arbitrada — o Fusion só rastreia o recurso.

### Magia: custo, Complexidade e Compositor

- **REQ-ETM-024** [MVP] Ao confirmar a conjuração de uma Frase, o sistema DEVE
  aplicar o **custo de Estresse fixo por Complexidade** (Trivial 0, Regular 1,
  Difícil 2, Complexa 4, Milagre 7 — Tabela A), recomputando a Fadiga; o Estresse
  DEVE acumular mesmo que a magia falhe ou não surta efeito.
- **REQ-ETM-025** [MVP] Se o conjurador estiver **Exausto/Esgotado** e a magia
  for não Trivial, o sistema DEVE rolar `2d6` de controle: Exausto → se `>
Corpo+4` a magia falha (Estresse ainda acumula); Esgotado → se `> Corpo+3` o
  personagem morre após conjurar (o efeito ocorre). O resultado é apresentado ao
  Narrador para confirmação narrativa.
- **REQ-ETM-026** [MVP] O sistema DEVE impedir (com aviso) a seleção de
  Complexidade acima da **Complexidade Máxima** do conjurador (REQ-ETM-009),
  salvo override explícito do Narrador (Habilidade "Exceder os Limites": +1
  Complexidade, +2 Estresse extra).
- **REQ-ETM-027** [MVP] O **Compositor de Magias** DEVE permitir ao jogador
  montar uma Frase selecionando do seu Grimório: exatamente **1 Função**, **≥1
  Objeto**, **0+ Características**, **0+ Complementos**, e declarar uma **Intenção**
  (texto livre). A UI DEVE gerar a **frase falada** (fundindo Função+Objeto em uma
  palavra; demais como palavras separadas; Complementos ao final).
- **REQ-ETM-028** [MVP] O Compositor DEVE validar a sintaxe: rejeitar 0 Funções,
  > 1 Função, 0 Objetos; DEVE permitir Complementos Criadores como prefixos a
  > Características (`Ada-`, `No-`, `Mut-`) e como conectores (`Ag`), e Modificadores
  > como palavras finais (`Mor`, `Min`, `Sin`, `San`, `Sar`, `Itam`).
- **REQ-ETM-029** [MVP] Ao enviar uma Frase, o sistema DEVE criar um **card de
  conjuração** (ChatMessage com flag de estado) no estado **`proposta`**, visível
  ao Narrador e ao jogador.
- **REQ-ETM-030** [MVP] O Narrador DEVE poder **arbitrar** o card: definir a
  **Complexidade (Trivial / Regular / Difícil / Complexa / Milagre)**, ajustar/
  confirmar o custo de Estresse, adicionar notas, e transicionar para **`arbitrada`**
  (ou **`recusada`** com motivo). A UI PODE exibir as opções numeradas (1–5) como
  atalho de apresentação, mas o dado persistido é sempre o enum textual `Complexidade`
  (mapeamento: 1=Trivial, 2=Regular, 3=Difícil, 4=Complexa, 5=Milagre).
- **REQ-ETM-031** [MVP] No estado `arbitrada`, o jogador (ou o Narrador) DEVE
  poder **rolar** o Teste de Conjuração associado, transicionando para
  **`rolada`**; a rolagem executa no servidor.
- **REQ-ETM-032** [MVP] O Narrador DEVE poder marcar o resultado e **resolver** o
  card (estado **`resolvida`**), narrando o efeito; a resolução DEVE disparar a
  aplicação do custo de Estresse (REQ-ETM-024) ao conjurador.
- **REQ-ETM-033** [MVP] Qualquer participante autorizado DEVE poder **cancelar**
  uma proposta antes de `rolada` (estado **`cancelada`**), sem aplicar custos.
- **REQ-ETM-034** [V2] O jogador DEVE poder **salvar** uma Frase composta como
  Item `frase_magica` reutilizável (favoritos), pré-preenchendo o Compositor em
  conjurações futuras.

### Marcos de Crescimento e progressão

- **REQ-ETM-035** [MVP] A ficha DEVE exibir **3 trilhas clicáveis** de Marcos de
  Crescimento (Físico, Mental, Emocional), 5 caixas cada; clicar marca/desmarca um
  Ponto de Desenvolvimento.
- **REQ-ETM-036** [MVP] Ao completar 5 caixas numa categoria, o sistema DEVE
  bloquear novos pontos nessa categoria e sinalizar um **Bônus de Progressão**
  disponível para ela.
- **REQ-ETM-037** [MVP] Quando as **3 categorias** estiverem completas (5+5+5), o
  sistema DEVE habilitar a **subida de nível** e apresentar, para cada categoria,
  a opção da **Tabela E** correspondente à transição de nível atual.
- **REQ-ETM-038** [MVP] Ao confirmar a subida de nível, o sistema DEVE aplicar
  **semiautomaticamente** os bônus escolhidos (ex.: +1 ponto de Atributo livre →
  abre seletor de atributo; +1 Função/Objeto/Característica → abre seletor de
  Partícula do compendium; +1 Habilidade → abre seletor/criação de Item
  `habilidade`), incrementar o Nível e **reiniciar as 3 trilhas**.
- **REQ-ETM-039** [MVP] O sistema DEVE impedir escolher a **mesma opção de
  categoria** mais de uma vez na mesma subida de nível (regra SRD: uma por
  categoria).

### Dados de Empenho e Descanso

- **REQ-ETM-040** [MVP] A ficha DEVE rastrear **Dados de Empenho** (contador);
  gastar 1 DEVE permitir re-rolar **1d6** de um teste já feito e escolher o melhor
  resultado, vinculado à mensagem original (`ver 08-...md` rerolls).
- **REQ-ETM-041** [V2] O sistema DEVE oferecer um botão de **Descanso**
  (Parcial / Completo) com modificadores: Tratamento Médico (−2 Ferimentos
  adicionais) e Mundo de Origem (fora do mundo de origem: Completo vira Parcial,
  Parcial sem efeito), aplicando os deltas de Ferimentos/Estresse.

### Totens, Santuários e Encantamento

- **REQ-ETM-042** [MVP] O Actor `orador` DEVE ter uma flag **`temTotem`** e
  **`rankTotem` (0–5)**; quando uma conjuração ocorre no Mundano sem Totem/Santuário,
  o sistema DEVE **avisar** que magia é impossível ali (aviso, não bloqueio rígido
  — o Narrador decide).
- **REQ-ETM-043** [MVP] Quando há Totem/Santuário com Rank > 0, conjurar magia
  não Trivial DEVE somar **Rank pontos de Estresse extras** ao custo.
- **REQ-ETM-044** [V2] O sistema DEVE oferecer uma **calculadora assistida de
  Encantamento**: Grau de Sofisticação (Simples 5 / Sofisticado 10 / Primoroso
  15 PP) e os fatores que modificam PP acumulados (veículo, qualidade do veículo,
  ferramentas, marcação prévia, Habilidade Artesão, sessões consecutivas),
  produzindo uma **sugestão de PP** — a decisão final é do Narrador (campos
  editáveis).
- **REQ-ETM-045** [V2] O sistema DEVE rastrear o progresso de um Encantamento
  (PP acumulados vs. PP necessários, sessões, Estresse por sessões extras),
  concluindo o Item `item_encantado` ao atingir o alvo.

### Compendiums e assets

- **REQ-ETM-046** [MVP] O sistema DEVE prover compendiums criados à mão (`ver
16-compendiums-e-importacao.md`): **Partículas** (81: 18 Funções, 19 Objetos,
  34 Características, 10 Complementos), **Origens** canônicas, **Habilidades**
  (Práticas e Teóricas) e **Antagonistas** (Fichas Base + exemplos).
- **REQ-ETM-047** [MVP] No MVP, cada Partícula DEVE renderizar com **placeholder
  tipográfico** (palavra Etmos + cor por categoria); o slot `icone_runico` DEVE
  existir para assets vetoriais futuros (D7).
- **REQ-ETM-048** [V2] O sistema DEVE suportar um **modo "baralho de Grimório"**
  que renderize as Partículas como cartas arrastáveis, espelhando o suporte
  físico do jogo.

### Antagonistas

- **REQ-ETM-049** [MVP] A ficha de Antagonista DEVE permitir escolher a Ficha
  Base (que pré-preenche Ferimentos, Estresse, Complexidade, Movimentação,
  Atributos sugeridos) e editar livremente Aptidões e Ataques (listas de texto
  com efeito).
- **REQ-ETM-050** [MVP] Ataques de Antagonista PODEM declarar **quantidade exata
  de Ferimentos** (exceção do SRD: só Aptidões de criatura causam dano exato),
  aplicável ao alvo selecionado via o tracker de combate.

### i18n

- **REQ-ETM-051** [MVP] Todos os rótulos da ficha e do Compositor DEVEM usar
  chaves i18n com **pt-BR primário** (`ver 11-ui-framework-e-fichas.md` §i18n);
  termos da linguagem Etmos (palavras das Partículas) são **nomes próprios** e não
  se traduzem.

---

## Requisitos não-funcionais

- **REQ-ETM-NFR-001** Todo cálculo derivado (limites, Fadiga, Complexidade,
  custos) DEVE ser **puro e determinístico**, implementado em
  `systems/etmos/src` de forma testável isoladamente (`ver
25-testes-e-qualidade.md`).
- **REQ-ETM-NFR-002** Toda rolagem DEVE executar **no servidor** (RNG
  autoritativo, `ver 08-...md`); o cliente nunca computa o resultado de dados.
- **REQ-ETM-NFR-003** O Compositor DEVE manter o estado do card **autoritativo no
  servidor**; clientes refletem via broadcast (`ver 04-rede-e-sincronizacao.md`).
- **REQ-ETM-NFR-004** Nenhuma arte proprietária (glifos rúnicos, ilustrações) DEVE
  ser empacotada sem autorização (`ver 26-licencas-e-legal.md`); o MVP usa apenas
  placeholders tipográficos.
- **REQ-ETM-NFR-005** Lacunas de regra DEVEM degradar para **controle manual**
  (campo editável / modificador livre), nunca para regra inventada (D8).
- **REQ-ETM-NFR-006** As fichas DEVEM ser usáveis em tablet (alvo mínimo de
  responsividade, `ver 23-acessibilidade-e-dispositivos.md`).

---

## Modelo de dados

> Interfaces do conteúdo de `system` de cada Document. Os campos comuns de
> engine (`_id`, `name`, `type`, `flags`, `ownership`, `_stats`) vivem em
> `ver 02-modelo-de-dados.md`. Tipos validados por Zod, registrados via
> `ver 15-api-de-sistemas.md`.

### Tipos auxiliares

```ts
type Mundo = "mundano" | "fantastico";
type Complexidade = "trivial" | "regular" | "dificil" | "complexa" | "milagre";
type EstadoFadiga = "normal" | "cansado" | "exausto" | "esgotado";
type CategoriaParticula = "funcao" | "objeto" | "caracteristica" | "complemento";
type SubtipoComplemento = "modificador" | "criador";
type CategoriaMarco = "fisicos" | "mentais" | "emocionais";

interface Atributo {
  /** valor base 1..6 (mínimo 1 — D2) */
  value: number;
  max: 6;
}

interface Recurso {
  atual: number;
  /** derivado, read-only na UI */
  limite: number;
}

interface Trilha {
  /** 0..max caixas marcadas */
  value: number;
  max: number;
}
```

### Actor Orador (`system` de `type: "orador"`)

```ts
interface OradorSystem {
  player_name: string;
  ano_escolar: string; // "1°", "2°", "3°", graduação...
  idade: number;
  nivel: number; // 1..6
  especie: string; // narrativo
  mundo_origem: Mundo;

  atributos: {
    corpo: Atributo;
    alma: Atributo;
    mente: Atributo;
  };

  // --- derivados (calculados em prepareData; persistidos como cache opcional) ---
  ferimentos: Recurso; // limite = 4 + floor(corpo/2)
  estresse: Recurso; // limite = 4 + alma
  fadiga: { estado: EstadoFadiga }; // derivado de (estresse.atual - estresse.limite)
  complexidade_maxima: Complexidade; // derivado de mente

  dados_empenho: { atual: number }; // expiram no dia fictício seguinte

  // --- Totem / magia no Mundano (D-/REQ-ETM-042/043) ---
  totem: { possui: boolean; rank: number }; // rank 0..5

  // --- Marcos de Crescimento (trilhas 5×3) ---
  marcos_crescimento: {
    fisicos: Trilha; // max 5
    mentais: Trilha; // max 5
    emocionais: Trilha; // max 5
  };

  // --- Conceito (narrativo; sem mecânica — controles manuais) ---
  conceito: {
    basico: string;
    aparencia: string;
    pontos_importancia: string; // campo livre (Q-D4 do research: sem efeito mecânico)
    futuro: string;
    valores: Array<{ polo_a: string; polo_b: string }>; // 2 eixos
  };

  // Grimório, Origens e Habilidades são Items embedded (não campos aqui).
}
```

### Actor Antagonista (`system` de `type: "antagonista"`)

```ts
interface AntagonistaSystem {
  ficha_base: "simples" | "intermediaria" | "avancada";
  ferimentos: Recurso; // limite editável (criaturas têm valor fixo)
  estresse: Recurso;
  complexidade_maxima: Complexidade;
  movimentacao: number; // metros
  comunicacao: boolean;
  atributos: { corpo: number; alma: number; mente: number };
  aptidoes: Array<{ nome: string; descricao: string }>;
  ataques: Array<{
    nome: string;
    ferimentos: number | null; // dano EXATO permitido (REQ-ETM-050)
    defesa: "completa" | "parcial" | "ineficaz" | "contestada" | null;
    alcance: string; // ex.: "1m", "30m", "área 5m"
    descricao: string;
  }>;
}
```

### Item Partícula (`type: "particula"`)

```ts
interface ParticulaSystem {
  palavra_etmos: string; // ex.: "Et", "Imu", "Mor"
  categoria: CategoriaParticula;
  /** apenas para complementos: nível mínimo de Grimório 1..4 */
  nivel_grimorio: number | null;
  /** apenas para complementos */
  subtipo_complemento: SubtipoComplemento | null;
  significado: string; // ex.: "Controlar"
  descricao: string;
  /** placeholder no MVP; path de asset vetorial quando disponível (D7) */
  icone_runico: string | null;
}
```

### Item Frase Mágica (`type: "frase_magica"`)

```ts
interface FraseMagicaSystem {
  funcao_id: string; // _id da Partícula Função (exatamente 1)
  objeto_ids: string[]; // ≥1 Objeto
  caracteristica_ids: string[]; // 0+
  complemento_ids: string[]; // 0+
  frase_completa: string; // gerada: Função+Objeto fundidos + palavras
  intencao: string; // texto livre declarado
  complexidade: Complexidade | null; // null até arbitrada pelo Narrador
  estresse_gerado: number; // custo aplicado (Tabela A + rank Totem)
}
```

### Item Habilidade (`type: "habilidade"`)

```ts
interface HabilidadeSystem {
  categoria: "pratica" | "teorica";
  descricao: string;
  bonus: number; // somado em 2d6 + bonus
  usos_por_dia: number | null;
  requer_acao: boolean;
  escolhivel_multiplas_vezes: boolean; // ex.: Conhecimento, Treinamento Mágico
}
```

### Item Origem (`type: "origem"`)

```ts
interface OrigemSystem {
  mundo_associado: "mundano" | "fantastico" | "ambos";
  exclusiva: boolean; // só do tipo correspondente
  descricao: string;
  efeito_mecanico: string; // texto; aplicação manual/arbitrada
}
```

### Item Totem (`type: "totem"`) e Item Encantado (`type: "item_encantado"`)

```ts
interface TotemSystem {
  rank: number; // 0..5
  sintonia_com: string | null; // nome do Orador sintonizado
  materia_prima: string;
  is_santuario: boolean; // Santuário = Totem de área
  area_metros: number | null; // quando Santuário
}

interface ItemEncantadoSystem {
  frase: FraseMagicaSystem; // a magia gravada (com Intenção fixa)
  grau_sofisticacao: "simples" | "sofisticado" | "primoroso";
  veiculo: "consumivel" | "persistente";
  pp_necessarios: number; // 5 / 10 / 15 base
  pp_acumulados: number; // progresso do encantamento
  concluido: boolean;
}
```

### Card de Conjuração (estado do Compositor)

Armazenado em `flags.etmos.conjuracao` de uma `ChatMessage` (`ver
09-chat-e-mensagens.md`). É a máquina de estados do Compositor (D5).

```ts
type EstadoConjuracao =
  | "proposta"
  | "arbitrada"
  | "rolada"
  | "resolvida"
  | "recusada"
  | "cancelada";

interface ConjuracaoCard {
  estado: EstadoConjuracao;
  conjurador_actor_id: string;
  frase: FraseMagicaSystem;
  // preenchidos pelo Narrador na arbitragem:
  complexidade: Complexidade | null;
  custo_estresse: number | null;
  notas_narrador: string;
  // resultado:
  roll_message_id: string | null; // vínculo à rolagem (ver 08-...md)
  dificuldade_alvo: number | null;
  sucesso: boolean | null;
  // controle (Exausto/Esgotado):
  controle_fadiga: {
    rolou: boolean;
    valor: number | null;
    falhou: boolean;
    morreu: boolean;
  } | null;
}
```

---

## API e eventos

> Registros que `systems/etmos` faz na `system-api` (`ver 15-api-de-sistemas.md`)
> e eventos que consome/emite. Os nomes são ilustrativos do contrato.

### Registro do sistema

- **Models:** `registerActorModel("orador" | "antagonista", schema)`,
  `registerItemModel("particula" | "habilidade" | "origem" | "totem" |
"item_encantado" | "frase_magica", schema)`.
- **Sheets:** `registerSheet({ documentType, subtype, component })` apontando para
  os componentes Svelte (`ver 11-ui-framework-e-fichas.md`).
- **Roll data:** `registerRollData(actor → { atributos, habilidades, ... })`
  (`ver 08-...md`).
- **DegreeOfSuccess:** o sistema implementa `computeDegreeOfSuccess(total, dc, context)`
  (REQ-ROL-038) via `RollHook.postRoll`, retornando `"success"` ou `"failure"` do conjunto
  binário próprio do Etmos, mais a margem (`total − dc`) como metadado (D6).
- **Iniciativa:** `registrar.initiativeFormula({ id: "etmos-corpo", label: "Corpo",
build(combatant, ctx): string, compare(a, b): number })` — `build` retorna a fórmula
  `"2d6 + @atributos.corpo.value"`; o desempate "jogadores vencem NPCs" é implementado em
  `compare(a, b)` (maior `initiative` → `hasPlayerOwner` → maior Corpo) conforme o contrato
  de `ver 10-combate-e-iniciativa.md` (REQ-SYS-042, REQ-CBT-013, REQ-ETM-022).
- **Compendiums:** declaração dos packs `particulas`, `origens`, `habilidades`,
  `antagonistas` (`ver 16-compendiums-e-importacao.md`).

### Funções puras expostas (testáveis)

```ts
function limiteFerimentos(corpo: number): number;          // 4 + floor(corpo/2)
function limiteEstresse(alma: number): number;             // 4 + alma
function complexidadeMaxima(mente: number): Complexidade;
function estadoFadiga(estresse: number, limite: number): EstadoFadiga;
function custoEstresse(c: Complexidade, rankTotem: number): number; // Tabela A + rank
function classeDificuldade(total: number): "simples"|"facil"|"mediano"|"arduo"|"dificil";
function montarFrase(funcao, objetos, caracteristicas, complementos): string;
function validarFrase(...): { valido: boolean; erros: string[] };
function opcoesProgressao(nivelAtual: number): { fisica; mental; emocional }; // Tabela E
```

### Eventos de combate consumidos

- `onTurnStart(combatant)` → resetar Reação do Orador (REQ-ETM-023).
- `onRoundStart` → (sem efeito específico no MVP).

### Eventos do Compositor (socket, via servidor autoritativo)

- `etmos:conjuracao:propor` → cria card `proposta`.
- `etmos:conjuracao:arbitrar` → GM → `arbitrada` | `recusada`.
- `etmos:conjuracao:rolar` → `rolada` (dispara rolagem no servidor).
- `etmos:conjuracao:resolver` → GM → `resolvida` (aplica custo de Estresse).
- `etmos:conjuracao:cancelar` → `cancelada`.

---

## Dependências (specs irmãs)

- `ver 02-modelo-de-dados.md` — contrato de Document, campos comuns, embedding,
  Zod.
- `ver 04-rede-e-sincronizacao.md` — broadcast autoritativo do estado do card de
  conjuração e dos updates de ficha.
- `ver 05-usuarios-e-permissoes.md` — quem pode arbitrar/rolar/resolver
  (Narrador vs. jogador).
- `ver 08-motor-de-rolagens.md` — execução de `2d6+mod` no servidor, roll data,
  `DegreeOfSuccess`, rerolls (Dados de Empenho).
- `ver 09-chat-e-mensagens.md` — o card de conjuração é uma ChatMessage com
  flags.
- `ver 10-combate-e-iniciativa.md` — iniciativa `2d6+Corpo`, desempate via `compare`
  (jogadores vencem NPCs), Reação por rodada.
- `ver 11-ui-framework-e-fichas.md` — sheets Svelte, janelas, autosave, i18n,
  responsividade.
- `ver 15-api-de-sistemas.md` — superfície de registro do sistema. **Nota de
  namespace de roll data:** o roll data do Etmos usa o caminho
  `@atributos.corpo.value` / `@atributos.alma.value` / `@atributos.mente.value`,
  alinhado ao schema `OradorSystem.atributos.corpo.value` desta spec. O exemplo
  ilustrativo da 15 (REQ-SYS-042: `2d6 + @abilities.corpo`) usa notação abreviada;
  a implementação concreta deve usar o namespace aqui definido.
- `ver 16-compendiums-e-importacao.md` — packs criados à mão (Partículas etc.).
- `ver 20-assets-e-midia.md` — armazenamento dos placeholders/glifos.
- `ver 23-acessibilidade-e-dispositivos.md` — uso em tablet.
- `ver 25-testes-e-qualidade.md` — testes das funções puras de regra.
- `ver 26-licencas-e-legal.md` — status de licenciamento do Etmos.

---

## Critérios de aceitação

- **CA-1** É possível criar um Orador Nível 1 válido pelo assistente (2 Origens, 6
  Pontos ≤4, 2+2 Habilidades, Grimório 2/3/4) e os derivados (Limite de
  Ferimentos, Limite de Estresse, Complexidade Máxima) aparecem corretos para
  todos os valores 1–6 dos Atributos (conforme Tabelas B/C).
- **CA-2** Alterar Corpo de 1→6 recalcula Limite de Ferimentos 4→7; alterar Alma
  1→6 recalcula Limite de Estresse 5→10.
- **CA-3** Acumular Estresse cruza corretamente os estados de Fadiga nas faixas 1–5
  (Cansado), 6–8 (Exausto), 9+ (Esgotado), com as penalidades exibidas.
- **CA-4** Ferimentos > Limite sinaliza Inconsciente; Ferimentos = Limite+4
  sinaliza Morte.
- **CA-5** Os botões de Teste de Atributo/Habilidade/Conjuração executam `2d6+mod`
  no servidor e, com dificuldade-alvo, classificam sucesso/falha e a classe de
  dificuldade no chat.
- **CA-6** Um Teste Contestado entre um jogador e um NPC com empate é resolvido a
  favor do jogador.
- **CA-7** A iniciativa de combate usa `2d6+Corpo`; o `compare(a, b)` registrado pela
  `InitiativeFormula` ordena por `initiative` descendente e, em empate, faz jogadores
  (`hasPlayerOwner`) superarem NPCs e, entre jogadores empatados, aquele com Corpo maior
  ficar à frente — aplicado pelo núcleo ao ordenar a fila (DEC-CBT-04, REQ-CBT-013).
- **CA-8** No Compositor, montar `Et`(Função) + `Imu`(Objeto) gera a frase falada
  "Etimu"; tentar 0 Funções ou 2 Funções é rejeitado com mensagem.
- **CA-9** O fluxo completo do card de conjuração percorre
  `proposta→arbitrada→rolada→resolvida`, e ao resolver aplica o custo de Estresse
  (incl. Rank de Totem) ao conjurador, recomputando a Fadiga.
- **CA-10** Conjurar não Trivial estando Exausto dispara a rolagem 2d6 de controle
  e, com `> Corpo+4`, marca a magia como falha (Estresse ainda acumula).
- **CA-11** Completar as 3 trilhas de Marcos habilita a subida de nível;
  confirmar aplica as opções da Tabela E para a transição correta, incrementa o
  Nível e reinicia as trilhas; não é possível escolher a mesma categoria duas
  vezes.
- **CA-12** Conjurar no Mundano sem Totem dispara o aviso de impossibilidade; com
  Totem Rank 2, uma magia não Trivial soma +2 Estresse ao custo.
- **CA-13** O compendium de Partículas contém exatamente 18 Funções, 19 Objetos,
  34 Características e 10 Complementos (81), cada uma com palavra, categoria e (para
  Complementos) nível e subtipo.
- **CA-14** Nenhuma arte proprietária é empacotada; Partículas renderizam com
  placeholder tipográfico colorido por categoria.

---

## Questões em aberto

- **Q1 — Contagem de Funções (18 vs. 17).** A ficha oficial lista **18**
  checkboxes de Função, mas a tabela canônica do SRD (excluindo "Mat") soma 17
  nomes claros. A pesquisa (12b §9.3) afirma "Funções: 18" no resumo e "17 no SRD"
  na nota. Resolver qual é a 18ª Função canônica (ou se "Mat" ocupa o slot na
  ficha apesar de não-canônica) com a editora antes de fechar o compendium.
- **Q2 — Licenciamento.** O Etmos **não tem licença aberta** conhecida (12b §0,
  12 §8). Distribuir `systems/etmos` com os dados de regra e os glifos exige
  **autorização formal da Balde Galáctico / Rafa Reis**. Sem isso, o pacote não
  pode ser publicado. Decisão de produto/legal (`ver 26-licencas-e-legal.md`).
- **Q3 — Glifos rúnicos.** Os símbolos das Partículas (`particulas-v3.pdf`) são
  rasterizados; o OCR não os captura (12b §21 D12). Obter vetoriais sob licença ou
  manter placeholder tipográfico indefinidamente.
- **Q4 — Pontos de Importância.** Sem efeito mecânico no SRD (12b §21 D4). Mantido
  como campo livre; confirmar se o livro base completo (210 p.) lhes dá mecânica.
- **Q5 — Listas completas de Origens e Habilidades.** O SRD traz apenas exemplos
  canônicos (5 Origens, ~10 Habilidades); o livro base pode ter listas maiores
  (12b §21 D2/D10). O compendium do MVP cobre os exemplos do SRD + os dos
  pré-gerados; lacunas viram Origens/Habilidades custom criadas pelo GM.
- **Q6 — Defesa Mágica como automação.** O SRD define Defesa Completa/Parcial/
  Ineficaz por Teste Contestado, mas a _aplicação_ (quanto reduz, o que dura) é
  arbitrada. Manter como controle manual no MVP ou tentar semiautomatizar a
  redução de Ferimentos? (Inclinação: manual, conforme D8.)
- **Q7 — Expiração diária dos Dados de Empenho.** O SRD diz que expiram no início
  do dia fictício seguinte; o Fusion não tem relógio de tempo fictício no MVP.
  Resolver via botão manual de "novo dia" (reset) ou flag de cena. (Inclinação:
  botão manual.)

---

## Referências

- `docs/research/12b-etmos-fontes-locais.md` — SRD-ETMOS 1.1 + ficha oficial +
  livro de Partículas (fonte canônica desta spec). Seções usadas: §3 (resolução),
  §4 (Atributos), §5 (criação), §6 (data model/ficha), §7 (Origens), §8
  (Habilidades), §9 (Grimório/Partículas/Complexidade), §10 (progressão/Tabela E),
  §11 (combate/iniciativa/Reação/Ferimentos), §12 (Estresse/Fadiga), §13
  (Totens/Santuários), §14 (Encantamento/Pontos de Preparo), §15 (Antagonistas),
  §16 (Descanso), §17 (Segmentos/Dados de Empenho), §18 (Tabelas A–E), §19
  (implicações VTT), §20 (pré-gerados), §21 (dúvidas).
- `docs/research/12-etmos-sistema.md` — identificação, ambientação, fontes
  públicas, licenciamento (§8), ausência de implementação prévia em VTT (§9).
- Editora Balde Galáctico — site oficial do Etmos:
  `https://baldegalactico.com.br/jogo/etmos/`.
