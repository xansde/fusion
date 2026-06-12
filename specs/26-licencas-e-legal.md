# 26 — Licenças e Aspectos Legais

- **Título:** Licenças e Aspectos Legais
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/14-licencas-legal.md` — Foundry EULA/ToS, abordagem clean-room, ORC License, OGL 1.0a, políticas Paizo (Fan Content, Community Use, Compatibility, Commercial), licenças do repositório `foundryvtt/pf2e`, matriz de risco, nomeação de compatibilidade, obrigações de notice
  - `docs/research/12b-etmos-fontes-locais.md` — licença do SRD ETMOS (todos os direitos reservados presumido), autoria/créditos da Balde Galáctico, símbolos rúnicos como assets proprietários
  - `docs/research/10-pf2e-sistema-internals.md` — três camadas de licença do `foundryvtt/pf2e` (código Apache-2.0, dados ORC/OGL, arte Paizo proibida), metadados de `publication`, separação regras-puras vs. acoplamento ao Foundry, relação SF2e

> Esta spec é a **fonte normativa legal** do Fusion. Ela é referenciada por
> praticamente todas as specs irmãs (notadamente `00-visao-e-escopo.md`,
> `16-compendiums-e-importacao.md`, `17-sistema-pf2e.md`, `18-sistema-sf2e.md`,
> `19-sistema-etmos.md`, `20-assets-e-midia.md`) e define obrigações concretas e
> testáveis: o que pode entrar no produto, o que jamais pode, e quais avisos
> (NOTICE/attribution) precisam acompanhar cada release.
>
> **Aviso:** este documento é uma especificação de engenharia, não aconselhamento
> jurídico. Decisões com risco residual elevado (ex.: distribuição pública,
> qualquer monetização) devem passar por revisão de advogado antes de execução.
> Ver `## Questões em aberto`.

---

## Objetivo

Definir a **postura legal completa do Fusion** de forma operacional e verificável,
cobrindo quatro eixos:

1. **Clean-room frente ao Foundry VTT** — fronteira exata entre o que a equipe
   pode observar (comportamento, documentação pública, código Apache-2.0 do
   sistema `pf2e`) e o que jamais toca (código proprietário do Foundry core,
   assets, marcas), com guidelines obrigatórias para contribuidores.
2. **PF2e / SF2e** — como implementar mecânicas legalmente sob **ORC License** e
   **OGL 1.0a**, quais avisos são obrigatórios (ORC Notice, Attribution Notice,
   Reserved Material Notice), o que é Reserved Material da Paizo, como declarar
   compatibilidade sem violar marcas, e a política de tratamento dos dados do
   repositório `foundryvtt/pf2e` (código Apache-2.0 = referência; JSON de
   mecânicas = importável; arte Paizo = **proibida**, com regra de substituição).
3. **Etmos** — tratamento do SRD da Balde Galáctico, que **não declara licença
   aberta** (presunção de "todos os direitos reservados"): uso privado do grupo
   é OK; qualquer distribuição do system/packs exige autorização da editora;
   plano de contato registrado; símbolos rúnicos idem.
4. **Licença do próprio Fusion e dependências** — recomendação de licenciamento
   da engine, inventário de licenças das dependências, arquivo `NOTICE`,
   riscos legais residuais com mitigação, e um **checklist legal por release**.

Esta spec **não** redefine _como_ os compendiums são importados nem _como_ os
assets são gerenciados — ela define apenas as **regras legais** que aqueles
subsistemas (`16-`, `20-`) devem obedecer.

## Escopo

### O que inclui

- A **postura clean-room** detalhada: matriz "observável vs. proibido" frente ao
  Foundry VTT, e o protocolo de contribuição (declaração de não-contaminação,
  tratamento de membros que possuem licença do Foundry).
- A **fronteira de marca**: por que o nome "Fusion" é seguro, o que jamais pode
  aparecer no produto/binário (marcas Paizo, marca Foundry como nome).
- As obrigações práticas de **ORC** e **OGL** ao implementar PF2e/SF2e: textos
  literais dos avisos a embutir, o que é Licensed vs. Reserved Material, período
  de cura, propagação downstream.
- A **política de uso do repositório `foundryvtt/pf2e`**: as três camadas de
  licença, atribuição do código Apache-2.0, filtragem de dados (mecânica sim,
  lore não), e a **regra de substituição de arte** (Paizo proibida → placeholders
  livres CC0/CC-BY).
- A **declaração de compatibilidade legal**: o que pode/não pode ser dito e
  exibido (texto descritivo permitido; logos "Compatible with Pathfinder" e
  golem Paizo proibidos sem commercial license).
- O **regime do Etmos**: presunção de direitos reservados, escopo de uso privado,
  gatilho que torna a distribuição ilegal sem autorização, plano de contato com a
  Balde Galáctico, e tratamento dos símbolos rúnicos das Partículas.
- A **recomendação de licença do Fusion** (privado inicialmente; MIT para a engine
  _sem_ os packs de dados, se aberto) com racional e alternativas rejeitadas.
- O **inventário de licenças de dependências** (predominância MIT; verificação de
  exceções) e a especificação do arquivo `NOTICE` / atribuições embutidas.
- A **matriz de risco residual** com mitigações e o **checklist legal por release**.

### O que NÃO inclui

- O **pipeline técnico** de extração/transformação de compendiums (como rodar o
  `foundryvtt-cli`, mapear rule elements, gerar packs) — `ver 16-compendiums-e-importacao.md`.
  Esta spec define apenas _o que é permitido_ importar e _quais notices_ anexar.
