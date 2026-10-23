# 00 — Visão e Escopo

- **Título:** Visão e Escopo do Fusion VTT
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/01-foundry-arquitetura-stack.md`
  - `docs/research/14-licencas-legal.md`

---

## Objetivo

Definir a visão de produto, o público-alvo, os cenários de uso, os objetivos e não-objetivos, os critérios de sucesso mensuráveis e os princípios de design do **Fusion**: um Virtual Tabletop (VTT) web próprio, self-hosted, inspirado no comportamento observável do Foundry VTT, mas construído em abordagem **clean-room** — sem jamais copiar código proprietário do Foundry. Esta spec é o documento-âncora do conjunto: ela fixa o "porquê" e o "para quem", e delimita o que entra no MVP versus o que fica para versões futuras [V2]. Todas as specs irmãs (01 a 27) derivam dos princípios e do escopo aqui estabelecidos.

Esta spec **não** detalha arquitetura técnica (ver `01-arquitetura-geral.md`), modelo de dados (ver `02-modelo-de-dados.md`) nem qualquer subsistema específico. Ela estabelece o contrato de produto que esses documentos cumprem.

## Escopo

### O que esta spec inclui

- A motivação do produto: por que construir um VTT próprio em vez de usar o Foundry VTT ou outro VTT existente.
- As personas envolvidas: o GM (xansd) e o grupo de jogadores.
- Os cenários de uso suportados: sessão híbrida presencial-remota, jogo em LAN e jogo pela internet.
- Os objetivos do produto e os não-objetivos explícitos (recortes de ambição deliberados).
- A postura legal resumida (clean-room, dados ORC/OGL, uso privado), apontando para `26-licencas-e-legal.md` como fonte normativa.
- Os critérios de sucesso mensuráveis do MVP e além.
- Os princípios de design que governam todas as decisões de produto e engenharia.
- A visão dos três sistemas-alvo (PF2e, SF2e, Etmos) e o que cada um exige de diferente da engine.

### O que esta spec NÃO inclui

- Especificação de arquitetura, protocolos de rede, schemas de dados ou APIs (specs 01–24).
- Detalhamento das regras mecânicas de cada sistema de jogo (specs 17, 18, 19).
- O texto normativo completo das licenças e a matriz de risco legal detalhada (spec 26 — aqui só o resumo operacional).
- O cronograma e os marcos de entrega (spec 27 — `27-roadmap-e-milestones.md`).
- Decisões de stack tecnológica, que já estão fixadas no enunciado do projeto e são detalhadas em uso nas specs específicas. Esta spec apenas as referencia quando relevantes para a visão.

## Conceitos e terminologia

| Termo                     | Definição no contexto do Fusion                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **VTT**                   | Virtual Tabletop — plataforma de software que reproduz a mesa de RPG: mapa, tokens, fichas, rolagens de dados, chat e ferramentas de mestre.                                                                                         |
| **GM**                    | Game Master (mestre). No Fusion, é quem hospeda o servidor e tem permissões plenas sobre o mundo. Persona primária: xansd.                                                                                                           |
| **Jogador (Player)**      | Usuário que conecta ao servidor do GM pelo navegador, controla um ou mais personagens e tem permissões restritas.                                                                                                                    |
| **Mundo (World)**         | Uma campanha: o conjunto de dados criados pelo usuário (cenas, atores, itens, journals) persistido em um arquivo `world.db` próprio. Ver `03-persistencia-e-mundos.md`.                                                              |
| **Sistema (System)**      | Pacote TypeScript/Svelte que implementa as regras de um RPG específico (ex.: PF2e). No Fusion, sistemas são compilados junto com o app — não há plugins de terceiros carregados dinamicamente no MVP. Ver `15-api-de-sistemas.md`.   |
| **Compendium**            | Coleção de conteúdo de referência reutilizável (monstros, magias, itens) importado de fonte open-source. Ver `16-compendiums-e-importacao.md`.                                                                                       |
| **Clean-room**            | Prática de engenharia em que se reimplementa funcionalidade equivalente a um software existente sem copiar seu código-fonte proprietário, trabalhando apenas a partir de comportamento observável e documentação pública.            |
| **Servidor autoritativo** | Modelo em que o servidor é a única fonte de verdade: valida, persiste e faz broadcast de todas as mutações. O cliente nunca decide o resultado de uma rolagem ou de uma mudança de estado sozinho. Ver `04-rede-e-sincronizacao.md`. |
| **ORC / OGL**             | Open RPG Creative License (Paizo, irrevogável) e Open Game License 1.0a — licenças sob as quais as mecânicas dos sistemas-alvo são abertas. Ver `26-licencas-e-legal.md`.                                                            |
| **MVP**                   | Minimum Viable Product. Aqui: o conjunto mínimo que permite ao grupo jogar uma sessão completa de PF2e (definição detalhada abaixo).                                                                                                 |

## Decisões

Cada decisão lista a alternativa rejeitada e o racional. As decisões de **stack** já estão fixadas pelo projeto e não são rediscutidas aqui; estas são decisões de **produto e escopo**.

### DEC-ESC-01: Construir um VTT próprio em vez de usar/estender o Foundry VTT

- **Decisão:** Desenvolver o Fusion do zero, em clean-room, como motor próprio com API de sistemas própria.
- **Alternativas rejeitadas:**
  - _Usar o Foundry VTT com o sistema oficial pf2e._ Rejeitada porque o objetivo do projeto é ter controle total sobre o motor, a API de sistemas e a experiência pt-BR-first, além de suportar o Etmos RPG (sistema brasileiro sem suporte no ecossistema Foundry). O Foundry também é software proprietário pago, com EULA que restringe extensão profunda e cuja arte/conteúdo pf2e está sob acordo de parceria exclusiva inacessível a terceiros (ver `docs/research/14-licencas-legal.md` §5.4).
  - _Forkar um VTT open-source existente._ Rejeitada para não herdar dívida técnica e restrições de licença de terceiros, e porque a curva de aprendizado de um motor próprio é parte do valor do projeto.
- **Racional:** Um motor próprio dá liberdade de design (GM-first, pt-BR-first, automação opcional), evita custos de licença e habilita o terceiro sistema-alvo (Etmos) sem depender de comunidade externa. A pesquisa confirma que as tecnologias-base (Node.js, WebSocket, canvas WebGL, persistência embarcada) são genéricas e legalmente livres de usar (ver `docs/research/01-foundry-arquitetura-stack.md` §10.2).

### DEC-ESC-02: Servidor self-hosted na máquina do GM, jogadores via navegador

- **Decisão:** O servidor roda localmente na máquina do GM; jogadores conectam pelo navegador via LAN ou internet, sem instalar nada.
- **Alternativas rejeitadas:**
  - _SaaS multi-tenant hospedado._ Rejeitada porque introduz custo operacional contínuo, responsabilidade de dados de terceiros e complexidade de infraestrutura incompatível com um projeto pessoal de grupo fechado. Também aumenta o risco legal (distribuição pública de conteúdo).
  - _Aplicativo desktop puro sem servidor de rede._ Rejeitada porque impede jogo remoto, que é um cenário central.
- **Racional:** O modelo self-hosted é o validado pelo Foundry (a pesquisa registra ~68% dos usuários rodando empacotado na máquina local — `docs/research/01-foundry-arquitetura-stack.md` §1) e é o que melhor serve a um grupo fechado com um GM técnico. Minimiza risco legal (uso privado — `docs/research/14-licencas-legal.md` §8.2) e custo.

### DEC-ESC-03: Foco em três sistemas-alvo, com PF2e como sistema de validação do MVP

- **Decisão:** Suportar PF2e (remaster), Starfinder 2e e Etmos RPG; usar PF2e como o sistema cuja jogabilidade completa define o MVP.
- **Alternativas rejeitadas:**
  - _Engine system-agnostic genérica sem nenhum sistema de referência._ Rejeitada por contrariar o princípio "simplicidade > generalidade": uma engine abstrata sem um sistema concreto guiando o design tende a abstrair cedo demais e errar as abstrações.
  - _Começar pelo Etmos (sistema brasileiro)._ Rejeitada porque o PF2e tem o maior volume de dados abertos e a maior complexidade mecânica, sendo o melhor estresse para a engine; validar o caso difícil primeiro reduz risco.
- **Racional:** PF2e é o sistema mais rico em dados abertos (compendiums JSON sob ORC/OGL no repo `foundryvtt/pf2e`) e o mais exigente mecanicamente, então valida a engine de forma robusta. SF2e reaproveita a base do PF2e (mesmo modelo ORC e mecânica de origem comum). Etmos valida a generalidade da API de sistemas com um sistema independente e material-fonte local.

### DEC-ESC-04: Não competir comercialmente; uso privado e, no máximo, distribuição gratuita

- **Decisão:** O Fusion é um projeto de uso privado do grupo do GM. Não é um produto comercial, não tem marketplace, não cobra acesso. Se houver distribuição, será gratuita e sem marcas Paizo.
- **Alternativas rejeitadas:**
  - _Modelo comercial / freemium._ Rejeitada porque exigiria commercial license com a Paizo para usar marcas, e porque qualquer monetização choca com a Community Use Policy e eleva o risco legal (`docs/research/14-licencas-legal.md` §8.2). Não é o objetivo do projeto.
  - _Marketplace de módulos/sistemas de terceiros._ Rejeitada por escopo: carregamento dinâmico de plugins de terceiros é explicitamente [V2], e um marketplace traz responsabilidades de moderação, segurança e legais desproporcionais.
- **Racional:** O uso privado em grupo fechado é o cenário de risco mínimo segundo a pesquisa legal. Não monetizar mantém o projeto inteiramente dentro de ORC/OGL para mecânicas, sem necessidade de licença comercial.

### DEC-ESC-05: Sem compatibilidade com módulos, sistemas ou dados binários do Foundry

- **Decisão:** O Fusion não busca compatibilidade com módulos do Foundry, com a API do Foundry, nem com seus formatos de dados (LevelDB packs, manifests `system.json`/`module.json`). A interoperabilidade com o ecossistema pf2e se dá apenas via **conversores** que leem os JSON abertos.
- **Alternativas rejeitadas:**
  - _Compat com a API do Foundry para reaproveitar módulos._ Rejeitada por ser clean-room incompatível com replicar a API proprietária do Foundry (`docs/research/14-licencas-legal.md` §1.3) e por acoplar o Fusion a um design externo que não controlamos.
  - _Importar diretamente os LevelDB packs do Foundry._ Rejeitada porque os packs binários carregam arte e referências sob acordo de parceria exclusiva (proibido — `docs/research/14-licencas-legal.md` §5.4); a importação correta filtra apenas campos mecânicos dos JSON abertos.
- **Racional:** Independência de design e conformidade clean-room. A engine tem liberdade de evoluir sua própria API de sistemas (`15-api-de-sistemas.md`) sem amarras com o Foundry. A importação de dados é tratada por conversores dedicados (`16-compendiums-e-importacao.md`, `tools/importer-pf2e`).

### DEC-ESC-06: Automação como camada opcional, não obrigatória

- **Decisão:** A engine automatiza rolagens, aplicação de dano, condições e fluxo de combate, mas toda automação deve poder ser feita manualmente pelo GM. Nenhuma automação é um pré-requisito rígido para jogar.
- **Alternativas rejeitadas:**
  - _Automação total e opinativa (a engine sempre resolve tudo)._ Rejeitada porque RPG de mesa frequentemente exige rulings do GM que contrariam a regra padrão; uma engine que impõe automação atrapalha. Também eleva o custo de implementação por sistema.
- **Racional:** Princípio "automação opcional, GM-first". A automação é um acelerador, não uma autoridade. O GM sempre pode sobrepor. Isso reduz o acoplamento entre engine e regras e mantém a engine utilizável mesmo para partes de um sistema ainda não automatizadas.

### DEC-ESC-07: pt-BR como idioma primário do produto

- **Decisão:** A UI, a documentação de usuário e o conteúdo padrão são em português do Brasil; inglês é idioma secundário. Identificadores e código permanecem em inglês.
- **Alternativas rejeitadas:**
  - _en primário (padrão do ecossistema VTT)._ Rejeitada porque o público é um grupo brasileiro e um dos sistemas (Etmos) é brasileiro; pt-BR-first é diferencial central de produto.
- **Racional:** Princípio "pt-BR first". Nenhum VTT consolidado prioriza pt-BR; isso é parte do valor do Fusion para seu público. Ver `23-acessibilidade-e-dispositivos.md` para detalhes de i18n e `11-ui-framework-e-fichas.md` para a aplicação na UI.

### DEC-ESC-08: Distribuição inicial como executável/CLI de servidor + browser; desktop Tauri é [V2]

- **Decisão:** O MVP distribui um executável/CLI do servidor que o GM roda na própria máquina; o acesso (inclusive do GM) é pelo navegador. O wrapper desktop (Tauri v2) é fase 2.
- **Alternativas rejeitadas:**
  - _Empacotar desde o MVP em um wrapper desktop (estilo Electron do Foundry)._ Rejeitada para reduzir escopo do MVP e evitar a complexidade de empacotamento multi-plataforma antes de validar a jogabilidade. A pesquisa mostra que o Foundry oferece ambos os modos (empacotado e headless) — começar pelo headless/CLI é o caminho de menor esforço.
- **Racional:** Foco do MVP em jogar uma sessão, não em conveniência de empacotamento. O wrapper desktop melhora a experiência do GM mas não habilita nenhuma capacidade nova de jogo. Ver `22-instalacao-e-distribuicao.md`.

## Requisitos funcionais

Requisitos de produto/escopo. Requisitos técnicos detalhados vivem nas specs irmãs. Cada requisito é testável; a tag [MVP] ou [V2] alinha-se à definição global de MVP.

### Visão e personas

- **REQ-ESC-001** [MVP] O Fusion DEVE permitir que um único GM hospede um servidor de jogo na própria máquina e que jogadores conectem a esse servidor exclusivamente pelo navegador, sem instalação de software no lado do jogador.
- **REQ-ESC-002** [MVP] O sistema DEVE distinguir, no mínimo, dois papéis de usuário — GM (permissões plenas) e Jogador (permissões restritas) — conforme detalhado em `05-usuarios-e-permissoes.md`.
- **REQ-ESC-003** [MVP] O Fusion DEVE suportar o cenário híbrido: jogadores presentes fisicamente na mesma sala e jogadores remotos conectados pela internet, compartilhando o mesmo mundo simultaneamente.
- **REQ-ESC-004** [MVP] O Fusion DEVE operar em rede local (LAN) sem dependência de serviços de nuvem de terceiros.
- **REQ-ESC-005** [MVP] O Fusion DEVE permitir acesso de jogadores pela internet, com o GM expondo seu servidor (detalhes de conectividade, portas e segurança em `21-seguranca.md` e `22-instalacao-e-distribuicao.md`).

### Escopo de jogabilidade do MVP

- **REQ-ESC-006** [MVP] O grupo DEVE conseguir jogar uma sessão completa de PF2e usando apenas o Fusion, sem necessidade do Foundry VTT ou de qualquer VTT de terceiros.
- **REQ-ESC-007** [MVP] Uma sessão completa DEVE incluir, no mínimo: cena com mapa e grid; tokens com movimento; visão, iluminação e fog of war básicos; fichas de personagem funcionais; rolagens automatizadas básicas; chat; e combat tracker com iniciativa. (Cada capacidade é detalhada em sua spec: `06`, `07`, `10`, `11`, `08`, `09`.)
- **REQ-ESC-008** [MVP] O servidor DEVE ser autoritativo: validar, persistir e fazer broadcast de toda mutação de estado e de toda rolagem de dados, de modo que nenhum cliente possa determinar sozinho o resultado de uma rolagem (anti-cheat). Ver `04-rede-e-sincronizacao.md` e `08-motor-de-rolagens.md`.

### Sistemas-alvo

- **REQ-ESC-009** [MVP] O Fusion DEVE suportar o sistema Pathfinder 2e (remaster) como sistema de referência do MVP, com fichas, rolagens e combate funcionais. Ver `17-sistema-pf2e.md`.
- **REQ-ESC-010** [V2] O Fusion DEVE suportar o sistema Starfinder 2e, reaproveitando a base mecânica e o modelo de licença comuns ao PF2e. Ver `18-sistema-sf2e.md`.
- **REQ-ESC-011** [V2] O Fusion DEVE suportar o sistema Etmos RPG (Editora Balde Galáctico) a partir do material-fonte local, validando a generalidade da API de sistemas. Ver `19-sistema-etmos.md`.
- **REQ-ESC-012** [MVP] Os sistemas de jogo DEVEM ser pacotes compilados junto com o app no monorepo; o MVP NÃO DEVE oferecer carregamento dinâmico de plugins de terceiros (isso é [V2]). Ver `15-api-de-sistemas.md`.

### Importação de dados

- **REQ-ESC-013** [MVP] O Fusion DEVE importar dados abertos (mecânicas) dos compendiums do repositório open-source `foundryvtt/pf2e` por meio de conversores próprios, filtrando apenas campos mecânicos. Ver `16-compendiums-e-importacao.md` e `tools/importer-pf2e`.
- **REQ-ESC-014** [MVP] A importação NÃO DEVE incluir arte, ilustrações, tokens, ícones nem texto de setting/lore protegidos como Reserved Material da Paizo ou cobertos pelo acordo de parceria exclusiva Paizo/Foundry. Ver `26-licencas-e-legal.md`.

### Postura legal e de marca

- **REQ-ESC-015** [MVP] O Fusion DEVE ser desenvolvido em clean-room: NÃO DEVE conter, referenciar ou derivar do código-fonte proprietário do Foundry VTT. Apenas documentação pública e comportamento observável são fontes permitidas.
- **REQ-ESC-016** [MVP] O produto distribuído NÃO DEVE usar as marcas "Foundry", "Pathfinder", "Starfinder" ou "Paizo", nem logos da Paizo, em seu nome, título de janela, metadados ou nomes de arquivos de instalação. Ver `26-licencas-e-legal.md` §9.
- **REQ-ESC-017** [MVP] O Fusion DEVE manter separação clara entre o código da aplicação (propriedade do projeto) e os dados de conteúdo licenciado (ORC/OGL), e DEVE rastrear a licença de origem de cada compendium importado. Ver `16-compendiums-e-importacao.md`.
- **REQ-ESC-018** [MVP] O conteúdo do Etmos RPG DEVE ser tratado como uso estritamente privado do grupo, NÃO DEVE ser redistribuído publicamente, e seu material-fonte permanece propriedade da Editora Balde Galáctico. Ver `26-licencas-e-legal.md`.

### Princípios de produto como requisitos

- **REQ-ESC-019** [MVP] Toda automação de regras (rolagens, dano, condições, fluxo de combate) DEVE ter equivalente manual disponível ao GM; nenhuma automação pode ser pré-requisito rígido para conduzir a sessão.
- **REQ-ESC-020** [MVP] A interface de usuário e a documentação do usuário final DEVEM estar disponíveis em pt-BR como idioma primário, com en como secundário.

## Requisitos não-funcionais

- **RNF-ESC-01 (Simplicidade de operação)** [MVP] Um GM com perfil técnico moderado DEVE conseguir iniciar o servidor, criar um mundo e convidar jogadores seguindo a documentação, sem editar código. Detalhes em `22-instalacao-e-distribuicao.md`.
- **RNF-ESC-02 (Acessibilidade de cliente)** [MVP] O cliente DEVE rodar em navegadores modernos de desktop (Chrome/Chromium, Firefox, Edge) com aceleração de hardware, sem instalação adicional. Ver `23-acessibilidade-e-dispositivos.md`.
- **RNF-ESC-03 (Escala de grupo)** [MVP] A engine DEVE ser dimensionada para uma mesa típica de RPG — da ordem de 1 GM e até ~6 jogadores simultâneos — e não para multidões. Metas de performance concretas em `04-rede-e-sincronizacao.md` e `06-canvas-e-renderizacao.md`.
- **RNF-ESC-04 (Privacidade e risco legal mínimo)** [MVP] O produto DEVE ser operável inteiramente em modo privado (grupo fechado), sem telemetria que vaze conteúdo de jogo para terceiros. Ver `24-operacao-backups-telemetria.md` e `21-seguranca.md`.
- **RNF-ESC-05 (Portabilidade de mundo)** [MVP] Um mundo DEVE ser autocontido o suficiente para ser copiado entre máquinas (arquivo `world.db` + pasta `assets/`), facilitando backup e migração. Ver `03-persistencia-e-mundos.md` e `24-operacao-backups-telemetria.md`.
- **RNF-ESC-06 (Idioma de código vs. produto)** [MVP] O código, comentários, identificadores e nomes de variáveis DEVEM ser em inglês; a camada de produto voltada ao usuário DEVE ser pt-BR-first. Esta separação é invariante do projeto.

## Modelo de dados

Esta spec não define entidades persistidas. As interfaces TypeScript dos documentos (World, User, Actor, etc.) são definidas em `02-modelo-de-dados.md`. Para fins de visão, registram-se apenas os conceitos de alto nível e seus donos de spec:

```typescript
// Conceitos de produto (não-normativos aqui; ver specs indicadas).
// A definição canônica de cada tipo vive na spec correspondente.

