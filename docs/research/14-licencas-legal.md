# Licenças e Aspectos Legais — Projeto Fusion VTT

**Data da pesquisa:** 2026-06-11  
**Escopo:** Foundry VTT EULA/ToS, ORC, OGL, Políticas Paizo, Licenças de bibliotecas, Recomendações para o Fusion

---

## Sumário Executivo

O Fusion VTT é um projeto de desenvolvimento independente ("clean-room") de uma plataforma de virtual tabletop (VTT). Esta pesquisa cobre todos os aspectos legais relevantes: o que o Fusion pode e não pode fazer em relação ao Foundry VTT, como usar legalmente conteúdo mecânico do Pathfinder 2e / Starfinder 2e, e como projetos similares (Pathbuilder, Wanderer's Guide, Archives of Nethys) operam dentro da lei.

---

## 1. Foundry VTT — EULA, Termos de Serviço e Implicações para o Fusion

### 1.1 Estrutura Legal do Foundry VTT

O Foundry VTT é um produto comercial desenvolvido pela **Foundry Gaming LLC**. O software é vendido sob licença proprietária e seus termos estão publicados em dois documentos principais:

- **Software License** (`foundryvtt.com/article/license/`) — rege o uso do software adquirido
- **Terms of Service** (`foundryvtt.com/article/terms-of-service/`) — rege o uso dos serviços web

### 1.2 O que o EULA/ToS proíbe

Os termos do Foundry VTT estabelecem as seguintes proibições relevantes para um projeto clone:

| Proibição | Texto relevante |
|---|---|
| Engenharia reversa | "I will not attempt to reverse-engineer or distribute the Software without explicit written permission from Foundry Gaming LLC." |
| Redistribuição | Vender, arrendar, sublicenciar ou distribuir o software ou a chave de licença é expressamente proibido |
| Publicação de código | "Publication of packages which reference or include software code and function in the absence of the base software is not permitted" |
| Múltiplas instâncias | Cada instância hospedada requer uma licença separada |
| Uso para atividades ilegais | Redistribuição de materiais protegidos por copyright usando o software é proibida |

**Nota importante para o Fusion:** A proibição de engenharia reversa se aplica **ao software do Foundry VTT adquirido como produto**. Um desenvolvedor que nunca comprou o Foundry não está vinculado por essa EULA. Contudo, qualquer pessoa da equipe que possua uma licença do Foundry e que participou de análise do código está sujeita a esses termos.

### 1.3 Abordagem Clean-Room

O desenvolvimento clean-room é uma prática legal estabelecida no direito de software. O conceito permite que um segundo grupo implemente funcionalidade equivalente sem copiar código proprietário, desde que:

1. A equipe de especificação (que pode analisar o sistema existente) não escreva código
2. A equipe de implementação trabalhe **apenas** a partir das especificações escritas, sem contato direto com o código proprietário
3. Não haja cópia de expressões de código concretas

Para o Fusion, a abordagem correta é:
- **Permitido:** Estudar a Knowledge Base pública do Foundry, a API documentation pública, o comportamento observável da interface, e documentação de sistemas de terceiros
- **Proibido:** Descompilar, desassemblar ou copiar o código JavaScript/Electron do Foundry VTT
- **Zona cinzenta:** Membros da equipe que adquiriram licença do Foundry e estudaram seu código fonte internamente

### 1.4 Marca Registrada "Foundry Virtual Tabletop"

O Foundry possui diretrizes de branding publicadas em `foundryvtt.com/article/branding/`:

- **"Foundry Virtual Tabletop"** e **"Foundry Gaming LLC"** são nomes protegidos
- O nome "Foundry" sozinho não deve ser usado como referência ao produto (causa confusão)
- Abreviações aceitas para referência: "Foundry VTT" ou "FVTT"
- É permitido **referenciar** o nome em texto descritivo, mas **não** no título de projetos independentes

**Implicação para o Fusion:** O nome "Fusion" não colide com a marca "Foundry VTT". O projeto deve evitar usar "Foundry" em qualquer documentação de marketing ou no nome do produto. Em documentação interna de desenvolvimento, pode-se referenciar o Foundry como inspiração.

### 1.5 O que NÃO está coberto pelo EULA do Foundry

Aspectos que o EULA do Foundry VTT **não restringe** para terceiros:

- Criar software VTT independente, mesmo que seja concorrente
- Usar conceitos, ideias e abordagens gerais de design de VTT (não são protegidos por copyright)
- Implementar funcionalidades similares de forma independente
- Usar o nome do Foundry em texto descritivo (ex.: "alternativa ao Foundry VTT")

---

## 2. ORC License — Open RPG Creative License

### 2.1 Origem e Natureza

A **Open RPG Creative (ORC) License** foi criada pela Paizo Inc. em 2023 com o apoio do escritório jurídico Azora Law, que registrou o texto na Biblioteca do Congresso dos EUA (TX 9-307-067). Ela é propositalmente irrevogável e controlada por uma entidade neutra — não pela Paizo nem por qualquer editora comercial.

**Característica fundamental:** Uma vez que uma publicação é lançada sob ORC, essa permissão não pode ser revogada. O texto da licença afirma expressamente: *"Licensor may not thereafter withdraw, modify, or revoke such offer to license the Licensed Material hereunder as to any existing licensee or any prospective licensee."*

### 2.2 O que a ORC cobre (Licensed Material)

O **Licensed Material** sob a ORC inclui elementos funcionais necessários para o gameplay:

- Sistemas de criação de personagens (estatísticas, classes, habilidades, magias, perícias)
- Mecânicas de jogo (combate, iniciativa, experiência, níveis)
- Métodos de determinação de sucesso/falha e resultados
- Métodos de jogo (lançamento de dados, fichas de personagem, tokens, mapeamento)
- Qualquer expressão "reasonably necessary to convey functional ideas and methods of operation" (Seção I.e.(2))

**Importante:** Mecânicas de jogo **não podem** ser designadas como Reserved Material. Sob a ORC, todas as mecânicas se tornam automaticamente Licensed Material.

### 2.3 O que a ORC NÃO cobre (Reserved Material)

O **Reserved Material** permanece exclusivo dos criadores e inclui:

- Marcas registradas e trade dress
- Expressões criativas não essenciais ao gameplay
- "Works of visual art, music and sound design, and clearly expressed and sufficiently delineated characters, character organizations, dialogue, settings, locations, worlds, plots, or storylines"
- Substantivos próprios derivados de conteúdo protegido por marca

Para a **Paizo especificamente**, o Reserved Material inclui:
- As marcas "Pathfinder", "Starfinder", "Paizo" e o logotipo do golem Paizo
- Personagens específicos (Seoni, Valeros, etc.)
- Localizações do universo Golarion (Absalom, Varisia, etc.)
- Divindades (Desna, Pharasma, etc.)
- Organizações (Guardiões da Chama, etc.)
- Arte e ilustrações de todos os produtos

**Nota crítica:** O d20pfsrd.com publicou explicitamente que *"Este produto não contém Expressly Designated Licensed Material"* — ou seja, a Paizo não abriu voluntariamente nenhum de seu Reserved Material além das mecânicas.

### 2.4 Implicações para VTTs (ORC e software)

A ORC **não contém** restrições específicas para VTTs. A Seção II.a. autoriza uso *"em todos os meios e formatos, sejam eles conhecidos agora ou criados futuramente"*, o que inclui explicitamente aplicações digitais.

Discussões na comunidade (EN World, 2024) estabeleceram os seguintes pontos:

- A ORC se aplica ao **conteúdo** (texto de regras, stat blocks, descrições de mecânicas), não ao **código de aplicação**
- O código-fonte de um VTT (UI, lógica de aplicação) é reservado pelo próprio desenvolvedor
- A implementação de mecânicas em código não cria obrigação de liberar o código-fonte sob ORC
- Um VTT deve manter separação clara entre o banco de dados de conteúdo licenciado e o código proprietário da aplicação

**Conclusão para o Fusion:** Implementar as regras mecânicas do PF2e/SF2e é legalmente viável sob a ORC. O código do Fusion permanece propriedade intelectual do projeto. O que não pode ser feito é reproduzir texto de setting, arte, personagens ou nomes próprios da Paizo.

### 2.5 Obrigações ao usar Licensed Material ORC

Ao usar conteúdo ORC, o Fusion deve incluir:

1. **ORC Notice:** Referência à localização da licença (Biblioteca do Congresso TX 9-307-067)
2. **Attribution Notice:** Crédito a todos os licenciadores upstream
3. **Reserved Material Notice:** Identificação do que permanece proprietário da Paizo
4. Os downstream users recebem automaticamente os mesmos direitos de licença ORC

**Cure period:** Violações têm um período de cura de 60 dias antes de terminar a licença.

---

## 3. OGL 1.0a — Open Game License

### 3.1 Contexto e Status Atual

A **Open Game License versão 1.0a** foi criada pela Wizards of the Coast em 2000 e permitiu por mais de duas décadas que qualquer pessoa criasse conteúdo compatível com D&D/d20 sem pagar royalties. A Paizo usou a OGL para lançar o Pathfinder 1e e o Pathfinder 2e original.

**Status em 2024:** A crise da "OGL 1.1" de janeiro de 2023, quando a WotC tentou revogar a OGL 1.0a, levou a Paizo a criar a ORC. O Pathfinder 2e **remaster** (lançado em novembro de 2023) foi especificamente projetado para migrar todo o conteúdo para a ORC e remover qualquer material exclusivamente OGL.

### 3.2 Diferenças Práticas OGL vs ORC

| Aspecto | OGL 1.0a | ORC |
|---|---|---|
| Controlado por | WotC (privada) | Azora Law (neutra) |
| Revogabilidade | Tecnicamente revogável (controverso) | Explicitamente irrevogável |
| Escopo | Centrado em D&D/d20 | System-agnostic |
| Mecânicas | Não podem ser designadas Product Identity | Não podem ser reservadas |
| Arte | Não coberta | Não coberta |
| Propagação para software | Ambígua | Não impõe copyleft em código |
| Uso futuro (PF2e) | Depreciado para conteúdo novo | Padrão para remaster |

### 3.3 Conteúdo legado OGL no pf2e

Conteúdo do PF2e anterior ao remaster (pré-novembro 2023) pode ainda estar sob OGL. O repositório `github.com/dogstarrb/pf2e-legacy-content` foi criado especificamente para manter material OGL legado separado do sistema remaster.

**Implicação para o Fusion:** Para evitar complexidade, priorizar exclusivamente conteúdo do **remaster** (Player Core, GM Core, Monster Core, Player Core 2) que está inteiramente sob ORC.

---

## 4. Políticas da Paizo

### 4.1 Mapa de Políticas Disponíveis

```
Paizo IP Usage
├── ORC License          → Mecânicas do remaster (grátis, irrevogável)
├── OGL 1.0a             → Mecânicas pré-remaster (grátis, ambíguo sobre revogação)
├── Fan Content Policy   → Merchandise, streams, podcasts (não cobre VTT/apps)
├── Community Use Policy → Sites, wikis, ferramentas não-comerciais (status ambíguo para apps)
├── Compatibility License → Marcas de compatibilidade (proibido para apps)
├── Infinite License     → Publicação em Pathfinder/Starfinder Infinite (plataforma fechada)
└── Commercial License   → Vídeo games, aplicativos comerciais (negociação direta com Paizo)
```

### 4.2 Fan Content Policy (versão 1.0, julho 2024)

A Fan Content Policy substituiu parcialmente a Community Use Policy. Pontos relevantes:

**O que NÃO está coberto pela Fan Content Policy:**
- "Game modules, board games, video games, roleplaying simulators, character generators, rules compendiums" são **expressamente proibidos**
- VTTs e ferramentas digitais que funcionam como produtos de jogo caem nessa categoria proibida

**O que está coberto:**
- Streams e gravações de actual play
- Merchandise artesanal (pins, camisetas, dados) vendido diretamente
- Podcasts, vídeos instrucionais
- Cosplay e props

**Monetização permitida:**
- Doações via Patreon/Ko-fi e receita de anúncios
- Venda direta de merchandise (não via print-on-demand)

**Conclusão:** O Fusion **não pode** operar legalmente sob a Fan Content Policy.

### 4.3 Community Use Policy (última atualização: agosto 2024)

A Community Use Policy continua em vigor. Permite uso não-comercial de materiais da Paizo. Pontos relevantes:

- **Gratuidade obrigatória:** Todo conteúdo usando materiais Paizo deve ser acessível gratuitamente
- **Anúncios permitidos:** Banner ads e revenue de anúncios são aceitos
- **Paywalls proibidos:** Qualquer paywall ou acesso restrito é vedado
- **VTTs:** A política não aborda VTTs explicitamente como categoria. A FAQ confirma que digital tools, VTTs e character builders **não são abordados**

**Nota histórica:** A Paizo chegou a ter uma política de Community Use específica que listava ferramentas digitais como permitidas, mas as revisões de 2024 criaram ambiguidade. O FAQ recomenda contato direto com a Paizo para casos não cobertos.

**Implicação para o Fusion:**
- Versão **gratuita e sem paywall**: poderia tentar operar sob Community Use Policy, mas há risco jurídico pela ambiguidade sobre apps
- Versão **comercial ou com qualquer forma de monetização**: precisa de commercial license ou usar apenas ORC/OGL sem usar marcas Paizo

### 4.4 Compatibility License (revisada julho 2024)

Em julho de 2024, a Paizo consolidou três licenças de compatibilidade em uma única.

**O que permite:**
- Usar os logos de compatibilidade ("Compatible with Pathfinder" etc.) em livros e websites
- Não requer registro prévio — basta concordar com os termos ao publicar

**O que proíbe:**
- **Aplicativos e apps estão explicitamente excluídos:** "The Paizo Compatibility License applies only to printed books, electronic books, and freely available websites, and is not available for use with apps."
- Criar cenários de aventuras ou usar conteúdo específico de campanhas

**Alternativa para apps:**
> "You may use game content released as Licensed Material under the ORC or as Open Game Content under the OGL in apps so long as you comply with those licenses, but you can't use the 'Pathfinder,' 'Starfinder,' or 'Paizo' trademarks, nor the associated logos."

**Conclusão para o Fusion:** O Fusion **não pode** usar o logo "Compatible with Pathfinder" ou qualquer marca da Paizo. Pode implementar as mecânicas sob ORC/OGL sem usar as marcas registradas.

### 4.5 Commercial License

Para uso comercial de marcas e IPs da Paizo em apps e vídeo games, existe um processo de **commercial license** via negociação direta:

- Contato: `licensing@paizo.com`
- Destinado a "established software publishers with excellent reputations and solid business plans"
- Envolve taxas e garantias mínimas de receita
- É assim que o Foundry Gaming LLC opera com a Paizo

**Exemplos de operações sob commercial license:**
- **Archives of Nethys**: Opera sob commercial license específica com a Paizo. O conteúdo do AoN **não** está disponível para reuso sob nenhuma das licenças comunitárias. A Paizo declarou o AoN como referência oficial.
- **Foundry VTT (sistema pf2e)**: Opera sob "partnership agreement between Foundry Gaming LLC and Paizo Inc." — acordo exclusivo que permite uso de arte, marcas e conteúdo não-OGL/ORC

---

## 5. Repositório `foundryvtt/pf2e` — O que pode ser usado

### 5.1 Estrutura de Licenças no Repositório

O repositório GitHub `foundryvtt/pf2e` (Apache-2.0 para código) possui **três camadas de licenciamento**:

| Componente | Licença | Usável pelo Fusion? |
|---|---|---|
| Código TypeScript/JavaScript (HTML, CSS) | Apache License 2.0 | **SIM** — com atribuição |
| Mecânicas do jogo (stat blocks, regras) | OGL 1.0a (legado) / ORC (remaster) | **SIM** — com compliance |
| Arte, ícones, ilustrações | Paizo: só para Foundry Gaming LLC | **NÃO** |
| Marcas (Pathfinder, etc.) | Paizo: todas as licenças | **NÃO** |
| Conteúdo de parceria exclusiva | Partnership Agreement Paizo/Foundry | **NÃO** |

### 5.2 Código Apache 2.0 — Implicações

O Apache License 2.0 é uma licença permissiva que:
- Permite uso comercial e redistribuição
- Requer preservação de avisos de copyright e licença
- Inclui concessão explícita de patentes
- É compatível com GPL e com projetos proprietários (com cuidados)

O **código** do sistema pf2e (lógica de jogo, estruturas de dados, regras implementadas em TypeScript) pode ser estudado, adaptado ou reescrito para o Fusion **com atribuição adequada**.

### 5.3 Dados dos Packs — O que pode ser extraído

Os JSONs dos compendiums do pf2e contêm:
- **Mecânicas abertas (OGL/ORC):** Stat blocks, valores de atributos, descrições de habilidades mecânicas — **pode ser importado**
- **Texto de setting:** Lore de personagens, descrições de localizações, histórias — **Reserved Material, não pode**
- **Arte referenciada:** Caminhos para arquivos de imagem com licenças específicas da Paizo — **não pode usar as imagens**
- **Licenças individuais por pack:** O repositório mantém arquivos de licença em `./packs/` e `./static/licenses/` para cada item

**Prática recomendada:** Ao extrair dados do JSON do pf2e, filtrar apenas os campos de mecânica (valores numéricos, ações, traits, condições) e descartar textos de lore e referências a arte.

### 5.4 Arte — Linha Vermelha Clara

A arte no repositório pf2e foi cedida pela Paizo **exclusivamente** para uso dentro do ecossistema Foundry Gaming LLC, como parte do acordo de parceria. Isso significa:

- Ícones de condições, tokens de personagens, ilustrações de itens = **proibido para o Fusion**
- Imagens de spells, arte de monstros = **proibido para o Fusion**
- Mapas de aventuras = **proibido para o Fusion**

O Fusion precisará de arte própria, licenciada separadamente, ou usar recursos open-source (ex.: Game-icons.net sob CC, assets sob CC0).

---

## 6. Como Projetos Similares Operam Legalmente

### 6.1 Archives of Nethys

- **Base legal:** Commercial license exclusiva com Paizo
- **Restrição única:** O conteúdo do AoN **não pode** ser redistribuído sob as licenças comunitárias da Paizo
- **Implicação:** O Fusion não pode "pegar" dados do AoN e redistribuí-los

### 6.2 Wanderer's Guide

- **Base legal:** OGL 1.0a + Community Use Policy
- **Atribuição obrigatória:** "This website uses trademarks and/or copyrights owned by Paizo Inc., which are used under Paizo's Community Use Policy. We are expressly prohibited from charging you to use or access this content."
- **Modelo de negócio:** Gratuito para acesso básico; funcionalidades premium são questionáveis sob CUP
- **Fonte de dados:** Puxa dados do Archives of Nethys (com permissão implícita)

### 6.3 Pathbuilder

- **Base legal:** OGL/ORC apenas — não usa Community Use Policy
- **Importante:** Como app comercial (iOS/Android), usa apenas conteúdo Open Game Content e ORC, sem invocar marcas Paizo
- **Nomeclatura:** Evita usar "Pathfinder" no nome comercial de forma associada às marcas

### 6.4 Foundry VTT (sistema pf2e oficial)

- **Base legal:** Partnership agreement exclusivo Paizo + Foundry Gaming LLC
- **Permite:** Uso de arte, marcas, conteúdo não-aberto
- **Não replicável:** Esse acordo é específico para a Foundry Gaming LLC e não está disponível para terceiros sem negociação direta com a Paizo

---

## 7. Bibliotecas de Código — Licenças

### 7.1 PixiJS

- **Licença:** MIT License
- **Copyright:** 2013-2023 Mathew Groves, Chad Engler
- **Uso comercial:** Permitido
- **Redistribuição:** Permitida com inclusão do aviso de copyright e licença
- **Implicação para o Fusion:** Totalmente adequado, zero restrições práticas

### 7.2 Socket.IO

- **Licença:** MIT License
- **Uso comercial:** Permitido
- **Redistribuição:** Permitida
- **Implicação para o Fusion:** Totalmente adequado

### 7.3 Apache License 2.0 (código pf2e)

- **Concessão de patentes:** Inclui concessão explícita
- **Compatibilidade:** Compatível com projetos proprietários e open-source
- **Atribuição:** Requer manutenção dos avisos de copyright originais

### 7.4 Outras bibliotecas relevantes para VTTs

| Biblioteca | Licença | Adequação |
|---|---|---|
| Three.js | MIT | OK |
| Tone.js (audio) | MIT | OK |
| Howler.js (audio) | MIT | OK |
| Yjs (CRDT collaboration) | MIT | OK |
| ProseMirror (rich text) | MIT | OK |
| Konva.js (canvas 2D) | MIT | OK |
| matter.js (physics) | MIT | OK |

---

## 8. Análise de Risco para o Fusion

### 8.1 Matriz de Risco

| Ação | Risco Legal | Mitigação |
|---|---|---|
| Usar código Apache 2.0 do pf2e | Baixo | Manter atribuições no código |
| Implementar mecânicas ORC | Baixo | Incluir ORC Notice, Attribution Notice |
| Importar JSON de mecânicas (sem arte) | Baixo-Médio | Filtrar apenas campos mecânicos, descartar lore |
| Usar arte do pf2e/Foundry | **ALTO** | Não fazer — criar ou licenciar arte própria |
| Usar marcas "Pathfinder"/"Starfinder" no nome | **ALTO** | Não fazer — descrever como "compatível com PF2e" no máximo |
| Usar nome "Foundry" no produto | Médio | Não fazer — nome "Fusion" é seguro |
| Engenharia reversa do Foundry VTT | **ALTO** | Não fazer — usar apenas documentação pública |
| Distribuição pública gratuita sem marcas Paizo | Baixo | Incluir disclaimers adequados |
| Distribuição comercial sem commercial license | Médio-Alto | Negociar commercial license ou evitar marcas Paizo |
| Uso privado/grupo fechado | Muito Baixo | Minimalismo de risco |

### 8.2 Distribuição vs. Uso Privado

**Uso privado (grupo fechado do GM):** O risco é mínimo. A Paizo não persegue grupos privados usando conteúdo para jogar. O Foundry VTT opera em modelo self-hosted — o próprio Foundry permite que usuários criem sistemas e modules para uso privado.

**Distribuição pública gratuita:** Viável com as seguintes condições:
- Usar apenas mecânicas ORC/OGL, sem marcas Paizo
- Não incluir arte proprietária
- Incluir avisos de licença adequados
- Não chamar o produto de "Pathfinder VTT" ou usar branding Paizo

**Distribuição comercial (qualquer forma de monetização):** Requer:
- Commercial license com a Paizo para usar marcas (se desejar)
- Sem commercial license: pode operar com mecânicas ORC sem marcas
- Consideração de Commercial License com Foundry Gaming LLC não é necessária — o Fusion é software independente

### 8.3 O Problema da Arte

Esta é a questão mais crítica para o Fusion. Sem arte:
- O jogo funciona mecanicamente, mas é visualmente vazio
- Tokens, ícones de condições, ilustrações de itens precisam de substitutos

**Alternativas legais:**
- **Game-icons.net:** Milhares de ícones RPG sob CC BY 3.0 (atribuição necessária)
- **Kenney.nl:** Assets de jogo sob CC0 (domínio público)
- **OpenGameArt.org:** Assets variados, verificar licença por item
- **Comissionar arte:** Contratar artistas para criar arte original
- **Arte gerada por IA:** Área legalmente ambígua em 2026; verificar licença das ferramentas usadas

---

## 9. Nomear Compatibilidade Legalmente

### 9.1 O Que é Permitido Dizer

Sem commercial license com a Paizo, o Fusion pode:
- Descrever funcionalidade: "suporta as regras do Pathfinder Second Edition"
- Referenciar o ORC: "implementa conteúdo Licensed Material sob a ORC License"
- Ser descritivo: "VTT para jogar Pathfinder 2e Remaster"

### 9.2 O Que é Proibido Sem Commercial License

- Usar o logo "Compatible with Pathfinder"
- Usar o logo "Starfinder Compatible"
- Usar o golem Paizo ou qualquer logo da Paizo
- Implicar endorsement ou parceria oficial com a Paizo

### 9.3 Nomenclatura do Produto Fusion

O nome "Fusion" não colide com nenhuma marca registrada identificada. Para segurança adicional:
- Verificar USPTO para "Fusion" + software/games
- Evitar "Fusion VTT for Pathfinder" como nome oficial (poderia conotar endorsement)
- Preferível: "Fusion VTT" como nome autônomo, com sistemas PF2e/SF2e como funcionalidades descritas

---

## 10. Resumo de Obrigações Legais para o Fusion

### 10.1 Ao usar código Apache 2.0 (pf2e)

```
// Manter este tipo de aviso nos arquivos derivados:
// Portions adapted from foundryvtt/pf2e, licensed under Apache License 2.0
// Copyright [year] pf2e contributors
```

### 10.2 Ao implementar conteúdo ORC

Incluir em documentação e/ou UI do produto:

```
This product is licensed under the ORC License, held at the Library of Congress 
at TX 9-307-067, and available online at various locations including 
paizo.com/orclicense and others.

Attribution Notice: [lista de autores dos produtos Paizo usados]

Reserved Material: All trademarks, registered trademarks, proper nouns (characters, 
deities, locations, etc., as well as all adjectives, names, titles, and descriptive 
terms derived from proper nouns), artworks, characters, dialogue, locations, 
organizations, plots, storylines, and trade dress. ©Paizo Inc.
```

### 10.3 Ao usar Community Use Policy (se aplicável)

```
[Nome do produto] uses trademarks and/or copyrights owned by Paizo Inc., which are 
used under Paizo's Community Use Policy. We are expressly prohibited from charging 
you to use or access this content. [Nome do produto] is not published, endorsed, or 
specifically approved by Paizo Inc.
```

---

## 11. Decisões Arquiteturais com Implicações Legais

1. **Separação de conteúdo e código:** Manter os dados ORC em um banco de dados/arquivo separado do código da aplicação. Isso clarifica que o código (proprietário do Fusion) não está sob ORC.

2. **Sistema de licenças por pack:** Cada compendium importado deve rastrear sua licença de origem (ORC, OGL, ou propriedade da Paizo).

3. **Arte própria ou licenciada:** Definir desde o início a fonte de toda arte visual. Nunca incluir arte do repositório pf2e.

4. **Sem uso das marcas Paizo no binário/executável:** O produto distribuído não deve referenciar "Pathfinder" ou "Starfinder" em metatags, títulos de janela ou nomes de arquivos de instalação sem a commercial license.

5. **Modelo de distribuição:** Decidir se o produto será gratuito (menor risco, possível operar sob CUP) ou comercial (requer commercial license ou operação estritamente sem marcas Paizo).

---

## 12. Starfinder 2e — Considerações Específicas

O Starfinder 2e foi anunciado em 2023 e está em desenvolvimento ativo. Pontos relevantes:

- **Licença:** SF2e seguirá o mesmo modelo ORC que o PF2e remaster
- **Status atual (2026):** Verificar estado de publicação; pode ainda estar em playtest ou lançamento recente
- **Marcas:** "Starfinder" é marca registrada da Paizo — mesmas restrições do Pathfinder
- **Plataforma Infinite:** A Paizo planeja relançar o Starfinder Infinite após o lançamento oficial do SF2e
- **OGL legado:** O Starfinder 1e usava OGL; o SF2e migra para ORC

---

## Fontes

1. [Terms of Service | Foundry Virtual Tabletop](https://foundryvtt.com/article/terms-of-service/)
2. [Software License | Foundry Virtual Tabletop](https://foundryvtt.com/article/license/)
3. [Brand Guidelines | Foundry Virtual Tabletop](https://foundryvtt.com/article/branding/)
4. [Open RPG Creative License | Paizo](https://paizo.com/orclicense)
5. [Paizo Licenses | Paizo](https://paizo.com/licenses)
6. [Paizo Fan Content Policy | Paizo](https://paizo.com/licenses/fancontent)
7. [Paizo Community Use Policy | Paizo](https://paizo.com/community/communityuse)
8. [Paizo Community Use FAQ](https://paizo.com/licenses/communityuse/faq)
9. [Paizo Compatibility License FAQ](https://paizo.com/licenses/compatibility/faq)
10. [New and Revised Licenses | Paizo Blog](https://paizo.com/blog/new-and-revised-licenses)
11. [GitHub — foundryvtt/pf2e](https://github.com/foundryvtt/pf2e)
12. [OGL and CUP compliance · Issue #352 · foundryvtt/pf2e](https://github.com/foundryvtt/pf2e/issues/352)
13. [Licenses — Archives of Nethys PF2e](https://2e.aonprd.com/Licenses.aspx)
14. [Legal Notice — PF2SRD (ORC)](https://pf2orc.d20pfsrd.com/rules/legal-notice/)
15. [To what degree does the ORC license apply to VTTs? | EN World](https://www.enworld.org/threads/to-what-degree-does-the-orc-license-apply-to-vtts.711192/)
16. [A Basic Guide To Using ORC | EN World](https://www.enworld.org/threads/a-basic-guide-to-using-orc-open-rpg-creative-license.697078/)
17. [Pathfinder Breaks Free: How the ORC License Revolution Changes RPGs — LitRPG Reads](https://litrpgreads.com/blog/rpg/pathfinder-breaks-free-how-the-orc-license-revolution-changes-rpgs-forever)
18. [Pathfinder Infinite and the ORC License | Paizo Blog](https://paizo.com/community/blog/v5748dyo6sig4)
19. [Ownership and License Questions — Pathfinder Infinite](https://help.pathfinderinfinite.com/hc/en-us/articles/12777431899927-Ownership-and-License-Questions)
20. [PixiJS LICENSE (MIT)](https://github.com/pixijs/pixijs/blob/dev/LICENSE)
21. [Socket.IO LICENSE (MIT)](https://github.com/socketio/socket.io/blob/main/LICENSE)
22. [Open Game License — Wikipedia](https://en.wikipedia.org/wiki/Open_Game_License)
23. [Paizo Updates Pathfinder/Starfinder Licenses | EN World](https://www.enworld.org/threads/paizo-updates-pathfinder-starfinder-licenses.705668/)
24. [Fan Content Policy FAQ Page | Paizo](https://paizo.com/licenses/fancontent/faq)