- A **mecânica de assets** (placeholders, otimização de imagem, paths) —
  `ver 20-assets-e-midia.md`. Esta spec define apenas a _política de licença_ de
  cada asset.
- O **conteúdo mecânico** dos sistemas (regras de PF2e/SF2e/Etmos) — `ver 17-`,
  `18-`, `19-`. Esta spec governa a _legalidade_ de implementá-los, não as regras.
- **Privacidade / proteção de dados pessoais** (LGPD/GDPR) e termos de uso para
  jogadores — `ver 21-seguranca.md` e `ver 24-operacao-backups-telemetria.md`
  (a telemetria, se houver, é regida lá). Aqui só se referencia o cruzamento.
- Aconselhamento jurídico formal ou parecer de advogado (fora de escopo de uma
  spec de engenharia).

## Conceitos e terminologia

- **Clean-room (limpa de quarto / Chinese wall):** prática de implementar
  funcionalidade equivalente a um produto sem copiar seu código proprietário,
  separando quem _observa/especifica_ de quem _implementa_. Legalmente robusta
  quando a equipe de implementação trabalha só a partir de especificações.
- **EULA / ToS do Foundry:** licença proprietária do software Foundry VTT
  (Foundry Gaming LLC). Proíbe engenharia reversa e redistribuição **do software
  adquirido**; vincula apenas quem comprou/usa o produto, não terceiros que nunca
  o adquiriram.
- **ORC License (Open RPG Creative):** licença irrevogável criada pela Paizo
  (2023), administrada por entidade neutra (Azora Law); o texto da licença está
  registrado na Library of Congress sob **TX 9-307-067** (número de registro do
  documento, não um identificador da licença em si). Cobre mecânicas de jogo
  (Licensed Material) e **não** impõe copyleft sobre código de aplicação.
- **OGL 1.0a (Open Game License):** licença da WotC (2000) usada no PF2e
  pré-remaster. Tecnicamente revogável (controverso). Conteúdo legado pode estar
  sob OGL; o **remaster** migrou tudo para ORC.
- **Licensed Material:** conteúdo aberto sob ORC/OGL — mecânicas, stat blocks,
  valores, descrições funcionais de regras. **Importável** pelo Fusion.
- **Reserved Material / Product Identity:** material que permanece exclusivo do
  criador — marcas, arte, personagens, divindades, locais, organizações,
  storylines, trade dress, e **nomes próprios** derivados deles. **Proibido** ao
  Fusion (para Paizo: "Pathfinder", "Starfinder", "Paizo", golem, Golarion, etc.).
- **ORC Notice / Attribution Notice / Reserved Material Notice:** os três avisos
  que devem acompanhar qualquer uso de Licensed Material sob ORC.
- **Community Use Policy (CUP) / Fan Content Policy / Compatibility License /
  Commercial License:** as quatro famílias de política Paizo. CUP e Fan Content
  **não cobrem VTTs/apps**; Compatibility License **exclui apps explicitamente**;
  Commercial License é negociação direta (modelo do Foundry/Paizo).
- **SRD (System Reference Document):** documento de referência de um sistema. O do
  ETMOS **não** declara licença aberta → presume-se "todos os direitos reservados".
- **NOTICE file:** arquivo-texto agregando avisos de copyright, atribuições e
  textos de licença obrigatórios de dependências e conteúdo embutido.
- **Spdx identifier:** identificador padronizado de licença (ex.: `MIT`,
  `Apache-2.0`, `CC0-1.0`, `CC-BY-4.0`) usado no inventário de dependências.

---

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### D1 — Abordagem clean-room estrita frente ao Foundry VTT

O Fusion é desenvolvido em clean-room: a equipe pode estudar **documentação
pública**, **comportamento observável** da interface e o **código Apache-2.0 do
sistema `pf2e`**, mas **jamais** descompila, desassembla ou copia o código
proprietário do **Foundry core** (a plataforma vendida pela Foundry Gaming LLC).

- **Alternativas rejeitadas:**
  - _Fork/adaptação do Foundry core_ — impossível: software proprietário,
    redistribuição e engenharia reversa proibidas pela EULA.
  - _Clean-room "frouxa" (qualquer membro lê o core e implementa)_ — rejeitada
    porque um membro que adquiriu licença do Foundry está vinculado à EULA; deixá-lo
    implementar a partir do código observado contamina o produto.
- **Racional:** o desenvolvimento clean-room é prática legal estabelecida; ideias,
  conceitos e abordagens gerais de design de VTT não são protegidos por copyright.
  Implementar funcionalidade equivalente de forma independente é lícito
  (`docs/research/14-licencas-legal.md` §1.3, §1.5).

### D2 — Marca: "Fusion" autônomo; nunca "Foundry" nem marcas Paizo no produto

O produto se chama **Fusion** (ou "Fusion VTT"), nome que não colide com marcas
identificadas. O binário/executável, títulos de janela, metadados, nomes de
instalador e materiais de marketing **não** referenciam "Pathfinder", "Starfinder",
"Paizo" nem usam "Foundry" como nome do produto. Em documentação **interna** de
desenvolvimento, o Foundry pode ser citado como inspiração.