/** Papéis de usuário no Fusion. Definição normativa em 05-usuarios-e-permissoes.md */
// MVP: PLAYER, TRUSTED, ASSISTANT, GAMEMASTER (enum Role em packages/shared).
// "observer" como role distinto não existe — ownership cobre esse caso de uso.
type UserRole = "player" | "trusted" | "assistant" | "gamemaster";

/** Sistemas de jogo suportados. Definição normativa em 15-api-de-sistemas.md */
type SystemId = "pf2e" | "sf2e" | "etmos";

/** Cenário de uso pretendido — usado apenas para enquadrar requisitos. */
type UsageScenario = "lan" | "internet" | "hybrid";
```

## API e eventos

Não aplicável a esta spec. As superfícies de API e os eventos de rede são definidos em `04-rede-e-sincronizacao.md`, `15-api-de-sistemas.md` e nas specs de cada subsistema.

## Dependências (specs irmãs)

Esta spec é a raiz conceitual; todas as demais derivam dela. As dependências mais diretas, que **consomem** as decisões aqui tomadas:

- `01-arquitetura-geral.md` — materializa o modelo cliente/servidor autoritativo (DEC-ESC-02, REQ-ESC-008).
- `04-rede-e-sincronizacao.md` — implementa autoridade do servidor e cenários LAN/internet/híbrido (REQ-ESC-003 a 005, 008).
- `15-api-de-sistemas.md` — concretiza sistemas como pacotes compilados (DEC-ESC-05, REQ-ESC-012).
- `16-compendiums-e-importacao.md` — implementa a importação filtrada de dados abertos (REQ-ESC-013, 014, 017).
- `17`, `18`, `19` — os três sistemas-alvo (REQ-ESC-009 a 011).
- `22-instalacao-e-distribuicao.md` — modelo de distribuição e desktop [V2] (DEC-ESC-08).
- `26-licencas-e-legal.md` — fonte normativa da postura legal resumida aqui (DEC-ESC-04, 05; REQ-ESC-015 a 018).
- `27-roadmap-e-milestones.md` — sequencia MVP vs. [V2] conforme as tags desta spec.

## Critérios de aceitação

- **CA-ESC-01** Existe um documento de visão (este) que enumera personas, cenários, objetivos, não-objetivos, critérios de sucesso e princípios de design, e cada um é rastreável a um requisito REQ-ESC-NNN.
- **CA-ESC-02** A definição de MVP global (sessão completa de PF2e com mapa+grid, tokens com movimento, visão/iluminação/fog básicos, fichas, rolagens básicas, chat e combat tracker) está integralmente coberta por requisitos [MVP] (REQ-ESC-006, 007).
- **CA-ESC-03** Todo requisito está marcado [MVP] ou [V2], e nenhum requisito [V2] é pré-condição de um requisito [MVP].
- **CA-ESC-04** A postura clean-room está expressa como requisito verificável (REQ-ESC-015) e não há, em nenhuma spec irmã, instrução para copiar código do Foundry.
- **CA-ESC-05** A postura legal de marcas e conteúdo (REQ-ESC-016 a 018) é consistente com `26-licencas-e-legal.md`; qualquer divergência é registrada em Questões em aberto.
- **CA-ESC-06** Os três sistemas-alvo têm requisito próprio (REQ-ESC-009 a 011) com a respectiva tag de fase, e o documento explica o que cada um exige de diferente da engine (seção "Visão dos sistemas-alvo" abaixo).

## Visão do produto (narrativa)

### Por que um VTT próprio

O grupo do GM quer uma mesa virtual sob controle total: que priorize o português, suporte um sistema brasileiro (Etmos) que nenhum VTT consolidado atende, e ofereça uma experiência GM-first sem a complexidade e o custo de licença do Foundry. Construir do zero — em vez de estender o Foundry — também é um objetivo de aprendizado e de liberdade de design: a engine não herda decisões nem restrições legais de um produto proprietário, e pode evoluir sua própria API de sistemas. A pesquisa de arquitetura confirma que as tecnologias necessárias são maduras e genéricas, e que o modelo self-hosted é o caminho validado para esse perfil de uso (`docs/research/01-foundry-arquitetura-stack.md`).

### Personas

- **GM (xansd) — persona primária.** Tecnicamente proficiente, hospeda o servidor na própria máquina, prepara cenas e encontros, conduz a narrativa e arbitra regras. Precisa de controle total, automação que economize tempo mas nunca o substitua, e ferramentas de preparação e de mesa em pt-BR. É quem instala, atualiza e faz backup do mundo.
- **Jogadores — persona secundária.** Membros do grupo (presenciais e remotos) que conectam pelo navegador, controlam seus personagens, rolam dados, movem tokens e interagem no chat. Querem entrar rápido (sem instalar nada), uma ficha clara e responsiva, e que o jogo "simplesmente funcione" em rede.

### Cenários de uso

1. **Sessão híbrida presencial-remota.** O GM hospeda na máquina da sala; alguns jogadores estão fisicamente presentes (em seus próprios dispositivos ou olhando uma tela compartilhada) e outros conectam de casa pela internet. Todos veem o mesmo mapa e o mesmo estado em tempo real.
2. **LAN.** Todos na mesma rede local (ex.: casa do GM). Sem dependência de internet ou de nuvem; latência mínima; ideal para sessões presenciais com cada jogador no próprio notebook/tablet.
3. **Internet.** Sessão totalmente remota; o GM expõe o servidor pela internet e os jogadores conectam de qualquer lugar. Exige atenção a portas e segurança (`21-seguranca.md`, `22-instalacao-e-distribuicao.md`).

### Objetivos

- Permitir que o grupo jogue uma sessão completa de PF2e usando só o Fusion.
- Entregar uma experiência GM-first, pt-BR-first, com automação opcional.
- Suportar três sistemas (PF2e, SF2e, Etmos) sobre uma engine única e uma API de sistemas própria.
- Manter o projeto inteiramente em terreno legal seguro (clean-room + ORC/OGL + uso privado).
- Ser simples de operar para um GM técnico e simples de acessar para jogadores (browser-only).

### Não-objetivos

- **Não** competir comercialmente nem monetizar (DEC-ESC-04).
- **Não** oferecer marketplace ou loja de conteúdo.
- **Não** buscar compatibilidade com módulos, API ou formatos de dados do Foundry (DEC-ESC-05).
- **Não** suportar carregamento dinâmico de plugins de terceiros no MVP (REQ-ESC-012; isso é [V2]).
- **Não** redistribuir arte, lore ou marcas da Paizo, nem o material do Etmos (REQ-ESC-014, 018).
- **Não** ser um VTT genérico "para qualquer sistema imaginável": a generalidade é guiada pelos três sistemas-alvo (princípio "simplicidade > generalidade").
- **Não** escalar para grandes públicos/multidões; o alvo é uma mesa de RPG (RNF-ESC-03).

### Postura legal resumida

O Fusion é desenvolvido em **clean-room**: nunca copia código proprietário do Foundry VTT, usando apenas documentação pública e comportamento observável (`docs/research/14-licencas-legal.md` §1.3). As **mecânicas** dos sistemas vêm de conteúdo aberto sob **ORC** (PF2e/SF2e remaster) e, quando legado, **OGL 1.0a** — implementar regras nesse conteúdo é legalmente viável e não obriga abrir o código do Fusion. **Arte, lore e marcas** da Paizo são linha vermelha: não entram no produto. O **Etmos** é tratado como uso estritamente privado, sem redistribuição. Como o uso é privado e gratuito (grupo fechado), o risco é mínimo. A fonte normativa completa, com a matriz de risco e os textos de atribuição obrigatórios (ORC Notice, Attribution Notice, Reserved Material Notice), é `26-licencas-e-legal.md`.

### Princípios de design do produto

1. **Simplicidade > generalidade.** Preferir o caminho concreto que serve os três sistemas-alvo a abstrações especulativas. Abstrair só quando dois sistemas reais exigirem.
2. **GM-first.** O GM é a autoridade. Ferramentas, padrões e a UI otimizam o trabalho do mestre; o jogador tem um caminho simples e restrito.
3. **Automação opcional.** A automação acelera, não decide. Tudo automatizado deve ter equivalente manual (REQ-ESC-019).
4. **pt-BR first.** Produto em português primeiro; código em inglês (REQ-ESC-020, RNF-ESC-06).
5. **Servidor autoritativo.** Uma única fonte de verdade; rolagens e mutações validadas e persistidas no servidor (REQ-ESC-008).
6. **Legalidade por construção.** Separar código de conteúdo licenciado; nunca importar arte/lore/marcas; nunca tocar o código do Foundry (REQ-ESC-015 a 018).
7. **Mundo portável.** Um mundo é um artefato copiável e versionável de backup (RNF-ESC-05).

### Critérios de sucesso mensuráveis

- **CS-ESC-01** O grupo conclui ao menos uma sessão inteira de PF2e usando exclusivamente o Fusion, com mapa+grid, tokens em movimento, visão/iluminação/fog básicos, fichas funcionais, rolagens automatizadas básicas, chat e combat tracker — sem recorrer ao Foundry. (Operacionaliza REQ-ESC-006/007.)
- **CS-ESC-02** Um jogador novo entra na sessão apenas com um link/endereço e um navegador, sem instalar nada. (Operacionaliza REQ-ESC-001.)
- **CS-ESC-03** O GM inicia servidor, cria um mundo e convida jogadores sem editar código, seguindo a documentação. (Operacionaliza RNF-ESC-01.)
- **CS-ESC-04** O conjunto de dados importado contém apenas mecânica aberta — zero arte, lore ou marcas da Paizo — verificável por inspeção do pipeline de importação. (Operacionaliza REQ-ESC-014/017.)
- **CS-ESC-05** Uma auditoria de procedência de código confirma que nenhum trecho deriva do código-fonte do Foundry VTT. (Operacionaliza REQ-ESC-015.)
- **CS-ESC-06** Um mundo é copiado de uma máquina para outra (arquivo `world.db` + `assets/`) e abre funcional na máquina de destino. (Operacionaliza RNF-ESC-05.)

### Visão dos três sistemas-alvo e o que cada um exige da engine

A engine é única; os sistemas são pacotes que a especializam via a API de sistemas (`15-api-de-sistemas.md`). O que cada sistema exige de diferente:

- **Pathfinder 2e (remaster) — sistema de validação do MVP.** É o mais exigente: três ações por turno, grande volume de traits/condições, sistema de graus de sucesso (crítico/sucesso/falha/falha crítica), proficiências, e o maior corpo de dados abertos (compendiums JSON sob ORC/OGL em `foundryvtt/pf2e`). Exige da engine: importador robusto de mecânicas (`tools/importer-pf2e`), motor de rolagens com graus de sucesso e modificadores condicionais, fichas ricas, e combat tracker com a economia de ações do PF2e. Por ser o caso mais difícil, valida a engine de forma abrangente. Ver `17-sistema-pf2e.md`.
- **Starfinder 2e.** Compartilha a base mecânica e o modelo de licença (ORC) do PF2e remaster — origem comum de regras. Exige da engine principalmente **reaproveitamento**: a maior parte do que o PF2e exercita serve ao SF2e, com adições temáticas (ex.: regras de espaçonaves, tecnologia) a serem avaliadas. Valida que a engine e a API de sistemas sustentam um segundo sistema próximo sem reescrita. Status de publicação do SF2e a confirmar (ver Questões em aberto). Ver `18-sistema-sf2e.md`.
- **Etmos RPG (Editora Balde Galáctico).** Sistema brasileiro independente, com material-fonte local já pesquisado. Exige da engine **generalidade**: não compartilha a base do PF2e, então força a API de sistemas a não estar acoplada às premissas do PF2e (graus de sucesso, três ações, etc.). É o teste de que a engine é realmente system-agnostic dentro do escopo dos três alvos. Diferentemente dos sistemas Paizo, seu conteúdo é uso privado e não redistribuível. Ver `19-sistema-etmos.md`.

## Questões em aberto

- **Q-ESC-01** Qual o status de publicação do Starfinder 2e em 2026-06-11 (playtest, lançado, parcial)? A pesquisa registra desenvolvimento ativo e migração para ORC, mas pede verificação do estado atual (`docs/research/14-licencas-legal.md` §12). Impacta a viabilidade e o escopo de dados de SF2e no roadmap (`27`).
- **Q-ESC-02** Qual a natureza exata da licença/permissão do material do Etmos RPG para uso no Fusion (uso privado tácito, autorização da Editora Balde Galáctico, ou outro)? Definir em `26-licencas-e-legal.md` e `19-sistema-etmos.md` antes de qualquer distribuição.
- **Q-ESC-03** Haverá algum cenário futuro de distribuição pública gratuita (que ativaria obrigações de Community Use Policy e textos de atribuição na UI), ou o projeto permanece estritamente privado? A decisão muda requisitos de UI de licenças (`26`) e de marca (REQ-ESC-016).
- **Q-ESC-04** ~~O papel de usuário deve incluir variantes além de GM/Jogador no MVP?~~ Resolvido: `05-usuarios-e-permissoes.md` (DEC-USR-01) define quatro roles MVP — `PLAYER`, `TRUSTED`, `ASSISTANT`, `GAMEMASTER` — alinhado com o uso de `ASSISTANT` já requerido em `04-rede-e-sincronizacao.md` (REQ-NET-004, REQ-NET-042). "Observer" como role separado não existe — o nível de ownership `OBSERVER` cobre esse caso de uso.
- **Q-ESC-05** Verificação de marca: confirmar no USPTO/INPI que "Fusion" como nome de software de VTT não colide com marca registrada relevante (`docs/research/14-licencas-legal.md` §9.3).

## Referências

- `docs/research/01-foundry-arquitetura-stack.md` — Arquitetura geral e stack do Foundry VTT (modelo cliente/servidor, self-hosting, limites clean-room §10).
- `docs/research/14-licencas-legal.md` — Licenças e aspectos legais (clean-room §1.3; ORC §2; OGL §3; políticas Paizo §4; repo pf2e §5; matriz de risco §8; nomear compatibilidade §9; obrigações §10; SF2e §12).
- Specs irmãs citadas ao longo do documento: `01`, `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, `10`, `11`, `15`, `16`, `17`, `18`, `19`, `21`, `22`, `23`, `24`, `26`, `27`.