- **Alternativas rejeitadas:**
  - _"Fusion VTT for Pathfinder" como nome oficial_ — rejeitada: pode conotar
    endorsement/parceria inexistente com a Paizo.
  - _Usar "Foundry" descritivamente no produto_ — evitado por confusão de marca,
    embora a referência textual ("alternativa ao Foundry VTT") seja tecnicamente
    permitida; mantemos a barra alta por segurança.
- **Racional:** marcas são Reserved Material sob todas as licenças Paizo, e a
  Compatibility License que autorizaria logos **exclui apps** explicitamente
  (`docs/research/14-licencas-legal.md` §4.4, §9). "Fusion" é seguro
  (verificação USPTO pendente — ver Questões em aberto).

### D3 — Mecânicas PF2e/SF2e sob ORC (prioridade ao remaster), com avisos obrigatórios

O Fusion implementa as mecânicas de PF2e e SF2e como **Licensed Material sob ORC**,
priorizando **exclusivamente conteúdo do remaster** (Player Core, GM Core, Monster
Core, Player Core 2) para evitar a ambiguidade da OGL legada. Todo release que
inclua esse conteúdo embute o **ORC Notice + Attribution Notice + Reserved Material
Notice** (textos em `## Modelo de dados` / `## API e eventos`).

- **Alternativas rejeitadas:**
  - _Misturar conteúdo OGL legado e ORC_ — rejeitada: a OGL é tecnicamente
    revogável (controverso) e exige rastrear material legado em separado
    (`pf2e-legacy-content`); o remaster já é 100% ORC e irrevogável.
  - _Operar sob Community Use Policy_ — rejeitada: CUP **não cobre apps/VTTs** e
    proíbe paywall; risco jurídico pela ambiguidade. A FAQ da Paizo recomenda
    contato direto para casos não cobertos.
  - _Operar sob Fan Content Policy_ — rejeitada e **expressamente vedada**: a Fan
    Content Policy exclui explicitamente "rules compendiums" e "character
    generators" — exatamente o que o Fusion implementa
    (`docs/research/14-licencas-legal.md` §4.2). O Fusion **não opera** sob Fan
    Content Policy, e materiais de marketing não podem descrever o produto como
    "fan content" Paizo.
- **Racional:** a ORC é irrevogável, autoriza uso "em todos os meios e formatos"
  (inclui digital), não impõe copyleft em código, e mecânicas não podem ser
  reservadas (`docs/research/14-licencas-legal.md` §2). O código do Fusion
  permanece propriedade do projeto.

### D4 — Dados do `foundryvtt/pf2e`: três camadas com tratamento distinto

O repositório é tratado em três camadas legais independentes:

| Camada                                           | Licença                                 | Tratamento no Fusion                                                                                      |
| ------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Código TS/JS/HTML/CSS                            | Apache-2.0                              | **Referência conceitual + atribuição**; reimplementar (clean-room PF2e), nunca copiar palavra-por-palavra |
| JSON de mecânicas (stat blocks, valores, traits) | ORC (remaster) / OGL (legado)           | **Importável** com filtragem (só campos mecânicos) + notices ORC                                          |
| Arte, ícones, tokens, mapas                      | Paizo (exclusiva ao Foundry Gaming LLC) | **PROIBIDO** — substituir por placeholders livres                                                         |
| Lore / texto de setting                          | Reserved Material Paizo                 | **Descartar** na importação                                                                               |

- **Alternativas rejeitadas:**
  - _Importar arte da Paizo "só para uso privado"_ — rejeitada: a arte foi cedida
    **exclusivamente** ao ecossistema Foundry Gaming LLC; o Fusion não tem esse
    direito nem em uso privado de distribuição de packs.
  - _Importar o JSON inteiro (mecânica + lore)_ — rejeitada: lore é Reserved
    Material; importar tudo cria risco médio. Filtra-se para campos mecânicos.
- **Racional:** `docs/research/14-licencas-legal.md` §5 e
  `docs/research/10-pf2e-sistema-internals.md` §2; o metadado `publication.license`
  de cada entrada (`"ORC"` / `"OGL"`) deve ser rastreado por pack.

### D5 — Arte proprietária PROIBIDA; pipeline de substituição por assets livres

Nenhuma arte do repositório `pf2e`/Foundry entra no Fusion. Cada referência de
imagem importada de um pack proprietário é **substituída** por um placeholder de
uma fonte livre (Game-icons.net CC-BY-3.0, Kenney.nl CC0, OpenGameArt verificado
por item, ou arte comissionada/CC0 própria). A licença de cada asset de
substituição é registrada por arquivo.

- **Alternativas rejeitadas:**
  - _Deixar paths quebrados (sem arte)_ — rejeitada por UX; mas é o **fallback
    seguro** se não houver placeholder.
  - _Arte gerada por IA_ — não adotada como padrão por ambiguidade legal em 2026
    (verificar licença da ferramenta caso a caso) — ver Questões em aberto.
- **Racional:** a arte Paizo é a "linha vermelha" mais crítica
  (`docs/research/14-licencas-legal.md` §5.4, §8.3). Game-icons.net exige
  atribuição (CC-BY) → deve constar no `NOTICE`.

### D6 — Etmos: presunção de direitos reservados; uso privado OK, distribuição requer autorização

O SRD do ETMOS (Balde Galáctico, autoria Rafa Reis) **não declara licença aberta**
→ presume-se **"todos os direitos reservados"**. Consequências:

- **Uso privado do grupo do GM**: implementar o sistema ETMOS no Fusion e jogar é
  tratado como uso privado de baixo risco, análogo a digitar a própria ficha.
- **Distribuição** do pacote `systems/etmos` e seus packs (as 81 Partículas, fichas,
  origens, etc.) a terceiros **exige autorização explícita da Balde Galáctico**.
  Sem autorização, o pacote Etmos é mantido **fora de qualquer distribuição
  pública** (privado/local apenas) — gate técnico em build/release.
- **Símbolos rúnicos das Partículas** (`particulas-v3.pdf`): são **arte proprietária**
  → não redistribuir; usar placeholders próprios até obter vetoriais autorizados.
- **Créditos**: qualquer build que inclua Etmos preserva os créditos de autoria
  (Rafa Reis; direção, edição, arte — `docs/research/12b-etmos-fontes-locais.md` §1).

- **Alternativas rejeitadas:**
  - _Tratar o SRD como aberto por ser "SRD"_ — rejeitada: "SRD" no nome não implica
    licença aberta; sem texto de licença, a presunção é direitos reservados.
  - _Distribuir Etmos publicamente "creditando a editora"_ — rejeitada: crédito não
    substitui autorização para redistribuir obra protegida.
- **Racional:** `docs/research/12b-etmos-fontes-locais.md` §0 recomenda
  explicitamente negociar permissão ou verificar licença em repositório público
  antes de uso distribuído.

### D7 — Plano de contato com a Balde Galáctico (registrado, com gate)

Registrar formalmente a intenção de contatar a Balde Galáctico para obter
autorização de distribuição do `systems/etmos`. Até resposta favorável por escrito,
o pacote Etmos permanece marcado como **não-distribuível** (privado). A spec mantém
o item de contato como **tarefa rastreável**, não como bloqueio do uso privado.

- **Alternativa rejeitada:** _adiar indefinidamente o contato e só usar em privado_ —
  aceitável tecnicamente, mas registramos o plano para destravar distribuição futura.
- **Racional:** abrir o canal cedo maximiza a chance de uma licença explícita
  (até CC ou permissão escrita), que removeria o gate.

### D8 — Licença do Fusion: privado inicialmente; MIT para a engine se aberto (sem packs de dados)

O Fusion **inicia como software privado** (não publicado) — menor superfície de
risco. **Se** for aberto no futuro, a recomendação é **MIT para a engine** (código
de `packages/server`, `packages/client`, `packages/shared`, `packages/system-api` e a lógica dos sistemas),
**excluindo** explicitamente os **packs de dados** (que carregam suas próprias
licenças: ORC/OGL para PF2e/SF2e; direitos reservados para Etmos). Os packs **não**
são redistribuídos sob MIT.

- **Alternativas rejeitadas:**
  - _GPL/AGPL para a engine_ — rejeitada: copyleft forte atritaria com a intenção
    de manter flexibilidade e com a separação engine/dados; sem benefício claro
    para um projeto majoritariamente self-hosted de um grupo.
  - _Abrir já no MVP_ — rejeitada: distribuição pública eleva risco antes de termos
    a separação de conteúdo e os notices totalmente maduros.
- **Racional:** MIT é permissiva, compatível com o ecossistema (dependências
  majoritariamente MIT), e a **separação física engine/dados** (decisão
  arquitetural com implicação legal — `docs/research/14-licencas-legal.md` §11)
  deixa claro que o código não está sob ORC e que os dados têm regime próprio.

### D9 — Separação física conteúdo vs. código (clareza legal por construção)

Os **dados** licenciados (ORC/OGL) e os de direitos reservados (Etmos) residem em
**arquivos de pack separados** do código da aplicação (alinhado a
`ver 16-compendiums-e-importacao.md`, que define `pack.db` por pack). Cada pack
carrega **metadados de licença** próprios. Isso torna evidente que o código
proprietário do Fusion não está sob ORC e que cada corpo de conteúdo tem seu regime.

- **Alternativa rejeitada:** _embutir dados no código (hardcode de stat blocks)_ —
  rejeitada: borra a fronteira legal código/conteúdo e dificulta o gate de
  distribuição do Etmos.
- **Racional:** decisão arquitetural com implicação legal direta
  (`docs/research/14-licencas-legal.md` §11.1, §11.2).

### D10 — Inventário de licenças de dependências + arquivo NOTICE obrigatório

Toda dependência de runtime tem sua licença inventariada (campo SPDX); a
predominância esperada é **MIT**, com a exceção conhecida do **código de referência
Apache-2.0** do `pf2e`. Um arquivo **`NOTICE`** na raiz agrega: avisos de copyright
de dependências que os exigem (Apache-2.0), atribuições de assets CC-BY
(Game-icons.net), e os notices ORC. O `NOTICE` é gerado/validado no pipeline de
release.

- **Alternativa rejeitada:** _confiar que "tudo é MIT"_ — rejeitada: exceções
  (Apache-2.0, CC-BY) têm obrigações de atribuição que, se omitidas, criam não
  conformidade.
- **Racional:** `docs/research/14-licencas-legal.md` §7 e §10 listam as
  obrigações; a verificação automatizada evita regressão a cada nova dependência.

---

## Requisitos funcionais

> Cada requisito é testável. Tags [MVP]/[V2] alinhadas à definição de MVP global
> (jogar uma sessão de PF2e). Requisitos de Etmos/SF2e de distribuição são [V2]
> quando dependem de autorização externa; os gates de proibição são [MVP] porque
> precisam existir desde o início para evitar violação.

### Clean-room e marca

- **REQ-LEG-001** [MVP] O repositório DEVE conter um documento `CONTRIBUTING`/seção
  de governança que declare a política clean-room: contribuidores não podem
  descompilar, desassemblar ou copiar código do **Foundry core**; só é permitido
  estudar documentação pública, comportamento observável e código Apache-2.0 do
  `foundryvtt/pf2e`.
- **REQ-LEG-002** [MVP] A equipe interna DEVE adotar a disciplina clean-room:
  todo membro que possua licença do Foundry e tenha estudado seu código core
  **não pode implementar** os módulos correspondentes (atua apenas como
  especificador). [V2] Quando houver contribuidores externos, DEVE existir um
  mecanismo formal de **declaração de não-contaminação** (ex.: linha no PR ou
  DCO estendido) para cada contribuição recebida — ver Q7 (Questões em aberto).
- **REQ-LEG-003** [MVP] Nenhum artefato distribuível (binário, instalador, título
  de janela, metadados de pacote `package.json`, nome de arquivo) PODE conter as
  marcas "Pathfinder", "Starfinder", "Paizo", o golem Paizo, ou usar "Foundry"
  como nome do produto. Um teste de build DEVE falhar se essas strings aparecerem
  em campos de identidade do produto.
- **REQ-LEG-004** [MVP] O nome e o branding do produto DEVEM ser "Fusion" /
  "Fusion VTT" de forma autônoma, sem sufixo que implique endorsement Paizo (ex.:
  "Fusion VTT for Pathfinder" é proibido como nome oficial).

### ORC / OGL (PF2e e SF2e)

- **REQ-LEG-005** [MVP] Qualquer release que inclua conteúdo mecânico de PF2e (e,
  quando aplicável, SF2e) DEVE embutir, em local acessível ao usuário (UI "Sobre"
  e/ou arquivo `NOTICE`), o **ORC Notice** — cujo texto da licença está registrado
  na Library of Congress sob **TX 9-307-067** (registro do documento de licença) —,
  o **Attribution Notice** (autores dos produtos Paizo usados) e o **Reserved
  Material Notice** (texto literal em `## Modelo de dados`).
- **REQ-LEG-006** [MVP] O Fusion DEVE priorizar conteúdo do **remaster** (ORC). Se
  conteúdo legado **OGL** for incluído, ele DEVE ser rastreado em pack separado e
  acompanhado do texto da **OGL 1.0a** correspondente.
- **REQ-LEG-007** [MVP] Cada pack importado DEVE registrar o metadado de licença de
  origem (`publication.license`: `ORC` | `OGL` | proprietária) por documento/pack,
  permitindo auditoria e o gate de distribuição.
- **REQ-LEG-008** [V2] Em caso de notificação de violação de ORC, o sistema/processo
  DEVE permitir correção dentro do **período de cura de 60 dias** previsto na
  licença (procedimento documentado no checklist de release).
- **REQ-LEG-009** [MVP] O produto NÃO PODE exibir o logo "Compatible with
  Pathfinder"/"Starfinder Compatible" nem qualquer logo Paizo. PODE usar texto
  **descritivo** de compatibilidade (ex.: "suporta as regras do Pathfinder Second
  Edition Remaster"), sem implicar endorsement.
- **REQ-LEG-009A** [MVP] O Fusion NÃO PODE se apresentar como "fan content" Paizo
  nem invocar a Fan Content Policy nem a Community Use Policy como base legal.
  Materiais de marketing e documentação de usuário não podem usar as expressões
  "fan content" ou "community use" em referência ao Fusion, pois "rules
  compendiums" e "character generators" estão expressamente excluídos da Fan
  Content Policy (`docs/research/14-licencas-legal.md` §4.2). A base legal
  exclusiva para conteúdo mecânico é a **ORC License**.

### Dados do `foundryvtt/pf2e`

- **REQ-LEG-010** [MVP] A importação de packs PF2e/SF2e DEVE **filtrar** campos:
  importar apenas dados mecânicos (valores, traits, ações, condições, fórmulas) e
  **descartar** texto de lore/setting (Reserved Material).
- **REQ-LEG-011** [MVP] A importação DEVE **substituir** toda referência de arte
  Paizo por um placeholder de fonte livre (ou path neutro), **nunca** copiando o
  arquivo de imagem proprietário para o pack do Fusion.
- **REQ-LEG-012** [MVP] Todo arquivo de código do Fusion adaptado conceitualmente do
  `foundryvtt/pf2e` (Apache-2.0) DEVE preservar um aviso de atribuição (ex.:
  cabeçalho "Portions adapted from foundryvtt/pf2e, Apache-2.0"), e o `NOTICE` DEVE
  listar o copyright dos contribuidores pf2e.

### Assets e arte

- **REQ-LEG-013** [MVP] Cada asset de substituição (placeholder/ícone/arte) incluído
  no produto DEVE ter sua licença registrada (SPDX) e, quando exigir atribuição
  (ex.: CC-BY/Game-icons.net), constar no `NOTICE`. Ver `ver 20-assets-e-midia.md`.
- **REQ-LEG-014** [MVP] O produto NÃO PODE incluir arte, tokens, ícones de condição,
  ilustrações de itens/spells ou mapas oriundos do repositório `pf2e`/Foundry. Um
  passo de auditoria de assets DEVE detectar e bloquear esses arquivos.

### Etmos

- **REQ-LEG-015** [MVP] O pacote `systems/etmos` e seus packs DEVEM ser marcados
  como **não-distribuíveis** (licença interna "all-rights-reserved / Balde
  Galáctico — uso privado") enquanto não houver autorização escrita da editora.
- **REQ-LEG-016** [MVP] O pipeline de **build de distribuição pública** DEVE
  **excluir** automaticamente o pacote Etmos e seus packs (gate técnico), permitindo
  sua inclusão apenas em builds privados/locais do grupo.
- **REQ-LEG-017** [MVP] Builds que incluam Etmos (privados) DEVEM preservar os
  **créditos de autoria** (Rafa Reis e equipe da Balde Galáctico) na UI "Sobre".
- **REQ-LEG-018** [MVP] Os **símbolos rúnicos** das Partículas (arte proprietária)
  NÃO PODEM ser redistribuídos; o sistema DEVE usar placeholders próprios até obter
  vetoriais autorizados.
- **REQ-LEG-019** [V2] DEVE existir um item rastreável de **contato com a Balde
  Galáctico** para obter autorização de distribuição (e idealmente uma licença
  explícita), cujo desfecho favorável remove o gate do REQ-LEG-016.

### Licença do Fusion e dependências

- **REQ-LEG-020** [MVP] O repositório DEVE declarar o status de licenciamento da
  engine: **privado** por padrão. A abertura futura, se ocorrer, DEVE usar **MIT**
  para a engine e **excluir** os packs de dados do escopo MIT.
- **REQ-LEG-021** [MVP] O **código** (engine) e os **dados** (packs) DEVEM permanecer
  fisicamente separados (packs em arquivos próprios com metadados de licença),
  conforme `ver 16-compendiums-e-importacao.md`.
- **REQ-LEG-022** [MVP] O projeto DEVE manter um **inventário de licenças de
  dependências** (SPDX por dependência de runtime), gerado/atualizado no pipeline,
  sinalizando qualquer licença que não seja permissiva (não-MIT/Apache/BSD/ISC) para
  revisão humana.
- **REQ-LEG-023** [MVP] O projeto DEVE manter um arquivo **`NOTICE`** na raiz,
  agregando: avisos Apache-2.0 (pf2e e outras deps Apache), atribuições CC-BY de
  assets, e os notices ORC. O pipeline DEVE **falhar** se uma dependência/asset que
  exige atribuição não estiver refletida no `NOTICE`.

### Processo e auditoria

- **REQ-LEG-024** [MVP] DEVE existir um **checklist legal por release** (em
  `## Critérios de aceitação`), executado e registrado antes de qualquer build de
  distribuição, cobrindo marcas, notices, arte, Etmos-gate e inventário.
- **REQ-LEG-025** [V2] DEVE existir uma rotina de **auditoria periódica** que
  revalide o inventário de dependências e a presença dos notices à medida que o
  conteúdo importado é atualizado (acompanhando releases do `foundryvtt/pf2e`).

## Requisitos não-funcionais

- **RNF-LEG-001 (Verificabilidade):** as proibições críticas (marcas, arte
  proprietária, Etmos em build público) DEVEM ser verificadas por **checagens
  automatizadas** no CI/pipeline, não apenas por revisão manual.
- **RNF-LEG-002 (Rastreabilidade):** cada documento de pack e cada asset DEVE
  carregar metadado de licença consultável (origem, SPDX, atribuição exigida).
- **RNF-LEG-003 (Reversibilidade do risco):** o gate de distribuição do Etmos e a
  exclusão de arte proprietária DEVEM ser configuráveis por **tipo de build**
  (privado/local vs. público), sem exigir mudança de código.
- **RNF-LEG-004 (Atualidade):** o conteúdo PF2e/SF2e só DEVE ser importado após a
  "street release" da Paizo do material correspondente (alinhado à política de
  contribuição do próprio `pf2e`).
- **RNF-LEG-005 (Minimalismo de exposição):** enquanto não houver revisão jurídica
  formal, o Fusion DEVE operar no modo de **menor risco** (uso privado do grupo,
  sem monetização, sem marcas Paizo).
- **RNF-LEG-006 (Documentação viva):** esta spec é normativa; mudanças de política
  (ex.: nova política Paizo, resposta da Balde Galáctico, decisão de abrir o código)
  DEVEM atualizar este documento e o `NOTICE`/checklist correspondentes.

## Modelo de dados

Estruturas TypeScript para rastrear licenças e os textos de notice embutidos.

```typescript
/** Identificador SPDX simplificado das licenças usadas no projeto. */
type LicenseId =
  | "MIT"
  | "Apache-2.0"
  | "BSD-2-Clause"
  | "BSD-3-Clause"
  | "ISC"
  | "CC0-1.0"
  | "CC-BY-3.0"
  | "CC-BY-4.0"
  | "ORC" // Open RPG Creative License (conteúdo, não SPDX oficial)
  | "OGL-1.0a" // Open Game License (conteúdo)
  | "all-rights-reserved"; // ex.: Etmos / Balde Galáctico

/** Tipo de build — controla os gates legais. */
type BuildKind = "private-local" | "public-distribution";

/** Metadado de licença por pack de conteúdo (ver 16-compendiums-e-importacao.md). */
interface PackLicenseMeta {
  packId: string;
  system: "pf2e" | "sf2e" | "etmos";
  /** Licença predominante do conteúdo mecânico do pack. */
  contentLicense: Extract<LicenseId, "ORC" | "OGL-1.0a" | "all-rights-reserved">;
  /** Metadado de publicação por documento, quando disponível (publication.license). */
  remaster: boolean;
  /** Se true, o pack é excluído de builds public-distribution (ex.: Etmos). */
  distributable: boolean;
  /** Atribuição obrigatória a embutir no NOTICE (autores upstream). */
  attribution: string[];
  /** Notas (ex.: "art stripped", "lore discarded"). */
  notes?: string;
}

/** Metadado de licença por asset (ver 20-assets-e-midia.md). */
interface AssetLicenseMeta {
  path: string;
  license: LicenseId;
  source: string; // "game-icons.net", "kenney.nl", "commissioned", ...
  requiresAttribution: boolean;
  attributionText?: string; // exigido se requiresAttribution
  /** Marca arte que NUNCA pode entrar (Paizo/Foundry) — usado pela auditoria. */
  forbiddenOrigin?: "paizo" | "foundry" | "etmos-runes";
}

/** Entrada do inventário de dependências. */
interface DependencyLicense {
  name: string;
  version: string;
  license: LicenseId;
  permissive: boolean; // false → revisão humana (RNF-LEG-001)
  noticeRequired: boolean; // Apache-2.0/CC-BY → true
}

/** Resultado do checklist legal de um release. */
interface ReleaseLegalAudit {
  buildKind: BuildKind;
  brandScanPassed: boolean; // REQ-LEG-003
  orcNoticePresent: boolean; // REQ-LEG-005
  artAuditPassed: boolean; // REQ-LEG-014
  etmosGateRespected: boolean; // REQ-LEG-016
  noticeFileComplete: boolean; // REQ-LEG-023
  depInventoryClean: boolean; // REQ-LEG-022
  timestamp: string;
  signedOffBy: string;
}
```

### Textos normativos de notice (a embutir literalmente)

**ORC Notice + Reserved Material Notice (PF2e/SF2e):**

```
This product is licensed under the ORC License held in the Library of Congress at
TX 9-307-067 and available online at various locations including paizo.com/orclicense
and others.

Attribution Notice: [lista dos produtos/autores Paizo cujas mecânicas foram usadas].

Reserved Material: All trademarks, registered trademarks, proper nouns (characters,
deities, locations, etc., as well as all adjectives, names, titles, and descriptive
terms derived from proper nouns), artworks, characters, dialogue, locations,
organizations, plots, storylines, and trade dress. (c) Paizo Inc.
```

**OGL 1.0a (somente se conteúdo legado for incluído):** embutir o texto completo da
Open Game License 1.0a e a `COPYRIGHT NOTICE` section listando as obras usadas.

**Atribuição Apache-2.0 (código adaptado do pf2e):**

```
Portions of the rules-implementation logic are adapted conceptually from
foundryvtt/pf2e, licensed under the Apache License, Version 2.0.
Copyright [year] pf2e contributors.
```

**Crédito Etmos (builds privados que incluam o sistema):**

```
Sistema ETMOS RPG (c) Balde Galáctico — autoria de Rafa Reis. Usado em caráter
privado pelo grupo. Distribuição não autorizada.
```

## API e eventos

Esta spec não define eventos de socket nem endpoints REST próprios. Ela impõe
**hooks de build/CI** consumidos por outras specs:

- `legal:brandScan(artifacts) -> { passed, offendingStrings[] }` — varre artefatos
  por marcas proibidas (REQ-LEG-003). Falha o build se houver match.
- `legal:artAudit(assets[]) -> { passed, forbidden[] }` — detecta assets com
  `forbiddenOrigin` (REQ-LEG-014).
- `legal:etmosGate(buildKind, packs[]) -> { passed, leaked[] }` — garante exclusão
  do Etmos em `public-distribution` (REQ-LEG-016).
- `legal:noticeCheck(deps[], assets[], packs[]) -> { complete, missing[] }` —
  valida que toda atribuição obrigatória está no `NOTICE` (REQ-LEG-023).
- `legal:depInventory() -> DependencyLicense[]` — gera o inventário SPDX e sinaliza
  não-permissivas (REQ-LEG-022).

A UI do cliente (`ver 11-ui-framework-e-fichas.md`) deve expor uma tela/seção
**"Sobre / Licenças"** que renderiza o conteúdo do `NOTICE` e os notices ORC
(REQ-LEG-005, REQ-LEG-017).

## Dependências

Specs irmãs com relação direta:

- `ver 00-visao-e-escopo.md` — resume a postura legal e aponta esta spec como fonte
  normativa.
- `ver 16-compendiums-e-importacao.md` — implementa a importação/filtragem de dados
  e os metadados de licença por pack que esta spec exige (REQ-LEG-007, 010, 011).
- `ver 20-assets-e-midia.md` — implementa placeholders e carrega o `AssetLicenseMeta`
  (REQ-LEG-011, 013, 014, 018).
- `ver 17-sistema-pf2e.md` e `ver 18-sistema-sf2e.md` — consomem as mecânicas ORC e
  exibem os notices (REQ-LEG-005, 009).
- `ver 19-sistema-etmos.md` — sistema sujeito ao gate de distribuição (REQ-LEG-015
  a 019).
- `ver 22-instalacao-e-distribuicao.md` — executa os gates de build por `BuildKind`
  e empacota o `NOTICE` (REQ-LEG-016, 023, 024).
- `ver 21-seguranca.md` e `ver 24-operacao-backups-telemetria.md` — privacidade/LGPD
  e telemetria (cruzamento fora do escopo desta spec).

## Critérios de aceitação

### Checklist legal por release (executar antes de cada build de distribuição)

1. **Marca:** `legal:brandScan` passa — nenhuma string "Pathfinder", "Starfinder",
   "Paizo", golem ou "Foundry-como-nome" em campos de identidade (REQ-LEG-003/004).
2. **ORC Notice:** o ORC Notice (TX 9-307-067) + Attribution + Reserved Material
   estão presentes na UI "Sobre" e no `NOTICE` quando há conteúdo PF2e/SF2e
   (REQ-LEG-005).
3. **Arte:** `legal:artAudit` passa — nenhum asset com `forbiddenOrigin`
   `paizo`/`foundry`/`etmos-runes` no build (REQ-LEG-014/018).
4. **Filtragem de dados:** packs importados não contêm lore/setting Paizo
   (amostragem) e referências de arte foram substituídas (REQ-LEG-010/011).
5. **Etmos gate:** em `public-distribution`, `legal:etmosGate` confirma ausência do
   pacote/packs Etmos; em `private-local`, créditos de autoria presentes
   (REQ-LEG-016/017).
6. **NOTICE:** `legal:noticeCheck` confirma que toda atribuição obrigatória
   (Apache-2.0, CC-BY, ORC) está no `NOTICE` (REQ-LEG-023).
7. **Inventário de deps:** `legal:depInventory` não lista licença não-permissiva sem
   aprovação humana registrada (REQ-LEG-022).
8. **Atribuição de código:** arquivos adaptados do pf2e carregam o cabeçalho
   Apache-2.0 (REQ-LEG-012).
9. **Registro:** o `ReleaseLegalAudit` resultante é assinado e arquivado.

### Critérios gerais

- **CA-1:** Um build `public-distribution` que contenha qualquer marca Paizo, arte
  proprietária ou o pacote Etmos **falha** automaticamente (RNF-LEG-001).
- **CA-2:** A tela "Sobre / Licenças" renderiza os notices ORC e o `NOTICE`
  agregado de forma legível ao usuário final.
- **CA-3:** Cada pack tem `PackLicenseMeta` válido; cada asset tem
  `AssetLicenseMeta` válido (RNF-LEG-002).
- **CA-4:** O documento de governança/contribuição contém a política clean-room e o
  mecanismo de declaração de não-contaminação (REQ-LEG-001/002).
- **CA-5:** Existe um item rastreável de contato com a Balde Galáctico (REQ-LEG-019).

## Questões em aberto

- **Q1 (Revisão jurídica):** este documento precisa de validação por advogado antes
  de qualquer **distribuição pública** ou **monetização**? Recomendação: sim, antes
  de sair do regime privado.
- **Q2 (Marca "Fusion"):** verificação de USPTO/INPI para "Fusion" + software/games
  ainda **pendente** (`docs/research/14-licencas-legal.md` §9.3). Existe risco de
  colisão de marca a confirmar.
- **Q3 (Etmos — autorização):** a Balde Galáctico aceitará licenciar/autorizar a
  distribuição? Em que termos (CC, permissão escrita, gratuidade)? Define se o gate
  do REQ-LEG-016 cai. Status do SRD em repositório público a reverificar.
- **Q4 (SF2e — status de publicação):** confirmar o estado de release do Starfinder
  2e em 2026 (playtest vs. lançado) e se o conteúdo já está sob ORC no
  `foundryvtt/pf2e` (compartilha codebase com pf2e) antes de importar.
- **Q5 (OGL legado):** será necessário incluir algum conteúdo PF2e **pré-remaster**
  (OGL)? Se não, simplifica todo o regime (só ORC). Decisão default: **não incluir**.
- **Q6 (Arte por IA):** adotar arte gerada por IA como fonte de placeholders? Status
  legal ambíguo em 2026; depende da licença da ferramenta — manter como decisão
  caso-a-caso, não política padrão.
- **Q7 (Comunidade externa):** se o Fusion ganhar contribuidores externos, como
  garantir a cadeia clean-room e a proveniência de assets de terceiros submetidos?
- **Q8 (Privacidade):** termos de uso e tratamento de dados de jogadores (LGPD) —
  pertencem a `ver 21-seguranca.md`/`ver 24-operacao-backups-telemetria.md`; falta
  confirmar a fronteira e se algum aviso legal precisa aparecer aqui.

## Referências

- `docs/research/14-licencas-legal.md` — pesquisa completa de licenças/legal do Fusion.
- `docs/research/12b-etmos-fontes-locais.md` — fontes locais e licença do ETMOS RPG.
- `docs/research/10-pf2e-sistema-internals.md` — internals e camadas de licença do `foundryvtt/pf2e`.
- Open RPG Creative License — paizo.com/orclicense (Library of Congress TX 9-307-067).
- Open Game License 1.0a — Wizards of the Coast.
- Paizo Licenses (Fan Content, Community Use, Compatibility, Commercial) — paizo.com/licenses.
- Apache License 2.0 — apache.org/licenses/LICENSE-2.0.
- Foundry VTT — Software License, Terms of Service, Brand Guidelines (foundryvtt.com/article/\*).
- Game-icons.net (CC-BY-3.0), Kenney.nl (CC0), OpenGameArt.org — fontes de assets livres.
- Etmos RPG — Editora Balde Galáctico (baldegalactico.com.br/jogo/etmos).
